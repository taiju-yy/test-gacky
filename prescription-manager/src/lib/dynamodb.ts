/**
 * 処方箋管理システム用 DynamoDB マネージャー
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  UpdateCommand,
  QueryCommand,
  GetCommand,
  DeleteCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb';

// DynamoDB クライアント初期化
const client = new DynamoDBClient({
  region: process.env.AWS_REGION || 'ap-northeast-1',
});

const dynamoDB = DynamoDBDocumentClient.from(client);

// テーブル名
const TABLE_PRESCRIPTIONS = process.env.TABLE_PRESCRIPTIONS || 'gacky-prescriptions';
const TABLE_PRESCRIPTION_MESSAGES = process.env.TABLE_PRESCRIPTION_MESSAGES || 'gacky-prescription-messages';
const TABLE_CUSTOMER_SESSIONS = process.env.TABLE_CUSTOMER_SESSIONS || 'gacky-customer-messaging-sessions';

// TTL計算（1年後）
const getTTL = () => Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;

/**
 * 処方箋受付を作成
 */
export async function createPrescriptionReception(data: {
  receptionId: string;
  userId: string;
  userDisplayName?: string;
  userProfileImage?: string;
  prescriptionImageUrl: string;
  prescriptionImageKey: string;
  preferredStoreId?: string;
  customerNote?: string;
}) {
  const timestamp = new Date().toISOString();
  
  const item = {
    receptionId: data.receptionId,
    timestamp,
    userId: data.userId,
    userDisplayName: data.userDisplayName || null,
    userProfileImage: data.userProfileImage || null,
    prescriptionImageUrl: data.prescriptionImageUrl,
    prescriptionImageKey: data.prescriptionImageKey,
    preferredStoreId: data.preferredStoreId || null,
    status: 'pending',
    messagingSessionStatus: 'inactive',
    customerNote: data.customerNote || null,
    staffNote: null,
    selectedStoreId: null,
    selectedStoreName: null,
    createdAt: timestamp,
    ttl: getTTL(),
  };

  await dynamoDB.send(new PutCommand({
    TableName: TABLE_PRESCRIPTIONS,
    Item: item,
  }));

  return item;
}

/**
 * 処方箋受付を取得
 */
export async function getPrescriptionReception(receptionId: string) {
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
}

/**
 * ユーザーの最新の処方箋受付を取得
 */
export async function getLatestPrescriptionByUser(userId: string) {
  // GSIを使用してユーザーIDで検索
  const result = await dynamoDB.send(new QueryCommand({
    TableName: TABLE_PRESCRIPTIONS,
    IndexName: 'userId-timestamp-index',
    KeyConditionExpression: 'userId = :userId',
    ExpressionAttributeValues: {
      ':userId': userId,
    },
    ScanIndexForward: false,
    Limit: 1,
  }));

  return result.Items?.[0] || null;
}

/**
 * 処方箋受付のステータスを更新
 */
export async function updatePrescriptionStatus(
  receptionId: string,
  timestamp: string,
  status: string,
  additionalData?: Record<string, any>
) {
  let updateExpression = 'SET #status = :status, updatedAt = :updatedAt';
  const expressionAttributeNames: Record<string, string> = {
    '#status': 'status',
  };
  const expressionAttributeValues: Record<string, any> = {
    ':status': status,
    ':updatedAt': new Date().toISOString(),
  };

  // ステータスに応じた追加フィールド
  if (status === 'confirmed') {
    updateExpression += ', confirmedAt = :confirmedAt';
    expressionAttributeValues[':confirmedAt'] = new Date().toISOString();
  } else if (status === 'preparing') {
    updateExpression += ', preparingStartedAt = :preparingStartedAt';
    expressionAttributeValues[':preparingStartedAt'] = new Date().toISOString();
  } else if (status === 'ready') {
    updateExpression += ', readyAt = :readyAt';
    expressionAttributeValues[':readyAt'] = new Date().toISOString();
  } else if (status === 'completed') {
    updateExpression += ', completedAt = :completedAt';
    expressionAttributeValues[':completedAt'] = new Date().toISOString();
  }

  // 追加データがあれば設定
  if (additionalData) {
    for (const [key, value] of Object.entries(additionalData)) {
      updateExpression += `, ${key} = :${key}`;
      expressionAttributeValues[`:${key}`] = value;
    }
  }

  await dynamoDB.send(new UpdateCommand({
    TableName: TABLE_PRESCRIPTIONS,
    Key: {
      receptionId,
      timestamp,
    },
    UpdateExpression: updateExpression,
    ExpressionAttributeNames: expressionAttributeNames,
    ExpressionAttributeValues: expressionAttributeValues,
  }));
}

