/**
 * 処方箋受付詳細API
 * GET: 受付詳細を取得
 * PATCH: 受付を更新（ステータス変更、店舗割振りなど）
 */

import { NextRequest, NextResponse } from 'next/server';
import { dynamoDB, TABLES, GetCommand, UpdateCommand, QueryCommand, PutCommand } from '@/lib/dynamodb';
import { sendReadyNotification, sendTextMessage } from '@/lib/line';

export async function GET(
  request: NextRequest,
  { params }: { params: { receptionId: string } }
) {
  try {
    const { receptionId } = params;
    
    // まずScanで該当の受付を探す（timestampが不明なため）
    const result = await dynamoDB.send(new QueryCommand({
      TableName: TABLES.PRESCRIPTIONS,
      IndexName: 'userId-timestamp-index',
      KeyConditionExpression: 'userId = :userId',
      FilterExpression: 'receptionId = :receptionId',
      ExpressionAttributeValues: {
        ':userId': '*', // これは動作しない可能性があるので、別の方法を検討
        ':receptionId': receptionId,
      },
    }));

    // GSIでreceptionIdを検索できないので、Scanを使用
    const { Items } = await dynamoDB.send(new QueryCommand({
      TableName: TABLES.PRESCRIPTIONS,
      KeyConditionExpression: 'receptionId = :receptionId',
      ExpressionAttributeValues: {
        ':receptionId': receptionId,
      },
      Limit: 1,
    }));

    if (!Items || Items.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Reception not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: Items[0],
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
    const { action, timestamp, ...data } = body;

    if (!timestamp) {
      return NextResponse.json(
        { success: false, error: 'timestamp is required for update' },
        { status: 400 }
      );
    }

    let updateExpression = 'SET updatedAt = :updatedAt';
    const expressionAttributeValues: Record<string, any> = {
      ':updatedAt': new Date().toISOString(),
    };
    const expressionAttributeNames: Record<string, string> = {};

    switch (action) {
      case 'updateStatus':
        updateExpression += ', #status = :status';
        expressionAttributeNames['#status'] = 'status';
        expressionAttributeValues[':status'] = data.status;

        // ステータスに応じてタイムスタンプを追加
        if (data.status === 'confirmed') {
          updateExpression += ', confirmedAt = :confirmedAt';
          expressionAttributeValues[':confirmedAt'] = new Date().toISOString();
        } else if (data.status === 'preparing') {
          updateExpression += ', preparingAt = :preparingAt';
          expressionAttributeValues[':preparingAt'] = new Date().toISOString();
        } else if (data.status === 'ready') {
          updateExpression += ', readyAt = :readyAt';
          expressionAttributeValues[':readyAt'] = new Date().toISOString();
          
          // お客様にLINE通知を送信
          if (data.userId) {
            const storeName = data.selectedStoreName || 'あおぞら薬局';
            const sent = await sendReadyNotification(data.userId, storeName);
            console.log(`Ready notification sent to ${data.userId}: ${sent}`);
          }
        } else if (data.status === 'completed') {
          updateExpression += ', completedAt = :completedAt, messagingSessionStatus = :sessionStatus';
          expressionAttributeValues[':completedAt'] = new Date().toISOString();
          expressionAttributeValues[':sessionStatus'] = 'closed';
        } else if (data.status === 'cancelled') {
          updateExpression += ', messagingSessionStatus = :sessionStatus';
          expressionAttributeValues[':sessionStatus'] = 'closed';
        }
        break;

      case 'assignStore':
        updateExpression += ', selectedStoreId = :storeId, selectedStoreName = :storeName, assignedAt = :assignedAt';
        expressionAttributeValues[':storeId'] = data.storeId;
        expressionAttributeValues[':storeName'] = data.storeName;
        expressionAttributeValues[':assignedAt'] = new Date().toISOString();
        break;

      case 'updateNote':
        updateExpression += ', staffNote = :staffNote';
        expressionAttributeValues[':staffNote'] = data.staffNote;
        break;

      default:
        return NextResponse.json(
          { success: false, error: 'Invalid action' },
          { status: 400 }
        );
    }

    // DynamoDB更新
    const updateParams = {
      TableName: TABLES.PRESCRIPTIONS,
      Key: {
        receptionId,
        timestamp,
      },
      UpdateExpression: updateExpression,
      ExpressionAttributeValues: expressionAttributeValues,
      ...(Object.keys(expressionAttributeNames).length > 0 && {
        ExpressionAttributeNames: expressionAttributeNames,
      }),
      ReturnValues: 'ALL_NEW' as const,
    };

    const result = await dynamoDB.send(new UpdateCommand(updateParams));

    return NextResponse.json({
      success: true,
      data: result.Attributes,
    });
  } catch (error) {
    console.error('Error updating reception:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update reception' },
      { status: 500 }
    );
  }
}
