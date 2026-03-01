/**
 * 処方箋受付API
 * GET: 受付一覧を取得（DynamoDBから）
 * POST: 新規受付を作成
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDynamoDBClient, TABLES, QueryCommand, ScanCommand, PutCommand } from '@/lib/dynamodb';
import { refreshPrescriptionImageUrls } from '@/lib/s3';

// DynamoDB クライアントを取得
const getDB = () => getDynamoDBClient();

// 店舗名を正規化（比較用）
const normalizeStoreName = (name: string): string => {
  if (!name) return '';
  return name
    .replace(/^あおぞら薬局[\s　]*/g, '')
    .replace(/^Aozora[\s　]*/gi, '')
    .replace(/店$/g, '')
    .toLowerCase()
    .trim();
};

// 店舗IDから店舗名を取得するマッピング（フォールバック用）
// LINE Bot側で使用されている可能性のある古い形式のIDを含む
const LEGACY_STORE_ID_TO_NAME: Record<string, string> = {
  'store_iris': 'アイリス店',
  'store_hashibacho': '橋場町店',
  'store_yokaichi': '八日市店',
  // 必要に応じて追加
};

// 日本時間の今日の日付範囲を取得
const getTodayDateRange = (): { startOfDay: string; endOfDay: string; todayStr: string } => {
  const now = new Date();
  // JSTでの今日の日付を取得
  const jstOffset = 9 * 60 * 60 * 1000;
  const jstNow = new Date(now.getTime() + jstOffset);
  const todayStr = jstNow.toISOString().split('T')[0];
  
  // JSTの今日の0時をUTCで表現
  const startOfDayJST = new Date(`${todayStr}T00:00:00+09:00`);
  // JSTの今日の23:59:59をUTCで表現
  const endOfDayJST = new Date(`${todayStr}T23:59:59+09:00`);
  
  return {
    startOfDay: startOfDayJST.toISOString(),
    endOfDay: endOfDayJST.toISOString(),
    todayStr,
  };
};

