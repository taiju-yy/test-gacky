#!/usr/bin/env node

/**
 * 店舗データをDynamoDBにインポートするスクリプト
 * 
 * 使用方法:
 *   cd prescription-manager
 *   node scripts/seed-stores.js dev          # 開発環境
 *   node scripts/seed-stores.js prod         # 本番環境
 *   node scripts/seed-stores.js dev gacky    # プロファイル指定
 * 
 * データソース:
 *   - 優先: ../../shared/stores/fallback-data.json（Single Source of Truth）
 *   - フォールバック: ./cloudformation/seed-stores-data.json
 * 
 * Note: 店舗情報を更新する場合は shared/stores/fallback-data.json を編集し、
 *       このスクリプトを実行してDynamoDBに反映してください。
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

/**
 * 店舗データファイルを読み込む
 * shared/stores/fallback-data.json を優先し、なければ cloudformation/seed-stores-data.json を使用
 */
function loadStoreData() {
  // 優先: shared/stores/fallback-data.json（Single Source of Truth）
  const sharedDataPath = path.join(__dirname, '../../shared/stores/fallback-data.json');
  
  if (fs.existsSync(sharedDataPath)) {
    console.log(`データソース: ${sharedDataPath} (Single Source of Truth)`);
    const rawData = JSON.parse(fs.readFileSync(sharedDataPath, 'utf-8'));
    
    // fallback-data.json の形式を seed-stores-data.json の形式に変換
    // (lat/lon → latitude/longitude, region code → region name)
    return rawData.map(store => ({
      storeId: store.storeId,
      storeName: store.storeName,
      region: store.region,  // kanazawa, kaga, noto のまま
      postalCode: store.postalCode,
      address: store.address,
      latitude: String(store.lat),
      longitude: String(store.lon),
      lineUrl: store.lineUrl,
      phone: store.phone,
      mapUrl: store.mapUrl,
      businessHours: store.businessHours,
      storeNote: store.storeNote || undefined,
    }));
  }
  
  // フォールバック: cloudformation/seed-stores-data.json
  const legacyDataPath = path.join(__dirname, '../cloudformation/seed-stores-data.json');
  
  if (fs.existsSync(legacyDataPath)) {
    console.log(`データソース: ${legacyDataPath} (フォールバック)`);
    console.log(`Warning: shared/stores/fallback-data.json が見つかりません`);
    return JSON.parse(fs.readFileSync(legacyDataPath, 'utf-8'));
  }
  
  console.error('Error: 店舗データファイルが見つかりません');
  console.error(`  確認したパス:`);
  console.error(`    - ${sharedDataPath}`);
  console.error(`    - ${legacyDataPath}`);
  process.exit(1);
}

async function seedStores() {
  console.log(`\n=== 店舗データインポート ===`);
  console.log(`Environment: ${environment}`);
  console.log(`Table: ${TABLE_NAME}\n`);

  // 店舗データを読み込み
  const stores = loadStoreData();
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
