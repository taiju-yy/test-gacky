/**
 * LINE Messaging API クライアント
 * 
 * 注意: Amplify Compute では環境変数はランタイム時に読み取る必要があります。
 * トップレベルで process.env を参照すると、ビルド時に評価されて undefined になります。
 */

import axios from 'axios';

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
 * 準備完了通知を送信
 */
export async function sendReadyNotification(userId: string, storeName: string): Promise<boolean> {
  const message = `【準備完了のお知らせ】\n\n${storeName}にて、お薬の準備が整いました。\n\nご都合のよろしい時間にご来局ください。\n\nご不明な点がございましたら、こちらにメッセージをお送りください。`;
  
  return pushMessage({
    to: userId,
    messages: [{ type: 'text', text: message }],
  });
}
