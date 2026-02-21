/**
 * Service Worker for Gacky 処方箋管理システム
 * 
 * プッシュ通知を受信してブラウザ通知を表示する
 */

// Service Worker のバージョン（更新時に変更）
const SW_VERSION = '1.0.4';

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
    requireInteraction: true, // 通知を画面に残す（ユーザーが操作するまで消えない）
    vibrate: [200, 100, 200],
    data: data.data,
    // 注意: macOS では actions を使うと通知センター経由になり、
    // クリックイベントが発火しないことがあるため、アクションボタンは使用しない
    // 通知本体をクリックすることでアプリを開く
  };

  event.waitUntil(
    (async () => {
      // 通知を表示
      await self.registration.showNotification(data.title, options);
      
      // 開いているタブにメッセージを送信してリストを更新させる
      const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      console.log('[Service Worker] Notifying', clientList.length, 'client(s) about new prescription');
      
      for (const client of clientList) {
        client.postMessage({
          type: 'NEW_PRESCRIPTION',
          data: data.data,
        });
      }
    })()
  );
});

// 通知クリック時（通知本体のクリック）
self.addEventListener('notificationclick', (event) => {
  console.log('[Service Worker] Notification clicked');
  console.log('[Service Worker] Action:', event.action);
  console.log('[Service Worker] Notification data:', JSON.stringify(event.notification.data));

  // 通知を閉じる
  event.notification.close();

  // 通知データからURLを取得（デフォルトはルート）
  const notificationData = event.notification.data || {};
  const baseUrl = self.location.origin;
  let urlToOpen = baseUrl + '/';
  
  // receptionId がある場合はURLパラメータに追加
  if (notificationData.receptionId) {
    urlToOpen = `${baseUrl}/?receptionId=${notificationData.receptionId}`;
  }
  
  console.log('[Service Worker] Base URL:', baseUrl);
  console.log('[Service Worker] URL to open:', urlToOpen);

  // クリック処理を waitUntil で包む（これが重要）
  event.waitUntil(
    (async () => {
      try {
        const clientList = await self.clients.matchAll({ 
          type: 'window', 
          includeUncontrolled: true 
        });
        
        console.log('[Service Worker] Found', clientList.length, 'client(s)');
        
        // 既に開いているウィンドウを探す
        for (const client of clientList) {
          console.log('[Service Worker] Checking client URL:', client.url);
          
          // 同じオリジンのウィンドウを見つけた場合
          if (client.url.startsWith(baseUrl)) {
            console.log('[Service Worker] Found matching client, focusing...');
            
            // フォーカスを当てる
            await client.focus();
            
            // ページにメッセージを送信してリストを更新させる
            client.postMessage({
              type: 'NOTIFICATION_CLICKED',
              data: notificationData,
            });
            
            console.log('[Service Worker] Message sent to client');
            return;
          }
        }
        
        // 開いているウィンドウがない場合は新しく開く
        console.log('[Service Worker] No matching client found, opening new window...');
        
        if (self.clients.openWindow) {
          const newClient = await self.clients.openWindow(urlToOpen);
          console.log('[Service Worker] New window opened:', newClient ? 'success' : 'failed');
        } else {
          console.error('[Service Worker] openWindow is not available');
        }
      } catch (err) {
        console.error('[Service Worker] Error in notification click handler:', err);
      }
    })()
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
