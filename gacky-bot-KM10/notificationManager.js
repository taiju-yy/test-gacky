/**
 * リアルタイム通知モジュール
 * 
 * 新規処方箋受付時に:
 * 1. 担当店舗スタッフへWeb Push通知を送信
 * 2. 店舗未割当の場合は管理者へメール通知を送信
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand, ScanCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');
const webpush = require('web-push');

// AWS クライアント
const dynamoDBClient = new DynamoDBClient({});
const dynamoDB = DynamoDBDocumentClient.from(dynamoDBClient);
const sesClient = new SESClient({});

// テーブル名
const TABLE_PUSH_SUBSCRIPTIONS = process.env.TABLE_PUSH_SUBSCRIPTIONS || 'gacky-prescription-push-subscriptions-dev';

// VAPID設定（環境変数から取得）
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@granpharma.co.jp';

// メール通知設定
const SES_FROM_EMAIL = process.env.SES_FROM_EMAIL || 'noreply@granpharma.co.jp';
const ADMIN_EMAIL_ADDRESSES = (process.env.ADMIN_EMAIL_ADDRESSES || '').split(',').filter(e => e.trim());

// 管理画面URL
const PRESCRIPTION_MANAGER_URL = process.env.PRESCRIPTION_MANAGER_URL || 'https://prescription-manager.granpharma.co.jp';

// VAPID設定
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  console.log('[Notification] VAPID keys configured');
} else {
  console.warn('[Notification] VAPID keys not configured - Push notifications disabled');
}

/**
 * 新規処方箋受付の通知を送信
 * 
 * @param {Object} reception - 処方箋受付データ
 * @param {string} reception.receptionId - 受付ID
 * @param {string} reception.userId - お客様のLINE ユーザーID
 * @param {string} reception.userDisplayName - お客様の表示名
 * @param {string|null} reception.selectedStoreId - 選択された店舗ID（未割当ならnull）
 * @param {string|null} reception.selectedStoreName - 選択された店舗名（未割当ならnull）
 * @param {string} reception.deliveryMethod - 受け取り方法 ('store' | 'home')
 */
async function sendNewPrescriptionNotification(reception) {
  const {
    receptionId,
    userDisplayName,
    selectedStoreId,
    selectedStoreName,
    deliveryMethod,
  } = reception;

  console.log(`[Notification] Sending notification for reception ${receptionId}, store: ${selectedStoreId || 'not assigned'}`);

  const results = {
    pushNotifications: { sent: 0, failed: 0 },
    emailNotifications: { sent: 0, failed: 0 },
  };

  // 受け取り方法のラベル
  const deliveryLabel = deliveryMethod === 'home' ? '自宅受け取り' : '店舗受け取り';

  // 1. 店舗が割り当てられている場合: 店舗スタッフにPush通知
  if (selectedStoreId) {
    const pushResult = await sendPushNotificationToStore(selectedStoreId, {
      title: '🆕 新しい処方箋が届きました',
      body: `${userDisplayName || 'お客様'}から処方箋が届きました（${deliveryLabel}）`,
      data: {
        url: `/?receptionId=${receptionId}`,
        receptionId,
        type: 'new_prescription',
      },
    });
    results.pushNotifications = pushResult;
  }

  // 2. 店舗未割当 または 自宅受け取りの場合: 管理者にメール通知
  if (!selectedStoreId || deliveryMethod === 'home') {
    const emailResult = await sendEmailToAdmins({
      subject: `【処方箋受付】${userDisplayName || 'お客様'}から新規受付（${deliveryLabel}）`,
      receptionId,
      userDisplayName: userDisplayName || 'お客様',
      selectedStoreName: selectedStoreName || '未割当',
      deliveryMethod: deliveryLabel,
    });
    results.emailNotifications = emailResult;
  }

  // 3. 管理者全員にもPush通知（オプション）
  // 管理者への過剰通知を避けるため、デフォルトでは無効
  // const adminPushResult = await sendPushNotificationToAdmins({...});

  console.log(`[Notification] Results for ${receptionId}:`, JSON.stringify(results));
  return results;
}

