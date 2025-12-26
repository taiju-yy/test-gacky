/**
 * メッセージAPI
 * GET: メッセージ一覧を取得
 * POST: メッセージを送信（店舗→お客様）
 */

import { NextRequest, NextResponse } from 'next/server';

// デモ用メッセージデータ
const demoMessages: Record<string, any[]> = {};

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

    const messages = demoMessages[receptionId] || [];

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
    const { receptionId, storeId, storeName, content, messageType = 'text' } = body;

    if (!receptionId || !content) {
      return NextResponse.json(
        { success: false, error: 'receptionId and content are required' },
        { status: 400 }
      );
    }

    const messageId = `msg_${Date.now()}`;
    const timestamp = new Date().toISOString();

    const newMessage = {
      receptionId,
      messageId,
      timestamp,
      senderType: 'store',
      senderId: storeId || 'admin',
      senderName: storeName || '管理者',
      messageType,
      content,
      lineDelivered: false,
      readByCustomer: false,
      readByStore: true,
    };

    // メッセージを保存
    if (!demoMessages[receptionId]) {
      demoMessages[receptionId] = [];
    }
    demoMessages[receptionId].push(newMessage);

    // TODO: 実際の実装では:
    // 1. DynamoDB にメッセージを保存
    // 2. LINE Push API でお客様にメッセージを送信
    // 3. メッセージングセッションをアクティブに設定
    // 4. lineDelivered を true に更新

    console.log(`Message sent to customer for reception ${receptionId}:`, content);

    // LINE配信をシミュレート
    setTimeout(() => {
      const msg = demoMessages[receptionId]?.find((m) => m.messageId === messageId);
      if (msg) {
        msg.lineDelivered = true;
        msg.lineDeliveredAt = new Date().toISOString();
      }
    }, 1000);

    return NextResponse.json({
      success: true,
      data: {
        ...newMessage,
        message: 'Message will be delivered to customer via LINE',
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