/**
 * 店舗を割り振り
 */
export async function assignStore(
  receptionId: string,
  timestamp: string,
  storeId: string,
  storeName: string
) {
  await dynamoDB.send(new UpdateCommand({
    TableName: TABLE_PRESCRIPTIONS,
    Key: {
      receptionId,
      timestamp,
    },
    UpdateExpression: 'SET selectedStoreId = :storeId, selectedStoreName = :storeName, assignedAt = :assignedAt, updatedAt = :updatedAt',
    ExpressionAttributeValues: {
      ':storeId': storeId,
      ':storeName': storeName,
      ':assignedAt': new Date().toISOString(),
      ':updatedAt': new Date().toISOString(),
    },
  }));
}

/**
 * 今日の受付一覧を取得
 */
export async function getTodayReceptions() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStart = today.toISOString();

  // Scanを使用（本番ではGSIを使用推奨）
  const result = await dynamoDB.send(new ScanCommand({
    TableName: TABLE_PRESCRIPTIONS,
    FilterExpression: '#timestamp >= :todayStart',
    ExpressionAttributeNames: {
      '#timestamp': 'timestamp',
    },
    ExpressionAttributeValues: {
      ':todayStart': todayStart,
    },
  }));

  return result.Items || [];
}

/**
 * 店舗の受付一覧を取得
 */
export async function getReceptionsByStore(storeId: string) {
  const result = await dynamoDB.send(new ScanCommand({
    TableName: TABLE_PRESCRIPTIONS,
    FilterExpression: 'selectedStoreId = :storeId AND #status IN (:s1, :s2, :s3)',
    ExpressionAttributeNames: {
      '#status': 'status',
    },
    ExpressionAttributeValues: {
      ':storeId': storeId,
      ':s1': 'confirmed',
      ':s2': 'preparing',
      ':s3': 'ready',
    },
  }));

  return result.Items || [];
}

// ========================================
// メッセージング関連
// ========================================

/**
 * メッセージを保存
 */
export async function savePrescriptionMessage(data: {
  receptionId: string;
  messageId: string;
  senderType: 'customer' | 'store' | 'system';
  senderId: string;
  senderName: string;
  messageType: 'text' | 'image';
  content: string;
}) {
  const timestamp = new Date().toISOString();
  
  const item = {
    receptionId: data.receptionId,
    messageId: data.messageId,
    timestamp,
    senderType: data.senderType,
    senderId: data.senderId,
    senderName: data.senderName,
    messageType: data.messageType,
    content: data.content,
    lineDelivered: false,
    readByCustomer: data.senderType === 'customer',
    readByStore: data.senderType === 'store',
    ttl: getTTL(),
  };

  await dynamoDB.send(new PutCommand({
    TableName: TABLE_PRESCRIPTION_MESSAGES,
    Item: item,
  }));

  return item;
}

/**
 * 受付のメッセージ一覧を取得
 */
export async function getPrescriptionMessages(receptionId: string) {
  const result = await dynamoDB.send(new QueryCommand({
    TableName: TABLE_PRESCRIPTION_MESSAGES,
    KeyConditionExpression: 'receptionId = :receptionId',
    ExpressionAttributeValues: {
      ':receptionId': receptionId,
    },
    ScanIndexForward: true, // 古い順
  }));

  return result.Items || [];
}

/**
 * メッセージのLINE配信状態を更新
 */
