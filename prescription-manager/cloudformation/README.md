# Gacky 処方箋管理システム - AWS インフラストラクチャ

## 概要

このディレクトリには、Gacky処方箋管理システムのAWSインフラストラクチャを構築するためのCloudFormationテンプレートが含まれています。

## 構成リソース

| リソース | 用途 |
|---------|------|
| **DynamoDB Tables** | |
| - gacky-prescription-prescriptions-{env} | 処方箋受付データ |
| - gacky-prescription-messages-{env} | 店舗⇄顧客メッセージ |
| - gacky-prescription-sessions-{env} | メッセージングセッション |
| - gacky-prescription-stores-{env} | 店舗マスタ |
| - gacky-prescription-customer-profiles-{env} | お客様プロフィール（履歴統合用） |
| **S3 Bucket** | |
| - gacky-prescription-images-{env}-{accountId} | 処方箋画像保存 |
| **Cognito** | |
| - User Pool | スタッフ認証 |
| - Identity Pool | AWS直接アクセス用 |
| - User Groups | admin / store_manager / store_staff |
| **IAM Roles** | |
| - Cognito認証済みロール | DynamoDB/S3アクセス |
| - Amplifyサービスロール | デプロイ用 |

## デプロイ手順

### 1. 前提条件

- AWS CLI がインストールされていること
- 適切なIAM権限を持つAWSアカウントにログインしていること

### 2. CloudFormationスタックの作成

#### 開発環境 (dev)

```bash
aws cloudformation create-stack \
  --stack-name gacky-prescription-dev \
  --template-body file://prescription-manager-infrastructure.yaml \
  --parameters \
    ParameterKey=Environment,ParameterValue=dev \
    ParameterKey=ProjectName,ParameterValue=gacky-prescription \
  --capabilities CAPABILITY_NAMED_IAM \
  --region ap-northeast-1 \
  --profile gacky-admin
```

#### 本番環境 (prod)

```bash
aws cloudformation create-stack \
  --stack-name gacky-prescription-prod \
  --template-body file://prescription-manager-infrastructure.yaml \
  --parameters \
    ParameterKey=Environment,ParameterValue=prod \
    ParameterKey=ProjectName,ParameterValue=gacky-prescription \
  --capabilities CAPABILITY_NAMED_IAM \
  --region ap-northeast-1 \
  --profile gacky-admin
```

### 3. スタック作成の確認

```bash
# ステータス確認
aws cloudformation describe-stacks \
  --stack-name gacky-prescription-dev \
  --query 'Stacks[0].StackStatus' \
  --region ap-northeast-1 \
  --profile gacky-admin

# 出力値の取得
aws cloudformation describe-stacks \
  --stack-name gacky-prescription-dev \
  --query 'Stacks[0].Outputs' \
  --region ap-northeast-1 \
  --profile gacky-admin
```

### 4. 店舗マスタデータの投入

```bash
# seed-stores-data.json を編集して実際の店舗情報を入力後、以下を実行

# Node.js スクリプトで投入（推奨）
node scripts/seed-stores.js dev

# または AWS CLI で1件ずつ投入
aws dynamodb put-item \
  --table-name gacky-prescription-stores-dev \
  --item file://store-item.json \
  --region ap-northeast-1 \
  --profile gacky-admin
```

### 5. Cognitoユーザーの作成

#### 管理者ユーザーの作成

```bash
# ユーザー作成
aws cognito-idp admin-create-user \
  --user-pool-id <USER_POOL_ID> \
  --username admin@example.com \
  --user-attributes \
    Name=email,Value=admin@example.com \
    Name=email_verified,Value=true \
    Name=custom:role,Value=admin \
  --temporary-password "TempPass123!" \
  --region ap-northeast-1 \
  --profile gacky-admin

# 管理者グループに追加
aws cognito-idp admin-add-user-to-group \
  --user-pool-id <USER_POOL_ID> \
  --username admin@example.com \
  --group-name admin \
  --region ap-northeast-1 \
  --profile gacky-admin
```

#### 店舗スタッフの作成

