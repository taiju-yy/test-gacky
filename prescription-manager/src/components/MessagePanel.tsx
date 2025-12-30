'use client';

import { useState, useEffect, useRef } from 'react';
import { PrescriptionMessage } from '@/types/prescription';

interface MessagePanelProps {
  receptionId: string;
  customerName: string;
  messages: PrescriptionMessage[];
  onSendMessage: (message: string) => Promise<void>;
  isEmbedded?: boolean; // インライン表示モード
  readOnly?: boolean; // メッセージ送信を無効化（キャンセル・完了時）
  readOnlyReason?: string; // 無効化の理由
}

export default function MessagePanel({
  receptionId,
  customerName,
  messages,
  onSendMessage,
  isEmbedded = false,
  readOnly = false,
  readOnlyReason = '',
}: MessagePanelProps) {
  const [newMessage, setNewMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 新しいメッセージが追加されたらスクロール
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    if (!newMessage.trim() || isLoading) return;

    setIsLoading(true);
    try {
      await onSendMessage(newMessage.trim());
      setNewMessage('');
    } catch (error) {
      console.error('メッセージ送信エラー:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const formatTime = (timestamp: string) => {
    return new Date(timestamp).toLocaleTimeString('ja-JP', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatDate = (timestamp: string) => {
    return new Date(timestamp).toLocaleDateString('ja-JP', {
      month: 'short',
      day: 'numeric',
    });
  };

  // メッセージをtimestampで時系列順（昇順）にソート
  const sortMessagesByTimestamp = (msgs: PrescriptionMessage[]): PrescriptionMessage[] => {
    return [...msgs].sort((a, b) => {
      const timeA = new Date(a.timestamp).getTime();
      const timeB = new Date(b.timestamp).getTime();
      return timeA - timeB;
    });
  };

  // メッセージを日付ごとにグループ化
  const groupMessagesByDate = (msgs: PrescriptionMessage[]) => {
    const groups: { [key: string]: PrescriptionMessage[] } = {};
    msgs.forEach((msg) => {
      const dateKey = new Date(msg.timestamp).toDateString();
      if (!groups[dateKey]) {
        groups[dateKey] = [];
      }
      groups[dateKey].push(msg);
    });
    return groups;
  };

  // まずソートしてからグループ化
  const sortedMessages = sortMessagesByTimestamp(messages);
  const messageGroups = groupMessagesByDate(sortedMessages);

  return (
    <div className={`flex flex-col ${isEmbedded ? 'h-full' : 'h-96'}`}>
      {/* ヘッダー */}
      <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gacky-green" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            <h3 className="font-medium text-gray-900 text-sm">{customerName}様とのやりとり</h3>
          </div>
          <span className="text-xs text-gray-500 bg-yellow-100 text-yellow-700 px-2 py-1 rounded">
            AI応答停止中
          </span>
        </div>
      </div>

      {/* 注意事項 */}
      <div className="px-3 py-2 bg-blue-50 border-b border-blue-100">
        <p className="text-xs text-blue-700 flex items-center">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          メッセージはGacky経由でお客様のLINEに送信されます
        </p>
      </div>

      {/* メッセージリスト */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50">
        {messages.length === 0 ? (
          <div className="text-center text-gray-400 py-8">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            <p className="text-sm">メッセージはありません</p>
            <p className="text-xs mt-1">お客様にメッセージを送信してみましょう</p>
          </div>
        ) : (
          Object.entries(messageGroups).map(([dateKey, msgs]) => (
            <div key={dateKey}>
              {/* 日付区切り */}
              <div className="flex items-center justify-center my-3">
                <div className="bg-gray-200 text-gray-600 text-xs px-3 py-1 rounded-full">
                  {formatDate(msgs[0].timestamp)}
                </div>
              </div>
              
              {/* メッセージ */}
              <div className="space-y-2">
                {msgs.map((msg) => (
                  <div
                    key={msg.messageId}
                    className={`flex ${msg.senderType === 'store' ? 'justify-end' : msg.senderType === 'customer' ? 'justify-start' : 'justify-center'}`}
                  >
                    {msg.senderType === 'system' ? (
                      <div className="bg-gray-100 text-gray-500 text-xs px-3 py-1 rounded-full">
                        {msg.content}
                      </div>
                    ) : (
                      <div className={`flex items-end space-x-2 max-w-[85%] ${msg.senderType === 'store' ? 'flex-row-reverse space-x-reverse' : ''}`}>
                        {/* アバター（顧客のみ） */}
                        {msg.senderType === 'customer' && (
                          <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                            </svg>
                          </div>
                        )}
                        
                        <div className={`flex flex-col ${msg.senderType === 'store' ? 'items-end' : 'items-start'}`}>
                          <div
                            className={`px-4 py-2 ${
                              msg.senderType === 'store'
                                ? 'bg-blue-500 text-white rounded-2xl rounded-br-md'
                                : 'bg-white text-gray-900 rounded-2xl rounded-bl-md shadow-sm border border-gray-100'
                            }`}
                          >
                            <p className="text-sm whitespace-pre-wrap break-words">{msg.content}</p>
                          </div>
                          <div className={`flex items-center mt-1 space-x-1 ${msg.senderType === 'store' ? 'flex-row-reverse space-x-reverse' : ''}`}>
                            <span className="text-xs text-gray-400">{formatTime(msg.timestamp)}</span>
                            {msg.senderType === 'store' && (
                              <span className="text-xs">
                                {msg.lineDelivered ? (
                                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                  </svg>
                                ) : (
                                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 text-gray-300 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                  </svg>
                                )}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* 入力エリア */}
      <div className="p-3 border-t border-gray-100 bg-white">
        {readOnly ? (
          /* 読み取り専用モード（キャンセル・完了時） */
          <div className="bg-gray-100 rounded-lg p-3 text-center">
            <div className="flex items-center justify-center space-x-2 text-gray-500">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
              </svg>
              <span className="text-sm font-medium">
                {readOnlyReason || 'メッセージ送信は無効になっています'}
              </span>
            </div>
          </div>
        ) : (
          /* 通常の入力エリア */
          <div className="flex space-x-2">
            <input
              type="text"
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="メッセージを入力..."
              className="flex-1 px-4 py-2 border border-gray-200 rounded-full focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
              disabled={isLoading}
            />
            <button
              onClick={handleSend}
              disabled={isLoading || !newMessage.trim()}
              className="px-4 py-2 bg-blue-500 text-white rounded-full hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
            >
              {isLoading ? (
                <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
