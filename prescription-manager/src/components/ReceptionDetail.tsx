'use client';

import { useState, useEffect } from 'react';
import { PrescriptionReception, ReceptionStatus, Store, PrescriptionMessage, DeliveryMethod } from '@/types/prescription';
import MessagePanel from './MessagePanel';

// 店舗名から「あおぞら薬局」を除去して表示用の名前を取得
const formatStoreName = (storeName: string): string => {
  // 「あおぞら薬局 XXX店」→「XXX店」
  // 「XXX店」→「XXX店」（そのまま）
  return storeName
    .replace(/^あおぞら薬局[\s　]*/g, '')
    .replace(/^Aozora[\s　]*/gi, '');
};

interface ReceptionDetailProps {
  reception: PrescriptionReception;
  stores: Store[];
  messages: PrescriptionMessage[];
  onStatusChange: (receptionId: string, newStatus: ReceptionStatus) => void;
  onStoreAssign: (receptionId: string, storeId: string) => void;
  onSendMessage: (receptionId: string, message: string) => Promise<void>;
  onReactivateSession?: (receptionId: string) => Promise<void>;
  onStartVideoCall?: (receptionId: string) => Promise<string | null>; // ビデオ通話を開始し、ルームURLを返す
  onDeliveryMethodChange?: (receptionId: string, deliveryMethod: DeliveryMethod, notifyCustomer: boolean) => Promise<void>;
  onStaffNoteUpdate?: (receptionId: string, staffNote: string) => Promise<void>;
  onRefreshMessages?: () => void; // メッセージを再取得するコールバック
  onClearUnread?: () => void; // 未読数をクリアするコールバック
  onMessageTabChange?: (isActive: boolean) => void; // メッセージタブの表示状態が変わったとき
  onClose: () => void;
  isAdmin?: boolean; // 管理者かどうか（店舗割振り機能の表示制御用）
}

const statusLabels: Record<ReceptionStatus, string> = {
  pending: '受付待ち',
  confirmed: '確認済み',
  preparing: '調剤中',
  ready: '準備完了',
  video_counseling: '服薬指導中',
  shipping: '配送準備中',
  shipped: '配送中',
  completed: '受取完了',
  cancelled: 'キャンセル',
};

const statusColors: Record<ReceptionStatus, string> = {
  pending: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  confirmed: 'bg-blue-100 text-blue-800 border-blue-200',
  preparing: 'bg-purple-100 text-purple-800 border-purple-200',
  ready: 'bg-green-100 text-green-800 border-green-200',
  video_counseling: 'bg-pink-100 text-pink-800 border-pink-200',
  shipping: 'bg-orange-100 text-orange-800 border-orange-200',
  shipped: 'bg-indigo-100 text-indigo-800 border-indigo-200',
  completed: 'bg-gray-100 text-gray-800 border-gray-200',
  cancelled: 'bg-red-100 text-red-800 border-red-200',
};

