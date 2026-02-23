/**
 * 店舗API
 * GET: 店舗一覧を取得（DynamoDBから）
 * 
 * 店舗データの信頼できる唯一の情報源（Single Source of Truth）:
 * - DynamoDB: gacky-prescription-stores-{env}
 * - フォールバック: src/data/stores-fallback.json
 * 
 * Note: stores-fallback.json は shared/stores/fallback-data.json のコピーです。
 *       店舗情報を更新する場合は、両方のファイルを同期してください。
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDynamoDBClient, TABLES, ScanCommand, QueryCommand } from '@/lib/dynamodb';
import type { Store, StoreFallback } from '@/types/store';

// フォールバック店舗データ（DynamoDBにデータがない場合）
// グランファルマ株式会社 あおぞら薬局 全38店舗
import fallbackStoresData from '@/data/stores-fallback.json';

// DynamoDB クライアントを取得
const getDB = () => getDynamoDBClient();

// フォールバックデータの型変換（lat/lon → latitude/longitude）
// Note: DynamoDB と fallback JSON では異なるフィールド名を使用しているため変換
const fallbackStores: Store[] = (fallbackStoresData as StoreFallback[]).map((store) => ({
  storeId: store.storeId,
  storeName: store.storeName,
  region: store.region,
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

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const region = searchParams.get('region');

    let stores: Store[] = [];

    // まずDynamoDBから店舗データを取得
    try {
      if (region) {
        // リージョンでフィルタ（GSI使用）
        const result = await getDB().send(new QueryCommand({
          TableName: TABLES.STORES,
          IndexName: 'region-index',
          KeyConditionExpression: 'region = :region',
          ExpressionAttributeValues: {
            ':region': region,
          },
        }));
        stores = (result.Items || []) as Store[];
      } else {
        // 全店舗取得
        const result = await getDB().send(new ScanCommand({
          TableName: TABLES.STORES,
        }));
        stores = (result.Items || []) as Store[];
      }
    } catch (dbError) {
      console.error('Error fetching from DynamoDB, using fallback:', dbError);
    }

    // DynamoDBにデータがない場合はフォールバックを使用
    if (stores.length === 0) {
      stores = region 
        ? fallbackStores.filter((s: Store) => s.region === region)
        : fallbackStores;
    }

    // 店舗名でソート
    stores.sort((a: Store, b: Store) => a.storeName.localeCompare(b.storeName, 'ja'));

    return NextResponse.json({
      success: true,
      data: stores,
    });
  } catch (error) {
    console.error('Error fetching stores:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch stores' },
      { status: 500 }
    );
  }
}
