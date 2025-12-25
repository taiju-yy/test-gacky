/**
 * 処方箋受付詳細API
 * GET: 受付詳細を取得
 * PATCH: 受付を更新（ステータス変更、店舗割振りなど）
 */

import { NextRequest, NextResponse } from 'next/server';

export async function GET(
  request: NextRequest,
  { params }: { params: { receptionId: string } }
) {
  try {
    const { receptionId } = params;
    
    // TODO: DynamoDB から取得
    return NextResponse.json({
      success: true,
      data: {
        receptionId,
        message: 'Reception details would be fetched from DynamoDB',
      },
    });
  } catch (error) {
    console.error('Error fetching reception:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch reception' },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { receptionId: string } }
) {
  try {
    const { receptionId } = params;
    const body = await request.json();
    const { action, ...data } = body;

    switch (action) {
      case 'updateStatus':
        // ステータス更新
        console.log(`Updating status for ${receptionId}:`, data.status);
        
        // 準備完了の場合はLINE通知を送信
        if (data.status === 'ready') {
          console.log('Sending ready notification...');
          // TODO: sendReadyNotification を呼び出し
        }
        break;

      case 'assignStore':
        // 店舗割振り
        console.log(`Assigning store for ${receptionId}:`, data.storeId, data.storeName);
        break;

      case 'updateNote':
        // メモ更新
        console.log(`Updating note for ${receptionId}:`, data.staffNote);
        break;

      default:
        return NextResponse.json(
          { success: false, error: 'Invalid action' },
          { status: 400 }
        );
    }

    return NextResponse.json({
      success: true,
      data: {
        receptionId,
        action,
        ...data,
        updatedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('Error updating reception:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update reception' },
      { status: 500 }
    );
  }
}
