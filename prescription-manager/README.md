# Gacky 処方箋管理システム

グランファルマ株式会社向けオンライン処方箋受付管理システム

## 概要

このシステムは、LINE公式アカウント「AIジブンカラダ Gacky」を通じて、オンライン処方箋受付を一元管理するためのWebアプリケーションです。

### 主な機能

1. **処方箋受付** - お客様がGackyに処方箋画像を送信
2. **管理者確認** - 管理者が処方箋を確認し、店舗に割り振り
3. **店舗⇔お客様メッセージ** - Gacky経由で店舗とお客様がやりとり
4. **準備完了通知** - お薬の準備完了をお客様にLINE通知

### AI応答スキップ機能

店舗がお客様にメッセージを送信すると、そのお客様との会話は一時的に「店舗とのやりとりモード」に切り替わります。
この間、お客様からのメッセージはAI自動応答をスキップし、店舗にルーティングされます。

セッションタイムアウト（デフォルト30分）後、自動的に通常のAI応答モードに戻ります。

## アーキテクチャ

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          システム構成                                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  【お客様】              【Gacky LINE Bot】           【管理画面】           │
│                                                                             │
│  ┌───────────┐         ┌─────────────────┐         ┌───────────────┐       │
│  │   LINE    │◀───────▶│   Lambda       │◀───────▶│  Next.js     │       │
│  │   App     │         │   (Node.js)    │         │  Web App     │       │
│  └───────────┘         └────────┬────────┘         └───────────────┘       │
│                                 │                                          │
│                        ┌────────▼────────┐                                 │
│                        │   DynamoDB      │                                 │
│                        │ ・処方箋受付     │                                 │
│                        │ ・メッセージ     │                                 │
│                        │ ・セッション     │                                 │
│                        └────────┬────────┘                                 │
│                                 │                                          │
│                        ┌────────▼────────┐                                 │
│                        │      S3         │                                 │
│                        │ ・処方箋画像     │                                 │
│                        └─────────────────┘                                 │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## DynamoDBテーブル

**注意**: テーブル名は環境によって異なります（例: dev環境では `-dev` サフィックスが付きます）

### gacky-prescription-prescriptions-{env}
処方箋受付情報を管理

| キー | 型 | 説明 |
|------|-----|------|
| receptionId (PK) | String | 受付ID |
| timestamp (SK) | String | 受付日時 |
| userId | String | LINE ユーザーID |
| status | String | ステータス（pending/confirmed/preparing/ready/completed/cancelled） |
| messagingSessionStatus | String | メッセージセッション状態（inactive/active/closed） |

### gacky-prescription-messages-{env}
店舗⇔お客様のメッセージを管理

| キー | 型 | 説明 |
|------|-----|------|
| receptionId (PK) | String | 受付ID |
| messageId (SK) | String | メッセージID |
| senderType | String | 送信者タイプ（customer/store/system） |
| content | String | メッセージ内容 |

### gacky-prescription-sessions-{env}
お客様のメッセージングセッション状態を管理（AI応答スキップ判定用）

| キー | 型 | 説明 |
|------|-----|------|
| userId (PK) | String | LINE ユーザーID |
| activeReceptionId | String | アクティブな受付ID |
| messagingSessionStatus | String | セッション状態 |
| lastStoreMessageAt | String | 最後の店舗メッセージ日時 |

### gacky-prescription-video-calls-{env}
ビデオ通話ルーム情報を管理（オンライン服薬指導用）

| キー | 型 | 説明 |
|------|-----|------|
| roomId (PK) | String | ルームID |
| receptionId | String | 受付ID |
| status | String | ステータス（waiting/active/ended） |
| storeId | String | 店舗ID |
| customerId | String | お客様のLINE ユーザーID |
| ttl | Number | TTL（24時間後に自動削除） |

### gacky-prescription-push-subscriptions-{env}
プッシュ通知の購読情報を管理（リアルタイム通知用）

| キー | 型 | 説明 |
|------|-----|------|
| subscriptionId (PK) | String | 購読ID（エンドポイントのハッシュ） |
| endpoint | String | Web Push エンドポイントURL |
| keys | Object | プッシュ通知用の暗号化キー |
| userId | String | ユーザーID |
| userType | String | ユーザータイプ（admin/store_staff） |
| storeId | String | 店舗ID（店舗スタッフの場合） |
| isActive | Boolean | アクティブ状態 |

