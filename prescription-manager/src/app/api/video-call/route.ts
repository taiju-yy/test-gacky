/**
 * ビデオ通話API
 * POST: 新しいビデオ通話ルームを作成
 * GET: ルーム一覧を取得（デバッグ用）
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDynamoDBClient, TABLES, PutCommand, ScanCommand } from '@/lib/dynamodb';
import { sendTextMessage } from '@/lib/line';
import { v4 as uuidv4 } from 'uuid';

const getDB = () => getDynamoDBClient();

/**
 * ビデオ通話ルームを作成し、お客様にLINEで通知
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      receptionId,
      userId,
      userDisplayName,
      storeId,
      storeName,
    } = body;

    if (!receptionId || !userId) {
      return NextResponse.json(
        { success: false, error: 'receptionId and userId are required' },
        { status: 400 }
      );
    }

    // ルームIDを生成
    const roomId = `vc_${uuidv4().slice(0, 8)}`;
    const timestamp = new Date().toISOString();

    // ルームをDynamoDBに保存
    const room = {
      roomId,
      receptionId,
      userId,
      userDisplayName: userDisplayName || 'お客様',
      storeId: storeId || 'admin',
      storeName: storeName || 'あおぞら薬局',
      status: 'waiting',
      storeCandidates: [],
      customerCandidates: [],
      createdAt: timestamp,
      // 24時間後に自動削除
      ttl: Math.floor(Date.now() / 1000) + 24 * 60 * 60,
    };

    await getDB().send(new PutCommand({
      TableName: TABLES.VIDEO_CALLS,
      Item: room,
    }));

    // お客様にLINEでビデオ通話リンクを送信
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://vpp-implement-prescription.d28rixt8pa2otz.amplifyapp.com';
    const videoCallUrl = `${baseUrl}/video-call/${roomId}?role=customer`;
    
    const message = `【オンライン服薬指導のご案内】

${storeName || 'あおぞら薬局'}から、オンライン服薬指導のビデオ通話リクエストが届きました。

下記のリンクをタップして、ビデオ通話に参加してください。

▼ビデオ通話に参加
${videoCallUrl}

※通話にはカメラとマイクの許可が必要です
※リンクの有効期限は24時間です`;

    const lineDelivered = await sendTextMessage(userId, message);
    console.log(`Video call invitation sent to ${userId}: ${lineDelivered}`);

    return NextResponse.json({
      success: true,
      data: {
        ...room,
        storeVideoCallUrl: `${baseUrl}/video-call/${roomId}?role=store`,
        customerVideoCallUrl: videoCallUrl,
        lineDelivered,
      },
    });
  } catch (error) {
    console.error('Error creating video call room:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create video call room' },
      { status: 500 }
    );
  }
}

/**
 * ビデオ通話ルーム一覧を取得（デバッグ用）
 */
export async function GET() {
  try {
    const result = await getDB().send(new ScanCommand({
      TableName: TABLES.VIDEO_CALLS,
      Limit: 50,
    }));

    return NextResponse.json({
      success: true,
      data: result.Items || [],
    });
  } catch (error) {
    console.error('Error fetching video call rooms:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch video call rooms' },
      { status: 500 }
    );
  }
}
