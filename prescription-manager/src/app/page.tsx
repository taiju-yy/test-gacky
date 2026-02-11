'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import Header from '@/components/Header';
import StatCard from '@/components/StatCard';
import ReceptionList from '@/components/ReceptionList';
import ReceptionDetail from '@/components/ReceptionDetail';
import { PrescriptionReception, ReceptionStatus, Store, DashboardStats, PrescriptionMessage, DeliveryMethod } from '@/types/prescription';

const SESSION_TIMEOUT_MINUTES = 30;

/**
 * セッションがタイムアウトしているかをフロントエンドで判定
 * Lambda側のcheckActiveMessagingSession()と同じロジック
 */
const checkSessionTimeout = (reception: PrescriptionReception): PrescriptionReception => {
  // アクティブセッションのみチェック
  if (reception.messagingSessionStatus !== 'active') {
    return reception;
  }

  // 最後のアクティビティ時刻を取得
  // lastStoreMessageAt, lastCustomerMessageAt, sessionReactivatedAt の最新を使用
  const lastStoreTime = reception.lastStoreMessageAt 
    ? new Date(reception.lastStoreMessageAt).getTime() 
    : 0;
  const lastCustomerTime = reception.lastCustomerMessageAt 
    ? new Date(reception.lastCustomerMessageAt).getTime() 
    : 0;
  const sessionReactivatedTime = reception.sessionReactivatedAt
    ? new Date(reception.sessionReactivatedAt).getTime()
    : 0;
  
  // どちらもない場合は、受付時刻を使用
  let lastActivityTime = Math.max(lastStoreTime, lastCustomerTime, sessionReactivatedTime);
  if (lastActivityTime === 0 && reception.timestamp) {
    lastActivityTime = new Date(reception.timestamp).getTime();
  }

  const now = Date.now();
  const timeoutMs = SESSION_TIMEOUT_MINUTES * 60 * 1000;

  // タイムアウト判定
  if (lastActivityTime > 0 && (now - lastActivityTime >= timeoutMs)) {
    // フロントエンド側でタイムアウト表示用にステータスを変更
    return {
      ...reception,
      messagingSessionStatus: 'closed',
      sessionCloseReason: 'timeout',
      // 表示用フラグ（DynamoDBには保存されない）
      _isTimeoutByFrontend: true,
    } as PrescriptionReception & { _isTimeoutByFrontend?: boolean };
  }

  return reception;
};