/**
 * 特定店舗のスタッフにPush通知を送信
 */
async function sendPushNotificationToStore(storeId, notification) {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    console.warn('[Notification] VAPID keys not configured, skipping push');
    return { sent: 0, failed: 0, skipped: true };
  }

  try {
    // 店舗IDに紐づく購読を取得
    const result = await dynamoDB.send(new QueryCommand({
      TableName: TABLE_PUSH_SUBSCRIPTIONS,
      IndexName: 'storeId-index',
      KeyConditionExpression: 'storeId = :storeId',
      FilterExpression: 'isActive = :isActive',
      ExpressionAttributeValues: {
        ':storeId': storeId,
        ':isActive': true,
      },
    }));

    const subscriptions = result.Items || [];
    console.log(`[Notification] Found ${subscriptions.length} subscriptions for store ${storeId}`);

    if (subscriptions.length === 0) {
      return { sent: 0, failed: 0, noSubscriptions: true };
    }

    return await sendPushToSubscriptions(subscriptions, notification);
  } catch (error) {
    console.error('[Notification] Error sending push to store:', error);
    return { sent: 0, failed: 1, error: error.message };
  }
}

/**
 * 管理者全員にPush通知を送信
 */
async function sendPushNotificationToAdmins(notification) {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    console.warn('[Notification] VAPID keys not configured, skipping push');
    return { sent: 0, failed: 0, skipped: true };
  }

  try {
    // 管理者タイプの購読を取得
    const result = await dynamoDB.send(new QueryCommand({
      TableName: TABLE_PUSH_SUBSCRIPTIONS,
      IndexName: 'userType-index',
      KeyConditionExpression: 'userType = :userType',
      FilterExpression: 'isActive = :isActive',
      ExpressionAttributeValues: {
        ':userType': 'admin',
        ':isActive': true,
      },
    }));

    const subscriptions = result.Items || [];
    console.log(`[Notification] Found ${subscriptions.length} admin subscriptions`);

    if (subscriptions.length === 0) {
      return { sent: 0, failed: 0, noSubscriptions: true };
    }

    return await sendPushToSubscriptions(subscriptions, notification);
  } catch (error) {
    console.error('[Notification] Error sending push to admins:', error);
    return { sent: 0, failed: 1, error: error.message };
  }
}

/**
 * 購読リストにPush通知を送信
 */
async function sendPushToSubscriptions(subscriptions, notification) {
  const payload = JSON.stringify(notification);
  let sent = 0;
  let failed = 0;
  const failedSubscriptionIds = [];

  for (const sub of subscriptions) {
    try {
      const pushSubscription = {
        endpoint: sub.endpoint,
        keys: sub.keys,
      };

      await webpush.sendNotification(pushSubscription, payload);
      sent++;
      console.log(`[Notification] Push sent to ${sub.subscriptionId}`);
    } catch (error) {
      failed++;
      failedSubscriptionIds.push(sub.subscriptionId);
      console.error(`[Notification] Push failed for ${sub.subscriptionId}:`, error.message);

      // 410 Gone または 404 Not Found の場合は購読を無効化
      if (error.statusCode === 410 || error.statusCode === 404) {
        await deactivateSubscription(sub.subscriptionId);
      }
    }
  }

  return { sent, failed, failedSubscriptionIds };
}

/**
 * 購読を無効化（通知失敗時）
 */
