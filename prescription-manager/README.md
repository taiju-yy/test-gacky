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

### gacky-prescriptions
処方箋受付情報を管理

| キー | 型 | 説明 |
|------|-----|------|
| receptionId (PK) | String | 受付ID |
| timestamp (SK) | String | 受付日時 |
| userId | String | LINE ユーザーID |
| status | String | ステータス（pending/confirmed/preparing/ready/completed/cancelled） |
| messagingSessionStatus | String | メッセージセッション状態（inactive/active/closed） |

### gacky-prescription-messages
店舗⇔お客様のメッセージを管理

| キー | 型 | 説明 |
|------|-----|------|
| receptionId (PK) | String | 受付ID |
| messageId (SK) | String | メッセージID |
| senderType | String | 送信者タイプ（customer/store/system） |
| content | String | メッセージ内容 |

### gacky-customer-messaging-sessions
お客様のメッセージングセッション状態を管理（AI応答スキップ判定用）

| キー | 型 | 説明 |
|------|-----|------|
| userId (PK) | String | LINE ユーザーID |
| activeReceptionId | String | アクティブな受付ID |
| messagingSessionStatus | String | セッション状態 |
| lastStoreMessageAt | String | 最後の店舗メッセージ日時 |

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
  --parameter-overrides Environment=dev
```

## 環境変数

### Lambda (gacky-bot)

```
TABLE_PRESCRIPTIONS=gacky-prescriptions
TABLE_PRESCRIPTION_MESSAGES=gacky-prescription-messages
TABLE_CUSTOMER_SESSIONS=gacky-customer-messaging-sessions
PRESCRIPTION_BUCKET=gacky-prescriptions
```

### Web App

```
AWS_REGION=ap-northeast-1
TABLE_PRESCRIPTIONS=gacky-prescriptions
TABLE_PRESCRIPTION_MESSAGES=gacky-prescription-messages
```

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

## ライセンス

プロプライエタリ - グランファルマ株式会社
