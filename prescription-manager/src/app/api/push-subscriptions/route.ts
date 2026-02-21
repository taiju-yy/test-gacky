/**
 * プッシュ通知購読管理API
 * 
 * POST: 購読を登録
 * PATCH: 購読の店舗情報を更新
 * DELETE: 購読を解除
 * GET: 購読状態を確認
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDynamoDBClient, TABLES, PutCommand, DeleteCommand, QueryCommand, ScanCommand, UpdateCommand } from '@/lib/dynamodb';
import { createHash } from 'crypto';

// DynamoDB クライアントを取得
const getDB = () => getDynamoDBClient();

/**
 * エンドポイントからユニークIDを生成
 */
function generateSubscriptionId(endpoint: string): string {
  return createHash('sha256').update(endpoint).digest('hex').slice(0, 32);
}

/**
 * POST: プッシュ通知購読を登録
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { subscription, userId, userType, storeId, storeName } = body;

    if (!subscription || !subscription.endpoint) {
      return NextResponse.json(
        { success: false, error: 'Invalid subscription data' },
        { status: 400 }
      );
    }

    if (!userId || !userType) {
      return NextResponse.json(
        { success: false, error: 'userId and userType are required' },
        { status: 400 }
      );
    }

    const subscriptionId = generateSubscriptionId(subscription.endpoint);
    const timestamp = new Date().toISOString();

    // DynamoDB に保存
    const item = {
      subscriptionId,
      endpoint: subscription.endpoint,
      keys: subscription.keys, // { p256dh, auth }
      userId,
      userType, // 'admin' | 'store_staff'
      storeId: storeId || null,
      storeName: storeName || null,
      createdAt: timestamp,
      updatedAt: timestamp,
      // アクティブフラグ（通知失敗時にfalseに）
      isActive: true,
      // TTL は設定しない（明示的に削除するまで保持）
    };

    await getDB().send(new PutCommand({
      TableName: TABLES.PUSH_SUBSCRIPTIONS,
      Item: item,
    }));

    console.log(`Push subscription registered: ${subscriptionId} for user ${userId} (${userType})`);

    return NextResponse.json({
      success: true,
      data: {
        subscriptionId,
        userId,
        userType,
        storeId,
      },
    });
  } catch (error) {
    console.error('Error registering push subscription:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to register subscription' },
      { status: 500 }
    );
  }
}

/**
 * DELETE: プッシュ通知購読を解除
 */
export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const { endpoint } = body;

    if (!endpoint) {
      return NextResponse.json(
        { success: false, error: 'Endpoint is required' },
        { status: 400 }
      );
    }

    const subscriptionId = generateSubscriptionId(endpoint);

    await getDB().send(new DeleteCommand({
      TableName: TABLES.PUSH_SUBSCRIPTIONS,
      Key: {
        subscriptionId,
      },
    }));

    console.log(`Push subscription deleted: ${subscriptionId}`);

    return NextResponse.json({
      success: true,
    });
  } catch (error) {
    console.error('Error deleting push subscription:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to delete subscription' },
      { status: 500 }
    );
  }
}

/**
 * PATCH: 購読の店舗情報を更新（店舗変更時）
 */
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId, storeId, storeName } = body;

    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'userId is required' },
        { status: 400 }
      );
    }

    // ユーザーの購読を検索
    const scanResult = await getDB().send(new ScanCommand({
      TableName: TABLES.PUSH_SUBSCRIPTIONS,
      FilterExpression: 'userId = :userId AND isActive = :isActive',
      ExpressionAttributeValues: {
        ':userId': userId,
        ':isActive': true,
      },
    }));

    const subscriptions = scanResult.Items || [];

    if (subscriptions.length === 0) {
      return NextResponse.json({
        success: true,
        data: { updated: 0, message: 'No active subscriptions found for user' },
      });
    }

    // 各購読の店舗情報を更新
    const timestamp = new Date().toISOString();
    let updatedCount = 0;

    for (const sub of subscriptions) {
      try {
        await getDB().send(new UpdateCommand({
          TableName: TABLES.PUSH_SUBSCRIPTIONS,
          Key: {
            subscriptionId: sub.subscriptionId,
          },
          UpdateExpression: 'SET storeId = :storeId, storeName = :storeName, updatedAt = :updatedAt',
          ExpressionAttributeValues: {
            ':storeId': storeId || null,
            ':storeName': storeName || null,
            ':updatedAt': timestamp,
          },
        }));
        updatedCount++;
        console.log(`Push subscription ${sub.subscriptionId} updated: storeId=${storeId}`);
      } catch (updateError) {
        console.error(`Failed to update subscription ${sub.subscriptionId}:`, updateError);
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        updated: updatedCount,
        storeId,
        storeName,
      },
    });
  } catch (error) {
    console.error('Error updating push subscriptions:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update subscriptions' },
      { status: 500 }
    );
  }
}

/**
 * GET: 購読状態を確認
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    const storeId = searchParams.get('storeId');

    // 特定ユーザーの購読を取得
    if (userId) {
      const result = await getDB().send(new ScanCommand({
        TableName: TABLES.PUSH_SUBSCRIPTIONS,
        FilterExpression: 'userId = :userId AND isActive = :isActive',
        ExpressionAttributeValues: {
          ':userId': userId,
          ':isActive': true,
        },
      }));

      return NextResponse.json({
        success: true,
        data: result.Items || [],
      });
    }

    // 特定店舗の購読を取得
    if (storeId) {
      const result = await getDB().send(new ScanCommand({
        TableName: TABLES.PUSH_SUBSCRIPTIONS,
        FilterExpression: 'storeId = :storeId AND isActive = :isActive',
        ExpressionAttributeValues: {
          ':storeId': storeId,
          ':isActive': true,
        },
      }));

      return NextResponse.json({
        success: true,
        data: result.Items || [],
      });
    }

    // 全体の購読数を取得（管理用）
    const result = await getDB().send(new ScanCommand({
      TableName: TABLES.PUSH_SUBSCRIPTIONS,
      FilterExpression: 'isActive = :isActive',
      ExpressionAttributeValues: {
        ':isActive': true,
      },
      Select: 'COUNT',
    }));

    return NextResponse.json({
      success: true,
      data: {
        totalActiveSubscriptions: result.Count || 0,
      },
    });
  } catch (error) {
    console.error('Error fetching push subscriptions:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch subscriptions' },
      { status: 500 }
    );
  }
}
