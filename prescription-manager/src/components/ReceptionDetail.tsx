'use client';

import { useState } from 'react';
import { PrescriptionReception, ReceptionStatus, Store } from '@/types/prescription';
import MessagePanel from './MessagePanel';

interface ReceptionDetailProps {
  reception: PrescriptionReception;
  stores: Store[];
  onStatusChange: (receptionId: string, newStatus: ReceptionStatus) => void;
  onStoreAssign: (receptionId: string, storeId: string) => void;
  onSendMessage: (receptionId: string, message: string) => void;
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

export default function ReceptionDetail({
  reception,
  stores,
  onStatusChange,
  onStoreAssign,
  onSendMessage,
  onClose,
}: ReceptionDetailProps) {
  const [selectedStoreId, setSelectedStoreId] = useState(reception.selectedStoreId || '');
  const [staffNote, setStaffNote] = useState(reception.staffNote || '');
  const [showMessagePanel, setShowMessagePanel] = useState(false);

  const handleAssign = () => {
    if (selectedStoreId) {
      onStoreAssign(reception.receptionId, selectedStoreId);
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 h-full flex flex-col">
      {/* ヘッダー */}
      <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">
          受付詳細 #{reception.receptionId.slice(-6)}
        </h2>
        <button
          onClick={onClose}
          className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* コンテンツ */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* お客様情報 */}
        <div>
          <h3 className="text-sm font-medium text-gray-500 mb-3">お客様情報</h3>
          <div className="flex items-center space-x-4">
            <div className="w-12 h-12 rounded-full bg-gray-200 flex items-center justify-center overflow-hidden">
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
              <p className="font-medium text-gray-900">
                {reception.userDisplayName || 'お客様'}
              </p>
              <p className="text-sm text-gray-500">
                受付: {new Date(reception.timestamp).toLocaleString('ja-JP')}
              </p>
            </div>
          </div>
          {reception.customerNote && (
            <div className="mt-3 p-3 bg-yellow-50 rounded-lg">
              <p className="text-sm text-yellow-800">
                <span className="font-medium">お客様メモ: </span>
                {reception.customerNote}
              </p>
            </div>
          )}
        </div>

        {/* 処方箋画像 */}
        <div>
          <h3 className="text-sm font-medium text-gray-500 mb-3">処方箋画像</h3>
          <div className="border rounded-lg overflow-hidden bg-gray-50">
            {reception.prescriptionImageUrl ? (
              <img
                src={reception.prescriptionImageUrl}
                alt="処方箋"
                className="w-full h-auto max-h-80 object-contain"
              />
            ) : (
              <div className="h-48 flex items-center justify-center text-gray-400">
                画像なし
              </div>
            )}
          </div>
          {reception.ocrResult && (
            <div className="mt-2 p-3 bg-gray-50 rounded-lg">
              <p className="text-xs text-gray-500 mb-1">OCR読取結果（参考）</p>
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{reception.ocrResult}</p>
            </div>
          )}
        </div>

        {/* 店舗割振り */}
        <div>
          <h3 className="text-sm font-medium text-gray-500 mb-3">店舗割振り</h3>
          <select
            value={selectedStoreId}
            onChange={(e) => setSelectedStoreId(e.target.value)}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="">店舗を選択...</option>
            {stores.map((store) => (
              <option key={store.storeId} value={store.storeId}>
                あおぞら薬局 {store.storeName}店（{store.region}）
              </option>
            ))}
          </select>
          {selectedStoreId && selectedStoreId !== reception.selectedStoreId && (
            <button
              onClick={handleAssign}
              className="mt-2 w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              この店舗に割振る
            </button>
          )}
        </div>

        {/* 管理者メモ */}
        <div>
          <h3 className="text-sm font-medium text-gray-500 mb-3">管理者メモ</h3>
          <textarea
            value={staffNote}
            onChange={(e) => setStaffNote(e.target.value)}
            placeholder="店舗への申し送り事項など"
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
            rows={3}
          />
        </div>

        {/* ステータス変更 */}
        <div>
          <h3 className="text-sm font-medium text-gray-500 mb-3">ステータス変更</h3>
          <div className="grid grid-cols-2 gap-2">
            {reception.status === 'pending' && (
              <button
                onClick={() => onStatusChange(reception.receptionId, 'confirmed')}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                disabled={!selectedStoreId}
              >
                確認OK・店舗に送信
              </button>
            )}
            {reception.status === 'confirmed' && (
              <button
                onClick={() => onStatusChange(reception.receptionId, 'preparing')}
                className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
              >
                調剤開始
              </button>
            )}
            {reception.status === 'preparing' && (
              <button
                onClick={() => onStatusChange(reception.receptionId, 'ready')}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
              >
                準備完了・お客様に通知
              </button>
            )}
            {reception.status === 'ready' && (
              <button
                onClick={() => onStatusChange(reception.receptionId, 'completed')}
                className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
              >
                受取完了
              </button>
            )}
            {reception.status !== 'completed' && reception.status !== 'cancelled' && (
              <button
                onClick={() => onStatusChange(reception.receptionId, 'cancelled')}
                className="px-4 py-2 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 transition-colors"
              >
                キャンセル
              </button>
            )}
          </div>
        </div>
      </div>

      {/* メッセージパネルトグル */}
      <div className="border-t border-gray-100 p-4">
        <button
          onClick={() => setShowMessagePanel(!showMessagePanel)}
          className="w-full flex items-center justify-center space-x-2 px-4 py-3 bg-gacky-green text-white rounded-lg hover:bg-green-600 transition-colors"
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
      </div>

      {/* メッセージパネル */}
      {showMessagePanel && (
        <MessagePanel
          receptionId={reception.receptionId}
          customerName={reception.userDisplayName || 'お客様'}
          onSendMessage={(message) => onSendMessage(reception.receptionId, message)}
          onClose={() => setShowMessagePanel(false)}
        />
      )}
    </div>
  );
}
