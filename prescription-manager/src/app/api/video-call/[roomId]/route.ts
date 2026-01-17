/**
 * ビデオ通話ルーム詳細API
 * GET: ルーム情報を取得
 * PATCH: ルーム情報を更新（シグナリング用）
 * DELETE: ルームを削除（通話終了）
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDynamoDBClient, TABLES, GetCommand, UpdateCommand, DeleteCommand } from '@/lib/dynamodb';

const getDB = () => getDynamoDBClient();

/**
 * ルーム情報を取得
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { roomId: string } }
) {
  try {
    const { roomId } = params;

    const result = await getDB().send(new GetCommand({
      TableName: TABLES.VIDEO_CALLS,
      Key: { roomId },
    }));

    if (!result.Item) {
      return NextResponse.json(
        { success: false, error: 'Room not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: result.Item,
    });
  } catch (error) {
    console.error('Error fetching video call room:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch room' },
      { status: 500 }
    );
  }
}

/**
 * ルーム情報を更新（WebRTCシグナリング用）
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { roomId: string } }
) {
  try {
    const { roomId } = params;
    const body = await request.json();
    const { action, ...data } = body;

    let updateExpression = 'SET updatedAt = :updatedAt';
    const expressionAttributeValues: Record<string, any> = {
      ':updatedAt': new Date().toISOString(),
    };

    switch (action) {
      case 'setOffer':
        // 店舗側がSDPオファーを設定
        updateExpression += ', offer = :offer, #status = :status';
        expressionAttributeValues[':offer'] = data.offer;
        expressionAttributeValues[':status'] = 'connecting';
        break;

      case 'setAnswer':
        // お客様側がSDPアンサーを設定
        updateExpression += ', answer = :answer, #status = :status, startedAt = :startedAt';
        expressionAttributeValues[':answer'] = data.answer;
        expressionAttributeValues[':status'] = 'active';
        expressionAttributeValues[':startedAt'] = new Date().toISOString();
        break;

      case 'addStoreCandidate':
        // 店舗側のICE Candidateを追加
        updateExpression += ', storeCandidates = list_append(if_not_exists(storeCandidates, :emptyList), :candidate)';
        expressionAttributeValues[':candidate'] = [data.candidate];
        expressionAttributeValues[':emptyList'] = [];
        break;

      case 'addCustomerCandidate':
        // お客様側のICE Candidateを追加
        updateExpression += ', customerCandidates = list_append(if_not_exists(customerCandidates, :emptyList), :candidate)';
        expressionAttributeValues[':candidate'] = [data.candidate];
        expressionAttributeValues[':emptyList'] = [];
        break;

      case 'endCall':
        // 通話終了
        updateExpression += ', #status = :status, endedAt = :endedAt';
        expressionAttributeValues[':status'] = 'ended';
        expressionAttributeValues[':endedAt'] = new Date().toISOString();
        break;

      default:
        return NextResponse.json(
          { success: false, error: 'Invalid action' },
          { status: 400 }
        );
    }

    const result = await getDB().send(new UpdateCommand({
      TableName: TABLES.VIDEO_CALLS,
      Key: { roomId },
      UpdateExpression: updateExpression,
      ExpressionAttributeValues: expressionAttributeValues,
      ExpressionAttributeNames: action !== 'addStoreCandidate' && action !== 'addCustomerCandidate' 
        ? { '#status': 'status' } 
        : undefined,
      ReturnValues: 'ALL_NEW',
    }));

    return NextResponse.json({
      success: true,
      data: result.Attributes,
    });
  } catch (error) {
    console.error('Error updating video call room:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update room' },
      { status: 500 }
    );
  }
}

/**
 * ルームを削除
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { roomId: string } }
) {
  try {
    const { roomId } = params;

    await getDB().send(new DeleteCommand({
      TableName: TABLES.VIDEO_CALLS,
      Key: { roomId },
    }));

    return NextResponse.json({
      success: true,
      message: 'Room deleted',
    });
  } catch (error) {
    console.error('Error deleting video call room:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to delete room' },
      { status: 500 }
    );
  }
}