## セットアップ

### 前提条件

- Node.js 18+
- AWS CLI設定済み
- LINE Messaging API設定済み

### インストール

```bash
cd prescription-manager
npm install
```

### 開発サーバー起動

```bash
npm run dev
```

### CloudFormationでテーブル作成

```bash
aws cloudformation deploy \
  --template-file cloudformation-tables.yaml \
  --stack-name gacky-prescription-tables \
  --parameter-overrides Environment=dev \
  --capabilities CAPABILITY_IAM \
  --profile gacky-admin
```

### S3 Bucket 作成

```bash
aws s3 mb s3://gacky-prescriptions-dev --region ap-northeast-1 --profile gacky-admin
```

## 環境変数

### Lambda (gacky-bot)

```
TABLE_PRESCRIPTIONS=gacky-prescription-prescriptions-dev
TABLE_MESSAGES=gacky-prescription-messages-dev
TABLE_CUSTOMER_SESSIONS=gacky-prescription-sessions-dev
PRESCRIPTION_BUCKET=gacky-prescriptions
TABLE_VIDEO_CALLS=gacky-prescription-video-calls-dev

# リアルタイム通知用（新規追加）
TABLE_PUSH_SUBSCRIPTIONS=gacky-prescription-push-subscriptions-dev
VAPID_PUBLIC_KEY=<VAPID公開鍵>
VAPID_PRIVATE_KEY=<VAPID秘密鍵>
VAPID_SUBJECT=mailto:admin@granpharma.co.jp

# メール通知用（SES）
SES_FROM_EMAIL=noreply@granpharma.co.jp
ADMIN_EMAIL_ADDRESSES=admin1@granpharma.co.jp,admin2@granpharma.co.jp
PRESCRIPTION_MANAGER_URL=https://your-amplify-app-url.amplifyapp.com
```

### Web App (Amplify)

```
APP_AWS_REGION=ap-northeast-1
TABLE_PRESCRIPTIONS=gacky-prescription-prescriptions-dev
TABLE_MESSAGES=gacky-prescription-messages-dev
TABLE_CUSTOMER_SESSIONS=gacky-prescription-sessions-dev
TABLE_STORES=gacky-prescription-stores-dev
TABLE_VIDEO_CALLS=gacky-prescription-video-calls-dev
TABLE_PUSH_SUBSCRIPTIONS=gacky-prescription-push-subscriptions-dev
NEXT_PUBLIC_APP_URL=https://your-amplify-app-url.amplifyapp.com

# Cognito認証設定（必須）
NEXT_PUBLIC_AWS_REGION=ap-northeast-1
NEXT_PUBLIC_COGNITO_USER_POOL_ID=ap-northeast-1_XXXXXXXXX
NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID=XXXXXXXXXXXXXXXXXXXXXXXXXX

# Web Push通知用（新規追加）
NEXT_PUBLIC_VAPID_PUBLIC_KEY=<VAPID公開鍵>
```

**注意**: テーブル名は CloudFormation テンプレート (`cloudformation-tables.yaml`) および `src/lib/dynamodb.ts` のデフォルト値と一致させてください。

## Cognito認証の設定

本システムはAWS Cognitoによる認証を使用しています。以下の手順でCognitoをセットアップしてください。

### 1. Cognito User Poolの作成

AWSコンソールで以下の手順を実行してください：

1. **AWSコンソール** → **Cognito** → **ユーザープールを作成**

2. **サインイン方法の設定**:
   - 「ユーザー名」と「Eメール」を選択
   - ユーザー名の要件: 大文字小文字を区別しない（推奨）

3. **パスワードポリシー**:
   - 最小長: 8文字以上
   - 大文字、小文字、数字、特殊文字を含める（推奨）

4. **MFA**（多要素認証）:
   - 本番環境では有効化を推奨
   - テスト時は「オプション」または「なし」でも可

5. **セルフサービス機能**:
   - 「自己登録を有効にする」: **無効**（管理者がユーザーを作成）
   - 「Cognitoがユーザーアカウントの復旧を自動的に検証および確認できるようにする」: 有効

