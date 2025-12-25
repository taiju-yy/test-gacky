'use client';

import { useState, useEffect } from 'react';
import Header from '@/components/Header';
import StatCard from '@/components/StatCard';
import ReceptionList from '@/components/ReceptionList';
import ReceptionDetail from '@/components/ReceptionDetail';
import { PrescriptionReception, ReceptionStatus, Store, DashboardStats } from '@/types/prescription';

// デモ用の店舗データ
const demoStores: Store[] = [
  { storeId: 'store_001', storeName: '金沢駅前', region: '金沢市', address: '石川県金沢市此花町1-1', phone: '076-xxx-xxxx', lineUrl: '', mapUrl: '', businessHours: '9:00-19:00' },
  { storeId: 'store_002', storeName: '野々市', region: '野々市市', address: '石川県野々市市xxx', phone: '076-xxx-xxxx', lineUrl: '', mapUrl: '', businessHours: '9:00-19:00' },
  { storeId: 'store_003', storeName: '小松', region: '小松市', address: '石川県小松市xxx', phone: '076-xxx-xxxx', lineUrl: '', mapUrl: '', businessHours: '9:00-18:00' },
  { storeId: 'store_004', storeName: '白山', region: '白山市', address: '石川県白山市xxx', phone: '076-xxx-xxxx', lineUrl: '', mapUrl: '', businessHours: '9:00-19:00' },
  { storeId: 'store_005', storeName: '津幡', region: '河北郡', address: '石川県河北郡津幡町xxx', phone: '076-xxx-xxxx', lineUrl: '', mapUrl: '', businessHours: '9:00-18:00' },
];

// デモ用の受付データ
const demoReceptions: PrescriptionReception[] = [
  {
    receptionId: 'rx_20241225_001',
    timestamp: new Date().toISOString(),
    userId: 'U1234567890abcdef',
    userDisplayName: '山田 太郎',
    prescriptionImageUrl: '',
    prescriptionImageKey: '',
    status: 'pending',
    messagingSessionStatus: 'inactive',
    ttl: Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60,
  },
  {
    receptionId: 'rx_20241225_002',
    timestamp: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
    userId: 'U2345678901bcdefg',
    userDisplayName: '佐藤 花子',
    prescriptionImageUrl: '',
    prescriptionImageKey: '',
    selectedStoreId: 'store_001',
    selectedStoreName: '金沢駅前',
    status: 'pending',
    messagingSessionStatus: 'inactive',
    customerNote: '15時頃に取りに行きたい',
    ttl: Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60,
  },
  {
    receptionId: 'rx_20241225_003',
    timestamp: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    userId: 'U3456789012cdefgh',
    userDisplayName: '鈴木 一郎',
    prescriptionImageUrl: '',
    prescriptionImageKey: '',
    selectedStoreId: 'store_002',
    selectedStoreName: '野々市',
    status: 'preparing',
    messagingSessionStatus: 'active',
    ttl: Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60,
  },
  {
    receptionId: 'rx_20241225_004',
    timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    userId: 'U4567890123defghi',
    userDisplayName: '田中 美咲',
    prescriptionImageUrl: '',
    prescriptionImageKey: '',
    selectedStoreId: 'store_001',
    selectedStoreName: '金沢駅前',
    status: 'ready',
    messagingSessionStatus: 'inactive',
    ttl: Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60,
  },
];

export default function Dashboard() {
  const [receptions, setReceptions] = useState<PrescriptionReception[]>(demoReceptions);
  const [selectedReception, setSelectedReception] = useState<PrescriptionReception | null>(null);
  const [filterStatus, setFilterStatus] = useState<ReceptionStatus | 'all'>('all');

  // 統計計算
  const stats: DashboardStats = {
    pendingCount: receptions.filter((r) => r.status === 'pending').length,
    preparingCount: receptions.filter((r) => r.status === 'preparing').length,
    readyCount: receptions.filter((r) => r.status === 'ready').length,
    todayTotal: receptions.length,
  };

  // フィルタリングされた受付リスト
  const filteredReceptions =
    filterStatus === 'all'
      ? receptions
      : receptions.filter((r) => r.status === filterStatus);

  // ステータス変更ハンドラ
  const handleStatusChange = async (receptionId: string, newStatus: ReceptionStatus) => {
    // 楽観的更新
    setReceptions((prev) =>
      prev.map((r) =>
        r.receptionId === receptionId
          ? {
              ...r,
              status: newStatus,
              ...(newStatus === 'confirmed' && { confirmedAt: new Date().toISOString() }),
              ...(newStatus === 'ready' && { readyAt: new Date().toISOString() }),
              ...(newStatus === 'completed' && { completedAt: new Date().toISOString() }),
            }
          : r
      )
    );

    // 選択中の受付も更新
    if (selectedReception?.receptionId === receptionId) {
      setSelectedReception((prev) =>
        prev ? { ...prev, status: newStatus } : null
      );
    }

    // TODO: API呼び出し
    console.log(`Status changed: ${receptionId} -> ${newStatus}`);

    // 準備完了の場合、お客様に通知
    if (newStatus === 'ready') {
      console.log('Sending ready notification to customer...');
      // TODO: LINE通知API呼び出し
    }
  };

  // 店舗割振りハンドラ
  const handleStoreAssign = async (receptionId: string, storeId: string) => {
    const store = demoStores.find((s) => s.storeId === storeId);
    if (!store) return;

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

    console.log(`Store assigned: ${receptionId} -> ${store.storeName}`);
  };

  // メッセージ送信ハンドラ
  const handleSendMessage = async (receptionId: string, message: string) => {
    console.log(`Sending message to reception ${receptionId}: ${message}`);

    // メッセージセッションをアクティブに
    setReceptions((prev) =>
      prev.map((r) =>
        r.receptionId === receptionId
          ? { ...r, messagingSessionStatus: 'active' as const }
          : r
      )
    );

    // TODO: API呼び出し
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Header mode="admin" />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* 統計カード */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <StatCard
            title="受付待ち"
            value={stats.pendingCount}
            icon="clock"
            color="yellow"
            onClick={() => setFilterStatus('pending')}
          />
          <StatCard
            title="調剤中"
            value={stats.preparingCount}
            icon="flask"
            color="purple"
            onClick={() => setFilterStatus('preparing')}
          />
          <StatCard
            title="準備完了"
            value={stats.readyCount}
            icon="check"
            color="green"
            onClick={() => setFilterStatus('ready')}
          />
          <StatCard
            title="本日の合計"
            value={stats.todayTotal}
            icon="chart"
            color="blue"
            onClick={() => setFilterStatus('all')}
          />
        </div>

        {/* メインコンテンツ */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* 受付リスト */}
          <div>
            <ReceptionList
              receptions={filteredReceptions}
              onSelect={setSelectedReception}
              selectedId={selectedReception?.receptionId}
            />
          </div>

          {/* 詳細パネル */}
          <div>
            {selectedReception ? (
              <ReceptionDetail
                reception={selectedReception}
                stores={demoStores}
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
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
