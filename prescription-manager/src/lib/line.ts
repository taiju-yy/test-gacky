/**
 * LINE Messaging API クライアント
 * 
 * 注意: Amplify Compute では環境変数はランタイム時に読み取る必要があります。
 * トップレベルで process.env を参照すると、ビルド時に評価されて undefined になります。
 */

import axios from 'axios';
import { getDynamoDBClient, TABLES, GetCommand, ScanCommand } from './dynamodb';

/**
 * 環境変数からLINEトークンを取得（ランタイム時に評価）
 */
function getLineChannelAccessToken(): string | undefined {
  return process.env.LINE_CHANNEL_ACCESS_TOKEN;
}

interface PushMessageParams {
  to: string;
  messages: Array<{
    type: string;
    text?: string;
    altText?: string;
    contents?: any;
  }>;
}

/**
 * LINE Push メッセージを送信
 */
export async function pushMessage(params: PushMessageParams): Promise<boolean> {
  // ランタイム時に環境変数を取得（Amplify Compute対応）
  const LINE_CHANNEL_ACCESS_TOKEN = getLineChannelAccessToken();
  
  // デバッグ情報を詳細にログ
  console.log('[LINE API] pushMessage called');
  console.log('[LINE API] Target userId:', params.to);
  console.log('[LINE API] Message count:', params.messages.length);
  console.log('[LINE API] TOKEN configured:', LINE_CHANNEL_ACCESS_TOKEN ? 'Yes (length: ' + LINE_CHANNEL_ACCESS_TOKEN.length + ')' : 'NO - TOKEN MISSING!');

  if (!LINE_CHANNEL_ACCESS_TOKEN) {
    console.error('[LINE API] ERROR: LINE_CHANNEL_ACCESS_TOKEN is not configured');
    console.error('[LINE API] Environment check - available vars:', Object.keys(process.env).filter(k => k.includes('LINE')));
    return false;
  }

  if (!params.to) {
    console.error('[LINE API] ERROR: userId (to) is empty or undefined');
    return false;
  }

  try {
    console.log('[LINE API] Sending request to LINE API...');
    const response = await axios.post(
      'https://api.line.me/v2/bot/message/push',
      params,
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
        },
      }
    );
    
    console.log('[LINE API] SUCCESS - Status:', response.status);
    console.log('[LINE API] Response headers:', JSON.stringify(response.headers));
    return true;
  } catch (error: any) {
    console.error('[LINE API] ERROR sending message');
    console.error('[LINE API] Error status:', error.response?.status);
    console.error('[LINE API] Error data:', JSON.stringify(error.response?.data));
    console.error('[LINE API] Error message:', error.message);
    return false;
  }
}

/**
 * テキストメッセージを送信
 */
export async function sendTextMessage(userId: string, text: string): Promise<boolean> {
  return pushMessage({
    to: userId,
    messages: [{ type: 'text', text }],
  });
}

/**
 * 店舗情報を取得（DynamoDBから）
 */
export async function getStoreInfo(storeId: string): Promise<{ phone: string; businessHours: string; storeName: string } | null> {
  try {
    const db = getDynamoDBClient();
    const tableName = TABLES.STORES;
    console.log(`[LINE API] getStoreInfo - storeId: "${storeId}", table: ${tableName}`);
    
    const result = await db.send(new GetCommand({
      TableName: tableName,
      Key: { storeId },
    }));
    
    console.log(`[LINE API] getStoreInfo - result.Item exists: ${!!result.Item}`);
    
    if (result.Item) {
      console.log(`[LINE API] getStoreInfo - found store: ${result.Item.storeName}, phone: ${result.Item.phone}`);
      return {
        phone: result.Item.phone || '',
        businessHours: result.Item.businessHours || '',
        storeName: result.Item.storeName || '',
      };
    }
    console.log(`[LINE API] getStoreInfo - no store found for storeId: ${storeId}`);
    return null;
  } catch (error) {
    console.error('[LINE API] Error fetching store info:', error);
    return null;
  }
}

/**
 * 店舗名から店舗情報を検索（DynamoDBから）
 * 完全一致と部分一致の両方をサポート
 */
