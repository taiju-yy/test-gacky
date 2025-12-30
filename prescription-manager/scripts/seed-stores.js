#!/usr/bin/env node

/**
 * 店舗データをDynamoDBにインポートするスクリプト
 * 
 * 使用方法:
 *   node scripts/seed-stores.js dev          # 開発環境
 *   node scripts/seed-stores.js prod         # 本番環境
 *   node scripts/seed-stores.js dev gacky    # プロファイル指定
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const fs = require('fs');
const path = require('path');

// 引数からEnvironmentとプロファイルを取得
const args = process.argv.slice(2);
const environment = args[0] || 'dev';
const profile = args[1];

// テーブル名
const TABLE_NAME = `gacky-prescription-stores-${environment}`;

// DynamoDB クライアント設定
const clientConfig = {
  region: 'ap-northeast-1',
};

// プロファイルが指定されている場合は環境変数で設定
if (profile) {
  process.env.AWS_PROFILE = profile;
  console.log(`Using AWS profile: ${profile}`);
}

const client = new DynamoDBClient(clientConfig);
const dynamoDB = DynamoDBDocumentClient.from(client);

async function seedStores() {
  console.log(`\n=== 店舗データインポート ===`);
  console.log(`Environment: ${environment}`);
  console.log(`Table: ${TABLE_NAME}\n`);

  // JSONファイルを読み込み
  const dataPath = path.join(__dirname, '../cloudformation/seed-stores-data.json');
  
  if (!fs.existsSync(dataPath)) {
    console.error(`Error: ${dataPath} not found`);
    process.exit(1);
  }

  const stores = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
  console.log(`${stores.length} 店舗のデータを読み込みました\n`);

  // 既存データを確認
  try {
    const existingData = await dynamoDB.send(new ScanCommand({
      TableName: TABLE_NAME,
      Select: 'COUNT',
    }));
    console.log(`既存データ: ${existingData.Count} 件\n`);
  } catch (err) {
    if (err.name === 'ResourceNotFoundException') {
      console.error(`Error: テーブル ${TABLE_NAME} が存在しません`);
      console.log('CloudFormation でテーブルを作成してください');
      process.exit(1);
    }
    throw err;
  }

  // データをインポート
  let successCount = 0;
  let errorCount = 0;

  for (const store of stores) {
    try {
      await dynamoDB.send(new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          ...store,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      }));
      console.log(`✓ ${store.storeName} (${store.storeId})`);
      successCount++;
    } catch (err) {
      console.error(`✗ ${store.storeName}: ${err.message}`);
      errorCount++;
    }
  }

  console.log(`\n=== 完了 ===`);
  console.log(`成功: ${successCount} 件`);
  console.log(`失敗: ${errorCount} 件`);
}

seedStores().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
