/**
 * 処方箋受付詳細API
 * GET: 受付詳細を取得
 * PATCH: 受付を更新（ステータス変更、店舗割振りなど）
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDynamoDBClient, TABLES, GetCommand, UpdateCommand, QueryCommand, PutCommand } from '@/lib/dynamodb';
import { sendReadyNotification, sendTextMessage, sendShippingNotification, sendShippedNotification, sendDeliveryCompletedNotification, sendVideoCallInvitation } from '@/lib/line';
import { v4 as uuidv4 } from 'uuid';

// DynamoDB クライアントを取得
const getDB = () => getDynamoDBClient();

export async function GET(
  request: NextRequest,
  { params }: { params: { receptionId: string } }
) {
  try {
    const { receptionId } = params;
    
    // まずScanで該当の受付を探す（timestampが不明なため）
    const result = await getDB().send(new QueryCommand({
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
    const { Items } = await getDB().send(new QueryCommand({
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
          
          // お客様にLINE通知を送信（店舗受け取りの場合のみ）
          if (data.userId) {
            const storeName = data.selectedStoreName || 'あおぞら薬局';
            const sent = await sendReadyNotification(data.userId, storeName);
            console.log(`Ready notification sent to ${data.userId}: ${sent}`);
          }
        } else if (data.status === 'video_counseling') {
          // オンライン服薬指導開始（自宅受け取り）
          // ビデオ通話ルームを作成し、リンクも同時に送信
          const roomId = `vc_${uuidv4().slice(0, 8)}`;
          const vcTimestamp = new Date().toISOString();
          
          updateExpression += ', videoCounselingStatus = :vcStatus, videoCounselingStartedAt = :vcStartedAt, videoCallRoomId = :roomId';
          expressionAttributeValues[':vcStatus'] = 'in_progress';
          expressionAttributeValues[':vcStartedAt'] = vcTimestamp;
          expressionAttributeValues[':roomId'] = roomId;
          
          // ビデオ通話ルームをDynamoDBに保存
          const room = {
            roomId,
            receptionId,
            userId: data.userId,
            userDisplayName: data.userDisplayName || 'お客様',
            storeId: data.selectedStoreId || 'admin',
            storeName: data.selectedStoreName || 'あおぞら薬局',
            status: 'waiting',
            storeCandidates: [],
            customerCandidates: [],
            createdAt: vcTimestamp,
            ttl: Math.floor(Date.now() / 1000) + 24 * 60 * 60,
          };
          
          try {
            await getDB().send(new PutCommand({
              TableName: TABLES.VIDEO_CALLS,
              Item: room,
            }));
            console.log(`Video call room created: ${roomId}`);
          } catch (roomError) {
            console.error('Error creating video call room:', roomError);
          }
          
          // お客様にビデオ通話リンクを送信
          if (data.userId) {
            const storeName = data.selectedStoreName || 'あおぞら薬局';
            const sent = await sendVideoCallInvitation(data.userId, storeName, roomId);
            console.log(`Video call invitation sent to ${data.userId}: ${sent}`);
          }
        } else if (data.status === 'shipping') {
          // 配送準備中（自宅受け取り）- 服薬指導完了
          updateExpression += ', shippingAt = :shippingAt, videoCounselingStatus = :vcStatus, videoCounselingCompletedAt = :vcCompletedAt';
          expressionAttributeValues[':shippingAt'] = new Date().toISOString();
          expressionAttributeValues[':vcStatus'] = 'completed';
          expressionAttributeValues[':vcCompletedAt'] = new Date().toISOString();
          
          // お客様にLINE通知を送信
          if (data.userId) {
            const sent = await sendShippingNotification(data.userId);
            console.log(`Shipping notification sent to ${data.userId}: ${sent}`);
          }
        } else if (data.status === 'shipped') {
          // 配送中（自宅受け取り）
          updateExpression += ', shippedAt = :shippedAt';
          expressionAttributeValues[':shippedAt'] = new Date().toISOString();
          
          // お客様にLINE通知を送信（店舗電話番号を含む）
          if (data.userId) {
            const storeName = data.selectedStoreName || 'あおぞら薬局';
            const storePhone = data.storePhone || null; // 店舗電話番号（将来的に店舗マスタから取得）
            const sent = await sendShippedNotification(data.userId, storeName, storePhone);
            console.log(`Shipped notification sent to ${data.userId}: ${sent}`);
          }
        } else if (data.status === 'completed') {
          updateExpression += ', completedAt = :completedAt, messagingSessionStatus = :sessionStatus, sessionCloseReason = :closeReason';
          expressionAttributeValues[':completedAt'] = new Date().toISOString();
          expressionAttributeValues[':sessionStatus'] = 'closed';
          expressionAttributeValues[':closeReason'] = 'completed';
          
          // 自宅受け取りの場合は配送完了通知を送信（店舗電話番号を含む）
          if (data.userId && data.deliveryMethod === 'home') {
            const storeName = data.selectedStoreName || 'あおぞら薬局';
            const storePhone = data.storePhone || null; // 店舗電話番号（将来的に店舗マスタから取得）
            const sent = await sendDeliveryCompletedNotification(data.userId, storeName, storePhone);
            console.log(`Delivery completed notification sent to ${data.userId}: ${sent}`);
          }
          
          // セッションテーブルも更新（Lambda側のAI応答スキップを解除）
          if (data.userId) {
            try {
              await getDB().send(new UpdateCommand({
                TableName: TABLES.SESSIONS,
                Key: { userId: data.userId },
                UpdateExpression: 'SET messagingSessionStatus = :status, activeReceptionId = :nullVal, sessionClosedAt = :closedAt, sessionCloseReason = :reason, updatedAt = :updatedAt',
                ExpressionAttributeValues: {
                  ':status': 'closed',
                  ':nullVal': null,
                  ':closedAt': new Date().toISOString(),
                  ':reason': 'completed',
                  ':updatedAt': new Date().toISOString(),
                },
              }));
              console.log(`Session closed for user ${data.userId} (completed)`);
            } catch (sessionError) {
              console.error('Error closing session:', sessionError);
            }
          }
        } else if (data.status === 'cancelled') {
          updateExpression += ', messagingSessionStatus = :sessionStatus, sessionCloseReason = :closeReason';
          expressionAttributeValues[':sessionStatus'] = 'closed';
          expressionAttributeValues[':closeReason'] = 'cancelled';
          
          // セッションテーブルも更新（Lambda側のAI応答スキップを解除）
          if (data.userId) {
            try {
              await getDB().send(new UpdateCommand({
                TableName: TABLES.SESSIONS,
                Key: { userId: data.userId },
                UpdateExpression: 'SET messagingSessionStatus = :status, activeReceptionId = :nullVal, sessionClosedAt = :closedAt, sessionCloseReason = :reason, updatedAt = :updatedAt',
                ExpressionAttributeValues: {
                  ':status': 'closed',
                  ':nullVal': null,
                  ':closedAt': new Date().toISOString(),
                  ':reason': 'cancelled',
                  ':updatedAt': new Date().toISOString(),
                },
              }));
              console.log(`Session closed for user ${data.userId} (cancelled)`);
            } catch (sessionError) {
              console.error('Error closing session:', sessionError);
            }
          }
        }
        break;

      case 'assignStore':
        updateExpression += ', selectedStoreId = :storeId, selectedStoreName = :storeName, assignedAt = :assignedAt';
        expressionAttributeValues[':storeId'] = data.storeId;
        expressionAttributeValues[':storeName'] = data.storeName;
        expressionAttributeValues[':assignedAt'] = new Date().toISOString();

        // お客様の元の店舗と異なる店舗に割り当てられた場合、LINE通知を送信
        // originalStoreId: お客様が選択した店舗（preferredStoreId または selectedStoreId）
        if (data.userId && data.originalStoreId && data.storeId !== data.originalStoreId) {
          const storeName = data.storeName || 'あおぞら薬局';
          // 「あおぞら薬局」プレフィックスを除去して店舗名を取得
          const displayStoreName = storeName
            .replace(/^あおぞら薬局[\s　]*/g, '')
            .replace(/^Aozora[\s　]*/gi, '');
          const message = `【お知らせ】\n\nお客様の処方箋について、調剤を担当する店舗が変更になりました。\n\n担当店舗: あおぞら薬局 ${displayStoreName}\n\nお薬の準備ができ次第ご連絡いたします。`;
          const sent = await sendTextMessage(data.userId, message);
          console.log(`Store change notification sent to ${data.userId}: ${sent}`);
        }
        break;

      case 'updateNote':
        updateExpression += ', staffNote = :staffNote';
        expressionAttributeValues[':staffNote'] = data.staffNote;
        break;

      case 'reactivateSession':
        // セッションを再開（タイムアウト後に店舗スタッフが手動で再開）
        updateExpression += ', messagingSessionStatus = :sessionStatus, sessionReactivatedAt = :reactivatedAt';
        expressionAttributeValues[':sessionStatus'] = 'active';
        expressionAttributeValues[':reactivatedAt'] = new Date().toISOString();
        
        // お客様にセッション再開を通知
        if (data.userId) {
          const message = '【お知らせ】\n\nあおぞら薬局からメッセージの受付を再開しました。\n\nご質問やご連絡がございましたら、こちらにメッセージをお送りください。';
          const sent = await sendTextMessage(data.userId, message);
          console.log(`Session reactivation notification sent to ${data.userId}: ${sent}`);
        }
        
        // セッションテーブルも更新（Lambda側と同期）
        try {
          const sessionTimestamp = new Date().toISOString();
          await getDB().send(new PutCommand({
            TableName: TABLES.SESSIONS,
            Item: {
              userId: data.userId,
              activeReceptionId: receptionId,
              messagingSessionStatus: 'active',
              lastStoreMessageAt: sessionTimestamp,
              lastCustomerMessageAt: null,
              sessionStartedAt: sessionTimestamp,
              sessionReactivatedAt: sessionTimestamp,
              sessionTimeoutMinutes: 30,
              updatedAt: sessionTimestamp,
            },
          }));
        } catch (sessionError) {
          console.error('Error updating session table:', sessionError);
        }
        break;

      case 'updateDeliveryMethod':
        // 受け取り方法の変更（店舗受取り ⇔ 自宅受取り）
        updateExpression += ', deliveryMethod = :deliveryMethod, deliveryMethodChangedAt = :changedAt, deliveryMethodChangedBy = :changedBy';
        expressionAttributeValues[':deliveryMethod'] = data.deliveryMethod;
        expressionAttributeValues[':changedAt'] = new Date().toISOString();
        expressionAttributeValues[':changedBy'] = data.changedBy || 'staff'; // 'staff' | 'admin'
        
        // 自宅受取りに変更された場合、店舗情報をクリア（オプション）
        if (data.deliveryMethod === 'home' && data.clearStore) {
          updateExpression += ', selectedStoreId = :nullStoreId, selectedStoreName = :nullStoreName';
          expressionAttributeValues[':nullStoreId'] = null;
          expressionAttributeValues[':nullStoreName'] = null;
        }
        
        // 店舗受取りに変更された場合、店舗を設定（オプション）
        if (data.deliveryMethod === 'store' && data.storeId && data.storeName) {
          updateExpression += ', selectedStoreId = :newStoreId, selectedStoreName = :newStoreName';
          expressionAttributeValues[':newStoreId'] = data.storeId;
          expressionAttributeValues[':newStoreName'] = data.storeName;
        }
        
        // お客様に変更を通知（オプション）
        if (data.notifyCustomer && data.userId) {
          let message;
          if (data.deliveryMethod === 'home') {
            message = '【お知らせ】\n\nお薬の受け取り方法が「自宅受け取り（オンライン服薬指導）」に変更されました。\n\n担当者からご連絡いたしますので、しばらくお待ちください。';
          } else {
            const storeName = data.storeName || '指定店舗';
            message = `【お知らせ】\n\nお薬の受け取り方法が「店舗受け取り」に変更されました。\n\n受取店舗: あおぞら薬局 ${storeName}\n\nお薬の準備ができ次第ご連絡いたします。`;
          }
          const sent = await sendTextMessage(data.userId, message);
          console.log(`Delivery method change notification sent to ${data.userId}: ${sent}`);
        }
        
        console.log(`Delivery method changed to ${data.deliveryMethod} for reception ${receptionId}`);
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

    const result = await getDB().send(new UpdateCommand(updateParams));

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
