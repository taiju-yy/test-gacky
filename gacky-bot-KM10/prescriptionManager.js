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
const TABLE_CUSTOMER_PROFILES = process.env.TABLE_CUSTOMER_PROFILES || 'gacky-customer-profiles';

// S3バケット
const PRESCRIPTION_BUCKET = process.env.PRESCRIPTION_BUCKET || 'gacky-prescriptions';

// セッションタイムアウト（分）
const SESSION_TIMEOUT_MINUTES = 30;

// 処方箋受付モードタイムアウト（分）- リッチメニューから「処方箋を送る」押下後
const PRESCRIPTION_MODE_TIMEOUT_MINUTES = 10;

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

    // お客様プロフィールを更新（将来の履歴統合表示用）
    await updateCustomerProfile(userId, userProfile, null, null);

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
 * 
 * セッションステータス:
 * - 'active': 店舗とお客様がやりとり中（双方のメッセージでAIスキップ）
 * - 'waiting': 処方箋受付後、店舗からの返信待ち（お客様メッセージはAIスキップしない）
 * - 'closed': セッション終了（通常のAI応答に戻る）
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
        sessionStatus: null,
      };
    }

    const sessionData = session.Item;
    const now = Date.now();

    // セッションがアクティブかつタイムアウトしていないか確認
    if (sessionData.messagingSessionStatus === 'active') {
      // 最後のアクティビティ（店舗またはお客様からのメッセージ）を確認
      const lastStoreTime = sessionData.lastStoreMessageAt ? new Date(sessionData.lastStoreMessageAt).getTime() : 0;
      const lastCustomerTime = sessionData.lastCustomerMessageAt ? new Date(sessionData.lastCustomerMessageAt).getTime() : 0;
      const lastActivityTime = Math.max(lastStoreTime, lastCustomerTime);
      
      const timeoutMs = (sessionData.sessionTimeoutMinutes || SESSION_TIMEOUT_MINUTES) * 60 * 1000;

      if (lastActivityTime > 0 && (now - lastActivityTime < timeoutMs)) {
        console.log(`Active messaging session found for user ${userId}, reception: ${sessionData.activeReceptionId}`);
        return {
          isActive: true,
          receptionId: sessionData.activeReceptionId,
          shouldRouteToStore: true,
          sessionStatus: 'active',
        };
      } else if (lastActivityTime > 0) {
        // タイムアウト - セッションを閉じてお客様に通知
        console.log(`Session timeout for user ${userId}, closing session and notifying customer`);
        await closeMessagingSession(userId, 'timeout', true);
      }
    }

    return {
      isActive: false,
      receptionId: sessionData.activeReceptionId || null,
      shouldRouteToStore: false,
      sessionStatus: sessionData.messagingSessionStatus || null,
    };
  } catch (error) {
    console.error('Error checking messaging session:', error);
    return {
      isActive: false,
      receptionId: null,
      shouldRouteToStore: false,
      sessionStatus: null,
    };
  }
}

/**
 * メッセージングセッションをアクティブにする（店舗がメッセージを送信したとき）
 */
