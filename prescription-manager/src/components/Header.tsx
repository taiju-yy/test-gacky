'use client';

import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Store } from '@/types/prescription';
import { isStoreId } from '@/types/auth';
import NotificationSettings from './NotificationSettings';

interface HeaderProps {
  stores?: Store[];
  onStoreChange?: (storeId: string, storeName: string) => void;
}

// 店舗名から「あおぞら薬局」を除去して表示用の名前を取得
const formatStoreName = (storeName: string): string => {
  return storeName
    .replace(/^あおぞら薬局[\s　]*/g, '')
    .replace(/^Aozora[\s　]*/gi, '');
};

export default function Header({ stores = [], onStoreChange }: HeaderProps) {
  const { user, isAdmin, isStoreStaff, hasStoreAssigned, logout, setSelectedStore } = useAuth();
  
  const [showDropdown, setShowDropdown] = useState(false);
  const [showStoreModal, setShowStoreModal] = useState(false);
  const [showNotificationModal, setShowNotificationModal] = useState(false);
  const [selectedStoreId, setSelectedStoreId] = useState(user?.assignedStoreId || '');
  const dropdownRef = useRef<HTMLDivElement>(null);

  // ユーザーの店舗情報が更新されたら選択状態を更新
  useEffect(() => {
    if (user?.assignedStoreId) {
      setSelectedStoreId(user.assignedStoreId);
    }
  }, [user?.assignedStoreId]);

  // ドロップダウン外クリックで閉じる
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // 店舗IDでログインしたスタッフかどうか
  const isStoreIdLogin = user?.username ? isStoreId(user.username) : false;
  
  // メールアドレスでログインした店舗スタッフかどうか（店舗設定が可能）
  const canChangeStore = isStoreStaff && !isStoreIdLogin;

  // 店舗設定を保存
  const handleSaveStore = async () => {
    if (!selectedStoreId) return;
    
    const store = stores.find((s) => s.storeId === selectedStoreId);
    if (store) {
      setSelectedStore(selectedStoreId, store.storeName);
      if (onStoreChange) {
        onStoreChange(selectedStoreId, store.storeName);
      }

      // プッシュ通知の購読情報も更新（店舗情報を同期）
      try {
        const userId = user?.username || user?.email;
        if (userId) {
          await fetch('/api/push-subscriptions', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userId,
              storeId: selectedStoreId,
              storeName: store.storeName,
            }),
          });
          console.log('Push subscription store info updated');
        }
      } catch (error) {
        console.error('Failed to update push subscription store info:', error);
        // 通知購読の更新失敗は店舗設定をブロックしない
      }
    }
    setShowStoreModal(false);
  };

  // ログアウト
  const handleLogout = async () => {
    setShowDropdown(false);
    await logout();
  };

  // 表示するロール名
  const getRoleDisplay = () => {
    if (isAdmin) return '管理者';
    if (isStoreStaff) {
      if (user?.assignedStoreName) {
        return formatStoreName(user.assignedStoreName);
      }
      if (user?.assignedStoreId) {
        return user.assignedStoreId;
      }
      return '店舗スタッフ';
    }
    return '';
  };

  return (
    <header className="gacky-header sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* ロゴとタイトル */}
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-gacky-green rounded-lg flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <div>
              <h1 className="text-lg font-bold text-gray-900">Gacky 処方箋管理システム</h1>
              <p className="text-xs text-gray-500">グランファルマ株式会社</p>
            </div>
          </div>

          {/* ユーザー情報とメニュー */}
          <div className="flex items-center space-x-4">
            {/* ロールバッジ */}
            {isAdmin && (
              <span className="inline-flex items-center px-3 py-1.5 rounded-full text-sm font-medium bg-gacky-green text-white">
                管理者モード
              </span>
            )}
            {isStoreStaff && (
              <span className="inline-flex items-center px-3 py-1.5 rounded-full text-sm font-medium bg-blue-600 text-white">
                {getRoleDisplay()}
              </span>
            )}
            
            {/* 店舗未設定の警告（メールアドレスログインの店舗スタッフ） */}
            {canChangeStore && !hasStoreAssigned && (
              <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-orange-100 text-orange-700 border border-orange-200">
                ⚠️ 店舗未設定
              </span>
            )}
            
            {/* 設定メニュー（ドロップダウン） */}
            <div className="relative" ref={dropdownRef}>
              <button 
                onClick={() => setShowDropdown(!showDropdown)}
                className="p-2 text-gray-500 hover:text-gray-700 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </button>

              {/* ドロップダウンメニュー */}
              {showDropdown && (
                <div className="absolute right-0 mt-2 w-64 bg-white rounded-lg shadow-lg border border-gray-200 py-2 z-50">
                  {/* ユーザー情報 */}
                  <div className="px-4 py-3 border-b border-gray-100">
                    <p className="text-sm font-medium text-gray-900">
                      {user?.email || user?.username || 'ユーザー'}
                    </p>
                    <p className="text-xs text-gray-500 mt-1">
                      {isAdmin ? '管理者' : '店舗スタッフ'}
                    </p>
                  </div>

                  {/* 店舗設定（メールアドレスログインの店舗スタッフのみ） */}
                  {canChangeStore && (
                    <button
                      onClick={() => {
                        setShowDropdown(false);
                        setShowStoreModal(true);
                      }}
                      className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                      </svg>
                      店舗を設定
                      {!hasStoreAssigned && (
                        <span className="ml-auto text-orange-500">●</span>
                      )}
                    </button>
                  )}

                  {/* 通知設定 */}
                  <button
                    onClick={() => {
                      setShowDropdown(false);
                      setShowNotificationModal(true);
                    }}
                    className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                    </svg>
                    通知設定
                  </button>

                  {/* ログアウト */}
                  <button
                    onClick={handleLogout}
                    className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                    </svg>
                    ログアウト
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 店舗設定モーダル */}
      {showStoreModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full mx-4">
            <div className="px-6 py-4 border-b border-gray-100">
              <h3 className="text-lg font-semibold text-gray-900">担当店舗を設定</h3>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-sm text-gray-600">
                担当する店舗を選択してください。選択した店舗の受付のみが表示されます。
              </p>
              
              {user?.assignedStoreName && (
                <div className="p-3 bg-blue-50 border border-blue-100 rounded-lg">
                  <p className="text-sm text-blue-700">
                    現在の店舗: <span className="font-medium">{formatStoreName(user.assignedStoreName)}</span>
                  </p>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  店舗を選択
                </label>
                <select
                  value={selectedStoreId}
                  onChange={(e) => setSelectedStoreId(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="">店舗を選択してください</option>
                  {stores.map((store) => (
                    <option key={store.storeId} value={store.storeId}>
                      {formatStoreName(store.storeName)}（{store.region}）
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex justify-end space-x-3">
              <button
                onClick={() => setShowStoreModal(false)}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 transition-colors"
              >
                キャンセル
              </button>
              <button
                onClick={handleSaveStore}
                disabled={!selectedStoreId}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 通知設定モーダル */}
      {showNotificationModal && user && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full mx-4">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">通知設定</h3>
              <button
                onClick={() => setShowNotificationModal(false)}
                className="p-1 text-gray-400 hover:text-gray-600 transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-6">
              <p className="text-sm text-gray-600 mb-4">
                新しい処方箋が届いたときにブラウザ通知を受け取ることができます。
              </p>
              <NotificationSettings
                userId={user.username || user.email || 'unknown'}
                userType={isAdmin ? 'admin' : 'store_staff'}
                storeId={user.assignedStoreId}
                storeName={user.assignedStoreName}
              />
            </div>
            <div className="px-6 py-4 bg-gray-50 border-t border-gray-100">
              <button
                onClick={() => setShowNotificationModal(false)}
                className="w-full px-4 py-2 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
              >
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
