'use client';

import { useState } from 'react';
import { PrescriptionReception, ReceptionStatus } from '@/types/prescription';

interface ReceptionListProps {
  receptions: PrescriptionReception[];
  onSelect: (reception: PrescriptionReception) => void;
  selectedId?: string;
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
  pending: 'status-pending',
  confirmed: 'status-confirmed',
  preparing: 'status-preparing',
  ready: 'status-ready',
  video_counseling: 'status-video-counseling',
  shipping: 'status-shipping',
  shipped: 'status-shipped',
  completed: 'status-completed',
  cancelled: 'status-cancelled',
};

export default function ReceptionList({ receptions, onSelect, selectedId }: ReceptionListProps) {
  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
  };

  const formatDate = (timestamp: string) => {
    const date = new Date(timestamp);
    const today = new Date();
    if (date.toDateString() === today.toDateString()) {
      return '今日';
    }
    return date.toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' });
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100">
      <div className="px-6 py-4 border-b border-gray-100">
        <h2 className="text-lg font-semibold text-gray-900">受付一覧</h2>
      </div>
      
      <div className="divide-y divide-gray-100">
        {receptions.length === 0 ? (
          <div className="px-6 py-12 text-center text-gray-500">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 mx-auto mb-4 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p>受付データがありません</p>
          </div>
        ) : (
          receptions.map((reception) => (
            <div
              key={reception.receptionId}
              className={`px-6 py-4 cursor-pointer hover:bg-gray-50 transition-colors ${
                selectedId === reception.receptionId ? 'bg-blue-50 border-l-4 border-blue-500' : ''
              }`}
              onClick={() => onSelect(reception)}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-4">
                  {/* プロフィール画像 */}
                  <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center overflow-hidden">
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
                      {reception.userDisplayName || `お客様 #${reception.receptionId.slice(-4)}`}
                    </p>
                    <p className="text-sm text-gray-500">
                      {formatDate(reception.timestamp)} {formatTime(reception.timestamp)}
                      {reception.selectedStoreName && (
                        <span className="ml-2 text-blue-600">→ {reception.selectedStoreName}</span>
                      )}
                    </p>
                  </div>
                </div>
                
                <div className="flex items-center space-x-3">
                  {/* 受け取り方法アイコン */}
                  <span 
                    className={`text-lg flex-shrink-0 ${
                      reception.deliveryMethod === 'home' 
                        ? 'opacity-100' 
                        : 'opacity-50'
                    }`}
                    title={reception.deliveryMethod === 'home' ? '自宅受け取り' : '店舗受け取り'}
                  >
                    {reception.deliveryMethod === 'home' ? '🏠' : '🏪'}
                  </span>

                  {/* 未読メッセージバッジ */}
                  {reception.unreadMessageCount && reception.unreadMessageCount > 0 && (
                    <span className="bg-red-500 text-white text-xs font-bold rounded-full min-w-[20px] h-5 px-1.5 flex items-center justify-center">
                      {reception.unreadMessageCount > 9 ? '9+' : reception.unreadMessageCount}
                    </span>
                  )}
                  
                  {/* メッセージ中インジケータ */}
                  {reception.messagingSessionStatus === 'active' && (
                    <span className="flex items-center text-xs text-orange-600">
                      <span className="w-2 h-2 bg-orange-500 rounded-full animate-pulse mr-1"></span>
                      やりとり中
                    </span>
                  )}
                  
                  {/* ステータスバッジ */}
                  <span className={`status-badge ${statusColors[reception.status]}`}>
                    {statusLabels[reception.status]}
                  </span>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