async function activateMessagingSession(userId, receptionId) {
  try {
    const timestamp = new Date().toISOString();

    // 既存のセッションを取得
    const existingSession = await dynamoDB.send(new GetCommand({
      TableName: TABLE_CUSTOMER_SESSIONS,
      Key: { userId },
    }));

    // セッションを作成/更新
    await dynamoDB.send(new PutCommand({
      TableName: TABLE_CUSTOMER_SESSIONS,
      Item: {
        userId,
        activeReceptionId: receptionId,
        messagingSessionStatus: 'active',
        lastStoreMessageAt: timestamp,
        lastCustomerMessageAt: existingSession?.Item?.lastCustomerMessageAt || null,
        sessionStartedAt: existingSession?.Item?.sessionStartedAt || timestamp,
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
 * メッセージングセッションを閉じる（準備完了/受け渡し完了/キャンセル時）
 * 
 * 呼び出し元:
 * - 店舗スタッフが「準備完了」ボタンを押した時
 * - 店舗スタッフが「受け渡し完了」ボタンを押した時
 * - 店舗スタッフが「キャンセル」ボタンを押した時
 * - セッションタイムアウト時
 * 
 * @param {string} userId - LINEユーザーID
 * @param {string} reason - 終了理由 ('manual' | 'ready' | 'completed' | 'cancelled' | 'timeout')
 * @param {boolean} sendTimeoutNotification - タイムアウト時にお客様へLINE通知を送るか
 */
async function closeMessagingSession(userId, reason = 'manual', sendTimeoutNotification = false) {
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
          UpdateExpression: 'SET messagingSessionStatus = :status, sessionClosedAt = :closedAt, sessionCloseReason = :reason',
          ExpressionAttributeValues: {
            ':status': 'closed',
            ':closedAt': new Date().toISOString(),
            ':reason': reason,
          },
        }));
      }
    }

    // タイムアウトの場合、お客様にLINE通知を送信
    if (reason === 'timeout' && sendTimeoutNotification) {
      try {
        // 受付情報から店舗名を取得
        const reception = session.Item?.activeReceptionId 
          ? await getReceptionById(session.Item.activeReceptionId)
          : null;
        const storeName = reception?.selectedStoreName || null;
        await sendSessionTimeoutNotification(userId, storeName);
      } catch (notifyError) {
        console.error('Error sending timeout notification:', notifyError);
        // 通知失敗でもセッションクローズは続行
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
        lastCustomerMessageAt: null,
        sessionStartedAt: null,
        sessionClosedAt: new Date().toISOString(),
        sessionCloseReason: reason,
        sessionTimeoutMinutes: SESSION_TIMEOUT_MINUTES,
        updatedAt: new Date().toISOString(),
      },
    }));

    console.log(`Messaging session closed for user ${userId}, reason: ${reason}`);
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
async function routeMessageToStore(userId, receptionId, messageContent, messageType = 'text', userProfile = null) {
  try {
    const messageId = `msg_${Date.now()}_${uuidv4().slice(0, 8)}`;
    const timestamp = new Date().toISOString();

    // ユーザー名を取得（引数またはプロフィールから）
    let senderName = 'お客様';
    if (userProfile?.displayName) {
      senderName = userProfile.displayName;
    } else {
      // プロフィールから取得を試みる
      const profile = await getCustomerProfile(userId);
      if (profile?.displayName) {
        senderName = profile.displayName;
      }
    }

    // メッセージを保存（userIdを含める）
    const messageItem = {
      receptionId,
      messageId,
      timestamp,
      userId, // 将来の履歴統合表示用
      senderType: 'customer',
      senderId: userId,
      senderName,
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

    // メッセージを保存（userIdを含める）
    const messageItem = {
      receptionId,
      messageId,
      timestamp,
      userId, // 将来の履歴統合表示用
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

    // お客様プロフィールの「よく使う店舗」を更新
    await updateCustomerProfile(userId, null, storeId, storeName);

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
 * 準備完了通知をお客様に送信し、セッションを閉じる
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

    // セッションを閉じる（準備完了）
    await closeMessagingSession(userId, 'ready');

    // 処方箋のステータスも更新
    await dynamoDB.send(new UpdateCommand({
      TableName: TABLE_PRESCRIPTIONS,
      Key: {
        receptionId,
        timestamp: reception.timestamp,
      },
      UpdateExpression: 'SET #status = :status, readyAt = :readyAt',
      ExpressionAttributeNames: {
        '#status': 'status',
      },
      ExpressionAttributeValues: {
        ':status': 'ready',
        ':readyAt': new Date().toISOString(),
      },
    }));

    console.log(`Ready notification sent to user: ${userId}, session closed`);

    return { success: true };
  } catch (error) {
    console.error('Error sending ready notification:', error);
    return { success: false, error: error.message };
  }
}

/**
 * セッションタイムアウト時にお客様へLINE通知を送信
 * 
 * 店舗スタッフとのやり取りが一時停止したことを明確に伝え、
 * 店舗からの連絡を待つか、電話連絡を案内する
 * 
 * @param {string} userId - LINEユーザーID
 * @param {string|null} storeName - 店舗名（割り当て済みの場合）
 */
async function sendSessionTimeoutNotification(userId, storeName = null) {
  try {
    // 店舗情報がある場合のメッセージ本文
    const bodyContents = [
      {
        type: 'text',
        text: '店舗スタッフとの\nメッセージ受付を一時停止しました',
        weight: 'bold',
        size: 'md',
        align: 'center',
        wrap: true,
      },
      {
        type: 'separator',
        margin: 'lg',
      },
      {
        type: 'text',
        text: 'お待たせして申し訳ございません。\n\n一定時間が経過したため、店舗スタッフとのメッセージのやり取りを一時停止しております。',
        size: 'sm',
        color: '#666666',
        wrap: true,
        margin: 'lg',
      },
      {
        type: 'text',
        text: '店舗からの連絡をお待ちいただくか、お急ぎの場合は店舗に直接お電話ください。',
        size: 'sm',
        color: '#666666',
        wrap: true,
        margin: 'md',
      },
    ];

    // 店舗名がある場合は表示
    if (storeName) {
      bodyContents.push({
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: '担当店舗',
            size: 'xs',
            color: '#999999',
          },
          {
            type: 'text',
            text: storeName,
            size: 'md',
            weight: 'bold',
            color: '#4CAF50',
            margin: 'xs',
          },
        ],
        margin: 'lg',
        paddingAll: '10px',
        backgroundColor: '#F5F5F5',
        cornerRadius: '8px',
      });
    }

    // 補足説明
    bodyContents.push({
      type: 'text',
      text: '※ 新たに処方箋を送る場合は「処方箋を送る」からやり直してください。',
      size: 'xs',
      color: '#999999',
      wrap: true,
      margin: 'lg',
    });

    const messages = [
      {
        type: 'flex',
        altText: '店舗スタッフとのメッセージ受付を一時停止しました',
        contents: {
          type: 'bubble',
          hero: {
            type: 'box',
            layout: 'vertical',
            contents: [
              {
                type: 'text',
                text: '⏰',
                size: '3xl',
                align: 'center',
              },
            ],
            paddingAll: '20px',
            backgroundColor: '#FFF3E0',
          },
          body: {
            type: 'box',
            layout: 'vertical',
            contents: bodyContents,
            paddingAll: '20px',
          },
          footer: {
            type: 'box',
            layout: 'vertical',
            contents: [
              {
                type: 'button',
                action: {
                  type: 'uri',
                  label: '最寄りのあおぞら薬局をさがす',
                  uri: 'https://aozora-g.jp/store/',
                },
                style: 'primary',
                color: '#4CAF50',
              },
            ],
            paddingAll: '10px',
          },
        },
      },
    ];

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

    console.log(`Session timeout notification sent to user: ${userId}, store: ${storeName || 'N/A'}`);
    return { success: true };
  } catch (error) {
    console.error('Error sending session timeout notification:', error);
    return { success: false, error: error.message };
  }
}

