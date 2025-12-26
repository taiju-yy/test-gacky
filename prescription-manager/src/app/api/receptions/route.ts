/**
 * 処方箋受付API
 * GET: 受付一覧を取得
 * POST: 新規受付を作成
 */

import { NextRequest, NextResponse } from 'next/server';

// デモ用データ（実際の実装ではDynamoDBから取得）
let demoReceptions = [
  {
    receptionId: 'rx_20241225_001',
    timestamp: new Date().toISOString(),
    userId: 'U1234567890abcdef',
    userDisplayName: '山田 太郎',
    prescriptionImageUrl: '',
    prescriptionImageKey: '',
    status: 'pending',
    messagingSessionStatus: 'inactive',
    ttl: Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60,
  },
  {
    receptionId: 'rx_20241225_002',
    timestamp: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
    userId: 'U2345678901bcdefg',
    userDisplayName: '佐藤 花子',
    prescriptionImageUrl: '',
    prescriptionImageKey: '',
    selectedStoreId: 'store_001',
    selectedStoreName: '金沢駅前',
    status: 'pending',
    messagingSessionStatus: 'inactive',
    customerNote: '15時頃に取りに行きたい',
    ttl: Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60,
  },
];

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const storeId = searchParams.get('storeId');

    let receptions = [...demoReceptions];

    // ステータスでフィルタ
    if (status && status !== 'all') {
      receptions = receptions.filter((r) => r.status === status);
    }

    // 店舗でフィルタ
    if (storeId) {
      receptions = receptions.filter((r) => r.selectedStoreId === storeId);
    }

    // タイムスタンプで降順ソート
    receptions.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    return NextResponse.json({
      success: true,
      data: receptions,
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
    
    // TODO: 実際の実装では DynamoDB に保存
    const newReception = {
      receptionId: `rx_${Date.now()}`,
      timestamp: new Date().toISOString(),
      ...body,
      status: 'pending',
      messagingSessionStatus: 'inactive',
      ttl: Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60,
    };

    demoReceptions.unshift(newReception);

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
