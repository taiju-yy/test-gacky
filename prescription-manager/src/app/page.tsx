'use client';

import { useState, useEffect, useCallback } from 'react';
import Header from '@/components/Header';
import StatCard from '@/components/StatCard';
import ReceptionList from '@/components/ReceptionList';
import ReceptionDetail from '@/components/ReceptionDetail';
import { PrescriptionReception, ReceptionStatus, Store, DashboardStats, PrescriptionMessage } from '@/types/prescription';

export default function Dashboard() {
  const [receptions, setReceptions] = useState<PrescriptionReception[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [selectedReception, setSelectedReception] = useState<PrescriptionReception | null>(null);
  const [filterStatus, setFilterStatus] = useState<ReceptionStatus | 'all'>('all');
  const [messages, setMessages] = useState<Record<string, PrescriptionMessage[]>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 受付一覧を取得
  const fetchReceptions = useCallback(async () => {
    try {
      const response = await fetch('/api/receptions');
      const data = await response.json();
      
      if (data.success) {
        setReceptions(data.data);
        setError(null);
      } else {
        setError(data.error || 'データの取得に失敗しました');
      }
    } catch (err) {
      console.error('Error fetching receptions:', err);
      setError('サーバーとの通信に失敗しました');
    } finally {
      setIsLoading(false);
    }
  }, []);

  // 店舗一覧を取得
  const fetchStores = useCallback(async () => {
    try {
      const response = await fetch('/api/stores');
      const data = await response.json();
      
      if (data.success) {
        setStores(data.data);
      }
    } catch (err) {
      console.error('Error fetching stores:', err);
    }
  }, []);

  // メッセージを取得
  const fetchMessages = useCallback(async (receptionId: string) => {
    try {
      const response = await fetch(`/api/messages?receptionId=${receptionId}`);
      const data = await response.json();
      
      if (data.success) {
        setMessages((prev) => ({
          ...prev,
          [receptionId]: data.data,
        }));
      }
    } catch (err) {
      console.error('Error fetching messages:', err);
    }
  }, []);

  // 初期データ取得
  useEffect(() => {
    fetchReceptions();
    fetchStores();
  }, [fetchReceptions, fetchStores]);

  // 定期的に受付一覧を更新（60秒ごと）
  // コスト抑制のため30秒から60秒に変更
  useEffect(() => {
    const interval = setInterval(() => {
      fetchReceptions();
    }, 60000);

    return () => clearInterval(interval);
  }, [fetchReceptions]);

  // 統計計算
  const stats: DashboardStats = {
    pendingCount: receptions.filter((r) => r.status === 'pending').length,
    preparingCount: receptions.filter((r) => r.status === 'preparing' || r.status === 'confirmed').length,
    readyCount: receptions.filter((r) => r.status === 'ready').length,
    todayTotal: receptions.length,
  };

  // フィルタリングされた受付リスト
  const filteredReceptions =
    filterStatus === 'all'
      ? receptions
      : receptions.filter((r) => {
          if (filterStatus === 'preparing') {
            return r.status === 'preparing' || r.status === 'confirmed';
          }
          return r.status === filterStatus;
        });

  // 選択中の受付のメッセージを取得
  const selectedReceptionMessages = selectedReception
    ? messages[selectedReception.receptionId] || []
    : [];

  // ステータス変更ハンドラ
  const handleStatusChange = async (receptionId: string, newStatus: ReceptionStatus) => {
    const reception = receptions.find((r) => r.receptionId === receptionId);
    if (!reception) return;

    // 楽観的更新
    setReceptions((prev) =>
      prev.map((r) =>
        r.receptionId === receptionId
          ? {
              ...r,
              status: newStatus,
              ...(newStatus === 'confirmed' && { confirmedAt: new Date().toISOString() }),
              ...(newStatus === 'ready' && { readyAt: new Date().toISOString() }),
              ...(newStatus === 'completed' && { 
                completedAt: new Date().toISOString(),
                messagingSessionStatus: 'closed' as const,
              }),
              ...(newStatus === 'cancelled' && { 
                messagingSessionStatus: 'closed' as const,
              }),
            }
          : r
      )
    );

    // 選択中の受付も更新
    if (selectedReception?.receptionId === receptionId) {
      setSelectedReception((prev) =>
        prev ? { 
          ...prev, 
          status: newStatus,
          ...(newStatus === 'completed' && { messagingSessionStatus: 'closed' as const }),
          ...(newStatus === 'cancelled' && { messagingSessionStatus: 'closed' as const }),
        } : null
      );
    }

    // API呼び出し
    try {
      const response = await fetch(`/api/receptions/${receptionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'updateStatus',
          timestamp: reception.timestamp,
          status: newStatus,
          userId: reception.userId,
          selectedStoreName: reception.selectedStoreName,
        }),
      });

      const data = await response.json();
      if (!data.success) {
        console.error('Failed to update status:', data.error);
        // エラー時はリフェッチ
        fetchReceptions();
      }
    } catch (err) {
      console.error('Error updating status:', err);
      fetchReceptions();
    }

    // 準備完了の場合、システムメッセージを追加
    if (newStatus === 'ready') {
      const systemMessage: PrescriptionMessage = {
        receptionId,
        messageId: `msg_system_${Date.now()}`,
        timestamp: new Date().toISOString(),
        senderType: 'system',
        senderId: 'system',
        senderName: 'システム',
        messageType: 'text',
        content: '準備完了通知をお客様に送信しました',
        lineDelivered: true,
        readByCustomer: true,
        readByStore: true,
        ttl: Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60,
      };
      setMessages((prev) => ({
        ...prev,
        [receptionId]: [...(prev[receptionId] || []), systemMessage],
      }));
    }
  };

  // 店舗割振りハンドラ
  const handleStoreAssign = async (receptionId: string, storeId: string) => {
    const store = stores.find((s) => s.storeId === storeId);
    const reception = receptions.find((r) => r.receptionId === receptionId);
    if (!store || !reception) return;

    // 楽観的更新
    setReceptions((prev) =>
      prev.map((r) =>
        r.receptionId === receptionId
          ? {
              ...r,
              selectedStoreId: storeId,
              selectedStoreName: store.storeName,
              assignedAt: new Date().toISOString(),
            }
          : r
      )
    );

    if (selectedReception?.receptionId === receptionId) {
      setSelectedReception((prev) =>
        prev
          ? {
              ...prev,
              selectedStoreId: storeId,
              selectedStoreName: store.storeName,
            }
          : null
      );
    }

    // API呼び出し
    try {
      await fetch(`/api/receptions/${receptionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'assignStore',
          timestamp: reception.timestamp,
          storeId,
          storeName: store.storeName,
        }),
      });
    } catch (err) {
      console.error('Error assigning store:', err);
      fetchReceptions();
    }
  };

  // メッセージ送信ハンドラ
  const handleSendMessage = async (receptionId: string, messageContent: string) => {
    const reception = receptions.find((r) => r.receptionId === receptionId);
    if (!reception) return;

    // 新しいメッセージを作成（楽観的更新）
    const newMessage: PrescriptionMessage = {
      receptionId,
      messageId: `msg_${Date.now()}`,
      timestamp: new Date().toISOString(),
      senderType: 'store',
      senderId: 'staff_001',
      senderName: reception.selectedStoreName || '管理者',
      messageType: 'text',
      content: messageContent,
      lineDelivered: false,
      readByCustomer: false,
      readByStore: true,
      ttl: Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60,
    };

    // メッセージを追加
    setMessages((prev) => ({
      ...prev,
      [receptionId]: [...(prev[receptionId] || []), newMessage],
    }));

    // メッセージセッションをアクティブに
    setReceptions((prev) =>
      prev.map((r) =>
        r.receptionId === receptionId
          ? { 
              ...r, 
              messagingSessionStatus: 'active' as const,
              lastMessage: {
                content: messageContent,
                timestamp: new Date().toISOString(),
                senderType: 'store' as const,
              },
            }
          : r
      )
    );

    if (selectedReception?.receptionId === receptionId) {
      setSelectedReception((prev) =>
        prev
          ? { 
              ...prev, 
              messagingSessionStatus: 'active' as const,
              lastMessage: {
                content: messageContent,
                timestamp: new Date().toISOString(),
                senderType: 'store' as const,
              },
            }
          : null
      );
    }

    // API呼び出し
    try {
      const response = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          receptionId,
          userId: reception.userId,
          storeId: reception.selectedStoreId,
          storeName: reception.selectedStoreName,
          content: messageContent,
          timestamp: reception.timestamp,
        }),
      });

      const data = await response.json();
      
      // LINE送信結果を反映
      if (data.success && data.data.lineDelivered) {
        setMessages((prev) => ({
          ...prev,
          [receptionId]: prev[receptionId].map((msg) =>
            msg.messageId === newMessage.messageId
              ? { ...msg, lineDelivered: true, lineDeliveredAt: new Date().toISOString() }
              : msg
          ),
        }));
      }
    } catch (err) {
      console.error('Error sending message:', err);
    }
  };

  // 受付選択時に未読をクリアしてメッセージを取得
  const handleSelectReception = (reception: PrescriptionReception) => {
    setSelectedReception(reception);
    
    // メッセージを取得
    fetchMessages(reception.receptionId);
    
    // 未読メッセージをクリア
    if (reception.unreadMessageCount && reception.unreadMessageCount > 0) {
      setReceptions((prev) =>
        prev.map((r) =>
          r.receptionId === reception.receptionId
            ? { ...r, unreadMessageCount: 0 }
            : r
        )
      );
      
      // メッセージの既読状態も更新
      setMessages((prev) => ({
        ...prev,
        [reception.receptionId]: (prev[reception.receptionId] || []).map((msg) => ({
          ...msg,
          readByStore: true,
        })),
      }));

      // API呼び出し（既読更新）
      const unreadMessageIds = (messages[reception.receptionId] || [])
        .filter((msg) => !msg.readByStore)
        .map((msg) => msg.messageId);
      
      if (unreadMessageIds.length > 0) {
        fetch('/api/messages', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            receptionId: reception.receptionId,
            messageIds: unreadMessageIds,
          }),
        }).catch(console.error);
      }
    }
  };

  // ローディング表示
  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Header mode="admin" />
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex items-center justify-center h-64">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
              <p className="text-gray-500">データを読み込んでいます...</p>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Header mode="admin" />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* エラー表示 */}
        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
            <p>{error}</p>
            <button
              onClick={() => {
                setError(null);
                fetchReceptions();
              }}
              className="mt-2 text-sm text-red-600 hover:text-red-800 underline"
            >
              再読み込み
            </button>
          </div>
        )}

        {/* 統計カード */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <StatCard
            title="受付待ち"
            value={stats.pendingCount}
            icon="clock"
            color="yellow"
            onClick={() => setFilterStatus(filterStatus === 'pending' ? 'all' : 'pending')}
            active={filterStatus === 'pending'}
          />
          <StatCard
            title="対応中"
            value={stats.preparingCount}
            icon="flask"
            color="purple"
            onClick={() => setFilterStatus(filterStatus === 'preparing' ? 'all' : 'preparing')}
            active={filterStatus === 'preparing'}
          />
          <StatCard
            title="準備完了"
            value={stats.readyCount}
            icon="check"
            color="green"
            onClick={() => setFilterStatus(filterStatus === 'ready' ? 'all' : 'ready')}
            active={filterStatus === 'ready'}
          />
          <StatCard
            title="本日の合計"
            value={stats.todayTotal}
            icon="chart"
            color="blue"
            onClick={() => setFilterStatus('all')}
            active={filterStatus === 'all'}
          />
        </div>

        {/* メインコンテンツ */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* 受付リスト */}
          <div>
            <ReceptionList
              receptions={filteredReceptions}
              onSelect={handleSelectReception}
              selectedId={selectedReception?.receptionId}
            />
          </div>

          {/* 詳細パネル */}
          <div className="lg:sticky lg:top-8 lg:self-start">
            {selectedReception ? (
              <ReceptionDetail
                reception={selectedReception}
                stores={stores}
                messages={selectedReceptionMessages}
                onStatusChange={handleStatusChange}
                onStoreAssign={handleStoreAssign}
                onSendMessage={handleSendMessage}
                onClose={() => setSelectedReception(null)}
              />
            ) : (
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 h-96 flex items-center justify-center">
                <div className="text-center text-gray-400">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-16 w-16 mx-auto mb-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                    />
                  </svg>
                  <p>受付を選択してください</p>
                  <p className="text-sm mt-1">左のリストから受付を選択すると詳細が表示されます</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
