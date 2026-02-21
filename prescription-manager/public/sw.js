/**
 * Service Worker for Gacky 処方箋管理システム
 * 
 * プッシュ通知を受信してブラウザ通知を表示する
 */

// Service Worker のバージョン（更新時に変更）
const SW_VERSION = '1.0.1';

// Service Worker インストール時
self.addEventListener('install', (event) => {
  console.log('[Service Worker] Installing... Version:', SW_VERSION);
  // 即座にアクティブ化
  self.skipWaiting();
});

// Service Worker アクティブ化時
self.addEventListener('activate', (event) => {
  console.log('[Service Worker] Activated. Version:', SW_VERSION);
  // 全てのクライアントを即座に制御
  event.waitUntil(self.clients.claim());
});

// プッシュ通知受信時
self.addEventListener('push', (event) => {
  console.log('[Service Worker] Push received:', event);

  let data = {
    title: '新しい処方箋が届きました',
    body: '処方箋管理画面を確認してください',
    icon: '/notification-icon.png',
    badge: '/notification-badge.png',
    tag: 'prescription-notification',
    renotify: true,
    requireInteraction: true,
    data: {
      url: '/',
      receptionId: null,
    },
  };

  // プッシュデータがある場合はパース
  if (event.data) {
    try {
      const payload = event.data.json();
      data = {
        ...data,
        ...payload,
        data: {
          ...data.data,
          ...payload.data,
        },
      };
    } catch (e) {
      console.error('[Service Worker] Error parsing push data:', e);
      // テキストとして扱う
      data.body = event.data.text();
    }
  }

  const options = {
    body: data.body,
    icon: data.icon || '/notification-icon.png',
    badge: data.badge || '/notification-badge.png',
    tag: data.tag || 'prescription-notification',
    renotify: data.renotify !== false,
    requireInteraction: data.requireInteraction !== false,
    vibrate: [200, 100, 200],
    data: data.data,
    actions: [
      {
        action: 'open',
        title: '確認する',
      },
      {
        action: 'close',
        title: '閉じる',
      },
    ],
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// 通知クリック時
self.addEventListener('notificationclick', (event) => {
  console.log('[Service Worker] Notification clicked:', event);
  console.log('[Service Worker] Action:', event.action);
  console.log('[Service Worker] Notification data:', event.notification.data);

  event.notification.close();

  if (event.action === 'close') {
    console.log('[Service Worker] Close action - doing nothing');
    return;
  }

  // 通知データからURLを取得（デフォルトはルート）
  const notificationData = event.notification.data || {};
  const baseUrl = self.location.origin;
  let urlToOpen = baseUrl + '/';
  
  // receptionId がある場合はURLパラメータに追加
  if (notificationData.receptionId) {
    urlToOpen = `${baseUrl}/?receptionId=${notificationData.receptionId}`;
  }
  
  console.log('[Service Worker] URL to open:', urlToOpen);

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        console.log('[Service Worker] Found', clientList.length, 'client(s)');
        
        // 既に開いているウィンドウがあればフォーカス
        for (const client of clientList) {
          console.log('[Service Worker] Checking client:', client.url);
          if (client.url.includes(baseUrl) && 'focus' in client) {
            console.log('[Service Worker] Focusing existing client');
            client.focus();
            // 画面更新を促すメッセージを送信
            client.postMessage({
              type: 'NOTIFICATION_CLICKED',
              data: notificationData,
            });
            return;
          }
        }
        
        // 開いているウィンドウがなければ新規オープン
        console.log('[Service Worker] No existing client found, opening new window');
        if (self.clients.openWindow) {
          return self.clients.openWindow(urlToOpen);
        } else {
          console.log('[Service Worker] openWindow not available');
        }
      })
      .catch((err) => {
        console.error('[Service Worker] Error handling notification click:', err);
      })
  );
});

// 通知閉じた時
self.addEventListener('notificationclose', (event) => {
  console.log('[Service Worker] Notification closed:', event);
});

// メッセージ受信時（フロントエンドからの通信用）
self.addEventListener('message', (event) => {
  console.log('[Service Worker] Message received:', event.data);

  if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