export async function getStoreInfoByName(storeName: string): Promise<{ phone: string; businessHours: string; storeId: string } | null> {
  try {
    const db = getDynamoDBClient();
    console.log(`[LINE API] Searching store by name: "${storeName}"`);
    
    // まず全店舗をスキャンして検索
    const result = await db.send(new ScanCommand({
      TableName: TABLES.STORES,
    }));
    
    if (!result.Items || result.Items.length === 0) {
      console.log('[LINE API] No stores found in database');
      return null;
    }
    
    console.log(`[LINE API] Found ${result.Items.length} stores in database`);
    
    // 店舗名を正規化（「あおぞら薬局」プレフィックスを除去して比較）
    const normalizedSearchName = storeName
      .replace(/^あおぞら薬局[\s　]*/g, '')
      .replace(/店$/, '')
      .trim();
    
    // 完全一致 → 部分一致の順で検索
    let matchedStore = result.Items.find(store => store.storeName === storeName);
    
    if (!matchedStore) {
      // 「〇〇店」形式での検索
      matchedStore = result.Items.find(store => {
        const dbStoreName = (store.storeName || '').replace(/店$/, '').trim();
        return dbStoreName === normalizedSearchName;
      });
    }
    
    if (!matchedStore) {
      // 部分一致（店舗名に検索キーワードが含まれる）
      matchedStore = result.Items.find(store => {
        const dbStoreName = store.storeName || '';
        return dbStoreName.includes(normalizedSearchName) || normalizedSearchName.includes(dbStoreName.replace(/店$/, ''));
      });
    }
    
    if (matchedStore) {
      console.log(`[LINE API] Matched store: ${matchedStore.storeName}, phone: ${matchedStore.phone}`);
      return {
        phone: matchedStore.phone || '',
        businessHours: matchedStore.businessHours || '',
        storeId: matchedStore.storeId || '',
      };
    }
    
    console.log(`[LINE API] No matching store found for: "${storeName}"`);
    return null;
  } catch (error) {
    console.error('[LINE API] Error fetching store info by name:', error);
    return null;
  }
}

/**
 * 準備完了通知を送信（店舗受け取り用）
 * 店舗電話番号が提供された場合は、電話番号も表示
 */
export async function sendReadyNotification(userId: string, storeName: string, storePhone?: string, businessHours?: string): Promise<boolean> {
  // 電話番号がない場合はシンプルなテキストメッセージ
  if (!storePhone) {
    const message = `【準備完了のお知らせ】\n\n${storeName}にて、お薬の準備が整いました。\n\nご都合のよろしい時間にご来局ください。`;
    return pushMessage({
      to: userId,
      messages: [{ type: 'text', text: message }],
    });
  }

  // 電話番号がある場合はFlex Messageで表示
  const bodyContents: any[] = [
    {
      type: 'text',
      text: 'お薬の準備が\n完了しました',
      weight: 'bold',
      size: 'lg',
      align: 'center',
      wrap: true,
    },
    {
      type: 'separator',
      margin: 'lg',
    },
    {
      type: 'text',
      text: 'ご都合のよろしい時間に\nご来局ください。',
      size: 'sm',
      color: '#666666',
      wrap: true,
      margin: 'lg',
      align: 'center',
    },
    {
      type: 'box',
      layout: 'vertical',
      contents: [
        {
          type: 'text',
          text: '受取店舗',
          size: 'xs',
          color: '#888888',
        },
        {
          type: 'text',
          text: storeName,
          size: 'md',
          weight: 'bold',
          margin: 'xs',
          wrap: true,
        },
        {
          type: 'text',
          text: `TEL: ${storePhone}`,
          size: 'sm',
          color: '#2196F3',
          margin: 'xs',
        },
      ],
      margin: 'lg',
      paddingAll: '12px',
      backgroundColor: '#F5F5F5',
      cornerRadius: '8px',
    },
  ];

  // 営業時間がある場合は追加
  if (businessHours) {
    bodyContents.push({
      type: 'box',
      layout: 'vertical',
      contents: [
        {
          type: 'text',
          text: '営業時間',
          size: 'xs',
          color: '#888888',
        },
        {
          type: 'text',
          text: businessHours,
          size: 'xs',
          color: '#666666',
          margin: 'xs',
          wrap: true,
        },
      ],
      margin: 'md',
      paddingAll: '8px',
    });
  }

  return pushMessage({
    to: userId,
    messages: [{
      type: 'flex',
      altText: '【準備完了】お薬のご用意ができました',
      contents: {
        type: 'bubble',
        hero: {
          type: 'box',
          layout: 'vertical',
          contents: [{
            type: 'text',
            text: '💊',
            size: '3xl',
            align: 'center',
          }],
          paddingAll: '20px',
          backgroundColor: '#E3F2FD',
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
                label: '電話をかける',
                uri: `tel:${storePhone.replace(/-/g, '')}`,
              },
              style: 'primary',
              color: '#2196F3',
            },
          ],
          paddingAll: '10px',
        },
      },
    }],
  });
}