/**
 * 手動でメッセージングセッションを再開する（店舗スタッフ用）
 * 
 * タイムアウトしたセッションを再度アクティブにする
 * 追加で30分のセッションが開始される
 */
async function reactivateMessagingSession(userId, receptionId) {
  try {
    const timestamp = new Date().toISOString();

    // セッションを再アクティブ化
    await dynamoDB.send(new PutCommand({
      TableName: TABLE_CUSTOMER_SESSIONS,
      Item: {
        userId,
        activeReceptionId: receptionId,
        messagingSessionStatus: 'active',
        lastStoreMessageAt: timestamp,
        lastCustomerMessageAt: null,
        sessionStartedAt: timestamp,
        sessionReactivatedAt: timestamp,
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
        UpdateExpression: 'SET messagingSessionStatus = :status, sessionReactivatedAt = :reactivatedAt',
        ExpressionAttributeValues: {
          ':status': 'active',
          ':reactivatedAt': timestamp,
        },
      }));
    }

    // お客様にセッション再開を通知
    const messages = [
      {
        type: 'text',
        text: '【お知らせ】\n\nあおぞら薬局からメッセージの受付を再開しました。\n\nご質問やご連絡がございましたら、こちらにメッセージをお送りください。',
      },
    ];

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

    console.log(`Messaging session reactivated for user ${userId}, reception ${receptionId}`);
    return { success: true };
  } catch (error) {
    console.error('Error reactivating messaging session:', error);
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

/**
 * 処方箋受付モードを開始する（リッチメニューから「処方箋を送る」を押したとき）
 * 
 * このモードが有効な間、次に送られてくる画像を処方箋として受け付ける
 */
async function startPrescriptionMode(userId) {
  try {
    const timestamp = new Date().toISOString();
    const expiresAt = new Date(Date.now() + PRESCRIPTION_MODE_TIMEOUT_MINUTES * 60 * 1000).toISOString();

    await dynamoDB.send(new PutCommand({
      TableName: TABLE_CUSTOMER_SESSIONS,
      Item: {
        userId,
        prescriptionModeActive: true,
        prescriptionModeStartedAt: timestamp,
        prescriptionModeExpiresAt: expiresAt,
        activeReceptionId: null,
        messagingSessionStatus: null,
        updatedAt: timestamp,
      },
    }));

    console.log(`Prescription mode started for user ${userId}, expires at ${expiresAt}`);
    return { success: true, expiresAt };
  } catch (error) {
    console.error('Error starting prescription mode:', error);
    return { success: false, error: error.message };
  }
}

/**
 * 処方箋受付モードかどうか確認
 */
async function checkPrescriptionMode(userId) {
  try {
    const session = await dynamoDB.send(new GetCommand({
      TableName: TABLE_CUSTOMER_SESSIONS,
      Key: { userId },
    }));

    if (!session.Item || !session.Item.prescriptionModeActive) {
      return { isActive: false };
    }

    const expiresAt = new Date(session.Item.prescriptionModeExpiresAt).getTime();
    const now = Date.now();

    if (now > expiresAt) {
      // タイムアウト - モードを解除
      await clearPrescriptionMode(userId);
      return { isActive: false, reason: 'expired' };
    }

    return { isActive: true };
  } catch (error) {
    console.error('Error checking prescription mode:', error);
    return { isActive: false };
  }
}

/**
 * 処方箋受付モードを解除
 */
async function clearPrescriptionMode(userId) {
  try {
    await dynamoDB.send(new UpdateCommand({
      TableName: TABLE_CUSTOMER_SESSIONS,
      Key: { userId },
      UpdateExpression: 'SET prescriptionModeActive = :active, updatedAt = :updatedAt',
      ExpressionAttributeValues: {
        ':active': false,
        ':updatedAt': new Date().toISOString(),
      },
    }));

    console.log(`Prescription mode cleared for user ${userId}`);
    return { success: true };
  } catch (error) {
    console.error('Error clearing prescription mode:', error);
    return { success: false, error: error.message };
  }
}

/**
 * お客様プロフィールを更新（将来の履歴統合表示用）
 * 
 * 保存される情報:
 * - 基本情報: displayName, profileImage
 * - 利用統計: totalReceptionCount, firstUsedAt, lastUsedAt
 * - よく使う店舗: preferredStoreId, preferredStoreName
 */
async function updateCustomerProfile(userId, userProfile, storeId, storeName) {
  try {
    const now = new Date().toISOString();

    const updateExpression = [
      'SET updatedAt = :now',
      'lastUsedAt = :now',
      'totalReceptionCount = if_not_exists(totalReceptionCount, :zero) + :one',
      'firstUsedAt = if_not_exists(firstUsedAt, :now)',
      'createdAt = if_not_exists(createdAt, :now)',
    ];

    const expressionAttributeValues = {
      ':now': now,
      ':zero': 0,
      ':one': 1,
    };

    // ユーザープロフィール情報があれば更新
    if (userProfile?.displayName) {
      updateExpression.push('displayName = :displayName');
      expressionAttributeValues[':displayName'] = userProfile.displayName;
    }
    if (userProfile?.pictureUrl) {
      updateExpression.push('profileImage = :profileImage');
      expressionAttributeValues[':profileImage'] = userProfile.pictureUrl;
    }

    // 店舗情報があれば「よく使う店舗」として更新
    if (storeId) {
      updateExpression.push('preferredStoreId = :storeId');
      expressionAttributeValues[':storeId'] = storeId;
    }
    if (storeName) {
      updateExpression.push('preferredStoreName = :storeName');
      expressionAttributeValues[':storeName'] = storeName;
    }

    await dynamoDB.send(new UpdateCommand({
      TableName: TABLE_CUSTOMER_PROFILES,
      Key: { userId },
      UpdateExpression: updateExpression.join(', '),
      ExpressionAttributeValues: expressionAttributeValues,
    }));

    console.log(`Customer profile updated: ${userId}`);
    return { success: true };
  } catch (error) {
    // プロフィール更新失敗はメインフローを止めない
    console.error('Error updating customer profile (non-blocking):', error);
    return { success: false, error: error.message };
  }
}

/**
 * お客様プロフィールを取得
 */
async function getCustomerProfile(userId) {
  try {
    const result = await dynamoDB.send(new GetCommand({
      TableName: TABLE_CUSTOMER_PROFILES,
      Key: { userId },
    }));
    return result.Item || null;
  } catch (error) {
    console.error('Error getting customer profile:', error);
    return null;
  }
}

/**
 * お客様の処方箋履歴を取得（将来の統合表示用）
 */
async function getCustomerReceptionHistory(userId, limit = 10) {
  try {
    const result = await dynamoDB.send(new QueryCommand({
      TableName: TABLE_PRESCRIPTIONS,
      IndexName: 'userId-timestamp-index',
      KeyConditionExpression: 'userId = :userId',
      ExpressionAttributeValues: {
        ':userId': userId,
      },
      ScanIndexForward: false, // 新しい順
      Limit: limit,
    }));
    return result.Items || [];
  } catch (error) {
    console.error('Error getting customer reception history:', error);
    return [];
  }
}

/**
 * 処方箋受付後、「待機中」セッションを開始
 * （店舗からの連絡を待っている状態。この状態ではお客様のメッセージはAIスキップしない）
 */
async function startWaitingSession(userId, receptionId) {
  try {
    const timestamp = new Date().toISOString();

    await dynamoDB.send(new PutCommand({
      TableName: TABLE_CUSTOMER_SESSIONS,
      Item: {
        userId,
        activeReceptionId: receptionId,
        messagingSessionStatus: 'waiting',
        prescriptionModeActive: false,
        sessionStartedAt: timestamp,
        sessionTimeoutMinutes: SESSION_TIMEOUT_MINUTES,
        updatedAt: timestamp,
      },
    }));

    console.log(`Waiting session started for user ${userId}, reception ${receptionId}`);
    return { success: true };
  } catch (error) {
    console.error('Error starting waiting session:', error);
    return { success: false, error: error.message };
  }
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
  startPrescriptionMode,
  checkPrescriptionMode,
  clearPrescriptionMode,
  startWaitingSession,
  // セッション再開（店舗スタッフ用）
  reactivateMessagingSession,
  // お客様プロフィール関連（将来の履歴統合表示用）
  updateCustomerProfile,
  getCustomerProfile,
  getCustomerReceptionHistory,
  // テーブル名
  TABLE_PRESCRIPTIONS,
  TABLE_PRESCRIPTION_MESSAGES,
  TABLE_CUSTOMER_SESSIONS,
  TABLE_CUSTOMER_PROFILES,
  SESSION_TIMEOUT_MINUTES,
};