export default function Dashboard() {
  const [receptions, setReceptions] = useState<PrescriptionReception[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [selectedReception, setSelectedReception] = useState<PrescriptionReception | null>(null);
  const [filterStatus, setFilterStatus] = useState<ReceptionStatus | 'all'>('all');
  const [messages, setMessages] = useState<Record<string, PrescriptionMessage[]>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // SP表示時の詳細パネルへのスクロール用ref
  const detailPanelRef = useRef<HTMLDivElement>(null);

  // 認証情報
  const { user, isAuthenticated, isLoading: authLoading, isAdmin, isStoreStaff, hasStoreAssigned, setSelectedStore } = useAuth();
  const router = useRouter();

  // 認証チェック
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login');
    }
  }, [authLoading, isAuthenticated, router]);

  // 受付一覧を取得
  const fetchReceptions = useCallback(async () => {
    // 店舗スタッフで店舗未設定の場合はスキップ
    if (isStoreStaff && !hasStoreAssigned) {
      setReceptions([]);
      setIsLoading(false);
      return;
    }

    try {
      // 店舗スタッフの場合は自分の店舗のみ取得
      let url = '/api/receptions';
      if (isStoreStaff && user?.assignedStoreId) {
        const params = new URLSearchParams();
        params.append('storeId', user.assignedStoreId);
        // 店舗名も送信（店舗IDの形式が異なる場合のフォールバック用）
        if (user.assignedStoreName) {
          params.append('storeName', user.assignedStoreName);
        }
        url += `?${params.toString()}`;
      }

      const response = await fetch(url);
      const data = await response.json();
      
      if (data.success) {
        // フロントエンドでタイムアウトチェックを適用
        const receptionsWithTimeoutCheck = data.data.map(checkSessionTimeout);
        setReceptions(receptionsWithTimeoutCheck);
        
        // 選択中の受付も更新（タイムアウトチェック含む）
        setSelectedReception((prev) => {
          if (!prev) return null;
          const updated = receptionsWithTimeoutCheck.find(
            (r: PrescriptionReception) => r.receptionId === prev.receptionId
          );
          return updated ? checkSessionTimeout(updated) : prev;
        });
        
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
  }, [isStoreStaff, hasStoreAssigned, user?.assignedStoreId, user?.assignedStoreName]);

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
    if (isAuthenticated) {
      fetchReceptions();
      fetchStores();
    }
  }, [isAuthenticated, fetchReceptions, fetchStores]);

  // 定期的に受付一覧を更新（60秒ごと）
  // コスト抑制のため30秒から60秒に変更
  useEffect(() => {
    if (!isAuthenticated) return;
    
    const interval = setInterval(() => {
      fetchReceptions();
    }, 60000);

    return () => clearInterval(interval);
  }, [isAuthenticated, fetchReceptions]);

  // 店舗変更時に受付一覧を再取得
  const handleStoreChange = useCallback((storeId: string, storeName: string) => {
    // 認証コンテキストの店舗情報は既に更新されているので、受付一覧を再取得
    fetchReceptions();
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
              ...(newStatus === 'video_counseling' && { 
                videoCounselingStatus: 'in_progress' as const,
                videoCounselingStartedAt: new Date().toISOString(),
              }),
              ...(newStatus === 'shipping' && { 
                shippingAt: new Date().toISOString(),
                videoCounselingStatus: 'completed' as const,
                videoCounselingCompletedAt: new Date().toISOString(),
              }),
              ...(newStatus === 'shipped' && { 
                shippedAt: new Date().toISOString(),
              }),
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
          userDisplayName: reception.userDisplayName,
          selectedStoreId: reception.selectedStoreId,
          selectedStoreName: reception.selectedStoreName,
          deliveryMethod: reception.deliveryMethod,
        }),
      });

      const data = await response.json();
      if (!data.success) {
        console.error('Failed to update status:', data.error);
        // エラー時はリフェッチ
        fetchReceptions();
      } else if (newStatus === 'video_counseling' && data.data?.videoCallRoomId) {
        // オンライン服薬指導開始時、店舗側のビデオ通話画面を自動で開く
        const baseUrl = process.env.NEXT_PUBLIC_APP_URL || window.location.origin;
        const storeVideoCallUrl = `${baseUrl}/video-call/${data.data.videoCallRoomId}?role=store`;
        window.open(storeVideoCallUrl, '_blank', 'width=800,height=600');
        
        // システムメッセージを追加
        const systemMessage: PrescriptionMessage = {
          receptionId,
          messageId: `msg_system_${Date.now()}`,
          timestamp: new Date().toISOString(),
          senderType: 'system',
          senderId: 'system',
          senderName: 'システム',
          messageType: 'text',
          content: 'オンライン服薬指導を開始しました。お客様のLINEにビデオ通話リンクを送信しました。',
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
          // 店舗変更通知用の情報
          userId: reception.userId,
          // お客様の元の店舗: preferredStoreId または selectedStoreId
          originalStoreId: reception.preferredStoreId || reception.selectedStoreId,
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

  // メッセージを既読にするAPI呼び出し
  const markMessagesAsRead = useCallback(async (receptionId: string, messageList: PrescriptionMessage[]) => {
    const unreadMessageIds = messageList
      .filter((msg) => msg.senderType === 'customer' && !msg.readByStore)
      .map((msg) => msg.messageId);
    
    if (unreadMessageIds.length > 0) {
      try {
        await fetch('/api/messages', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            receptionId,
            messageIds: unreadMessageIds,
          }),
        });
        console.log(`Marked ${unreadMessageIds.length} messages as read for ${receptionId}`);
      } catch (error) {
        console.error('Error marking messages as read:', error);
      }
    }
  }, []);

  // 受付選択時に未読をクリアしてメッセージを取得
  const handleSelectReception = async (reception: PrescriptionReception) => {
    // タイムアウトチェックを適用してから選択
    const checkedReception = checkSessionTimeout(reception);
    setSelectedReception(checkedReception);
    
    // SP表示時は詳細パネルまでスクロール
    if (window.innerWidth < 1024 && detailPanelRef.current) {
      // 少し遅延してレンダリング完了後にスクロール
      setTimeout(() => {
        detailPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    }
    
    // 未読数を即座にUIからクリア（楽観的更新）
    if (reception.unreadMessageCount && reception.unreadMessageCount > 0) {
      setReceptions((prev) =>
        prev.map((r) =>
          r.receptionId === reception.receptionId
            ? { ...r, unreadMessageCount: 0 }
            : r
        )
      );
    }
    
    // メッセージを取得してから既読更新を実行
    try {
      const response = await fetch(`/api/messages?receptionId=${reception.receptionId}`);
      const data = await response.json();
      
      if (data.success) {
        const messageList = data.data as PrescriptionMessage[];
        
        // メッセージをステートに保存
        setMessages((prev) => ({
          ...prev,
          [reception.receptionId]: messageList,
        }));
        
        // メッセージの既読状態をUIで更新
        setMessages((prev) => ({
          ...prev,
          [reception.receptionId]: (prev[reception.receptionId] || []).map((msg) => ({
            ...msg,
            readByStore: true,
          })),
        }));
        
        // API呼び出しで既読状態をDB更新
        await markMessagesAsRead(reception.receptionId, messageList);
      }
    } catch (error) {
      console.error('Error fetching messages:', error);
    }
  };

  // セッション再開ハンドラ
  const handleReactivateSession = async (receptionId: string) => {
    const reception = receptions.find((r) => r.receptionId === receptionId);
    if (!reception) return;

    const reactivatedAt = new Date().toISOString();

    // 楽観的更新
    setReceptions((prev) =>
      prev.map((r) =>
        r.receptionId === receptionId
          ? {
              ...r,
              messagingSessionStatus: 'active' as const,
              sessionReactivatedAt: reactivatedAt,
              sessionCloseReason: undefined, // タイムアウト理由をクリア
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
              sessionReactivatedAt: reactivatedAt,
              sessionCloseReason: undefined, // タイムアウト理由をクリア
            }
          : null
      );
    }

    // API呼び出し
    try {
      const response = await fetch(`/api/receptions/${receptionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'reactivateSession',
          timestamp: reception.timestamp,
          userId: reception.userId,
        }),
      });

      const data = await response.json();
      if (!data.success) {
        console.error('Failed to reactivate session:', data.error);
        // エラー時はリフェッチ
        fetchReceptions();
      }
    } catch (err) {
      console.error('Error reactivating session:', err);
      fetchReceptions();
    }
  };

    // 受け取り方法変更ハンドラ
  const handleDeliveryMethodChange = async (receptionId: string, deliveryMethod: DeliveryMethod, notifyCustomer: boolean) => {
    const reception = receptions.find((r) => r.receptionId === receptionId);
    if (!reception) return;

    // 楽観的更新
    setReceptions((prev) =>
      prev.map((r) =>
        r.receptionId === receptionId
          ? {
              ...r,
              deliveryMethod,
            }
          : r
      )
    );

    if (selectedReception?.receptionId === receptionId) {
      setSelectedReception((prev) =>
        prev
          ? {
              ...prev,
              deliveryMethod,
            }
          : null
      );
    }

    // API呼び出し
    try {
      const response = await fetch(`/api/receptions/${receptionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'updateDeliveryMethod',
          timestamp: reception.timestamp,
          userId: reception.userId,
          deliveryMethod,
          notifyCustomer,
          changedBy: 'staff',
          // 自宅受け取りの場合は店舗情報をクリア
          clearStore: deliveryMethod === 'home',
        }),
      });

      const data = await response.json();
      if (!data.success) {
        console.error('Failed to update delivery method:', data.error);
        // エラー時はリフェッチ
        fetchReceptions();
      }
    } catch (err) {
      console.error('Error updating delivery method:', err);
      fetchReceptions();
    }
  };

  // ビデオ通話開始ハンドラ
  const handleStartVideoCall = async (receptionId: string): Promise<string | null> => {
    const reception = receptions.find((r) => r.receptionId === receptionId);
    if (!reception) return null;

    try {
      const response = await fetch('/api/video-call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          receptionId,
          userId: reception.userId,
          userDisplayName: reception.userDisplayName,
          storeId: reception.selectedStoreId,
          storeName: reception.selectedStoreName,
        }),
      });

      const data = await response.json();
      
      if (data.success) {
        console.log('Video call room created:', data.data.roomId);
        
        // システムメッセージをローカルに追加
        const systemMessage: PrescriptionMessage = {
          receptionId,
          messageId: `msg_system_${Date.now()}`,
          timestamp: new Date().toISOString(),
          senderType: 'system',
          senderId: 'system',
          senderName: 'システム',
          messageType: 'text',
          content: 'ビデオ通話のリクエストをお客様に送信しました',
          lineDelivered: data.data.lineDelivered,
          readByCustomer: false,
          readByStore: true,
          ttl: Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60,
        };
        setMessages((prev) => ({
          ...prev,
          [receptionId]: [...(prev[receptionId] || []), systemMessage],
        }));

        return data.data.storeVideoCallUrl;
      } else {
        console.error('Failed to create video call room:', data.error);
        return null;
      }
    } catch (err) {
      console.error('Error starting video call:', err);
      return null;
    }
  };

  // 認証ローディング中
  if (authLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gacky-green mx-auto mb-4"></div>
          <p className="text-gray-500">認証確認中...</p>
        </div>
      </div>
    );
  }

  // 店舗スタッフで店舗未設定の場合
  if (isStoreStaff && !hasStoreAssigned) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Header stores={stores} onStoreChange={handleStoreChange} />
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-8 text-center">
            <div className="w-16 h-16 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-orange-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              </svg>
            </div>
            <h2 className="text-xl font-semibold text-gray-900 mb-2">担当店舗を設定してください</h2>
            <p className="text-gray-500 mb-6">
              右上の歯車アイコンをクリックして、担当する店舗を選択してください。<br />
              店舗を設定すると、その店舗に割り振られた受付のみが表示されます。
            </p>
          </div>
        </main>
      </div>
    );
  }

  // ローディング表示
  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Header stores={stores} onStoreChange={handleStoreChange} />
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
      <Header stores={stores} onStoreChange={handleStoreChange} />

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

        {/* メインコンテンツ - PCでは左右独立スクロール */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:h-[calc(100vh-280px)]">
          {/* 受付リスト - PC表示時は独立スクロール */}
          <div className="lg:overflow-y-auto lg:h-full">
            <ReceptionList
              receptions={filteredReceptions}
              onSelect={handleSelectReception}
              selectedId={selectedReception?.receptionId}
            />
          </div>

          {/* 詳細パネル - PC表示時は独立スクロール */}
          <div ref={detailPanelRef} className="lg:overflow-y-auto lg:h-full">
            {selectedReception ? (
              <ReceptionDetail
                reception={selectedReception}
                stores={stores}
                messages={selectedReceptionMessages}
                onStatusChange={handleStatusChange}
                onStoreAssign={handleStoreAssign}
                onSendMessage={handleSendMessage}
                onReactivateSession={handleReactivateSession}
                onDeliveryMethodChange={handleDeliveryMethodChange}
                onStartVideoCall={handleStartVideoCall}
                onClose={() => setSelectedReception(null)}
                isAdmin={isAdmin}
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