/**
 * オンライン服薬指導開始通知を送信（自宅受け取り用）
 */
export async function sendVideoCounselingNotification(userId: string): Promise<boolean> {
  return pushMessage({
    to: userId,
    messages: [{
      type: 'flex',
      altText: 'オンライン服薬指導のご案内',
      contents: {
        type: 'bubble',
        hero: {
          type: 'box',
          layout: 'vertical',
          contents: [{
            type: 'text',
            text: '📹',
            size: '3xl',
            align: 'center',
          }],
          paddingAll: '20px',
          backgroundColor: '#FCE4EC',
        },
        body: {
          type: 'box',
          layout: 'vertical',
          contents: [
            {
              type: 'text',
              text: 'オンライン服薬指導を\n開始します',
              weight: 'bold',
              size: 'lg',
              align: 'center',
              wrap: true,
            },
            {
              type: 'separator',
              margin: 'lg',
            },
            {
              type: 'text',
              text: 'お薬の調剤が完了しました。\n\n担当薬剤師からビデオ通話のリクエストが送信されます。\n\nしばらくお待ちください。',
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
          contents: [{
            type: 'text',
            text: '通話にはカメラとマイクの\n許可が必要です',
            size: 'xs',
            color: '#999999',
            wrap: true,
            align: 'center',
          }],
          paddingAll: '10px',
        },
      },
    }],
  });
}

/**
 * 配送準備開始通知を送信（自宅受け取り用）
 */
export async function sendShippingNotification(userId: string): Promise<boolean> {
  return pushMessage({
    to: userId,
    messages: [{
      type: 'flex',
      altText: '配送準備を開始しました',
      contents: {
        type: 'bubble',
        hero: {
          type: 'box',
          layout: 'vertical',
          contents: [{
            type: 'text',
            text: '📦',
            size: '3xl',
            align: 'center',
          }],
          paddingAll: '20px',
          backgroundColor: '#FFF3E0',
        },
        body: {
          type: 'box',
          layout: 'vertical',
          contents: [
            {
              type: 'text',
              text: '配送準備を開始しました',
              weight: 'bold',
              size: 'lg',
              align: 'center',
              wrap: true,
            },
            {
              type: 'separator',
              margin: 'lg',
            },
            {
              type: 'text',
              text: 'オンライン服薬指導が完了しました。\n\nお薬の配送準備を開始します。配送が開始されましたらご連絡いたします。',
              size: 'sm',
              color: '#666666',
              wrap: true,
              margin: 'lg',
            },
          ],
          paddingAll: '20px',
        },
      },
    }],
  });
}

/**
 * 配送開始通知を送信（自宅受け取り用）
 * 配送開始後はAI応答モードのため、電話番号での問い合わせを案内
 */
export async function sendShippedNotification(userId: string, storeName?: string, storePhone?: string): Promise<boolean> {
  // 電話番号がない場合はあおぞら薬局の代表番号を使用
  const phone = storePhone || '0120-XXX-XXX';
  const store = storeName || 'あおぞら薬局';
  
  return pushMessage({
    to: userId,
    messages: [{
      type: 'flex',
      altText: 'お薬を発送しました',
      contents: {
        type: 'bubble',
        hero: {
          type: 'box',
          layout: 'vertical',
          contents: [{
            type: 'text',
            text: '🚚',
            size: '3xl',
            align: 'center',
          }],
          paddingAll: '20px',
          backgroundColor: '#E8EAF6',
        },
        body: {
          type: 'box',
          layout: 'vertical',
          contents: [
            {
              type: 'text',
              text: 'お薬を発送しました',
              weight: 'bold',
              size: 'lg',
              align: 'center',
              wrap: true,
            },
            {
              type: 'separator',
              margin: 'lg',
            },
            {
              type: 'text',
              text: 'お薬の配送を開始しました。\n\nご自宅への到着をお待ちください。',
              size: 'sm',
              color: '#666666',
              wrap: true,
              margin: 'lg',
            },
            {
              type: 'box',
              layout: 'vertical',
              contents: [
                {
                  type: 'text',
                  text: '配送についてのお問い合わせ',
                  size: 'xs',
                  color: '#888888',
                },
                {
                  type: 'text',
                  text: store,
                  size: 'sm',
                  weight: 'bold',
                  margin: 'xs',
                },
                {
                  type: 'text',
                  text: `TEL: ${phone}`,
                  size: 'sm',
                  color: '#3F51B5',
                  margin: 'xs',
                },
              ],
              margin: 'lg',
              paddingAll: '12px',
              backgroundColor: '#F5F5F5',
              cornerRadius: '8px',
            },
          ],
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
                label: '電話をかける',
                uri: `tel:${phone.replace(/-/g, '')}`,
              },
              style: 'primary',
              color: '#3F51B5',
            },
          ],
          paddingAll: '10px',
        },
      },
    }],
  });
}

