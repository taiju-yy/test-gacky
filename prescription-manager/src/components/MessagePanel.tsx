'use client';

import { useState, useEffect, useRef } from 'react';
import { PrescriptionMessage } from '@/types/prescription';

interface MessagePanelProps {
  receptionId: string;
  customerName: string;
  onSendMessage: (message: string) => void;
  onClose: () => void;
}

// デモ用のメッセージデータ
const demoMessages: PrescriptionMessage[] = [];

export default function MessagePanel({
  receptionId,
  customerName,
  onSendMessage,
  onClose,
}: MessagePanelProps) {
  const [messages, setMessages] = useState<PrescriptionMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // メッセージ読み込み（デモ用）
  useEffect(() => {
    // 実際の実装ではAPIからメッセージを取得
    setMessages(demoMessages);
  }, [receptionId]);

  // 新しいメッセージが追加されたらスクロール
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    if (!newMessage.trim()) return;

    setIsLoading(true);
    
    // 新しいメッセージを追加（楽観的更新）
    const newMsg: PrescriptionMessage = {
      receptionId,
      messageId: Date.now().toString(),
      timestamp: new Date().toISOString(),
      senderType: 'store',
      senderId: 'staff_001',
      senderName: 'スタッフ',
      messageType: 'text',
      content: newMessage,
      lineDelivered: false,
      readByCustomer: false,
      readByStore: true,
      ttl: Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60,
    };

    setMessages((prev) => [...prev, newMsg]);
    setNewMessage('');

    // API呼び出し
    try {
      await onSendMessage(newMessage);
      // 送信成功後、lineDeliveredを更新
      setMessages((prev) =>
        prev.map((msg) =>
          msg.messageId === newMsg.messageId
            ? { ...msg, lineDelivered: true, lineDeliveredAt: new Date().toISOString() }
            : msg
        )
      );
    } catch (error) {
      console.error('メッセージ送信エラー:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const formatTime = (timestamp: string) => {
    return new Date(timestamp).toLocaleTimeString('ja-JP', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[80vh] flex flex-col">
        {/* ヘッダー */}
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-gray-900">{customerName}様とのメッセージ</h3>
            <p className="text-xs text-gray-500">
              このメッセージはGacky経由でお客様のLINEに送信されます
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 注意事項 */}
        <div className="px-4 py-2 bg-yellow-50 border-b border-yellow-100">
          <p className="text-xs text-yellow-700 flex items-center">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            店舗からのメッセージ送信中は、お客様へのAI自動応答が一時的に停止されます
          </p>
        </div>

        {/* メッセージリスト */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-50">
          {messages.length === 0 ? (
            <div className="text-center text-gray-400 py-8">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
              <p>まだメッセージはありません</p>
              <p className="text-sm mt-1">お客様にメッセージを送信してみましょう</p>
            </div>
          ) : (
            messages.map((msg) => (
              <div
                key={msg.messageId}
                className={`flex ${msg.senderType === 'store' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[80%] px-4 py-2 ${
                    msg.senderType === 'store'
                      ? 'message-store ml-auto'
                      : msg.senderType === 'customer'
                      ? 'message-customer'
                      : 'message-system w-full'
                  }`}
                >
                  {msg.senderType !== 'system' && (
                    <p className="text-xs opacity-70 mb-1">{msg.senderName}</p>
                  )}
                  <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                  <div className="flex items-center justify-end mt-1 space-x-1">
                    <span className="text-xs opacity-50">{formatTime(msg.timestamp)}</span>
                    {msg.senderType === 'store' && (
                      <span className="text-xs">
                        {msg.lineDelivered ? (
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                        ) : (
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 text-gray-400 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                        )}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* 入力エリア */}
        <div className="p-4 border-t border-gray-100 bg-white">
          <div className="flex space-x-2">
            <input
              type="text"
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
              placeholder="メッセージを入力..."
              className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              disabled={isLoading}
            />
            <button
              onClick={handleSend}
              disabled={isLoading || !newMessage.trim()}
              className="px-4 py-2 bg-gacky-green text-white rounded-lg hover:bg-green-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
          <p className="text-xs text-gray-400 mt-2">
            Enter で送信
          </p>
        </div>
      </div>
    </div>
  );
}
