/**
 * DynamoDB クライアント設定
 * AWS SDK for JavaScript v3 を使用
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

// DynamoDB クライアントの初期化
const client = new DynamoDBClient({
  region: process.env.APP_AWS_REGION || process.env.NEXT_PUBLIC_AWS_REGION || 'ap-northeast-1',
});

// DocumentClient（マーシャリング/アンマーシャリングを自動化）
export const dynamoDB = DynamoDBDocumentClient.from(client, {
  marshallOptions: {
    removeUndefinedValues: true,
  },
});

// テーブル名
export const TABLES = {
  PRESCRIPTIONS: process.env.TABLE_PRESCRIPTIONS || 'gacky-prescription-prescriptions-dev',
  MESSAGES: process.env.TABLE_MESSAGES || 'gacky-prescription-messages-dev',
  SESSIONS: process.env.TABLE_SESSIONS || 'gacky-prescription-sessions-dev',
  STORES: process.env.TABLE_STORES || 'gacky-prescription-stores-dev',
  CUSTOMER_PROFILES: process.env.TABLE_CUSTOMER_PROFILES || 'gacky-prescription-customer-profiles-dev',
};

// エクスポート
export {
  PutCommand,
  GetCommand,
  QueryCommand,
  UpdateCommand,
  ScanCommand,
};