/**
 * 配送完了通知を送信（自宅受け取り用）
 * 配送完了後はAI応答モードに戻るため、電話番号での問い合わせを案内
 */
export async function sendDeliveryCompletedNotification(userId: string, storeName?: string, storePhone?: string): Promise<boolean> {
  // 電話番号がない場合はあおぞら薬局の代表番号を使用
  const phone = storePhone || '0120-XXX-XXX';
  const store = storeName || 'あおぞら薬局';
  
  return pushMessage({
    to: userId,
    messages: [{
      type: 'flex',
      altText: 'お薬のお届け完了',
      contents: {
        type: 'bubble',
        hero: {
          type: 'box',
          layout: 'vertical',
          contents: [{
            type: 'text',
            text: '✅',
            size: '3xl',
            align: 'center',
          }],
          paddingAll: '20px',
          backgroundColor: '#E8F5E9',
        },
        body: {
          type: 'box',
          layout: 'vertical',
          contents: [
            {
              type: 'text',
              text: 'お届け完了',
              weight: 'bold',
              size: 'lg',
              align: 'center',
              wrap: true,
            },
            {
              type: 'separator',
              margin: 'lg',
            },
            {
              type: 'text',
              text: 'お薬が配送されました。\n\nご利用いただきありがとうございました。',
              size: 'sm',
              color: '#666666',
              wrap: true,
              margin: 'lg',
            },
            {
              type: 'box',
              layout: 'vertical',
              contents: [
                {
                  type: 'text',
                  text: 'お薬についてのお問い合わせ',
                  size: 'xs',
                  color: '#888888',
                },
                {
                  type: 'text',
                  text: store,
                  size: 'sm',
                  weight: 'bold',
                  margin: 'xs',
                },
                {
                  type: 'text',
                  text: `TEL: ${phone}`,
                  size: 'sm',
                  color: '#4CAF50',
                  margin: 'xs',
                },
              ],
              margin: 'lg',
              paddingAll: '12px',
              backgroundColor: '#F5F5F5',
              cornerRadius: '8px',
            },
          ],
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
                label: '電話をかける',
                uri: `tel:${phone.replace(/-/g, '')}`,
              },
              style: 'primary',
              color: '#4CAF50',
            },
          ],
          paddingAll: '10px',
        },
      },
    }],
  });
}

/**
 * ビデオ通話招待を送信（オンライン服薬指導開始時）
 */
export async function sendVideoCallInvitation(userId: string, storeName: string, roomId: string): Promise<boolean> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://vpp-implement-prescription.d28rixt8pa2otz.amplifyapp.com';
  const videoCallUrl = `${baseUrl}/video-call/${roomId}?role=customer`;
  
  return pushMessage({
    to: userId,
    messages: [
      {
        type: 'flex',
        altText: 'オンライン服薬指導のご案内',
        contents: {
          type: 'bubble',
          hero: {
            type: 'box',
            layout: 'vertical',
            contents: [{
              type: 'text',
              text: '📹',
              size: '3xl',
              align: 'center',
            }],
            paddingAll: '20px',
            backgroundColor: '#FCE4EC',
          },
          body: {
            type: 'box',
            layout: 'vertical',
            contents: [
              {
                type: 'text',
                text: 'オンライン服薬指導を\n開始します',
                weight: 'bold',
                size: 'lg',
                align: 'center',
                wrap: true,
              },
              {
                type: 'separator',
                margin: 'lg',
              },
              {
                type: 'text',
                text: 'お薬の調剤が完了しました。\n\n下記のボタンをタップして、ビデオ通話に参加してください。',
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
                type: 'button',
                action: {
                  type: 'uri',
                  label: 'ビデオ通話に参加',
                  uri: videoCallUrl,
                },
                style: 'primary',
                color: '#E91E63',
              },
              {
                type: 'text',
                text: '※通話にはカメラとマイクの許可が必要です\n※リンクの有効期限は24時間です',
                size: 'xs',
                color: '#999999',
                wrap: true,
                align: 'center',
                margin: 'md',
              },
            ],
            paddingAll: '10px',
          },
        },
      },
    ],
  });
}
