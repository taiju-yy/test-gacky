'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  isPushNotificationSupported,
  getNotificationPermission,
  setupPushNotifications,
  teardownPushNotifications,
  getPushSubscriptionStatus,
  registerServiceWorker,
  getNotificationSupportInfo,
  type NotificationSupportInfo,
} from '@/lib/pushNotification';

interface NotificationSettingsProps {
  userId: string;
  userType: 'admin' | 'store_staff';
  storeId?: string;
  storeName?: string;
}

/**
 * iOS/iPadOS ユーザー向けの PWA インストールガイダンスコンポーネント
 */
function PWAInstallGuide({ supportInfo }: { supportInfo: NotificationSupportInfo }) {
  const deviceName = supportInfo.device.isIPad ? 'iPad' : 'iPhone';
  // iPad は右上、iPhone は下部に共有ボタンがある
  const shareButtonPosition = supportInfo.device.isIPad ? '画面右上' : '画面下部';
  
  return (
    <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
      <div className="flex items-start space-x-3">
        <div className="p-2 rounded-full bg-blue-100 shrink-0">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-5 w-5 text-blue-600"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z"
            />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-medium text-blue-900">
            {deviceName} で通知を受け取るには
          </h3>
          <p className="mt-1 text-sm text-blue-700">
            Safari でホーム画面にアプリを追加すると、プッシュ通知を受け取れるようになります。
          </p>
          
          <div className="mt-4 space-y-3">
            <div className="flex items-start space-x-3">
              <div className="flex items-center justify-center w-6 h-6 rounded-full bg-blue-200 text-blue-800 text-sm font-medium shrink-0">
                1
              </div>
              <div className="flex items-center flex-wrap gap-1 text-sm text-blue-800">
                <span>{shareButtonPosition}の</span>
                {/* Safari の共有アイコン（四角形から上矢印） */}
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 inline-block" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                <span>共有ボタンをタップ</span>
              </div>
            </div>
            
            <div className="flex items-start space-x-3">
              <div className="flex items-center justify-center w-6 h-6 rounded-full bg-blue-200 text-blue-800 text-sm font-medium shrink-0">
                2
              </div>
              <div className="flex items-center flex-wrap gap-1 text-sm text-blue-800">
                <span>「</span>
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                <span>ホーム画面に追加」を選択</span>
              </div>
            </div>
            
            <div className="flex items-start space-x-3">
              <div className="flex items-center justify-center w-6 h-6 rounded-full bg-blue-200 text-blue-800 text-sm font-medium shrink-0">
                3
              </div>
              <div className="text-sm text-blue-800">
                ホーム画面のアイコンからアプリを起動
              </div>
            </div>
            
            <div className="flex items-start space-x-3">
              <div className="flex items-center justify-center w-6 h-6 rounded-full bg-blue-200 text-blue-800 text-sm font-medium shrink-0">
                4
              </div>
              <div className="text-sm text-blue-800">
                アプリ内で通知設定を有効にする
              </div>
            </div>
          </div>

          <div className="mt-4 p-3 bg-blue-100 rounded-lg">
            <p className="text-xs text-blue-700">
              <strong>ヒント:</strong> ホーム画面に追加すると、ブラウザのアドレスバーなしでフルスクリーンで使用できます。
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * 通知非対応ブラウザ向けのメッセージコンポーネント
 */
function UnsupportedBrowserMessage() {
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

export default function NotificationSettings({
  userId,
  userType,
  storeId,
  storeName,
}: NotificationSettingsProps) {
  const [isSupported, setIsSupported] = useState(false);
  const [supportInfo, setSupportInfo] = useState<NotificationSupportInfo | null>(null);
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>('default');
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 初期状態の確認
  const checkStatus = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    // 詳細なサポート情報を取得
    const info = getNotificationSupportInfo();
    setSupportInfo(info);
    
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

  // iOS/iPadOS Safari でブラウザモードの場合、PWA インストールガイドを表示
  if (supportInfo && supportInfo.requiresPWA && !supportInfo.device.isPWA && supportInfo.canEnableWithPWA) {
    return <PWAInstallGuide supportInfo={supportInfo} />;
  }

  // サポートされていない場合（PWA にしても対応不可のブラウザ）
  if (!isSupported && supportInfo && !supportInfo.canEnableWithPWA) {
    return <UnsupportedBrowserMessage />;
  }

  // ローディング中の表示（初期状態）
  if (isLoading && supportInfo === null) {
    return (
      <div className="p-4 bg-white rounded-lg border border-gray-200">
        <div className="flex items-center justify-center">
          <div className="animate-spin rounded-full h-5 w-5 border-2 border-gacky-green border-t-transparent"></div>
          <span className="ml-2 text-sm text-gray-500">読み込み中...</span>
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