6. **アプリケーションクライアントの作成**:
   - アプリケーションタイプ: 「パブリッククライアント」
   - 認証フロー: `ALLOW_USER_SRP_AUTH`, `ALLOW_REFRESH_TOKEN_AUTH` を有効化
   - クライアントシークレット: **生成しない**（ブラウザアプリケーションのため）

7. **User Pool名**: `gacky-prescription-users-{env}`（例: `gacky-prescription-users-dev`）

### 2. ユーザーの作成

#### 管理者ユーザー（メールアドレスでログイン）

AWSコンソールの「ユーザー」タブから、以下の管理者を作成してください：

| ユーザー名（メールアドレス） | 役割 |
|------------------------------|------|
| admin-vpp-line@granpharma.co.jp | 管理者 |
| granpharmaline@gmail.com | 管理者 |

**作成手順**:
1. 「ユーザーを作成」をクリック
2. ユーザー名: メールアドレスを入力
3. Eメールアドレス: 同じメールアドレスを入力
4. 「Eメールで招待を送信」を選択（または仮パスワードを設定）
5. 作成後、初回ログイン時にパスワード変更が必要

#### 店舗スタッフユーザー（店舗IDまたはメールアドレスでログイン）

**方法A: 店舗ID形式のユーザー**（メールアドレスなしのスタッフ用）

| ユーザー名 | 説明 |
|------------|------|
| store_utsushi | 写薬局のスタッフアカウント |
| store_utsushi-staff | 写薬局スタッフアカウント（別名） |
| store_morimoto | 森本店のスタッフアカウント |
| store_kanazawa | 金沢店のスタッフアカウント |

**作成手順**:
1. 「ユーザーを作成」をクリック
2. ユーザー名: `store_xxx` 形式で入力
3. 仮パスワードを設定（管理者から店舗に伝達）
4. Eメールアドレス: 空白のまま（またはダミーアドレス）

**方法B: メールアドレス形式のユーザー**（メールアドレスを持つスタッフ用）

このタイプのスタッフは、ログイン後に右上の歯車アイコンから担当店舗を設定できます。

### 3. 店舗IDの命名規則

店舗IDでログインする場合、ユーザー名は `store_` プレフィックスで始める必要があります：

```
store_<店舗識別子>
```

例:
- `store_utsushi` - 写薬局
- `store_morimoto` - 森本店
- `store_007` - 店舗マスタのstoreIdと一致させる場合

### 4. 環境変数の設定

User Pool作成後、以下の情報を環境変数に設定してください：

1. **User Pool ID**: ユーザープールの詳細ページに表示
   → `NEXT_PUBLIC_COGNITO_USER_POOL_ID`

2. **App Client ID**: アプリケーションクライアントの「クライアントID」
   → `NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID`

### 5. ロールと権限

| ロール | ログイン方法 | 権限 |
|--------|--------------|------|
| 管理者 (admin) | 登録済みメールアドレス | すべての受付閲覧、店舗割振り |
| 店舗スタッフ (store_staff) | 店舗ID or メールアドレス | 自分の店舗の受付のみ閲覧 |

**店舗スタッフの店舗設定**:
- 店舗IDでログイン: 自動的にその店舗が割り当て
- メールアドレスでログイン: 歯車アイコンから店舗を選択して設定

## UXフロー

### お客様のジャーニー

1. **処方箋送信** → Gackyに処方箋画像を送る
2. **受付確認** → 受付番号を受け取る
3. **店舗選択** → （将来）希望店舗を選択
4. **やりとり** → 必要に応じて店舗とメッセージ
5. **準備完了通知** → お薬の準備完了をLINE通知で受け取る
6. **受取** → 店舗でお薬を受け取る

### 管理者/店舗スタッフのジャーニー

1. **受付確認** → 新規受付を確認
2. **処方箋確認** → 画像を目視確認
3. **店舗割振り** → 対応店舗を選択
4. **メッセージ** → 必要に応じてお客様にメッセージ
5. **準備完了** → お薬の準備が完了したら通知ボタンを押す

## 今後の拡張

- [ ] 処方箋OCR（自動読み取り）
- [ ] 在庫連携
- [ ] 位置情報による店舗推薦
- [ ] お薬手帳統合
- [ ] 決済連携

## リアルタイム通知のセットアップ

処方箋受付時に店舗スタッフ・管理者にリアルタイム通知を送信する機能です。

### 通知の種類

