# Gacky LINEチャットボット Analytics マニュアル

**作成日**: 2025年12月21日  
**最終更新日**: 2026年1月4日  
**対象環境**: 開発環境（gackyBotDev）/ 本番環境（gackyBot）

---

## 目次

1. [概要](#概要)
2. [配信前チェックリスト](#配信前チェックリスト)
3. [配信後の情報取得手順](#配信後の情報取得手順)
4. [各種分析データの取得方法](#各種分析データの取得方法)
5. [MAU率の計算方法](#mau率の計算方法)
6. [対話継続率の取得](#対話継続率の取得)
7. [配信後ブロック率の計算方法](#配信後ブロック率の計算方法)
8. [応答率について](#応答率について)
9. [トラブルシューティング](#トラブルシューティング)

---

## 概要

### 利用可能なデータソース

| データソース | テーブル名（開発） | 用途 |
|-------------|-------------------|------|
| 配信ログ | `gacky-bot-broadcast-logs-dev` | 配信日時、対象者数、成功/失敗数 |
| ユーザーアクティビティ | `gacky-bot-user-activity-summary-dev` | MAU、メッセージ数、会話日数 |
| LINE公式アカウント管理画面 | - | targetReaches、ブロック数 |

### 本番環境のテーブル名

| データソース | テーブル名（本番） |
|-------------|-------------------|
| 配信ログ | `gacky-bot-broadcast-logs` |
| ユーザーアクティビティ | `gacky-bot-user-activity-summary` |

### 取得可能な指標

| 指標 | 取得可否 | 方法 |
|------|----------|------|
| MAU（月間アクティブユーザー率） | ✅ 可能 | `getMonthlyActiveUsers` |
| 対話継続率（月3回以上対話） | ✅ 可能 | `getEngagementRate` |
| 配信後ブロック率 | ✅ 可能 | LINE管理画面 + `getBroadcastSummary` |
| 応答率（配信後24時間以内の反応） | ❌ 追加実装が必要 | [応答率について](#応答率について) 参照 |

---

## 配信前チェックリスト

### AWS配信（Lambda経由）の場合

- [ ] 配信内容の確認
- [ ] 配信対象ユーザーIDリストの準備
- [ ] LINE公式アカウント管理画面で現在のブロック数を記録
- [ ] LINE公式アカウント管理画面で現在のtargetReachesを記録

### 記録テンプレート

```
【配信前記録】
日時: 2025/12/22 10:00
配信前ブロック数: ____
配信前targetReaches: ____
```

---

## 配信後の情報取得手順

### ステップ1: 配信直後（配信完了後すぐ）

#### 1-1. ブロードキャストサマリーの確認（推奨）

**Lambda テストイベント:**
```json
{
  "handler": "analyticsHandler",
  "action": "getBroadcastSummary",
  "days": 7
}
```

**特定日付の配信のみ取得:**
```json
{
  "handler": "analyticsHandler",
  "action": "getBroadcastSummary",
  "date": "2025-12-29"
}
```

**確認項目（集約済み）:**
- `totalTargetUserCount`: 配信対象者数（全バッチ合計）
- `totalSuccessCount`: 成功数（全バッチ合計）
- `totalFailureCount`: 失敗数（全バッチ合計）
- `successRate`: 成功率（%）
- `batchCount`: バッチ数（20人ずつ分割された数）

---

### ステップ2: 配信翌日（24時間後）

#### 2-1. ブロック数の確認

1. LINE公式アカウント管理画面にログイン
2. 「分析」→「友だち」を選択
3. 現在のブロック数を記録

#### 2-2. 配信後ブロック率の計算

```
配信後ブロック率 = (配信後ブロック数 - 配信前ブロック数) / totalTargetUserCount × 100
```

**記録テンプレート:**
```
【配信後記録（24時間後）】
日時: 2025/12/23 10:00
配信後ブロック数: ____
ブロック増加数: ____
配信後ブロック率: ____%
```

---

### ステップ3: 月末（MAU集計）

#### 3-1. 月別アクティブユーザー数の取得

**Lambda テストイベント:**
```json
{
  "handler": "analyticsHandler",
  "action": "getMonthlyActiveUsers",
  "yearMonth": "2025-12"
}
```

#### 3-2. 対話継続率の取得

**Lambda テストイベント:**
```json
{
  "handler": "analyticsHandler",
  "action": "getEngagementRate",
  "yearMonth": "2025-12",
  "threshold": 3
}
```

**レスポンス例:**
```json
{
  "action": "getEngagementRate",
  "yearMonth": "2025-12",
  "threshold": 3,
  "totalActiveUsers": 150,
  "engagedUserCount": 45,
  "engagementRate": 30.0,
  "distribution": {
    "1日": 50,
    "2日": 55,
    "3-5日": 30,
    "6-10日": 10,
    "11日以上": 5
  }
}
```

---

## 各種分析データの取得方法

### Lambda テストイベントの実行手順

1. AWS コンソールにログイン
2. Lambda → Functions → `gackyBotDev`（または `gackyBot`）
3. 「テスト」タブを選択
4. 「新しいイベントを作成」を選択
5. イベント名を入力（例: `GetMAU`）
6. Event JSON にテストイベントを入力
7. 「テスト」ボタンをクリック
8. 「実行結果」で結果を確認

---

### 分析アクション一覧

#### 1. 月別アクティブユーザー取得

```json
{
  "handler": "analyticsHandler",
  "action": "getMonthlyActiveUsers",
  "yearMonth": "2025-12"
}
```

| パラメータ | 必須 | 説明 |
|-----------|------|------|
| yearMonth | 任意 | 対象年月（省略時は当月） |

---

#### 2. ユーザーのアクティビティ履歴取得

```json
{
  "handler": "analyticsHandler",
  "action": "getUserActivityHistory",
  "userId": "Uxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "months": 6
}
```

| パラメータ | 必須 | 説明 |
|-----------|------|------|
| userId | 必須 | 対象ユーザーID |
| months | 任意 | 取得月数（デフォルト: 12） |

---

#### 3. 最近のブロードキャストログ取得（生データ）

```json
{
  "handler": "analyticsHandler",
  "action": "getRecentBroadcastLogs",
  "limit": 10
}
```

| パラメータ | 必須 | 説明 |
|-----------|------|------|
| limit | 任意 | 取得件数（デフォルト: 50） |

---

#### 4. ブロードキャストサマリー取得（集約済み）⭐ 新機能

```json
{
  "handler": "analyticsHandler",
  "action": "getBroadcastSummary",
  "days": 7
}
```

| パラメータ | 必須 | 説明 |
|-----------|------|------|
| days | 任意 | 過去N日分を取得（デフォルト: 7） |
| date | 任意 | 特定日付でフィルタ（例: "2025-12-29"） |

**特徴:**
- 同じメッセージ内容・同じ日付の配信を1つに集約
- `totalTargetUserCount`: 全バッチの対象者数合計
- `totalSuccessCount`: 全バッチの成功数合計
- `successRate`: 成功率（%）
- `batchCount`: バッチ数

---

#### 5. 対話継続率（エンゲージメント率）取得 ⭐ 新機能

```json
{
  "handler": "analyticsHandler",
  "action": "getEngagementRate",
  "yearMonth": "2025-12",
  "threshold": 3
}
```

| パラメータ | 必須 | 説明 |
|-----------|------|------|
| yearMonth | 任意 | 対象年月（省略時は当月） |
| threshold | 任意 | 対話日数の閾値（デフォルト: 3） |

**出力項目:**
- `engagementRate`: 対話継続率（%）
- `engagedUserCount`: threshold以上対話したユーザー数
- `distribution`: 会話日数の分布

---

## MAU率の計算方法

### 計算式

```
MAU率 = (月間アクティブユーザー数 / targetReaches) × 100
```

### 計算例

```
【2025年12月の例】
- activeUserCount: 150（Lambda分析で取得）
- targetReaches: 3,000（LINE管理画面で確認）

MAU率 = 150 / 3,000 × 100 = 5.0%
```

### 目標値

| 状況 | 目標MAU率 |
|------|----------|
| 通常月 | 5%以上 |
| キャンペーン時 | 10%以上 |

---

## 対話継続率の取得

### 計算式

```
対話継続率 = (threshold日以上対話したユーザー数 / 月間アクティブユーザー数) × 100
```

### 取得方法

```json
{
  "handler": "analyticsHandler",
  "action": "getEngagementRate",
  "yearMonth": "2025-12",
  "threshold": 3
}
```

### 目標値

| 状況 | 目標対話継続率 |
|------|---------------|
| 通常月 | 20%以上 |
| キャンペーン時 | 30%以上 |

---

## 配信後ブロック率の計算方法

### 計算式

```
配信後ブロック率 = (配信後ブロック増加数 / 配信対象者数) × 100
```

### 計算例

```
【2025/12/22配信の例】
- 配信前ブロック数: 1,925
- 配信後ブロック数: 1,930（24時間後）
- ブロック増加数: 5
- 配信対象者数: 500（getBroadcastSummaryのtotalTargetUserCount）

配信後ブロック率 = 5 / 500 × 100 = 1.0%
```

### 目標値

| 評価 | ブロック率 |
|------|----------|
| 良好 | 1%未満 |
| 要注意 | 1〜2% |
| 要改善 | 2%以上 |

---

## 応答率について

### 現状

**応答率（配信後24時間以内の反応）** は、現在の実装では取得できません。

### 理由

- 配信（ブロードキャスト）とユーザーの反応（メッセージ）が紐づいていない
- 「どの配信に対する反応か」を判定する仕組みがない

### 将来の実装案

応答率を取得するには、以下の追加実装が必要です：

1. **配信時に `lastBroadcastId` をユーザーレコードに記録**
2. **ユーザーが次に発言した時に、前回配信からの経過時間を計算**
3. **24時間以内なら「配信への反応」としてカウント**

この実装をご希望の場合はお知らせください。

---

## 週次レポートテンプレート

```
【週次レポート】
期間: 2025/12/22 〜 2025/12/28

■ 配信実績
- 配信回数: __ 回
- 総配信対象者数: __ 人
- 平均成功率: ___%

■ ブロック状況
- 週初ブロック数: ____
- 週末ブロック数: ____
- 週間ブロック増加数: ____
- 平均配信後ブロック率: ___%

■ MAU状況（月初からの累計）
- アクティブユーザー数: ____
- 推定MAU率: ___%
- 対話継続率（3日以上）: ___%

■ 所見・次週アクション
- 
```

---

## トラブルシューティング

### Q1: Lambda テストで「Error」が返される

**確認事項:**
1. Lambda 環境変数に以下が設定されているか確認
   - `TABLE_BROADCAST_LOGS`
   - `TABLE_USER_ACTIVITY_SUMMARY`
2. IAM ポリシーにテーブルへのアクセス権限があるか確認

---

### Q2: activeUserCount が 0 になる

**原因:**
- 対象月にユーザーからのメッセージがない
- テーブル名が間違っている

**確認方法:**
1. DynamoDB コンソールで `gacky-bot-user-activity-summary-dev` を確認
2. 対象 yearMonth のレコードが存在するか確認

---

### Q3: ブロードキャストログが見つからない

**原因:**
- AWS経由の配信を行っていない（LINE管理画面からの配信は記録されない）
- broadcastHandler を使用していない

**注意:**
このログはAWS Lambda経由のブロードキャスト配信のみを記録します。
LINE公式アカウント管理画面からの配信は対象外です。

---

### Q4: getBroadcastSummary で同じ配信が別々に表示される

**原因:**
- メッセージ内容が微妙に異なる（絵文字の違い等）
- 配信日が異なる

**対処法:**
- `date` パラメータで特定日付に絞り込む
- メッセージ内容を確認

---

## 関連リソース

- LINE公式アカウント管理画面: https://manager.line.biz/
- AWS Lambda コンソール: https://ap-northeast-1.console.aws.amazon.com/lambda/
- DynamoDB コンソール: https://ap-northeast-1.console.aws.amazon.com/dynamodbv2/

---

## 更新履歴

| 日付 | 内容 |
|------|------|
| 2025/12/21 | 初版作成 |
| 2026/01/04 | `getBroadcastSummary`, `getEngagementRate` 追加 |
