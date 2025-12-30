/**
 * メッセージAPI
 * GET: メッセージ一覧を取得（DynamoDBから）
 * POST: メッセージを送信（店舗→お客様）
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDynamoDBClient, TABLES, QueryCommand, PutCommand, UpdateCommand } from '@/lib/dynamodb';
import { sendTextMessage } from '@/lib/line';
import { v4 as uuidv4 } from 'uuid';

// DynamoDB クライアントを取得
const getDB = () => getDynamoDBClient();

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const receptionId = searchParams.get('receptionId');

    if (!receptionId) {
      return NextResponse.json(
        { success: false, error: 'receptionId is required' },
        { status: 400 }
      );
    }

    // DynamoDBからメッセージを取得
    const result = await getDB().send(new QueryCommand({
      TableName: TABLES.MESSAGES,
      KeyConditionExpression: 'receptionId = :receptionId',
      ExpressionAttributeValues: {
        ':receptionId': receptionId,
      },
      ScanIndexForward: true, // 時系列順（古い順）
    }));

    const messages = result.Items || [];

    return NextResponse.json({
      success: true,
      data: messages,
    });
  } catch (error) {
    console.error('Error fetching messages:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch messages' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    console.log('[Messages API] POST received:', JSON.stringify(body));
    
    const { 
      receptionId, 
      userId,
      storeId, 
      storeName, 
      content, 
      messageType = 'text',
      timestamp: receptionTimestamp, // 受付のtimestamp（更新用）
    } = body;

    console.log('[Messages API] Extracted values - receptionId:', receptionId, ', userId:', userId, ', content length:', content?.length);

    if (!receptionId || !content) {
      console.error('[Messages API] Missing required fields');
      return NextResponse.json(
        { success: false, error: 'receptionId and content are required' },
        { status: 400 }
      );
    }

    const messageId = `msg_${uuidv4()}`;
    const timestamp = new Date().toISOString();

    const newMessage = {
      receptionId,
      messageId,
      timestamp,
      userId, // 顧客のuserIdを保存（将来の履歴統合用）
      senderType: 'store',
      senderId: storeId || 'admin',
      senderName: storeName || '管理者',
      messageType,
      content,
      lineDelivered: false,
      readByCustomer: false,
      readByStore: true,
      ttl: Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60,
    };

    // DynamoDBにメッセージを保存
    await getDB().send(new PutCommand({
      TableName: TABLES.MESSAGES,
      Item: newMessage,
    }));

    // LINE Push API でお客様にメッセージを送信
    let lineDelivered = false;
    console.log('[Messages API] Checking userId for LINE delivery:', userId);
    
    if (userId) {
      console.log('[Messages API] Attempting LINE delivery to userId:', userId);
      lineDelivered = await sendTextMessage(userId, content);
      console.log('[Messages API] LINE delivery result:', lineDelivered);
    } else {
      console.warn('[Messages API] WARNING: No userId provided - cannot send LINE message');
    }

    // LINE送信結果を更新
    if (lineDelivered) {
      await getDB().send(new UpdateCommand({
        TableName: TABLES.MESSAGES,
        Key: {
          receptionId,
          messageId,
        },
        UpdateExpression: 'SET lineDelivered = :delivered, lineDeliveredAt = :deliveredAt',
        ExpressionAttributeValues: {
          ':delivered': true,
          ':deliveredAt': new Date().toISOString(),
        },
      }));
      newMessage.lineDelivered = true;
    }

    // 受付のメッセージングセッションをアクティブに設定
    if (receptionTimestamp) {
      try {
        await getDB().send(new UpdateCommand({
          TableName: TABLES.PRESCRIPTIONS,
          Key: {
            receptionId,
            timestamp: receptionTimestamp,
          },
          UpdateExpression: 'SET messagingSessionStatus = :status, lastStoreMessageAt = :messageAt',
          ExpressionAttributeValues: {
            ':status': 'active',
            ':messageAt': timestamp,
          },
        }));
      } catch (updateError) {
        console.error('Error updating reception session status:', updateError);
      }
    }

    // Lambda側のセッションテーブルも更新（AI応答を停止するため）
    // これがないと Lambda の checkActiveMessagingSession() がセッションを認識しない
    if (userId) {
      try {
        await getDB().send(new PutCommand({
          TableName: TABLES.SESSIONS,
          Item: {
            userId,
            activeReceptionId: receptionId,
            messagingSessionStatus: 'active',
            lastStoreMessageAt: timestamp,
            sessionStartedAt: timestamp,
            sessionTimeoutMinutes: 30, // SESSION_TIMEOUT_MINUTES
            updatedAt: timestamp,
          },
        }));
        console.log('[Messages API] Customer session updated for AI skip - userId:', userId);
      } catch (sessionError) {
        console.error('Error updating customer session for AI skip:', sessionError);
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        ...newMessage,
        lineDelivered,
      },
    });
  } catch (error) {
    console.error('Error sending message:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to send message' },
      { status: 500 }
    );
  }
}

/**
 * 既読更新用のPATCH
 */
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { receptionId, messageIds } = body;

    if (!receptionId || !messageIds || !Array.isArray(messageIds)) {
      return NextResponse.json(
        { success: false, error: 'receptionId and messageIds are required' },
        { status: 400 }
      );
    }

    // 各メッセージの既読状態を更新
    await Promise.all(
      messageIds.map((messageId: string) =>
        getDB().send(new UpdateCommand({
          TableName: TABLES.MESSAGES,
          Key: {
            receptionId,
            messageId,
          },
          UpdateExpression: 'SET readByStore = :read',
          ExpressionAttributeValues: {
            ':read': true,
          },
        }))
      )
    );

    return NextResponse.json({
      success: true,
      data: { updated: messageIds.length },
    });
  } catch (error) {
    console.error('Error updating message read status:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update read status' },
      { status: 500 }
    );
  }
}