| 通知先 | 方法 | トリガー |
|--------|------|----------|
| 店舗スタッフ | Web Push通知（ブラウザ） | 自分の店舗に処方箋が届いた時 |
| 管理者 | メール通知（SES） | 店舗未割当の処方箋が届いた時 |

### 1. VAPID鍵の生成

Web Push通知には VAPID（Voluntary Application Server Identification）鍵が必要です。
以下のコマンドで生成できます：

```bash
# Node.js環境で実行
npx web-push generate-vapid-keys
```

出力例：
```
=======================================

Public Key:
BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U

Private Key:
UUxI4O8-FbRouADVXc-hK3ltaldH8vCiFb9cY1uXs8M

=======================================
```

### 2. DynamoDBテーブルの追加

CloudFormationスタックを更新して、プッシュ通知購読テーブルを追加します：

```bash
aws cloudformation deploy \
  --template-file cloudformation-tables.yaml \
  --stack-name gacky-prescription-tables \
  --parameter-overrides Environment=dev \
  --capabilities CAPABILITY_IAM \
  --profile gacky-admin
```

### 3. Lambda環境変数の設定

AWS Lambda コンソールで以下の環境変数を追加：

| 環境変数名 | 説明 | 例 |
|------------|------|-----|
| TABLE_PUSH_SUBSCRIPTIONS | 購読テーブル名 | gacky-prescription-push-subscriptions-dev |
| VAPID_PUBLIC_KEY | VAPID公開鍵 | BEl62iUY... |
| VAPID_PRIVATE_KEY | VAPID秘密鍵 | UUxI4O8-... |
| VAPID_SUBJECT | 連絡先メール | mailto:admin@granpharma.co.jp |
| SES_FROM_EMAIL | 送信元メール | noreply@granpharma.co.jp |
| ADMIN_EMAIL_ADDRESSES | 管理者メール（カンマ区切り） | admin1@example.com,admin2@example.com |
| PRESCRIPTION_MANAGER_URL | 管理画面URL | https://xxx.amplifyapp.com |

### 4. Amplify環境変数の設定

Amplifyコンソールで以下の環境変数を追加：

| 環境変数名 | 説明 |
|------------|------|
| TABLE_PUSH_SUBSCRIPTIONS | 購読テーブル名 |
| NEXT_PUBLIC_VAPID_PUBLIC_KEY | VAPID公開鍵（クライアント用） |

### 5. Lambda用 npm パッケージの追加

`gacky-bot-KM10` ディレクトリで以下を実行：

```bash
npm install web-push @aws-sdk/client-ses
```

### 6. SES（Simple Email Service）の設定

メール通知を使用する場合、SESの設定が必要です：

1. **AWSコンソール** → **SES** → **Verified identities**
2. 送信元メールアドレスを検証（または送信ドメインを検証）
3. 管理者のメールアドレスを検証（サンドボックスモードの場合）

**注意**: SESは初期状態でサンドボックスモードです。本番環境では本番アクセスリクエストが必要です。

### 7. Lambda IAMロールへの権限追加

Lambda関数のIAMロールに以下の権限を追加：

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "dynamodb:Query",
        "dynamodb:Scan",
        "dynamodb:UpdateItem"
      ],
      "Resource": [
        "arn:aws:dynamodb:ap-northeast-1:*:table/gacky-prescription-push-subscriptions-*",
        "arn:aws:dynamodb:ap-northeast-1:*:table/gacky-prescription-push-subscriptions-*/index/*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "ses:SendEmail",
        "ses:SendRawEmail"
      ],
      "Resource": "*"
    }
  ]
}
```

### 8. 通知の有効化（店舗スタッフ）

1. 管理画面にログイン
2. 右上の歯車アイコン → 「通知設定」
3. 「有効にする」をクリック
4. ブラウザの通知許可ダイアログで「許可」を選択

### トラブルシューティング

**通知が届かない場合：**
- ブラウザの通知がブロックされていないか確認
- VAPID鍵が正しく設定されているか確認
- CloudWatch Logsでエラーを確認

**メールが届かない場合：**
- SESでメールアドレスが検証済みか確認
- サンドボックスモードの場合、受信者も検証が必要
- CloudWatch Logsでエラーを確認

## ライセンス

プロプライエタリ - グランファルマ株式会社
