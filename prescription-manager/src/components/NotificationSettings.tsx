'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  isPushNotificationSupported,
  getNotificationPermission,
  setupPushNotifications,
  teardownPushNotifications,
  getPushSubscriptionStatus,
  registerServiceWorker,
} from '@/lib/pushNotification';

interface NotificationSettingsProps {
  userId: string;
  userType: 'admin' | 'store_staff';
  storeId?: string;
  storeName?: string;
}

export default function NotificationSettings({
  userId,
  userType,
  storeId,
  storeName,
}: NotificationSettingsProps) {
  const [isSupported, setIsSupported] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>('default');
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 初期状態の確認
  const checkStatus = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    const supported = isPushNotificationSupported();
    setIsSupported(supported);

    if (!supported) {
      setPermission('unsupported');
      setIsLoading(false);
      return;
    }

    // Service Worker を登録（未登録の場合）
    await registerServiceWorker();

    const currentPermission = getNotificationPermission();
    setPermission(currentPermission);

    if (currentPermission === 'granted') {
      const status = await getPushSubscriptionStatus();
      setIsSubscribed(status.isSubscribed);
    }

    setIsLoading(false);
  }, []);

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  // 通知を有効化
  const handleEnable = async () => {
    setIsLoading(true);
    setError(null);

    const result = await setupPushNotifications({
      userId,
      userType,
      storeId,
      storeName,
    });

    if (result.success) {
      setIsSubscribed(true);
      setPermission('granted');
    } else {
      setError(result.error || '通知の設定に失敗しました');
      setPermission(result.permission);
    }

    setIsLoading(false);
  };

  // 通知を無効化
  const handleDisable = async () => {
    setIsLoading(true);
    setError(null);

    const success = await teardownPushNotifications();

    if (success) {
      setIsSubscribed(false);
    } else {
      setError('通知の解除に失敗しました');
    }

    setIsLoading(false);
  };

  // サポートされていない場合
  if (!isSupported) {
    return (
      <div className="p-4 bg-gray-50 rounded-lg">
        <div className="flex items-center space-x-2 text-gray-500">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <span className="text-sm">このブラウザは通知に対応していません</span>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 bg-white rounded-lg border border-gray-200">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className={`p-2 rounded-full ${isSubscribed ? 'bg-green-100' : 'bg-gray-100'}`}>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className={`h-5 w-5 ${isSubscribed ? 'text-green-600' : 'text-gray-400'}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
              />
            </svg>
          </div>
          <div>
            <h3 className="font-medium text-gray-900">プッシュ通知</h3>
            <p className="text-sm text-gray-500">
              {isSubscribed
                ? '新しい処方箋が届くと通知されます'
                : '処方箋受付をリアルタイムで通知'}
            </p>
          </div>
        </div>

        <div>
          {isLoading ? (
            <div className="w-8 h-8 flex items-center justify-center">
              <div className="animate-spin rounded-full h-5 w-5 border-2 border-gacky-green border-t-transparent"></div>
            </div>
          ) : permission === 'denied' ? (
            <button
              disabled
              className="px-3 py-1.5 text-sm bg-gray-100 text-gray-400 rounded-lg cursor-not-allowed"
              title="ブラウザの設定から通知を許可してください"
            >
              拒否されています
            </button>
          ) : isSubscribed ? (
            <button
              onClick={handleDisable}
              className="px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
            >
              無効にする
            </button>
          ) : (
            <button
              onClick={handleEnable}
              className="px-3 py-1.5 text-sm bg-gacky-green text-white rounded-lg hover:bg-green-600 transition-colors"
            >
              有効にする
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="mt-3 p-2 bg-red-50 rounded text-sm text-red-600">
          {error}
        </div>
      )}

      {permission === 'denied' && (
        <div className="mt-3 p-2 bg-yellow-50 rounded text-sm text-yellow-700">
          通知がブロックされています。ブラウザの設定から通知を許可してください。
        </div>
      )}
    </div>
  );
}
