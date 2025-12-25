/**
 * 処方箋管理モジュール
 * 
 * お客様がGackyに処方箋画像を送信したときの処理と、
 * 店舗とのメッセージルーティングを管理
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient,
  PutCommand,
  UpdateCommand,
  QueryCommand,
  GetCommand,
} = require('@aws-sdk/lib-dynamodb');
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');

// AWS クライアント
const dynamoDBClient = new DynamoDBClient({});
const dynamoDB = DynamoDBDocumentClient.from(dynamoDBClient);
const s3Client = new S3Client({});

// テーブル名
const TABLE_PRESCRIPTIONS = process.env.TABLE_PRESCRIPTIONS || 'gacky-prescriptions';
const TABLE_PRESCRIPTION_MESSAGES = process.env.TABLE_PRESCRIPTION_MESSAGES || 'gacky-prescription-messages';
const TABLE_CUSTOMER_SESSIONS = process.env.TABLE_CUSTOMER_SESSIONS || 'gacky-customer-messaging-sessions';

// S3バケット
const PRESCRIPTION_BUCKET = process.env.PRESCRIPTION_BUCKET || 'gacky-prescriptions';

// セッションタイムアウト（分）
const SESSION_TIMEOUT_MINUTES = 30;

// TTL計算（1年後）
const getTTL = () => Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;

/**
 * 処方箋画像を受信して処理
 */
