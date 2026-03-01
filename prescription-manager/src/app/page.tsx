'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import Header from '@/components/Header';
import StatCard from '@/components/StatCard';
import ReceptionList from '@/components/ReceptionList';
import ReceptionDetail from '@/components/ReceptionDetail';
import MonthlyStats from '@/components/MonthlyStats';
import { PrescriptionReception, ReceptionStatus, Store, DashboardStats, AdminDashboardStats, StoreDashboardStats, PrescriptionMessage, DeliveryMethod } from '@/types/prescription';
import { registerServiceWorker } from '@/lib/pushNotification';

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
  const [filterTodayOnly, setFilterTodayOnly] = useState(false); // 本日のみフィルター
  const [filterUnreadOnly, setFilterUnreadOnly] = useState(false); // 未読メッセージありのみフィルター
  const [messages, setMessages] = useState<Record<string, PrescriptionMessage[]>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showMonthlyStats, setShowMonthlyStats] = useState(false); // 月別統計モーダル表示
  const [isStatsCollapsed, setIsStatsCollapsed] = useState(false); // ダッシュボード折りたたみ状態
  
  // SP表示時の詳細パネルへのスクロール用ref
  const detailPanelRef = useRef<HTMLDivElement>(null);
  
  // 選択中の受付をrefで追跡（useEffect内のクロージャで最新値を参照するため）
  const selectedReceptionRef = useRef<PrescriptionReception | null>(null);
  selectedReceptionRef.current = selectedReception;
  
  // メッセージタブが表示中かどうかを追跡（NEW_MESSAGEイベントで既読処理を行うかどうかの判定に使用）
  const isMessageTabActiveRef = useRef<boolean>(false);

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
        
        // メッセージタブが表示中の場合のみ、選択中の受付の未読数を0に保持
        const currentSelectedReception = selectedReceptionRef.current;
        const isMessageTabActive = isMessageTabActiveRef.current;
        const updatedReceptions = receptionsWithTimeoutCheck.map((r: PrescriptionReception) => {
          if (currentSelectedReception && r.receptionId === currentSelectedReception.receptionId && isMessageTabActive) {
            // メッセージタブ表示中の受付は未読数を0に保持（既読処理済みの想定）
            return { ...r, unreadMessageCount: 0 };
          }
          return r;
        });
        
        setReceptions(updatedReceptions);
        
        // 選択中の受付も更新（タイムアウトチェック含む、未読数の保持ロジック適用済み）
        setSelectedReception((prev) => {
          if (!prev) return null;
          const updated = updatedReceptions.find(
            (r: PrescriptionReception) => r.receptionId === prev.receptionId
          );
          return updated ? updated : prev;
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

  // Service Worker 登録とプッシュ通知のリスナー設定
  useEffect(() => {
    if (!isAuthenticated) return;

    // Service Worker を登録
    registerServiceWorker();

    // 通知音を鳴らす関数
    const playNotificationSound = () => {
      try {
        // Web Audio API を使用して通知音を生成
        const audioContext = new (window.AudioContext || (window as typeof window & { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        // 音の設定（心地よいチャイム音）
        oscillator.frequency.setValueAtTime(880, audioContext.currentTime); // A5
        oscillator.frequency.setValueAtTime(1108.73, audioContext.currentTime + 0.1); // C#6
        oscillator.frequency.setValueAtTime(1318.51, audioContext.currentTime + 0.2); // E6
        
        gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);
        
        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.5);
        
        console.log('[Dashboard] Notification sound played');
      } catch (err) {
        console.log('[Dashboard] Could not play notification sound:', err);
      }
    };

    // Service Worker からのメッセージを受け取る
    const handleServiceWorkerMessage = async (event: MessageEvent) => {
      console.log('[Dashboard] Service Worker message received:', event.data?.type);
      
      if (event.data?.type === 'NOTIFICATION_CLICKED') {
        console.log('[Dashboard] Notification clicked, refreshing data...');
        // 通知クリック時に即座にデータを更新
        fetchReceptions();
        
        // 特定の受付を選択する場合
        const receptionId = event.data?.data?.receptionId;
        if (receptionId) {
          // URLパラメータを更新して受付を選択状態にする
          const url = new URL(window.location.href);
          url.searchParams.set('receptionId', receptionId);
          window.history.replaceState({}, '', url.toString());
          
          // 該当する受付のメッセージも取得
          fetchMessages(receptionId);
        }
      } else if (event.data?.type === 'NEW_PRESCRIPTION') {
        // 新しい処方箋が届いた場合、リストを即時更新
        console.log('[Dashboard] New prescription received, refreshing list...');
        fetchReceptions();
        
        // 通知音を鳴らす（タブが開いている場合）
        playNotificationSound();
      } else if (event.data?.type === 'NEW_MESSAGE') {
        // お客様からの新しいメッセージが届いた場合
        const receptionId = event.data?.data?.receptionId;
        console.log('[Dashboard] New message received for reception:', receptionId);
        
        // 選択中の受付と一致する場合
        const currentSelectedReception = selectedReceptionRef.current;
        if (receptionId && currentSelectedReception?.receptionId === receptionId) {
          console.log('[Dashboard] Message is for currently selected reception');
          
          // メッセージタブが表示中の場合のみ、メッセージを取得して既読処理
          if (isMessageTabActiveRef.current) {
            console.log('[Dashboard] Message tab is active, fetching and marking as read');
            try {
              const response = await fetch(`/api/messages?receptionId=${receptionId}`);
              const data = await response.json();
              
              if (data.success) {
                const messageList = data.data as PrescriptionMessage[];
                setMessages((prev) => ({
                  ...prev,
                  [receptionId]: messageList,
                }));
                
                // 未読メッセージを既読に更新（サーバー側の未読数も更新）
                const unreadMessageIds = messageList
                  .filter((msg: PrescriptionMessage) => msg.senderType === 'customer' && !msg.readByStore)
                  .map((msg: PrescriptionMessage) => msg.messageId);
                
                if (unreadMessageIds.length > 0 && currentSelectedReception) {
                  await fetch('/api/messages', {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      receptionId,
                      messageIds: unreadMessageIds,
                      receptionTimestamp: currentSelectedReception.timestamp,
                    }),
                  });
                  console.log(`[Dashboard] Marked ${unreadMessageIds.length} messages as read`);
                }
              }
            } catch (err) {
              console.error('[Dashboard] Error fetching messages:', err);
            }
            // メッセージタブ表示中なので未読数は0のまま
          } else {
            // 受付情報タブが表示中の場合、未読数を増やす
            console.log('[Dashboard] Info tab is active, incrementing unread count');
            setReceptions((prev) =>
              prev.map((r) =>
                r.receptionId === receptionId
                  ? { ...r, unreadMessageCount: (r.unreadMessageCount || 0) + 1 }
                  : r
              )
            );
            // selectedReception も同時に更新（同期を保つ）
            setSelectedReception((prev) =>
              prev && prev.receptionId === receptionId
                ? { ...prev, unreadMessageCount: (prev.unreadMessageCount || 0) + 1 }
                : prev
            );
          }
        } else if (receptionId) {
          // 選択中でない受付の場合、未読数を増やす（ローカルで +1）
          setReceptions((prev) =>
            prev.map((r) =>
              r.receptionId === receptionId
                ? { ...r, unreadMessageCount: (r.unreadMessageCount || 0) + 1 }
                : r
            )
          );
        }
        
        // 通知音を鳴らす
        playNotificationSound();
      }
    };

    navigator.serviceWorker?.addEventListener('message', handleServiceWorkerMessage);

    return () => {
      navigator.serviceWorker?.removeEventListener('message', handleServiceWorkerMessage);
    };
  }, [isAuthenticated, fetchReceptions, fetchMessages]);

  // ポーリングは廃止
  // リアルタイム通知（Web Push）により、新規受付は即座に通知されるため
  // 60秒ごとのポーリングは不要になりました
  // 通知クリック時や画面フォーカス時に手動で更新します

  // 画面がフォーカスされた時に更新（タブ切り替え時など）
  useEffect(() => {
    if (!isAuthenticated) return;

    const handleFocus = () => {
      console.log('[Dashboard] Window focused, refreshing data...');
      fetchReceptions();
    };

    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [isAuthenticated, fetchReceptions]);

  // 店舗変更時に受付一覧を即時再取得
  // 注意: useCallbackの依存関係ではなく、引数で渡された店舗情報を使用
  const handleStoreChange = useCallback(async (storeId: string, storeName: string) => {
    console.log(`[Dashboard] handleStoreChange called - Store: ${storeName} (${storeId}), isStoreStaff: ${isStoreStaff}`);
    setIsLoading(true);
    setSelectedReception(null); // 選択中の受付をクリア
    
    try {
      // 店舗スタッフの場合は新しい店舗のデータを取得
      // 注: isStoreStaff に関わらず、storeId が渡された場合は店舗フィルタを適用
      let url = '/api/receptions';
      if (storeId) {
        const params = new URLSearchParams();
        params.append('storeId', storeId);
        params.append('storeName', storeName);
        url += `?${params.toString()}`;
        console.log(`[Dashboard] Fetching receptions for store: ${storeId}`);
      } else {
        console.log('[Dashboard] Fetching all receptions (no store filter)');
      }

      const response = await fetch(url);
      const data = await response.json();
      
      if (data.success) {
        const receptionsWithTimeoutCheck = data.data.map(checkSessionTimeout);
        setReceptions(receptionsWithTimeoutCheck);
        setError(null);
      } else {
        setError(data.error || 'データの取得に失敗しました');
      }
    } catch (err) {
      console.error('Error fetching receptions after store change:', err);
      setError('サーバーとの通信に失敗しました');
    } finally {
      setIsLoading(false);
    }
  }, []);

  // 本日の日付範囲を取得（日本時間）
  const getTodayDateRange = () => {
    const now = new Date();
    const jstOffset = 9 * 60 * 60 * 1000;
    const jstNow = new Date(now.getTime() + jstOffset);
    const todayStr = jstNow.toISOString().split('T')[0];
    
    const startOfDayJST = new Date(`${todayStr}T00:00:00+09:00`);
    const endOfDayJST = new Date(`${todayStr}T23:59:59+09:00`);
    
    return {
      startOfDay: startOfDayJST.toISOString(),
      endOfDay: endOfDayJST.toISOString(),
    };
  };

  // 受付が今日のものかどうかを判定
  const isToday = (timestamp: string): boolean => {
    const { startOfDay, endOfDay } = getTodayDateRange();
    return timestamp >= startOfDay && timestamp <= endOfDay;
  };

  // 管理者向け統計計算
  const adminStats: AdminDashboardStats = {
    // 要アクション
    pendingCount: receptions.filter((r) => r.status === 'pending').length,
    unassignedCount: receptions.filter((r) => !r.selectedStoreId && r.status !== 'completed' && r.status !== 'cancelled').length,
    
    // 進行状況
    preparingCount: receptions.filter((r) => r.status === 'preparing' || r.status === 'confirmed').length,
    readyCount: receptions.filter((r) => r.status === 'ready').length,
    shippingCount: receptions.filter((r) => r.status === 'shipping' || r.status === 'shipped').length,
    
    // 本日の統計
    todayNewCount: receptions.filter((r) => isToday(r.timestamp)).length,
    todayCompletedCount: receptions.filter((r) => r.status === 'completed' && r.completedAt && isToday(r.completedAt)).length,
    
    // 未読メッセージ総数
    totalUnreadMessages: receptions.reduce((sum, r) => sum + (r.unreadMessageCount || 0), 0),
  };

  // 店舗スタッフ向け統計計算
  const storeStats: StoreDashboardStats = {
    // 要アクション
    pendingCount: receptions.filter((r) => 
      (r.status === 'pending' || r.status === 'confirmed') && r.deliveryMethod === 'store'
    ).length,
    unreadMessageCount: receptions.reduce((sum, r) => sum + (r.unreadMessageCount || 0), 0),
    
    // 進行状況
    preparingCount: receptions.filter((r) => r.status === 'preparing').length,
    readyCount: receptions.filter((r) => r.status === 'ready').length,
    videoCounselingCount: receptions.filter((r) => r.status === 'video_counseling').length,
    
    // 本日の統計
    todayNewCount: receptions.filter((r) => isToday(r.timestamp)).length,
    todayCompletedCount: receptions.filter((r) => r.status === 'completed' && r.completedAt && isToday(r.completedAt)).length,
  };

  // 後方互換用の統計（既存のフィルタリング用）
  const stats: DashboardStats = {
    pendingCount: receptions.filter((r) => r.status === 'pending').length,
    preparingCount: receptions.filter((r) => r.status === 'preparing' || r.status === 'confirmed').length,
    readyCount: receptions.filter((r) => r.status === 'ready').length,
    todayTotal: receptions.filter((r) => isToday(r.timestamp)).length,
  };

  // フィルタリングされた受付リスト
  const filteredReceptions = receptions.filter((r) => {
    // 本日のみフィルターが有効な場合
    if (filterTodayOnly && !isToday(r.timestamp)) {
      return false;
    }
    
    // 未読メッセージありのみフィルターが有効な場合
    if (filterUnreadOnly && (!r.unreadMessageCount || r.unreadMessageCount === 0)) {
      return false;
    }
    
    // ステータスフィルター
    if (filterStatus === 'all') {
      return true;
    }
    if (filterStatus === 'preparing') {
      return r.status === 'preparing' || r.status === 'confirmed';
    }
    return r.status === filterStatus;
  });

  // 選択中の受付のメッセージを取得
  const selectedReceptionMessages = selectedReception
    ? messages[selectedReception.receptionId] || []
    : [];

  // receptions 配列から最新の選択中の受付データを取得
  // これにより、receptions を更新すれば ReceptionDetail にも自動的に反映される
  const currentSelectedReception = selectedReception
    ? receptions.find((r) => r.receptionId === selectedReception.receptionId) || selectedReception
    : null;

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
  const markMessagesAsRead = useCallback(async (receptionId: string, messageList: PrescriptionMessage[], receptionTimestamp?: string) => {
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
            receptionTimestamp, // 受付テーブルの未読数を更新するために必要
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
    
    // 受付を選択したときは初期状態が「受付情報」タブなのでfalseに設定
    isMessageTabActiveRef.current = false;
    
    // SP表示時は詳細パネルまでスクロール
    if (window.innerWidth < 1024 && detailPanelRef.current) {
      // 少し遅延してレンダリング完了後にスクロール
      setTimeout(() => {
        detailPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    }
    
    // メッセージを取得（既読処理はメッセージタブをクリックしたときに行う）
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
        
        // 注意: 既読処理はここでは行わない
        // メッセージタブをクリックしたときに onRefreshMessages で既読処理を行う
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

  // スタッフメモ更新ハンドラ
  const handleStaffNoteUpdate = async (receptionId: string, staffNote: string) => {
    const reception = receptions.find((r) => r.receptionId === receptionId);
    if (!reception) return;

    // 楽観的更新
    setReceptions((prev) =>
      prev.map((r) =>
        r.receptionId === receptionId
          ? {
              ...r,
              staffNote,
            }
          : r
      )
    );

    if (selectedReception?.receptionId === receptionId) {
      setSelectedReception((prev) =>
        prev
          ? {
              ...prev,
              staffNote,
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
          action: 'updateNote',
          timestamp: reception.timestamp,
          staffNote,
        }),
      });

      const data = await response.json();
      if (!data.success) {
        console.error('Failed to update staff note:', data.error);
        // エラー時はリフェッチ
        fetchReceptions();
      }
    } catch (err) {
      console.error('Error updating staff note:', err);
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

        {/* 統計カード - ロール別表示 */}
        {isAdmin ? (
          /* 管理者向けダッシュボード */
          <div className="mb-8 p-1">
            {/* ヘッダー行 */}
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-700">ダッシュボード</h2>
              <button
                onClick={() => setShowMonthlyStats(true)}
                className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 text-white rounded-lg hover:from-blue-600 hover:to-indigo-700 transition-all shadow-sm text-sm font-medium"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
                月別統計レポート
              </button>
            </div>
            {/* 要アクション行 */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
              <StatCard
                title="受付待ち"
                subtitle="店舗未割当"
                value={adminStats.pendingCount}
                icon="clock"
                color="red"
                badge={adminStats.pendingCount > 0 ? '要対応' : undefined}
                onClick={() => {
                  setFilterTodayOnly(false);
                  setFilterUnreadOnly(false);
                  setFilterStatus(filterStatus === 'pending' ? 'all' : 'pending');
                }}
                active={filterStatus === 'pending' && !filterTodayOnly && !filterUnreadOnly}
              />
              <StatCard
                title="対応中"
                subtitle="全店舗合計"
                value={adminStats.preparingCount}
                icon="flask"
                color="purple"
                onClick={() => {
                  setFilterTodayOnly(false);
                  setFilterUnreadOnly(false);
                  setFilterStatus(filterStatus === 'preparing' ? 'all' : 'preparing');
                }}
                active={filterStatus === 'preparing' && !filterTodayOnly && !filterUnreadOnly}
              />
              <StatCard
                title="準備完了"
                subtitle="全店舗合計"
                value={adminStats.readyCount}
                icon="check"
                color="green"
                onClick={() => {
                  setFilterTodayOnly(false);
                  setFilterUnreadOnly(false);
                  setFilterStatus(filterStatus === 'ready' ? 'all' : 'ready');
                }}
                active={filterStatus === 'ready' && !filterTodayOnly && !filterUnreadOnly}
              />
              <StatCard
                title="配送中"
                subtitle="自宅受取"
                value={adminStats.shippingCount}
                icon="truck"
                color="indigo"
                onClick={() => {
                  setFilterTodayOnly(false);
                  setFilterUnreadOnly(false);
                  setFilterStatus('all');
                }}
                active={false}
              />
            </div>
            {/* 本日の統計行 */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard
                title="本日の新規受付"
                subtitle="全店舗合計"
                value={adminStats.todayNewCount}
                icon="calendar"
                color="blue"
                onClick={() => {
                  setFilterUnreadOnly(false);
                  if (filterTodayOnly) {
                    setFilterTodayOnly(false);
                    setFilterStatus('all');
                  } else {
                    setFilterTodayOnly(true);
                    setFilterStatus('all');
                  }
                }}
                active={filterTodayOnly && !filterUnreadOnly}
              />
              <StatCard
                title="本日の完了"
                subtitle="全店舗合計"
                value={adminStats.todayCompletedCount}
                icon="chart"
                color="green"
                onClick={() => {
                  setFilterTodayOnly(false);
                  setFilterUnreadOnly(false);
                  setFilterStatus('all');
                }}
                active={false}
              />
              <StatCard
                title="未読メッセージ"
                subtitle="全店舗合計"
                value={adminStats.totalUnreadMessages || 0}
                icon="message"
                color={adminStats.totalUnreadMessages && adminStats.totalUnreadMessages > 0 ? 'orange' : 'blue'}
                badge={adminStats.totalUnreadMessages && adminStats.totalUnreadMessages > 0 ? '要確認' : undefined}
                onClick={() => {
                  if (filterUnreadOnly) {
                    // フィルター解除
                    setFilterUnreadOnly(false);
                  } else {
                    // 未読のみフィルター
                    setFilterTodayOnly(false);
                    setFilterStatus('all');
                    setFilterUnreadOnly(true);
                  }
                }}
                active={filterUnreadOnly}
              />
              <StatCard
                title="全受付件数"
                subtitle="表示中"
                value={receptions.length}
                icon="store"
                color="blue"
                onClick={() => {
                  setFilterTodayOnly(false);
                  setFilterUnreadOnly(false);
                  setFilterStatus('all');
                }}
                active={filterStatus === 'all' && !filterTodayOnly && !filterUnreadOnly}
              />
            </div>
          </div>
        ) : (
          /* 店舗スタッフ向けダッシュボード（折りたたみ可能） */
          <div className="mb-4">
            {/* ヘッダー（常に表示） */}
            <div className="flex items-center justify-between mb-3">
              <button
                onClick={() => setIsStatsCollapsed(!isStatsCollapsed)}
                className="flex items-center gap-2 text-gray-700 hover:text-gray-900 transition-colors"
              >
                <svg 
                  xmlns="http://www.w3.org/2000/svg" 
                  className={`h-5 w-5 transition-transform duration-200 ${isStatsCollapsed ? '' : 'rotate-90'}`}
                  fill="none" 
                  viewBox="0 0 24 24" 
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
                <span className="font-semibold">ダッシュボード</span>
                {isStatsCollapsed && (
                  <span className="text-sm text-gray-500 font-normal">
                    （対応待ち: {storeStats.pendingCount} / 未読: {storeStats.unreadMessageCount}）
                  </span>
                )}
              </button>
              
              {/* 折りたたみ時のクイックサマリーバッジ */}
              {isStatsCollapsed && (storeStats.pendingCount > 0 || storeStats.unreadMessageCount > 0) && (
                <div className="flex gap-2">
                  {storeStats.pendingCount > 0 && (
                    <span className="px-2 py-1 bg-yellow-100 text-yellow-700 text-xs rounded-full font-medium">
                      要対応 {storeStats.pendingCount}
                    </span>
                  )}
                  {storeStats.unreadMessageCount > 0 && (
                    <span className="px-2 py-1 bg-red-100 text-red-700 text-xs rounded-full font-medium">
                      未読 {storeStats.unreadMessageCount}
                    </span>
                  )}
                </div>
              )}
            </div>
            
            {/* 折りたたみ可能な統計カード部分 */}
            <div 
              className={`transition-all duration-300 ease-in-out overflow-hidden ${
                isStatsCollapsed ? 'max-h-0 opacity-0' : 'max-h-[500px] opacity-100'
              }`}
            >
              {/* ringボーダーが見切れないようにpadding追加 */}
              <div className="p-1">
              {/* 要アクション行 */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
              <StatCard
                title="対応待ち"
                subtitle="店舗受取のみ"
                value={storeStats.pendingCount}
                icon="clock"
                color="yellow"
                badge={storeStats.pendingCount > 0 ? '要対応' : undefined}
                onClick={() => {
                  setFilterTodayOnly(false);
                  setFilterUnreadOnly(false);
                  setFilterStatus(filterStatus === 'pending' ? 'all' : 'pending');
                }}
                active={filterStatus === 'pending' && !filterTodayOnly && !filterUnreadOnly}
              />
              <StatCard
                title="未読メッセージ"
                subtitle="お客様から"
                value={storeStats.unreadMessageCount}
                icon="message"
                color={storeStats.unreadMessageCount > 0 ? 'red' : 'blue'}
                badge={storeStats.unreadMessageCount > 0 ? '要確認' : undefined}
                onClick={() => {
                  if (filterUnreadOnly) {
                    // フィルター解除
                    setFilterUnreadOnly(false);
                  } else {
                    // 未読のみフィルター
                    setFilterTodayOnly(false);
                    setFilterStatus('all');
                    setFilterUnreadOnly(true);
                  }
                }}
                active={filterUnreadOnly}
              />
              <StatCard
                title="調剤中"
                subtitle="対応中"
                value={storeStats.preparingCount}
                icon="flask"
                color="purple"
                onClick={() => {
                  setFilterTodayOnly(false);
                  setFilterUnreadOnly(false);
                  setFilterStatus(filterStatus === 'preparing' ? 'all' : 'preparing');
                }}
                active={filterStatus === 'preparing' && !filterTodayOnly && !filterUnreadOnly}
              />
              <StatCard
                title="準備完了"
                subtitle="受取待ち"
                value={storeStats.readyCount}
                icon="check"
                color="green"
                onClick={() => {
                  setFilterTodayOnly(false);
                  setFilterUnreadOnly(false);
                  setFilterStatus(filterStatus === 'ready' ? 'all' : 'ready');
                }}
                active={filterStatus === 'ready' && !filterTodayOnly && !filterUnreadOnly}
              />
            </div>
            {/* 本日の統計行 */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard
                title="本日の新規受付"
                subtitle="自店舗"
                value={storeStats.todayNewCount}
                icon="calendar"
                color="blue"
                onClick={() => {
                  setFilterUnreadOnly(false);
                  if (filterTodayOnly) {
                    setFilterTodayOnly(false);
                    setFilterStatus('all');
                  } else {
                    setFilterTodayOnly(true);
                    setFilterStatus('all');
                  }
                }}
                active={filterTodayOnly && !filterUnreadOnly}
              />
              <StatCard
                title="本日の完了"
                subtitle="自店舗"
                value={storeStats.todayCompletedCount}
                icon="chart"
                color="green"
                onClick={() => {
                  setFilterTodayOnly(false);
                  setFilterUnreadOnly(false);
                  setFilterStatus('all');
                }}
                active={false}
              />
              {storeStats.videoCounselingCount > 0 && (
                <StatCard
                  title="オンライン服薬指導"
                  subtitle="対応中"
                  value={storeStats.videoCounselingCount}
                  icon="video"
                  color="pink"
                  badge="進行中"
                  onClick={() => {
                    setFilterTodayOnly(false);
                    setFilterUnreadOnly(false);
                    setFilterStatus('all');
                  }}
                  active={false}
                />
              )}
              <StatCard
                title="全受付件数"
                subtitle="表示中"
                value={receptions.length}
                icon="store"
                color="blue"
                onClick={() => {
                  setFilterTodayOnly(false);
                  setFilterUnreadOnly(false);
                  setFilterStatus('all');
                }}
                active={filterStatus === 'all' && !filterTodayOnly && !filterUnreadOnly}
              />
            </div>
            </div>
            </div>
          </div>
        )}

        {/* メインコンテンツ - PCでは左右独立スクロール */}
        <div className={`grid grid-cols-1 lg:grid-cols-2 gap-6 ${isStatsCollapsed && !isAdmin ? 'lg:h-[calc(100vh-180px)]' : 'lg:h-[calc(100vh-280px)]'}`}>
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
            {currentSelectedReception ? (
              <ReceptionDetail
                reception={currentSelectedReception}
                stores={stores}
                messages={selectedReceptionMessages}
                onStatusChange={handleStatusChange}
                onStoreAssign={handleStoreAssign}
                onSendMessage={handleSendMessage}
                onReactivateSession={handleReactivateSession}
                onDeliveryMethodChange={handleDeliveryMethodChange}
                onStartVideoCall={handleStartVideoCall}
                onStaffNoteUpdate={handleStaffNoteUpdate}
                onRefreshMessages={async () => {
                  if (!currentSelectedReception) return;
                  // メッセージを取得
                  const response = await fetch(`/api/messages?receptionId=${currentSelectedReception.receptionId}`);
                  const data = await response.json();
                  
                  if (data.success) {
                    const messageList = data.data as PrescriptionMessage[];
                    setMessages((prev) => ({
                      ...prev,
                      [currentSelectedReception.receptionId]: messageList,
                    }));
                    
                    // 未読メッセージを既読に更新（サーバー側の未読数も更新）
                    await markMessagesAsRead(currentSelectedReception.receptionId, messageList, currentSelectedReception.timestamp);
                  }
                }}
                onClearUnread={() => {
                  if (!currentSelectedReception) return;
                  // 選択中の受付の未読数をクリア（左カラムの未読マークを消す）
                  setReceptions((prev) =>
                    prev.map((r) =>
                      r.receptionId === currentSelectedReception.receptionId
                        ? { ...r, unreadMessageCount: 0 }
                        : r
                    )
                  );
                  // selectedReception も同時に更新（同期を保つ）
                  setSelectedReception((prev) =>
                    prev ? { ...prev, unreadMessageCount: 0 } : null
                  );
                }}
                onMessageTabChange={(isActive) => {
                  // メッセージタブの表示状態を追跡
                  isMessageTabActiveRef.current = isActive;
                }}
                onClose={() => {
                  setSelectedReception(null);
                  // 受付を閉じたらメッセージタブの状態をリセット
                  isMessageTabActiveRef.current = false;
                }}
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

      {/* 月別統計モーダル（管理者のみ） */}
      {isAdmin && (
        <MonthlyStats
          isVisible={showMonthlyStats}
          onClose={() => setShowMonthlyStats(false)}
        />
      )}
    </div>
  );
}
