/**
 * Web Push 通知クライアントライブラリ
 * 
 * Service Worker の登録とプッシュ通知の購読管理を行う
 */

// VAPID公開鍵（環境変数から取得）
// 注意: これはサーバー側で生成した公開鍵と一致させる必要がある
const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || '';

/**
 * Base64 URL文字列をUint8Arrayに変換
 */
function urlBase64ToUint8Array(base64String: string): BufferSource {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, '+')
    .replace(/_/g, '/');

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  // ArrayBufferを返すことで型の互換性を確保
  return outputArray.buffer;
}

/**
 * Service Worker がサポートされているか確認
 */
export function isPushNotificationSupported(): boolean {
  return (
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/**
 * 通知の許可状態を取得
 */
export function getNotificationPermission(): NotificationPermission | 'unsupported' {
  if (!isPushNotificationSupported()) {
    return 'unsupported';
  }
  return Notification.permission;
}

/**
 * Service Worker を登録
 */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!isPushNotificationSupported()) {
    console.warn('Push notifications are not supported in this browser');
    return null;
  }

  try {
    const registration = await navigator.serviceWorker.register('/sw.js', {
      scope: '/',
    });
    console.log('Service Worker registered:', registration.scope);
    return registration;
  } catch (error) {
    console.error('Service Worker registration failed:', error);
    return null;
  }
}

/**
 * プッシュ通知の購読を取得または作成
 */
export async function subscribeToPushNotifications(
  registration: ServiceWorkerRegistration
): Promise<PushSubscription | null> {
  if (!VAPID_PUBLIC_KEY) {
    console.error('VAPID public key is not configured');
    return null;
  }

  try {
    // 既存の購読を確認
    let subscription = await registration.pushManager.getSubscription();

    if (subscription) {
      console.log('Existing push subscription found');
      return subscription;
    }

    // 新規購読を作成
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });

    console.log('New push subscription created');
    return subscription;
  } catch (error) {
    console.error('Failed to subscribe to push notifications:', error);
    return null;
  }
}

/**
 * プッシュ通知の購読を解除
 */
export async function unsubscribeFromPushNotifications(
  registration: ServiceWorkerRegistration
): Promise<boolean> {
  try {
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      await subscription.unsubscribe();
      console.log('Push subscription unsubscribed');
      return true;
    }
    return false;
  } catch (error) {
    console.error('Failed to unsubscribe from push notifications:', error);
    return false;
  }
}

/**
 * 通知の許可をリクエスト
 */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!isPushNotificationSupported()) {
    throw new Error('Push notifications are not supported');
  }

  const permission = await Notification.requestPermission();
  console.log('Notification permission:', permission);
  return permission;
}

/**
 * 購読情報をサーバーに登録
 */
export async function registerSubscriptionToServer(
  subscription: PushSubscription,
  userInfo: {
    userId: string;
    userType: 'admin' | 'store_staff';
    storeId?: string;
    storeName?: string;
  }
): Promise<boolean> {
  try {
    const response = await fetch('/api/push-subscriptions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        subscription: subscription.toJSON(),
        ...userInfo,
      }),
    });

    const data = await response.json();
    
    if (data.success) {
      console.log('Push subscription registered to server');
      return true;
    } else {
      console.error('Failed to register subscription:', data.error);
      return false;
    }
  } catch (error) {
    console.error('Failed to register subscription to server:', error);
    return false;
  }
}

/**
 * サーバーから購読を解除
 */
export async function unregisterSubscriptionFromServer(
  subscription: PushSubscription
): Promise<boolean> {
  try {
    const response = await fetch('/api/push-subscriptions', {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        endpoint: subscription.endpoint,
      }),
    });

    const data = await response.json();
    return data.success;
  } catch (error) {
    console.error('Failed to unregister subscription from server:', error);
    return false;
  }
}

/**
 * プッシュ通知のフルセットアップ
 * 
 * 1. Service Worker 登録
 * 2. 通知許可リクエスト
 * 3. プッシュ購読作成
 * 4. サーバーに登録
 */
export async function setupPushNotifications(
  userInfo: {
    userId: string;
    userType: 'admin' | 'store_staff';
    storeId?: string;
    storeName?: string;
  }
): Promise<{
  success: boolean;
  permission: NotificationPermission | 'unsupported';
  error?: string;
}> {
  // 1. サポートチェック
  if (!isPushNotificationSupported()) {
    return {
      success: false,
      permission: 'unsupported',
      error: 'このブラウザはプッシュ通知に対応していません',
    };
  }

  // 2. Service Worker 登録
  const registration = await registerServiceWorker();
  if (!registration) {
    return {
      success: false,
      permission: Notification.permission,
      error: 'Service Workerの登録に失敗しました',
    };
  }

  // 3. 通知許可リクエスト
  const permission = await requestNotificationPermission();
  if (permission !== 'granted') {
    return {
      success: false,
      permission,
      error: permission === 'denied' 
        ? '通知が拒否されています。ブラウザの設定から許可してください'
        : '通知の許可が必要です',
    };
  }

  // 4. プッシュ購読作成
  const subscription = await subscribeToPushNotifications(registration);
  if (!subscription) {
    return {
      success: false,
      permission,
      error: 'プッシュ通知の購読に失敗しました',
    };
  }

  // 5. サーバーに登録
  const registered = await registerSubscriptionToServer(subscription, userInfo);
  if (!registered) {
    return {
      success: false,
      permission,
      error: 'サーバーへの登録に失敗しました',
    };
  }

  return {
    success: true,
    permission,
  };
}

/**
 * プッシュ通知の完全解除
 */
export async function teardownPushNotifications(): Promise<boolean> {
  if (!isPushNotificationSupported()) {
    return false;
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();

    if (subscription) {
      // サーバーから解除
      await unregisterSubscriptionFromServer(subscription);
      // ブラウザから解除
      await subscription.unsubscribe();
    }

    return true;
  } catch (error) {
    console.error('Failed to teardown push notifications:', error);
    return false;
  }
}

/**
 * 現在の購読状態を取得
 */
export async function getPushSubscriptionStatus(): Promise<{
  isSubscribed: boolean;
  permission: NotificationPermission | 'unsupported';
  endpoint?: string;
}> {
  if (!isPushNotificationSupported()) {
    return {
      isSubscribed: false,
      permission: 'unsupported',
    };
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();

    return {
      isSubscribed: !!subscription,
      permission: Notification.permission,
      endpoint: subscription?.endpoint,
    };
  } catch (error) {
    return {
      isSubscribed: false,
      permission: Notification.permission,
    };
  }
}
