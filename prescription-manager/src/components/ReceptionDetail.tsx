'use client';

import { useState, useEffect } from 'react';
import { PrescriptionReception, ReceptionStatus, Store, PrescriptionMessage } from '@/types/prescription';
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
  onClose: () => void;
}

const statusLabels: Record<ReceptionStatus, string> = {
  pending: '受付待ち',
  confirmed: '確認済み',
  preparing: '調剤中',
  ready: '準備完了',
  completed: '受取完了',
  cancelled: 'キャンセル',
};

const statusColors: Record<ReceptionStatus, string> = {
  pending: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  confirmed: 'bg-blue-100 text-blue-800 border-blue-200',
  preparing: 'bg-purple-100 text-purple-800 border-purple-200',
  ready: 'bg-green-100 text-green-800 border-green-200',
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
  onClose,
}: ReceptionDetailProps) {
  const [selectedStoreId, setSelectedStoreId] = useState(reception.selectedStoreId || '');
  const [staffNote, setStaffNote] = useState(reception.staffNote || '');
  const [activeTab, setActiveTab] = useState<'info' | 'message'>('info');
  const [isReactivating, setIsReactivating] = useState(false);
  const [isStartingVideoCall, setIsStartingVideoCall] = useState(false);

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

  // reception変更時にstateを更新
  useEffect(() => {
    setSelectedStoreId(reception.selectedStoreId || '');
    setStaffNote(reception.staffNote || '');
  }, [reception.receptionId, reception.selectedStoreId, reception.staffNote]);

  const handleAssign = () => {
    if (selectedStoreId) {
      onStoreAssign(reception.receptionId, selectedStoreId);
    }
  };

  const handleSendMessageWrapper = async (message: string) => {
    await onSendMessage(reception.receptionId, message);
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
          onClick={() => setActiveTab('info')}
          className={`flex-1 py-3 text-sm font-medium transition-colors ${
            activeTab === 'info'
              ? 'text-blue-600 border-b-2 border-blue-600'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          受付情報
        </button>
        <button
          onClick={() => setActiveTab('message')}
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

            {/* 店舗割振り */}
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
              {reception.selectedStoreId && (
                <p className="mt-1 text-xs text-gray-500">
                  現在の割当: {formatStoreName(reception.selectedStoreName || '')}
                </p>
              )}
              {selectedStoreId && selectedStoreId !== reception.selectedStoreId && (
                <button
                  onClick={handleAssign}
                  className="mt-2 w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
                >
                  この店舗に割振る
                </button>
              )}
            </div>

            {/* 管理者メモ */}
            <div>
              <h3 className="text-sm font-medium text-gray-500 mb-2">管理者メモ</h3>
              <textarea
                value={staffNote}
                onChange={(e) => setStaffNote(e.target.value)}
                placeholder="店舗への申し送り事項など"
                className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none text-sm"
                rows={2}
              />
            </div>

            {/* ステータス変更 */}
            <div>
              <h3 className="text-sm font-medium text-gray-500 mb-2">ステータス変更</h3>
              <div className="space-y-3">
                {reception.status === 'pending' && (
                  <div className="space-y-2">
                    <button
                      onClick={() => onStatusChange(reception.receptionId, 'confirmed')}
                      className="w-full px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                      disabled={!selectedStoreId}
                    >
                      ✓ 確認OK・店舗に送信
                    </button>
                    <div className="p-3 bg-blue-50 border border-blue-100 rounded-lg">
                      <p className="text-xs text-blue-700">
                        <span className="font-medium">このボタンをクリックすると:</span>
                      </p>
                      <ul className="mt-1 text-xs text-blue-600 space-y-1">
                        <li>• ステータスが「確認済み」に変更されます</li>
                        <li>• 選択した店舗に処方箋が割り当てられます</li>
                        <li>• 店舗スタッフが調剤を開始できるようになります</li>
                      </ul>
                      {!selectedStoreId && (
                        <p className="mt-2 text-xs text-orange-600 font-medium">
                          ⚠ 先に店舗を選択してください
                        </p>
                      )}
                    </div>
                  </div>
                )}
                {reception.status === 'confirmed' && (
                  <div className="space-y-2">
                    <button
                      onClick={() => onStatusChange(reception.receptionId, 'preparing')}
                      className="w-full px-4 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors text-sm font-medium"
                    >
                      調剤開始
                    </button>
                    <p className="text-xs text-gray-500">
                      調剤を開始したらクリックしてください
                    </p>
                  </div>
                )}
                {reception.status === 'preparing' && (
                  <div className="space-y-2">
                    <button
                      onClick={() => onStatusChange(reception.receptionId, 'ready')}
                      className="w-full px-4 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm font-medium"
                    >
                      ✓ 準備完了・お客様にLINE通知
                    </button>
                    <div className="p-3 bg-green-50 border border-green-100 rounded-lg">
                      <p className="text-xs text-green-700">
                        <span className="font-medium">このボタンをクリックすると:</span>
                      </p>
                      <ul className="mt-1 text-xs text-green-600 space-y-1">
                        <li>• ステータスが「準備完了」に変更されます</li>
                        <li>• <strong>お客様のLINEに準備完了通知が送信されます</strong></li>
                      </ul>
                    </div>
                  </div>
                )}
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
                {reception.status !== 'completed' && reception.status !== 'cancelled' && (
                  <button
                    onClick={() => onStatusChange(reception.receptionId, 'cancelled')}
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