```bash
# 店舗スタッフ作成
aws cognito-idp admin-create-user \
  --user-pool-id <USER_POOL_ID> \
  --username staff@store.com \
  --user-attributes \
    Name=email,Value=staff@store.com \
    Name=email_verified,Value=true \
    Name=custom:store_id,Value=kanazawa-ekimae \
    Name=custom:role,Value=store_staff \
  --temporary-password "TempPass123!" \
  --region ap-northeast-1 \
  --profile gacky-admin

# 店舗スタッフグループに追加
aws cognito-idp admin-add-user-to-group \
  --user-pool-id <USER_POOL_ID> \
  --username staff@store.com \
  --group-name store_staff \
  --region ap-northeast-1 \
  --profile gacky-admin
```

## 環境変数の設定

CloudFormationスタック作成後、出力される`ConfigurationSummary`を参考に`.env.local`を作成してください。

```bash
# prescription-manager/.env.local

# AWS Region
NEXT_PUBLIC_AWS_REGION=ap-northeast-1

# Cognito
NEXT_PUBLIC_USER_POOL_ID=ap-northeast-1_XXXXXXXXX
NEXT_PUBLIC_USER_POOL_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxx
NEXT_PUBLIC_IDENTITY_POOL_ID=ap-northeast-1:xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx

# DynamoDB Tables
TABLE_PRESCRIPTIONS=gacky-prescription-prescriptions-dev
TABLE_MESSAGES=gacky-prescription-messages-dev
TABLE_SESSIONS=gacky-prescription-sessions-dev
TABLE_STORES=gacky-prescription-stores-dev
TABLE_CUSTOMER_PROFILES=gacky-prescription-customer-profiles-dev

# S3
S3_PRESCRIPTION_BUCKET=gacky-prescription-images-dev-123456789012

# LINE Bot (Gacky Bot Lambda環境変数と同じ)
LINE_CHANNEL_ACCESS_TOKEN=xxxx
LINE_CHANNEL_SECRET=xxxx
```

## Gacky LINE Bot (Lambda) との連携

Gacky LINE Bot Lambda関数に以下の環境変数を追加してください：

```
TABLE_PRESCRIPTIONS=gacky-prescription-prescriptions-dev
TABLE_PRESCRIPTION_MESSAGES=gacky-prescription-messages-dev
TABLE_CUSTOMER_SESSIONS=gacky-prescription-sessions-dev
TABLE_CUSTOMER_PROFILES=gacky-prescription-customer-profiles-dev
PRESCRIPTION_BUCKET=gacky-prescription-images-dev-123456789012
```

## 権限グループ

| グループ | 権限 |
|---------|------|
| `admin` | 全店舗の処方箋管理、スタッフ管理、設定変更 |
| `store_manager` | 担当店舗の処方箋管理、スタッフ閲覧 |
| `store_staff` | 担当店舗の処方箋閲覧、メッセージ送受信 |

## トラブルシューティング

### スタック作成に失敗した場合

```bash
# イベントログの確認
aws cloudformation describe-stack-events \
  --stack-name gacky-prescription-dev \
  --region ap-northeast-1 \
  --profile gacky-admin

# 失敗したスタックの削除
aws cloudformation delete-stack \
  --stack-name gacky-prescription-dev \
  --region ap-northeast-1 \
  --profile gacky-admin
```

### S3バケット名が重複している場合

S3バケット名はグローバルに一意である必要があります。`ProjectName`パラメータを変更するか、テンプレートのバケット名を修正してください。

## 更新・削除

### スタックの更新

```bash
aws cloudformation update-stack \
  --stack-name gacky-prescription-dev \
  --template-body file://prescription-manager-infrastructure.yaml \
  --parameters \
    ParameterKey=Environment,ParameterValue=dev \
  --capabilities CAPABILITY_NAMED_IAM \
  --region ap-northeast-1 \
  --profile gacky-admin
```

### スタックの削除

⚠️ **注意**: 削除するとすべてのデータが失われます。本番環境では十分注意してください。

```bash
# S3バケットを空にする（削除前に必要）
aws s3 rm s3://gacky-prescription-images-dev-123456789012 --recursive --profile gacky-admin

# スタック削除
aws cloudformation delete-stack \
  --stack-name gacky-prescription-dev \
  --region ap-northeast-1 \
  --profile gacky-admin
```