export async function updateMessageDeliveryStatus(
  receptionId: string,
  messageId: string,
  delivered: boolean
) {
  await dynamoDB.send(new UpdateCommand({
    TableName: TABLE_PRESCRIPTION_MESSAGES,
    Key: {
      receptionId,
      messageId,
    },
    UpdateExpression: 'SET lineDelivered = :delivered, lineDeliveredAt = :deliveredAt',
    ExpressionAttributeValues: {
      ':delivered': delivered,
      ':deliveredAt': delivered ? new Date().toISOString() : null,
    },
  }));
}

// ========================================
// お客様メッセージングセッション関連
// ========================================

/**
 * お客様のメッセージングセッションを取得
 */
export async function getCustomerMessagingSession(userId: string) {
  const result = await dynamoDB.send(new GetCommand({
    TableName: TABLE_CUSTOMER_SESSIONS,
    Key: {
      userId,
    },
  }));

  return result.Item || null;
}

/**
 * お客様のメッセージングセッションを更新
 */
export async function updateCustomerMessagingSession(
  userId: string,
  data: {
    activeReceptionId: string | null;
    messagingSessionStatus: 'inactive' | 'active' | 'closed';
    lastStoreMessageAt?: string;
  }
) {
  const timestamp = new Date().toISOString();
  
  await dynamoDB.send(new PutCommand({
    TableName: TABLE_CUSTOMER_SESSIONS,
    Item: {
      userId,
      activeReceptionId: data.activeReceptionId,
      messagingSessionStatus: data.messagingSessionStatus,
      lastStoreMessageAt: data.lastStoreMessageAt || null,
      sessionStartedAt: data.messagingSessionStatus === 'active' ? timestamp : null,
      sessionTimeoutMinutes: 30, // 30分でタイムアウト
      updatedAt: timestamp,
    },
  }));
}

/**
 * メッセージングセッションをアクティブにする（店舗からメッセージ送信時）
 */
export async function activateMessagingSession(userId: string, receptionId: string) {
  const timestamp = new Date().toISOString();
  
  // セッションを更新
  await updateCustomerMessagingSession(userId, {
    activeReceptionId: receptionId,
    messagingSessionStatus: 'active',
    lastStoreMessageAt: timestamp,
  });

  // 処方箋受付のメッセージングステータスも更新
  const reception = await getPrescriptionReception(receptionId);
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
}

/**
 * メッセージングセッションを終了する
 */
export async function closeMessagingSession(userId: string) {
  await updateCustomerMessagingSession(userId, {
    activeReceptionId: null,
    messagingSessionStatus: 'closed',
  });
}

/**
 * お客様がアクティブなメッセージングセッションを持っているか確認
 * （AI応答をスキップするかどうかの判定に使用）
 */
export async function hasActiveMessagingSession(userId: string): Promise<{
  isActive: boolean;
  receptionId: string | null;
  shouldRouteToStore: boolean;
}> {
  const session = await getCustomerMessagingSession(userId);
  
  if (!session) {
    return { isActive: false, receptionId: null, shouldRouteToStore: false };
  }

  // セッションがアクティブかつタイムアウトしていないか確認
  if (session.messagingSessionStatus === 'active' && session.lastStoreMessageAt) {
    const lastMessageTime = new Date(session.lastStoreMessageAt).getTime();
    const timeoutMs = (session.sessionTimeoutMinutes || 30) * 60 * 1000;
    const now = Date.now();

    if (now - lastMessageTime < timeoutMs) {
      return {
        isActive: true,
        receptionId: session.activeReceptionId,
        shouldRouteToStore: true,
      };
    } else {
      // タイムアウト - セッションを閉じる
      await closeMessagingSession(userId);
      return { isActive: false, receptionId: null, shouldRouteToStore: false };
    }
  }

  return { isActive: false, receptionId: null, shouldRouteToStore: false };
}

export {
  TABLE_PRESCRIPTIONS,
  TABLE_PRESCRIPTION_MESSAGES,
  TABLE_CUSTOMER_SESSIONS,
};
