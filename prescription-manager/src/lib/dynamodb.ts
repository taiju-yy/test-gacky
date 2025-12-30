/**
 * DynamoDB クライアント設定
 * AWS SDK for JavaScript v3 を使用
 * 
 * 注意: Amplify Compute では環境変数はランタイム時に読み取る必要があります。
 * シングルトンパターンを使用して、初回アクセス時にクライアントを初期化します。
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  QueryCommand,
  UpdateCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb';

// シングルトンインスタンスをキャッシュ
let dynamoDBInstance: DynamoDBDocumentClient | null = null;

/**
 * DynamoDB DocumentClient を取得（ランタイム時に初期化）
 */
function getDynamoDBClient(): DynamoDBDocumentClient {
  if (!dynamoDBInstance) {
    // 注意: Amplify では AWS_ プレフィックスの環境変数が予約されているため、
    // APP_AWS_REGION または NEXT_PUBLIC_AWS_REGION を使用
    const region = process.env.APP_AWS_REGION || process.env.NEXT_PUBLIC_AWS_REGION || 'ap-northeast-1';
    console.log('[DynamoDB] Initializing client with region:', region);
    
    const client = new DynamoDBClient({ region });
    dynamoDBInstance = DynamoDBDocumentClient.from(client, {
      marshallOptions: {
        removeUndefinedValues: true,
      },
    });
  }
  return dynamoDBInstance;
}

// 後方互換性のため、dynamoDB をエクスポート（getter経由）
export const dynamoDB = {
  send: async (command: any) => {
    const client = getDynamoDBClient();
    return client.send(command);
  },
};

/**
 * テーブル名を取得（ランタイム時に評価）
 */
export function getTables() {
  return {
    PRESCRIPTIONS: process.env.TABLE_PRESCRIPTIONS || 'gacky-prescription-prescriptions-dev',
    MESSAGES: process.env.TABLE_MESSAGES || 'gacky-prescription-messages-dev',
    SESSIONS: process.env.TABLE_SESSIONS || 'gacky-prescription-sessions-dev',
    STORES: process.env.TABLE_STORES || 'gacky-prescription-stores-dev',
    CUSTOMER_PROFILES: process.env.TABLE_CUSTOMER_PROFILES || 'gacky-prescription-customer-profiles-dev',
  };
}

// 後方互換性のため、TABLES もエクスポート（ただし関数版を推奨）
// 注意: これはビルド時に評価されるため、Amplify Compute では動作しない可能性があります
export const TABLES = {
  get PRESCRIPTIONS() { return process.env.TABLE_PRESCRIPTIONS || 'gacky-prescription-prescriptions-dev'; },
  get MESSAGES() { return process.env.TABLE_MESSAGES || 'gacky-prescription-messages-dev'; },
  get SESSIONS() { return process.env.TABLE_SESSIONS || 'gacky-prescription-sessions-dev'; },
  get STORES() { return process.env.TABLE_STORES || 'gacky-prescription-stores-dev'; },
  get CUSTOMER_PROFILES() { return process.env.TABLE_CUSTOMER_PROFILES || 'gacky-prescription-customer-profiles-dev'; },
};

// エクスポート
export {
  PutCommand,
  GetCommand,
  QueryCommand,
  UpdateCommand,
  ScanCommand,
};