// 受付が今日のものかどうかを判定
const isToday = (timestamp: string): boolean => {
  const { startOfDay, endOfDay } = getTodayDateRange();
  return timestamp >= startOfDay && timestamp <= endOfDay;
};

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const storeId = searchParams.get('storeId');
    const storeName = searchParams.get('storeName'); // 店舗名でのフィルタも対応
    const date = searchParams.get('date'); // YYYY-MM-DD形式
    const todayOnly = searchParams.get('todayOnly') === 'true'; // 本日のみフィルタ

    // 今日の日付を取得（日本時間）
    const { todayStr } = getTodayDateRange();
    const targetDate = date || todayStr;

    let receptions: any[] = [];

    // ステータスでフィルタする場合はGSIを使用
    if (status && status !== 'all') {
      const queryParams = {
        TableName: TABLES.PRESCRIPTIONS,
        IndexName: 'status-timestamp-index',
        KeyConditionExpression: '#status = :status',
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExpressionAttributeValues: {
          ':status': status,
        },
        ScanIndexForward: false, // 降順
        Limit: 100,
      };

      const result = await getDB().send(new QueryCommand(queryParams));
      receptions = result.Items || [];
    } 
    // 店舗でフィルタする場合
    // storeIdとstoreNameの両方に対応（店舗IDの形式が異なる場合があるため）
    else if (storeId || storeName) {
      // Scanで全件取得後、フィルタリング
      // （店舗IDの形式が複数あるため、GSI使用よりも柔軟なフィルタリングが必要）
      console.log(`[Receptions API] Filtering by storeId: ${storeId}, storeName: ${storeName}`);
      
      const scanParams = {
        TableName: TABLES.PRESCRIPTIONS,
        Limit: 500, // フィルタリング前なので多めに取得
      };

      const result = await getDB().send(new ScanCommand(scanParams));
      const allReceptions = result.Items || [];
      
      // フィルタリング: storeIdまたはstoreNameで一致するものを抽出
      receptions = allReceptions.filter((reception: any) => {
        // 1. storeIdが完全一致する場合
        if (storeId && reception.selectedStoreId === storeId) {
          return true;
        }
        
        // 2. storeNameが指定されている場合、正規化して比較
        if (storeName) {
          const normalizedTarget = normalizeStoreName(storeName);
          const normalizedReception = normalizeStoreName(reception.selectedStoreName || '');
          if (normalizedTarget === normalizedReception) {
            return true;
          }
        }
        
        // 3. storeIdに対応する店舗名を取得して比較（レガシーID対応）
        if (storeId) {
          const legacyStoreName = LEGACY_STORE_ID_TO_NAME[reception.selectedStoreId];
          if (legacyStoreName) {
            // レガシーIDに対応する店舗名を取得し、現在のstoreIdの店舗名と比較
            // 店舗マスターから店舗名を取得する必要がある
            // ここでは selectedStoreName を使用
            const normalizedLegacy = normalizeStoreName(legacyStoreName);
            const normalizedTarget = normalizeStoreName(storeName || '');
            if (normalizedLegacy === normalizedTarget) {
              return true;
            }
          }
        }
        
        return false;
      });

      // タイムスタンプで降順ソート
      receptions.sort((a, b) => 
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );
      
      // 最大100件に制限
      receptions = receptions.slice(0, 100);
      
      console.log(`[Receptions API] Found ${receptions.length} receptions for store filter`);
    }
    // 全件取得（Scan - 本番では避けるべき）
    else {
      const scanParams = {
        TableName: TABLES.PRESCRIPTIONS,
        Limit: 100,
      };

      const result = await getDB().send(new ScanCommand(scanParams));
      receptions = result.Items || [];

      // タイムスタンプで降順ソート
      receptions.sort((a, b) => 
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );
    }

    // todayOnlyフィルタが有効な場合、本日の受付のみに絞り込む
    if (todayOnly) {
      receptions = receptions.filter((r: any) => isToday(r.timestamp));
      console.log(`[Receptions API] Filtered to today only: ${receptions.length} receptions`);
    }

    // 署名付きURLを再生成（S3の一時クレデンシャル問題対策）
    const receptionsWithFreshUrls = await refreshPrescriptionImageUrls(receptions);

    // メッセージテーブルから各受付の最新メッセージと未読数を取得
    const receptionsWithMessages = await Promise.all(
      receptionsWithFreshUrls.map(async (reception) => {
        try {
          // メッセージを取得
          const messagesResult = await getDB().send(new QueryCommand({
            TableName: TABLES.MESSAGES,
            KeyConditionExpression: 'receptionId = :receptionId',
            ExpressionAttributeValues: {
              ':receptionId': reception.receptionId,
            },
            ScanIndexForward: false, // 降順
            Limit: 10,
          }));

          const messages = messagesResult.Items || [];
          
          // 最新メッセージ
          const lastMessage = messages.length > 0 ? {
            content: messages[0].content,
            timestamp: messages[0].timestamp,
            senderType: messages[0].senderType,
          } : undefined;

          // 未読数（店舗側で未読のメッセージ）
          const unreadMessageCount = messages.filter(
            (msg: any) => msg.senderType === 'customer' && !msg.readByStore
          ).length;

          return {
            ...reception,
            lastMessage,
            unreadMessageCount,
          };
        } catch (error) {
          console.error(`Error fetching messages for ${reception.receptionId}:`, error);
          return reception;
        }
      })
    );

    return NextResponse.json({
      success: true,
      data: receptionsWithMessages,
    });
  } catch (error) {
    console.error('Error fetching receptions:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch receptions' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    const receptionId = `rx_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
    const timestamp = new Date().toISOString();
    
    const newReception = {
      receptionId,
      timestamp,
      ...body,
      status: 'pending',
      messagingSessionStatus: 'inactive',
      ttl: Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60,
      createdAt: timestamp,
    };

    await getDB().send(new PutCommand({
      TableName: TABLES.PRESCRIPTIONS,
      Item: newReception,
    }));

    return NextResponse.json({
      success: true,
      data: newReception,
    });
  } catch (error) {
    console.error('Error creating reception:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create reception' },
      { status: 500 }
    );
  }
}