export default function ReceptionDetail({
  reception,
  stores,
  messages,
  onStatusChange,
  onStoreAssign,
  onSendMessage,
  onReactivateSession,
  onStartVideoCall,
  onDeliveryMethodChange,
  onClose,
  isAdmin = false,
  onStaffNoteUpdate,
  onRefreshMessages,
  onClearUnread,
  onMessageTabChange,
}: ReceptionDetailProps) {
  // 店舗名から店舗IDを取得するヘルパー関数
  const getStoreIdByName = (storeName: string | undefined): string => {
    if (!storeName) return '';
    // 完全一致で検索
    let store = stores.find(s => s.storeName === storeName);
    if (store) return store.storeId;
    // 「あおぞら薬局」プレフィックスを除去して検索
    const normalizedName = storeName.replace(/^あおぞら薬局[\s　]*/g, '').replace(/^Aozora[\s　]*/gi, '');
    store = stores.find(s => 
      s.storeName === normalizedName || 
      s.storeName.replace(/^あおぞら薬局[\s　]*/g, '').replace(/^Aozora[\s　]*/gi, '') === normalizedName
    );
    return store?.storeId || '';
  };

  // 店舗IDの初期値を計算
  // LINE Bot側のstoreId形式と店舗マスタのstoreId形式が異なる場合があるため、
  // 店舗名からの逆引きを優先する
  const getInitialStoreId = (): string => {
    // 店舗名から逆引き（最も確実な方法）
    const resolvedId = getStoreIdByName(reception.selectedStoreName);
    if (resolvedId) return resolvedId;
    // フォールバック: 保存されているIDを使用
    return reception.selectedStoreId || reception.preferredStoreId || '';
  };

  const [selectedStoreId, setSelectedStoreId] = useState(getInitialStoreId());
  const [staffNote, setStaffNote] = useState(reception.staffNote || '');
  const [activeTab, setActiveTab] = useState<'info' | 'message'>('info');
  const [isReactivating, setIsReactivating] = useState(false);
  const [isStartingVideoCall, setIsStartingVideoCall] = useState(false);
  const [isChangingDeliveryMethod, setIsChangingDeliveryMethod] = useState(false);
  const [showDeliveryMethodModal, setShowDeliveryMethodModal] = useState(false);
  const [notifyCustomerOnChange, setNotifyCustomerOnChange] = useState(true);
  
  // キャンセル確認モーダル（二段階チェック）
  const [showCancelConfirmModal, setShowCancelConfirmModal] = useState(false);
  const [cancelConfirmStep, setCancelConfirmStep] = useState<1 | 2>(1);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isSavingNote, setIsSavingNote] = useState(false);
  const [noteHasChanges, setNoteHasChanges] = useState(false);

  // セッションがタイムアウトしているかどうか判定
  const isSessionTimedOut = reception.messagingSessionStatus === 'closed' && 
    reception.sessionCloseReason === 'timeout';
  
  // セッションが終了しているか（タイムアウト以外の理由）
  const isSessionClosed = reception.messagingSessionStatus === 'closed' && 
    reception.sessionCloseReason !== 'timeout';

  // セッション再開ハンドラ
  const handleReactivateSession = async () => {
    if (!onReactivateSession) return;
    setIsReactivating(true);
    try {
      await onReactivateSession(reception.receptionId);
    } finally {
      setIsReactivating(false);
    }
  };

  // ビデオ通話開始ハンドラ
  const handleStartVideoCall = async () => {
    if (!onStartVideoCall) return;
    setIsStartingVideoCall(true);
    try {
      const storeVideoCallUrl = await onStartVideoCall(reception.receptionId);
      if (storeVideoCallUrl) {
        // 新しいウィンドウでビデオ通話画面を開く
        window.open(storeVideoCallUrl, '_blank', 'width=800,height=600');
      }
    } finally {
      setIsStartingVideoCall(false);
    }
  };

  // 受け取り方法変更ハンドラ
  const handleDeliveryMethodChange = async (newMethod: DeliveryMethod) => {
    if (!onDeliveryMethodChange) return;
    setIsChangingDeliveryMethod(true);
    try {
      await onDeliveryMethodChange(reception.receptionId, newMethod, notifyCustomerOnChange);
      setShowDeliveryMethodModal(false);
    } finally {
      setIsChangingDeliveryMethod(false);
    }
  };

  // キャンセル確認モーダルを開く
  const handleOpenCancelModal = () => {
    setShowCancelConfirmModal(true);
    setCancelConfirmStep(1);
  };

  // キャンセル確認モーダルを閉じる
  const handleCloseCancelModal = () => {
    setShowCancelConfirmModal(false);
    setCancelConfirmStep(1);
  };

  // キャンセル処理実行（二段階目で確定後）
  const handleConfirmCancel = async () => {
    if (cancelConfirmStep === 1) {
      // 一段階目: 二段階目へ進む
      setCancelConfirmStep(2);
    } else {
      // 二段階目: 実際にキャンセル処理を実行
      setIsCancelling(true);
      try {
        await onStatusChange(reception.receptionId, 'cancelled');
        handleCloseCancelModal();
      } finally {
        setIsCancelling(false);
      }
    }
  };

  // reception変更時またはstoresロード時にstateを更新
  useEffect(() => {
    // 店舗名から店舗マスタのIDを逆引き
    // LINE Bot側のstoreId形式（例: store_morimoto）と
    // 店舗マスタのstoreId形式（例: store_007）が異なる場合があるため、
    // 店舗名からの逆引きを優先する
    const resolvedStoreId = getStoreIdByName(reception.selectedStoreName);
    
    // 店舗名から解決できた場合はそれを使用、できない場合は保存されているIDを使用
    const newStoreId = resolvedStoreId || 
                       reception.selectedStoreId || 
                       reception.preferredStoreId || 
                       '';
    
    setSelectedStoreId(newStoreId);
    setStaffNote(reception.staffNote || '');
    setNoteHasChanges(false); // 受付切り替え時に変更フラグをリセット
  }, [reception.receptionId, reception.selectedStoreId, reception.preferredStoreId, reception.selectedStoreName, reception.staffNote, stores]);

  const handleAssign = () => {
    if (selectedStoreId) {
      onStoreAssign(reception.receptionId, selectedStoreId);
    }
  };

  const handleSendMessageWrapper = async (message: string) => {
    await onSendMessage(reception.receptionId, message);
  };

  // スタッフメモ変更ハンドラ
  const handleStaffNoteChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    setStaffNote(newValue);
    setNoteHasChanges(newValue !== (reception.staffNote || ''));
  };

  // スタッフメモ保存ハンドラ
  const handleSaveStaffNote = async () => {
    if (!onStaffNoteUpdate || !noteHasChanges) return;
    setIsSavingNote(true);
    try {
      await onStaffNoteUpdate(reception.receptionId, staffNote);
      setNoteHasChanges(false);
    } finally {
      setIsSavingNote(false);
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 h-full flex flex-col overflow-hidden">
      {/* ヘッダー */}
      <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-white flex-shrink-0">
        <div className="flex items-center space-x-4">
          {/* プロフィール画像 */}
          <div className="w-12 h-12 rounded-full bg-gray-200 flex items-center justify-center overflow-hidden flex-shrink-0">
            {reception.userProfileImage ? (
              <img
                src={reception.userProfileImage}
                alt={reception.userDisplayName || ''}
                className="w-full h-full object-cover"
              />
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            )}
          </div>
          <div>
            <h2 className="font-semibold text-gray-900">
              {reception.userDisplayName || 'お客様'}
            </h2>
            <p className="text-sm text-gray-500">
              #{reception.receptionId.slice(-6)} ・ {new Date(reception.timestamp).toLocaleString('ja-JP', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </p>
          </div>
        </div>
        <div className="flex items-center space-x-3">
          {/* ステータスバッジ */}
          <span className={`px-3 py-1 rounded-full text-sm font-medium border ${statusColors[reception.status]}`}>
            {statusLabels[reception.status]}
          </span>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* タブ切り替え */}
      <div className="flex border-b border-gray-100 flex-shrink-0">
        <button
          onClick={() => {
            setActiveTab('info');
            // 受付情報タブに切り替えたことを親に通知
            if (onMessageTabChange) {
              onMessageTabChange(false);
            }
          }}
          className={`flex-1 py-3 text-sm font-medium transition-colors ${
            activeTab === 'info'
              ? 'text-blue-600 border-b-2 border-blue-600'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          受付情報
        </button>
        <button
          onClick={() => {
            setActiveTab('message');
            // メッセージタブに切り替えたことを親に通知
            if (onMessageTabChange) {
              onMessageTabChange(true);
            }
            // メッセージタブをクリックしたときにメッセージを再取得
            if (onRefreshMessages) {
              onRefreshMessages();
            }
            // 未読数をクリア（左カラムの未読マークを消す）
            if (onClearUnread) {
              onClearUnread();
            }
          }}
          className={`flex-1 py-3 text-sm font-medium transition-colors relative ${
            activeTab === 'message'
              ? 'text-blue-600 border-b-2 border-blue-600'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          メッセージ
          {reception.unreadMessageCount && reception.unreadMessageCount > 0 && activeTab !== 'message' && (
            <span className="absolute top-2 right-1/4 bg-red-500 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
              {reception.unreadMessageCount > 9 ? '9+' : reception.unreadMessageCount}
            </span>
          )}
          {reception.messagingSessionStatus === 'active' && (
            <span className="ml-2 w-2 h-2 bg-orange-500 rounded-full animate-pulse inline-block"></span>
          )}
        </button>
      </div>

      {/* コンテンツ */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'info' ? (
          <div className="overflow-y-auto h-full p-6 space-y-5">
            {/* セッションタイムアウト警告 */}
            {isSessionTimedOut && (
              <div className="p-4 bg-orange-50 border border-orange-200 rounded-lg">
                <div className="flex items-start">
                  <span className="text-2xl mr-3">⏰</span>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-orange-800 mb-1">
                      セッションがタイムアウトしました
                    </p>
                    <p className="text-xs text-orange-700 mb-3">
                      30分以上経過したため、お客様との双方向メッセージが終了しました。
                      お客様のLINE発言はAI応答に戻っています。
                    </p>
                    {onReactivateSession && (
                      <button
                        onClick={handleReactivateSession}
                        disabled={isReactivating}
                        className="px-4 py-2 bg-orange-600 text-white text-sm rounded-lg hover:bg-orange-700 transition-colors disabled:opacity-50"
                      >
                        {isReactivating ? '再開中...' : 'セッションを再開（+30分）'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* セッション終了（タイムアウト以外）の表示 */}
            {isSessionClosed && (
              <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg">
                <p className="text-xs text-gray-600">
                  メッセージセッションは終了しています（理由: {
                    reception.sessionCloseReason === 'ready' ? '準備完了' :
                    reception.sessionCloseReason === 'completed' ? '受取完了' :
                    reception.sessionCloseReason === 'cancelled' ? 'キャンセル' :
                    reception.sessionCloseReason === 'manual' ? '手動終了' : '不明'
                  }）
                </p>
              </div>
            )}

            {/* お客様メモ */}
            {reception.customerNote && (
              <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                <p className="text-sm font-medium text-yellow-800 mb-1">お客様からのメモ</p>
                <p className="text-sm text-yellow-700">{reception.customerNote}</p>
              </div>
            )}

            {/* 処方箋画像 */}
            <div>
              <h3 className="text-sm font-medium text-gray-500 mb-2">処方箋画像</h3>
              <div className="border rounded-lg overflow-hidden bg-gray-50">
                {reception.prescriptionImageUrl ? (
                  <img
                    src={reception.prescriptionImageUrl}
                    alt="処方箋"
                    className="w-full h-auto max-h-64 object-contain cursor-pointer hover:opacity-90"
                    onClick={() => window.open(reception.prescriptionImageUrl, '_blank')}
                  />
                ) : (
                  <div className="h-40 flex items-center justify-center text-gray-400">
                    <div className="text-center">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                      <p className="text-sm">画像なし</p>
                    </div>
                  </div>
                )}
              </div>
              {reception.ocrResult && (
                <div className="mt-2 p-2 bg-gray-50 rounded-lg">
                  <p className="text-xs text-gray-500 mb-1">OCR読取結果（参考）</p>
                  <p className="text-sm text-gray-700 whitespace-pre-wrap">{reception.ocrResult}</p>
                </div>
              )}
            </div>

            {/* 受け取り方法 */}
            <div>
              <h3 className="text-sm font-medium text-gray-500 mb-2">受け取り方法</h3>
              <div className="flex items-center justify-between p-3 bg-gray-50 border border-gray-200 rounded-lg">
                <div className="flex items-center space-x-3">
                  <span className="text-2xl">
                    {reception.deliveryMethod === 'home' ? '🏠' : '🏪'}
                  </span>
                  <div>
                    <p className="font-medium text-gray-900">
                      {reception.deliveryMethod === 'home' ? '自宅受け取り' : '店舗受け取り'}
                    </p>
                    <p className="text-xs text-gray-500">
                      {reception.deliveryMethod === 'home' 
                        ? 'オンライン服薬指導後にご自宅へ配送'
                        : '店舗でお薬をお受け取り'}
                    </p>
                  </div>
                </div>
                {onDeliveryMethodChange && reception.status !== 'completed' && reception.status !== 'cancelled' && (
                  <button
                    onClick={() => setShowDeliveryMethodModal(true)}
                    className="px-3 py-1.5 text-sm text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded-lg transition-colors"
                  >
                    変更
                  </button>
                )}
              </div>
              {reception.preferredPickupTimeText && (
                <div className="mt-2 p-2 bg-blue-50 border border-blue-100 rounded-lg">
                  <p className="text-xs text-blue-700">
                    <span className="font-medium">希望受け取り日時:</span> {reception.preferredPickupTimeText}
                  </p>
                </div>
              )}
            </div>

            {/* 受け取り方法変更モーダル */}
            {showDeliveryMethodModal && (
              <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                <div className="bg-white rounded-xl shadow-xl max-w-md w-full mx-4 overflow-hidden">
                  <div className="px-6 py-4 border-b border-gray-100">
                    <h3 className="text-lg font-semibold text-gray-900">受け取り方法を変更</h3>
                  </div>
                  <div className="p-6 space-y-4">
                    <p className="text-sm text-gray-600">
                      現在: <span className="font-medium">{reception.deliveryMethod === 'home' ? '自宅受け取り' : '店舗受け取り'}</span>
                    </p>
                    
                    <div className="space-y-3">
                      <button
                        onClick={() => handleDeliveryMethodChange('store')}
                        disabled={reception.deliveryMethod === 'store' || isChangingDeliveryMethod}
                        className={`w-full p-4 rounded-lg border-2 text-left transition-colors ${
                          reception.deliveryMethod === 'store'
                            ? 'border-gray-200 bg-gray-50 cursor-not-allowed'
                            : 'border-blue-200 bg-blue-50 hover:border-blue-400 cursor-pointer'
                        }`}
                      >
                        <div className="flex items-center space-x-3">
                          <span className="text-2xl">🏪</span>
                          <div>
                            <p className="font-medium text-gray-900">店舗受け取り</p>
                            <p className="text-xs text-gray-500">店舗でお薬をお受け取り</p>
                          </div>
                        </div>
                      </button>
                      
                      <button
                        onClick={() => handleDeliveryMethodChange('home')}
                        disabled={reception.deliveryMethod === 'home' || isChangingDeliveryMethod}
                        className={`w-full p-4 rounded-lg border-2 text-left transition-colors ${
                          reception.deliveryMethod === 'home'
                            ? 'border-gray-200 bg-gray-50 cursor-not-allowed'
                            : 'border-green-200 bg-green-50 hover:border-green-400 cursor-pointer'
                        }`}
                      >
                        <div className="flex items-center space-x-3">
                          <span className="text-2xl">🏠</span>
                          <div>
                            <p className="font-medium text-gray-900">自宅受け取り</p>
                            <p className="text-xs text-gray-500">オンライン服薬指導後にご自宅へ配送</p>
                          </div>
                        </div>
                      </button>
                    </div>
                    
                    <div className="flex items-center space-x-2 mt-4">
                      <input
                        type="checkbox"
                        id="notifyCustomer"
                        checked={notifyCustomerOnChange}
                        onChange={(e) => setNotifyCustomerOnChange(e.target.checked)}
                        className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                      />
                      <label htmlFor="notifyCustomer" className="text-sm text-gray-700">
                        お客様にLINEで変更を通知する
                      </label>
                    </div>
                    
                    {isChangingDeliveryMethod && (
                      <div className="flex items-center justify-center space-x-2 text-blue-600">
                        <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        <span className="text-sm">変更中...</span>
                      </div>
                    )}
                  </div>
                  <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex justify-end">
                    <button
                      onClick={() => setShowDeliveryMethodModal(false)}
                      disabled={isChangingDeliveryMethod}
                      className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 transition-colors disabled:opacity-50"
                    >
                      キャンセル
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* キャンセル確認モーダル（二段階チェック） */}
            {showCancelConfirmModal && (
              <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                <div className="bg-white rounded-xl shadow-xl max-w-md w-full mx-4 overflow-hidden">
                  <div className="px-6 py-4 border-b border-gray-100">
                    <h3 className="text-lg font-semibold text-gray-900 flex items-center">
                      <span className="text-red-500 mr-2">⚠️</span>
                      {cancelConfirmStep === 1 ? '受付をキャンセルしますか？' : '最終確認'}
                    </h3>
                  </div>
                  <div className="p-6 space-y-4">
                    {cancelConfirmStep === 1 ? (
                      // 一段階目：初回確認
                      <>
                        <div className="p-4 bg-red-50 border border-red-100 rounded-lg">
                          <p className="text-sm text-red-800 font-medium mb-2">
                            以下の受付をキャンセルしようとしています：
                          </p>
                          <div className="space-y-1 text-sm text-red-700">
                            <p>・お客様: {reception.userDisplayName || 'お客様'}</p>
                            <p>・受付番号: #{reception.receptionId.slice(-6)}</p>
                            <p>・受付日時: {new Date(reception.timestamp).toLocaleString('ja-JP')}</p>
                            {reception.selectedStoreName && (
                              <p>・店舗: {reception.selectedStoreName}</p>
                            )}
                          </div>
                        </div>
                        <p className="text-sm text-gray-600">
                          キャンセルすると、お客様への対応が中断されます。
                          本当にキャンセルしてよろしいですか？
                        </p>
                      </>
                    ) : (
                      // 二段階目：最終確認
                      <>
                        <div className="p-4 bg-red-100 border border-red-200 rounded-lg">
                          <p className="text-red-800 font-bold text-center mb-2">
                            ⚠️ 最終確認 ⚠️
                          </p>
                          <p className="text-sm text-red-700 text-center">
                            この操作は取り消せません。<br />
                            本当にキャンセルしてもよろしいですか？
                          </p>
                        </div>
                        <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg">
                          <p className="text-xs text-gray-600 text-center">
                            お客様: <span className="font-medium">{reception.userDisplayName || 'お客様'}</span><br />
                            受付番号: <span className="font-medium">#{reception.receptionId.slice(-6)}</span>
                          </p>
                        </div>
                      </>
                    )}
                    
                    {isCancelling && (
                      <div className="flex items-center justify-center space-x-2 text-red-600">
                        <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        <span className="text-sm">キャンセル処理中...</span>
                      </div>
                    )}
                  </div>
                  <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex justify-between">
                    <button
                      onClick={handleCloseCancelModal}
                      disabled={isCancelling}
                      className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 transition-colors disabled:opacity-50"
                    >
                      {cancelConfirmStep === 1 ? 'やめる' : '戻る'}
                    </button>
                    <button
                      onClick={handleConfirmCancel}
                      disabled={isCancelling}
                      className={`px-4 py-2 text-sm text-white rounded-lg transition-colors disabled:opacity-50 ${
                        cancelConfirmStep === 1
                          ? 'bg-orange-500 hover:bg-orange-600'
                          : 'bg-red-600 hover:bg-red-700'
                      }`}
                    >
                      {cancelConfirmStep === 1 ? '次へ進む' : 'キャンセルを確定する'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* 店舗割振り（管理者のみ） */}
            {isAdmin ? (
              <div>
                <h3 className="text-sm font-medium text-gray-500 mb-2">受取店舗を選択</h3>
                <select
                  value={selectedStoreId}
                  onChange={(e) => setSelectedStoreId(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                >
                  <option value="">店舗を選択してください</option>
                  {stores.map((store) => (
                    <option key={store.storeId} value={store.storeId}>
                      {formatStoreName(store.storeName)}（{store.region}）
                    </option>
                  ))}
                </select>
                {selectedStoreId && selectedStoreId !== reception.selectedStoreId && (
                  <button
                    onClick={handleAssign}
                    className="mt-2 w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
                  >
                    この店舗に割振る
                  </button>
                )}
              </div>
            ) : (
              /* 店舗スタッフには現在の割り当て店舗のみ表示 */
              reception.selectedStoreName && (
                <div>
                  <h3 className="text-sm font-medium text-gray-500 mb-2">受取店舗</h3>
                  <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                    <p className="text-sm font-medium text-blue-800">
                      {formatStoreName(reception.selectedStoreName)}
                    </p>
                  </div>
                </div>
              )
            )}

            {/* スタッフメモ */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-medium text-gray-500">スタッフメモ</h3>
                {noteHasChanges && (
                  <span className="text-xs text-orange-600">未保存の変更があります</span>
                )}
              </div>
              <textarea
                value={staffNote}
                onChange={handleStaffNoteChange}
                placeholder="申し送り事項やお客様情報などのメモ"
                className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none text-sm"
                rows={2}
              />
              {onStaffNoteUpdate && (
                <button
                  onClick={handleSaveStaffNote}
                  disabled={isSavingNote || !noteHasChanges}
                  className={`mt-2 w-full px-4 py-2 rounded-lg transition-colors text-sm font-medium ${
                    isSavingNote || !noteHasChanges
                      ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                      : 'bg-blue-600 text-white hover:bg-blue-700'
                  }`}
                >
                  {isSavingNote ? 'メモを保存中...' : 'メモを保存'}
                </button>
              )}
            </div>

            {/* ステータス変更 */}
            <div>
              <h3 className="text-sm font-medium text-gray-500 mb-2">ステータス変更</h3>
              <div className="space-y-3">
                {/* ============================================ */}
                {/* 店舗スタッフ向け：シンプル化されたステータス変更 */}
                {/* 受付待ち(pending)から直接調剤開始可能 */}
                {/* ============================================ */}
                
                {/* 【店舗受け取り】受付待ち/確認済み/調剤中 → シンプルな2ボタン */}
                {reception.deliveryMethod !== 'home' && (reception.status === 'pending' || reception.status === 'confirmed' || reception.status === 'preparing') && (
                  <div className="space-y-3">
                    {/* 調剤開始ボタン */}
                    <button
                      onClick={() => onStatusChange(reception.receptionId, 'preparing')}
                      disabled={reception.status === 'preparing'}
                      className={`w-full px-4 py-3 rounded-lg transition-colors text-sm font-medium ${
                        reception.status === 'preparing'
                          ? 'bg-purple-100 text-purple-600 border-2 border-purple-400 cursor-default'
                          : 'bg-purple-600 text-white hover:bg-purple-700'
                      }`}
                    >
                      {reception.status === 'preparing' ? '✓ 調剤中' : '調剤開始'}
                    </button>
                    
                    {/* 準備完了ボタン */}
                    <button
                      onClick={() => onStatusChange(reception.receptionId, 'ready')}
                      disabled={reception.status !== 'preparing'}
                      className={`w-full px-4 py-3 rounded-lg transition-colors text-sm font-medium ${
                        reception.status !== 'preparing'
                          ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                          : 'bg-green-600 text-white hover:bg-green-700'
                      }`}
                    >
                      ✓ 準備完了・お客様にLINE通知
                    </button>
                    
                    {reception.status !== 'preparing' && (
                      <p className="text-xs text-gray-500 text-center">
                        ※ 準備完了は「調剤開始」後に押せます
                      </p>
                    )}
                    {reception.status === 'preparing' && (
                      <div className="p-3 bg-green-50 border border-green-100 rounded-lg">
                        <p className="text-xs text-green-700">
                          <span className="font-medium">「準備完了」をクリックすると:</span>
                        </p>
                        <ul className="mt-1 text-xs text-green-600 space-y-1">
                          <li>• <strong>お客様のLINEに準備完了通知が送信されます</strong></li>
                        </ul>
                      </div>
                    )}
                  </div>
                )}

                {/* 【自宅受け取り】受付待ち/確認済み/調剤中 → オンライン服薬指導開始 */}
                {reception.deliveryMethod === 'home' && (reception.status === 'pending' || reception.status === 'confirmed' || reception.status === 'preparing') && (
                  <div className="space-y-3">
                    {/* 調剤開始ボタン（調剤中でなければ表示） */}
                    {reception.status !== 'preparing' && (
                      <button
                        onClick={() => onStatusChange(reception.receptionId, 'preparing')}
                        className="w-full px-4 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors text-sm font-medium"
                      >
                        調剤開始
                      </button>
                    )}
                    {reception.status === 'preparing' && (
                      <div className="w-full px-4 py-3 bg-purple-100 text-purple-600 border-2 border-purple-400 rounded-lg text-sm font-medium text-center">
                        ✓ 調剤中
                      </div>
                    )}
                    
                    {/* オンライン服薬指導開始ボタン */}
                    <button
                      onClick={() => onStatusChange(reception.receptionId, 'video_counseling')}
                      disabled={reception.status !== 'preparing'}
                      className={`w-full px-4 py-3 rounded-lg transition-colors text-sm font-medium ${
                        reception.status !== 'preparing'
                          ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                          : 'bg-pink-600 text-white hover:bg-pink-700'
                      }`}
                    >
                      📹 オンライン服薬指導開始
                    </button>
                    
                    {reception.status !== 'preparing' && (
                      <p className="text-xs text-gray-500 text-center">
                        ※ オンライン服薬指導は「調剤開始」後に開始できます
                      </p>
                    )}
                    {reception.status === 'preparing' && (
                      <div className="p-3 bg-pink-50 border border-pink-100 rounded-lg">
                        <p className="text-xs text-pink-700">
                          <span className="font-medium">「オンライン服薬指導開始」をクリックすると:</span>
                        </p>
                        <ul className="mt-1 text-xs text-pink-600 space-y-1">
                          <li>• <strong>お客様のLINEにビデオ通話リンクが送信されます</strong></li>
                          <li>• 同時に店舗側のビデオ通話画面も開きます</li>
                        </ul>
                      </div>
                    )}
                  </div>
                )}
                
                {/* 服薬指導中 → 配送準備中（自宅受け取りのみ） */}
                {reception.status === 'video_counseling' && (
                  <div className="space-y-2">
                    <button
                      onClick={() => onStatusChange(reception.receptionId, 'shipping')}
                      className="w-full px-4 py-3 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors text-sm font-medium"
                    >
                      📦 服薬指導完了・配送準備開始
                    </button>
                    <div className="p-3 bg-orange-50 border border-orange-100 rounded-lg">
                      <p className="text-xs text-orange-700">
                        <span className="font-medium">このボタンをクリックすると:</span>
                      </p>
                      <ul className="mt-1 text-xs text-orange-600 space-y-1">
                        <li>• オンライン服薬指導が完了として記録されます</li>
                        <li>• ステータスが「配送準備中」に変更されます</li>
                        <li>• お客様のLINEに配送準備開始通知が送信されます</li>
                      </ul>
                    </div>
                    
                    {/* ビデオ通話ステータス表示 */}
                    {reception.videoCounselingStartedAt && (
                      <div className="p-2 bg-gray-50 border border-gray-200 rounded-lg">
                        <p className="text-xs text-gray-600">
                          📹 通話開始: {new Date(reception.videoCounselingStartedAt).toLocaleString('ja-JP')}
                        </p>
                      </div>
                    )}
                  </div>
                )}
                
                {/* 配送準備中 → 配送中（自宅受け取りのみ） */}
                {reception.status === 'shipping' && (
                  <div className="space-y-2">
                    <button
                      onClick={() => onStatusChange(reception.receptionId, 'shipped')}
                      className="w-full px-4 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors text-sm font-medium"
                    >
                      🚚 配送開始・お客様に通知
                    </button>
                    <div className="p-3 bg-indigo-50 border border-indigo-100 rounded-lg">
                      <p className="text-xs text-indigo-700">
                        <span className="font-medium">このボタンをクリックすると:</span>
                      </p>
                      <ul className="mt-1 text-xs text-indigo-600 space-y-1">
                        <li>• ステータスが「配送中」に変更されます</li>
                        <li>• <strong>お客様のLINEに配送開始通知が送信されます</strong></li>
                      </ul>
                    </div>
                  </div>
                )}
                
                {/* 配送中 → 配送完了（自宅受け取りのみ） */}
                {reception.status === 'shipped' && (
                  <div className="space-y-2">
                    <button
                      onClick={() => onStatusChange(reception.receptionId, 'completed')}
                      className="w-full px-4 py-3 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors text-sm font-medium"
                    >
                      ✓ 配送完了
                    </button>
                    <p className="text-xs text-gray-500">
                      お薬が配送されたらクリックしてください
                    </p>
                  </div>
                )}
                
                {/* 準備完了 → 受取完了（店舗受け取りのみ） */}
                {reception.status === 'ready' && (
                  <div className="space-y-2">
                    <button
                      onClick={() => onStatusChange(reception.receptionId, 'completed')}
                      className="w-full px-4 py-3 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors text-sm font-medium"
                    >
                      受取完了
                    </button>
                    <p className="text-xs text-gray-500">
                      お客様がお薬を受け取ったらクリックしてください
                    </p>
                  </div>
                )}
                
                {/* キャンセルボタン（二段階確認モーダルを開く） */}
                {reception.status !== 'completed' && reception.status !== 'cancelled' && (
                  <button
                    onClick={handleOpenCancelModal}
                    className="w-full px-4 py-2 bg-red-50 text-red-700 rounded-lg hover:bg-red-100 transition-colors text-sm border border-red-200"
                  >
                    この受付をキャンセル
                  </button>
                )}
              </div>
            </div>

            {/* クイックアクションボタン */}
            {reception.status !== 'completed' && reception.status !== 'cancelled' ? (
              <div className="pt-2 space-y-2">
                {/* メッセージボタン */}
                <button
                  onClick={() => setActiveTab('message')}
                  className="w-full flex items-center justify-center space-x-2 px-4 py-3 bg-gacky-green text-white rounded-lg hover:bg-green-600 transition-colors font-medium"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                  <span>お客様にメッセージを送る</span>
                  {reception.messagingSessionStatus === 'active' && (
                    <span className="ml-2 flex items-center">
                      <span className="w-2 h-2 bg-white rounded-full animate-pulse"></span>
                    </span>
                  )}
                </button>
                
                {/* ビデオ通話ボタン */}
                {onStartVideoCall && (
                  <button
                    onClick={handleStartVideoCall}
                    disabled={isStartingVideoCall}
                    className="w-full flex items-center justify-center space-x-2 px-4 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isStartingVideoCall ? (
                      <>
                        <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        <span>通話を開始中...</span>
                      </>
                    ) : (
                      <>
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                        <span>お客様とビデオ通話する</span>
                      </>
                    )}
                  </button>
                )}
                
                {/* オンライン服薬指導の説明 */}
                {onStartVideoCall && (
                  <div className="p-3 bg-blue-50 border border-blue-100 rounded-lg">
                    <p className="text-xs text-blue-700">
                      <span className="font-medium">ビデオ通話について:</span>
                    </p>
                    <ul className="mt-1 text-xs text-blue-600 space-y-1">
                      <li>• お客様のLINEに通話リンクが送信されます</li>
                      <li>• オンライン服薬指導に使用できます</li>
                      <li>• 通話にはカメラとマイクの許可が必要です</li>
                    </ul>
                  </div>
                )}
              </div>
            ) : (
              <div className="pt-2 p-3 bg-gray-100 rounded-lg text-center">
                <p className="text-sm text-gray-500">
                  {reception.status === 'completed' ? '受取完了' : 'キャンセル'}済みのため、メッセージ・通話は利用できません
                </p>
              </div>
            )}
          </div>
        ) : (
          // メッセージタブの内容
          <MessagePanel
            receptionId={reception.receptionId}
            customerName={reception.userDisplayName || 'お客様'}
            messages={messages}
            onSendMessage={handleSendMessageWrapper}
            isEmbedded={true}
            readOnly={reception.status === 'completed' || reception.status === 'cancelled'}
            readOnlyReason={
              reception.status === 'completed' 
                ? '受取完了済みのため、メッセージは送信できません' 
                : reception.status === 'cancelled'
                ? 'キャンセル済みのため、メッセージは送信できません'
                : ''
            }
            messagingSessionStatus={reception.messagingSessionStatus}
          />
        )}
      </div>
    </div>
  );
}