async function handlePrescriptionImage(userId, userProfile, imageContent, messageId) {
  try {
    console.log(`Processing prescription image from user: ${userId}`);

    // 受付IDを生成
    const receptionId = `rx_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}_${uuidv4().slice(0, 8)}`;
    const timestamp = new Date().toISOString();

    // S3に画像を保存
    const s3Key = `prescriptions/${userId}/${receptionId}/${messageId}.jpg`;
    await s3Client.send(new PutObjectCommand({
      Bucket: PRESCRIPTION_BUCKET,
      Key: s3Key,
      Body: imageContent,
      ContentType: 'image/jpeg',
    }));

    // 署名付きURLを生成
    const imageUrl = await getSignedUrl(
      s3Client,
      new GetObjectCommand({
        Bucket: PRESCRIPTION_BUCKET,
        Key: s3Key,
      }),
      { expiresIn: 7 * 24 * 60 * 60 } // 7日間有効
    );

    // DynamoDBに受付を作成
    const receptionItem = {
      receptionId,
      timestamp,
      userId,
      userDisplayName: userProfile?.displayName || null,
      userProfileImage: userProfile?.pictureUrl || null,
      prescriptionImageUrl: imageUrl,
      prescriptionImageKey: s3Key,
      status: 'pending',
      messagingSessionStatus: 'inactive',
      customerNote: null,
      staffNote: null,
      selectedStoreId: null,
      selectedStoreName: null,
      createdAt: timestamp,
      ttl: getTTL(),
    };

    await dynamoDB.send(new PutCommand({
      TableName: TABLE_PRESCRIPTIONS,
      Item: receptionItem,
    }));

    console.log(`Prescription reception created: ${receptionId}`);

    return {
      success: true,
      receptionId,
      timestamp,
    };
  } catch (error) {
    console.error('Error handling prescription image:', error);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * お客様がアクティブなメッセージングセッションを持っているか確認
 * 
 * これがtrueの場合:
 * - AI自動応答をスキップする
 * - メッセージを店舗にルーティングする
 */
async function checkActiveMessagingSession(userId) {
  try {
    const session = await dynamoDB.send(new GetCommand({
      TableName: TABLE_CUSTOMER_SESSIONS,
      Key: { userId },
    }));

    if (!session.Item) {
      return {
        isActive: false,
        receptionId: null,
        shouldRouteToStore: false,
      };
    }

    const sessionData = session.Item;

    // セッションがアクティブかつタイムアウトしていないか確認
    if (sessionData.messagingSessionStatus === 'active' && sessionData.lastStoreMessageAt) {
      const lastMessageTime = new Date(sessionData.lastStoreMessageAt).getTime();
      const timeoutMs = (sessionData.sessionTimeoutMinutes || SESSION_TIMEOUT_MINUTES) * 60 * 1000;
      const now = Date.now();

      if (now - lastMessageTime < timeoutMs) {
        console.log(`Active messaging session found for user ${userId}, reception: ${sessionData.activeReceptionId}`);
        return {
          isActive: true,
          receptionId: sessionData.activeReceptionId,
          shouldRouteToStore: true,
        };
      } else {
        // タイムアウト - セッションを閉じる
        console.log(`Session timeout for user ${userId}, closing session`);
        await closeMessagingSession(userId);
      }
    }

    return {
      isActive: false,
      receptionId: null,
      shouldRouteToStore: false,
    };
  } catch (error) {
    console.error('Error checking messaging session:', error);
    return {
      isActive: false,
      receptionId: null,
      shouldRouteToStore: false,
    };
  }
}

/**
 * メッセージングセッションをアクティブにする（店舗がメッセージを送信したとき）
 */
async function activateMessagingSession(userId, receptionId) {
  try {
    const timestamp = new Date().toISOString();

    // セッションを作成/更新
    await dynamoDB.send(new PutCommand({
      TableName: TABLE_CUSTOMER_SESSIONS,
      Item: {
        userId,
        activeReceptionId: receptionId,
        messagingSessionStatus: 'active',
        lastStoreMessageAt: timestamp,
        sessionStartedAt: timestamp,
        sessionTimeoutMinutes: SESSION_TIMEOUT_MINUTES,
        updatedAt: timestamp,
      },
    }));

    // 処方箋受付のステータスも更新
    const reception = await getReceptionById(receptionId);
    if (reception) {
      await dynamoDB.send(new UpdateCommand({
        TableName: TABLE_PRESCRIPTIONS,
        Key: {
          receptionId,
          timestamp: reception.timestamp,
        },
        UpdateExpression: 'SET messagingSessionStatus = :status',
        ExpressionAttributeValues: {
          ':status': 'active',
        },
      }));
    }

    console.log(`Messaging session activated for user ${userId}, reception ${receptionId}`);
    return { success: true };
  } catch (error) {
    console.error('Error activating messaging session:', error);
    return { success: false, error: error.message };
  }
}

/**
 * メッセージングセッションを閉じる
 */
async function closeMessagingSession(userId) {
  try {
    const session = await dynamoDB.send(new GetCommand({
      TableName: TABLE_CUSTOMER_SESSIONS,
      Key: { userId },
    }));

    if (session.Item && session.Item.activeReceptionId) {
      // 処方箋受付のステータスも更新
      const reception = await getReceptionById(session.Item.activeReceptionId);
      if (reception) {
        await dynamoDB.send(new UpdateCommand({
          TableName: TABLE_PRESCRIPTIONS,
          Key: {
            receptionId: session.Item.activeReceptionId,
            timestamp: reception.timestamp,
          },
          UpdateExpression: 'SET messagingSessionStatus = :status',
          ExpressionAttributeValues: {
            ':status': 'closed',
          },
        }));
      }
    }

    // セッションを更新
    await dynamoDB.send(new PutCommand({
      TableName: TABLE_CUSTOMER_SESSIONS,
      Item: {
        userId,
        activeReceptionId: null,
        messagingSessionStatus: 'closed',
        lastStoreMessageAt: null,
        sessionStartedAt: null,
        sessionTimeoutMinutes: SESSION_TIMEOUT_MINUTES,
        updatedAt: new Date().toISOString(),
      },
    }));

    console.log(`Messaging session closed for user ${userId}`);
    return { success: true };
  } catch (error) {
    console.error('Error closing messaging session:', error);
    return { success: false, error: error.message };
  }
}

/**
 * 受付IDで処方箋受付を取得
 */
async function getReceptionById(receptionId) {
  try {
    const result = await dynamoDB.send(new QueryCommand({
      TableName: TABLE_PRESCRIPTIONS,
      KeyConditionExpression: 'receptionId = :receptionId',
      ExpressionAttributeValues: {
        ':receptionId': receptionId,
      },
      ScanIndexForward: false,
      Limit: 1,
    }));

    return result.Items?.[0] || null;
  } catch (error) {
    console.error('Error getting reception:', error);
    return null;
  }
}

/**
 * お客様からのメッセージを店舗にルーティング
 */
async function routeMessageToStore(userId, receptionId, messageContent, messageType = 'text') {
  try {
    const messageId = `msg_${Date.now()}_${uuidv4().slice(0, 8)}`;
    const timestamp = new Date().toISOString();

    // メッセージを保存
    const messageItem = {
      receptionId,
      messageId,
      timestamp,
      senderType: 'customer',
      senderId: userId,
      senderName: 'お客様', // TODO: ユーザー名を取得
      messageType,
      content: messageContent,
      lineDelivered: true, // お客様から受信したメッセージなのでtrue
      readByCustomer: true,
      readByStore: false,
      ttl: getTTL(),
    };

    await dynamoDB.send(new PutCommand({
      TableName: TABLE_PRESCRIPTION_MESSAGES,
      Item: messageItem,
    }));

    console.log(`Message routed to store: ${receptionId} - ${messageId}`);

    // セッションの最終アクティビティを更新
    await dynamoDB.send(new UpdateCommand({
      TableName: TABLE_CUSTOMER_SESSIONS,
      Key: { userId },
      UpdateExpression: 'SET lastCustomerMessageAt = :timestamp, updatedAt = :timestamp',
      ExpressionAttributeValues: {
        ':timestamp': timestamp,
      },
    }));

    // TODO: 店舗への通知（WebSocket、Push通知など）

    return {
      success: true,
      messageId,
    };
  } catch (error) {
    console.error('Error routing message to store:', error);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * 店舗からお客様へメッセージを送信
 */
async function sendMessageToCustomer(receptionId, storeId, storeName, messageContent, lineClient) {
  try {
    const reception = await getReceptionById(receptionId);
    if (!reception) {
      throw new Error(`Reception not found: ${receptionId}`);
    }

    const userId = reception.userId;
    const messageId = `msg_${Date.now()}_${uuidv4().slice(0, 8)}`;
    const timestamp = new Date().toISOString();

    // メッセージを保存
    const messageItem = {
      receptionId,
      messageId,
      timestamp,
      senderType: 'store',
      senderId: storeId,
      senderName: `あおぞら薬局 ${storeName}`,
      messageType: 'text',
      content: messageContent,
      lineDelivered: false,
      readByCustomer: false,
      readByStore: true,
      ttl: getTTL(),
    };

    await dynamoDB.send(new PutCommand({
      TableName: TABLE_PRESCRIPTION_MESSAGES,
      Item: messageItem,
    }));

    // メッセージングセッションをアクティブに
    await activateMessagingSession(userId, receptionId);

    // LINE でお客様にメッセージを送信
    const lineMessage = {
      type: 'text',
      text: `【あおぞら薬局 ${storeName}店からのメッセージ】\n\n${messageContent}`,
    };

    if (lineClient) {
      await lineClient.pushMessage({
        to: userId,
        messages: [lineMessage],
      });
    } else {
      // LINEクライアントがない場合は axios で直接送信
      await axios.post(
        'https://api.line.me/v2/bot/message/push',
        {
          to: userId,
          messages: [lineMessage],
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.ACCESSTOKEN}`,
          },
        }
      );
    }

    // 送信完了を記録
    await dynamoDB.send(new UpdateCommand({
      TableName: TABLE_PRESCRIPTION_MESSAGES,
      Key: { receptionId, messageId },
      UpdateExpression: 'SET lineDelivered = :delivered, lineDeliveredAt = :deliveredAt',
      ExpressionAttributeValues: {
        ':delivered': true,
        ':deliveredAt': timestamp,
      },
    }));

    console.log(`Message sent to customer: ${userId} from store ${storeName}`);

    return {
      success: true,
      messageId,
    };
  } catch (error) {
    console.error('Error sending message to customer:', error);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * 準備完了通知をお客様に送信
 */
async function sendReadyNotification(receptionId, lineClient) {
  try {
    const reception = await getReceptionById(receptionId);
    if (!reception) {
      throw new Error(`Reception not found: ${receptionId}`);
    }

    const userId = reception.userId;
    const storeName = reception.selectedStoreName || '店舗';

    // LINE でお客様に通知
    const messages = [
      {
        type: 'text',
        text: `🎉 お薬の準備ができました！\n\nあおぞら薬局 ${storeName}店でお受け取りいただけます。\n\nご来局をお待ちしております。`,
      },
    ];

    if (lineClient) {
      await lineClient.pushMessage({
        to: userId,
        messages,
      });
    } else {
      await axios.post(
        'https://api.line.me/v2/bot/message/push',
        {
          to: userId,
          messages,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.ACCESSTOKEN}`,
          },
        }
      );
    }

    console.log(`Ready notification sent to user: ${userId}`);

    return { success: true };
  } catch (error) {
    console.error('Error sending ready notification:', error);
    return { success: false, error: error.message };
  }
}

/**
 * 処方箋受付確認メッセージを生成
 */
function generateReceptionConfirmMessage(receptionId) {
  return {
    type: 'flex',
    altText: '処方箋を受け付けました',
    contents: {
      type: 'bubble',
      hero: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: '✅',
            size: '3xl',
            align: 'center',
          },
        ],
        paddingAll: '20px',
        backgroundColor: '#E8F5E9',
      },
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: '処方箋を受け付けました',
            weight: 'bold',
            size: 'lg',
            align: 'center',
          },
          {
            type: 'text',
            text: `受付番号: ${receptionId.slice(-8)}`,
            size: 'sm',
            color: '#666666',
            align: 'center',
            margin: 'md',
          },
          {
            type: 'separator',
            margin: 'lg',
          },
          {
            type: 'text',
            text: '管理者が確認後、店舗に連絡します。\n準備ができ次第ご連絡いたします。',
            size: 'sm',
            color: '#666666',
            wrap: true,
            margin: 'lg',
          },
        ],
        paddingAll: '20px',
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: 'お薬についてご不明点があれば、\nこちらにメッセージをお送りください。',
            size: 'xs',
            color: '#999999',
            wrap: true,
            align: 'center',
          },
        ],
        paddingAll: '10px',
      },
    },
  };
}

module.exports = {
  handlePrescriptionImage,
  checkActiveMessagingSession,
  activateMessagingSession,
  closeMessagingSession,
  routeMessageToStore,
  sendMessageToCustomer,
  sendReadyNotification,
  generateReceptionConfirmMessage,
  getReceptionById,
  TABLE_PRESCRIPTIONS,
  TABLE_PRESCRIPTION_MESSAGES,
  TABLE_CUSTOMER_SESSIONS,
};
