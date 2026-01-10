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

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const storeId = searchParams.get('storeId');
    const date = searchParams.get('date'); // YYYY-MM-DD形式

    // 今日の日付を取得（日本時間）
    const today = new Date();
    today.setHours(today.getHours() + 9); // JST
    const todayStr = today.toISOString().split('T')[0];
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
    else if (storeId) {
      const queryParams = {
        TableName: TABLES.PRESCRIPTIONS,
        IndexName: 'storeId-timestamp-index',
        KeyConditionExpression: 'selectedStoreId = :storeId',
        ExpressionAttributeValues: {
          ':storeId': storeId,
        },
        ScanIndexForward: false,
        Limit: 100,
      };

      const result = await getDB().send(new QueryCommand(queryParams));
      receptions = result.Items || [];
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