async function deactivateSubscription(subscriptionId) {
  try {
    await dynamoDB.send(new UpdateCommand({
      TableName: TABLE_PUSH_SUBSCRIPTIONS,
      Key: { subscriptionId },
      UpdateExpression: 'SET isActive = :isActive, deactivatedAt = :deactivatedAt, deactivationReason = :reason',
      ExpressionAttributeValues: {
        ':isActive': false,
        ':deactivatedAt': new Date().toISOString(),
        ':reason': 'push_failed',
      },
    }));
    console.log(`[Notification] Subscription ${subscriptionId} deactivated`);
  } catch (error) {
    console.error(`[Notification] Failed to deactivate subscription ${subscriptionId}:`, error);
  }
}

/**
 * 管理者にメール通知を送信
 */
async function sendEmailToAdmins({ subject, receptionId, userDisplayName, selectedStoreName, deliveryMethod }) {
  if (ADMIN_EMAIL_ADDRESSES.length === 0) {
    console.warn('[Notification] No admin email addresses configured');
    return { sent: 0, failed: 0, skipped: true };
  }

  const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #4CAF50; color: white; padding: 20px; border-radius: 8px 8px 0 0; }
    .content { background: #f9f9f9; padding: 20px; border: 1px solid #ddd; border-top: none; }
    .info-row { margin: 10px 0; padding: 10px; background: white; border-radius: 4px; }
    .label { font-weight: bold; color: #666; }
    .value { color: #333; }
    .button { display: inline-block; background: #4CAF50; color: white !important; padding: 12px 24px; text-decoration: none; border-radius: 4px; margin-top: 20px; }
    .footer { text-align: center; padding: 20px; color: #999; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1 style="margin: 0; font-size: 20px;">🆕 新しい処方箋が届きました</h1>
    </div>
    <div class="content">
      <div class="info-row">
        <span class="label">受付番号:</span>
        <span class="value">${receptionId}</span>
      </div>
      <div class="info-row">
        <span class="label">お客様:</span>
        <span class="value">${userDisplayName}</span>
      </div>
      <div class="info-row">
        <span class="label">受け取り方法:</span>
        <span class="value">${deliveryMethod}</span>
      </div>
      <div class="info-row">
        <span class="label">店舗:</span>
        <span class="value">${selectedStoreName}</span>
      </div>
      <a href="${PRESCRIPTION_MANAGER_URL}/?receptionId=${receptionId}" class="button">管理画面で確認する</a>
    </div>
    <div class="footer">
      <p>このメールは Gacky 処方箋管理システムから自動送信されています。</p>
      <p>© グランファルマ株式会社</p>
    </div>
  </div>
</body>
</html>
`;

  const textBody = `
新しい処方箋が届きました

受付番号: ${receptionId}
お客様: ${userDisplayName}
受け取り方法: ${deliveryMethod}
店舗: ${selectedStoreName}

管理画面: ${PRESCRIPTION_MANAGER_URL}/?receptionId=${receptionId}

---
このメールは Gacky 処方箋管理システムから自動送信されています。
© グランファルマ株式会社
`;

  let sent = 0;
  let failed = 0;

  for (const email of ADMIN_EMAIL_ADDRESSES) {
    try {
      await sesClient.send(new SendEmailCommand({
        Source: SES_FROM_EMAIL,
        Destination: {
          ToAddresses: [email.trim()],
        },
        Message: {
          Subject: {
            Data: subject,
            Charset: 'UTF-8',
          },
          Body: {
            Html: {
              Data: htmlBody,
              Charset: 'UTF-8',
            },
            Text: {
              Data: textBody,
              Charset: 'UTF-8',
            },
          },
        },
      }));
      sent++;
      console.log(`[Notification] Email sent to ${email}`);
    } catch (error) {
      failed++;
      console.error(`[Notification] Email failed for ${email}:`, error.message);
    }
  }

  return { sent, failed };
}

module.exports = {
  sendNewPrescriptionNotification,
  sendPushNotificationToStore,
  sendPushNotificationToAdmins,
  sendEmailToAdmins,
  // テーブル名エクスポート
  TABLE_PUSH_SUBSCRIPTIONS,
};
