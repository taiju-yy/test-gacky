/**
 * LINE Messaging API クライアント
 */

import axios from 'axios';

const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;

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
  if (!LINE_CHANNEL_ACCESS_TOKEN) {
    console.error('LINE_CHANNEL_ACCESS_TOKEN is not configured');
    return false;
  }

  try {
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
    
    console.log('LINE message sent successfully:', response.status);
    return true;
  } catch (error: any) {
    console.error('Error sending LINE message:', error.response?.data || error.message);
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
