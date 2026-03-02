'use client';

import { useState, useEffect, useCallback } from 'react';
import { MonthlyStatsResponse, MonthlyStatsData } from '@/types/prescription';

interface MonthlyStatsProps {
  isVisible: boolean;
  onClose: () => void;
}

export default function MonthlyStats({ isVisible, onClose }: MonthlyStatsProps) {
  const [stats, setStats] = useState<MonthlyStatsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<MonthlyStatsData | null>(null);

  const fetchStats = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      const response = await fetch('/api/stats?months=6');
      const data = await response.json();
      
      if (data.success) {
        setStats(data.data);
        setSelectedMonth(data.data.currentMonth);
      } else {
        setError(data.error || '統計データの取得に失敗しました');
      }
    } catch (err) {
      console.error('Error fetching stats:', err);
      setError('サーバーとの通信に失敗しました');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isVisible) {
      fetchStats();
    }
  }, [isVisible, fetchStats]);

  if (!isVisible) return null;

  // 処理時間のフォーマット
  const formatProcessingTime = (minutes?: number): string => {
    if (!minutes) return '-';
    if (minutes < 60) return `${minutes}分`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}時間${mins > 0 ? `${mins}分` : ''}`;
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden">
        {/* ヘッダー */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-blue-50 to-indigo-50">
          <div>
            <h2 className="text-xl font-bold text-gray-900">月別統計レポート</h2>
            <p className="text-sm text-gray-500">受付・完了数の月別推移を確認できます</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-white hover:bg-opacity-50 rounded-full transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* コンテンツ */}
        <div className="overflow-y-auto max-h-[calc(90vh-120px)]">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600"></div>
              <span className="ml-3 text-gray-500">統計データを読み込み中...</span>
            </div>
          ) : error ? (
            <div className="p-6 text-center">
              <div className="text-red-500 mb-4">{error}</div>
              <button
                onClick={fetchStats}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                再読み込み
              </button>
            </div>
          ) : stats ? (
            <div className="p-6 space-y-6">
              {/* 年間累計 */}
              <div className="bg-gradient-to-r from-blue-500 to-indigo-600 rounded-xl p-6 text-white">
                <h3 className="text-lg font-semibold mb-4 opacity-90">
                  {new Date().getFullYear()}年 年間累計
                </h3>
                <div className="grid grid-cols-3 gap-4">
                  <div className="text-center">
                    <div className="text-3xl font-bold">{stats.yearToDate.totalReceptions}</div>
                    <div className="text-sm opacity-80">総受付数</div>
                  </div>
                  <div className="text-center">
                    <div className="text-3xl font-bold">{stats.yearToDate.completedCount}</div>
                    <div className="text-sm opacity-80">完了数</div>
                  </div>
                  <div className="text-center">
                    <div className="text-3xl font-bold">{stats.yearToDate.cancelledCount}</div>
                    <div className="text-sm opacity-80">キャンセル数</div>
                  </div>
                </div>
              </div>

              {/* 月別タブ */}
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-3">月別詳細</h3>
                <div className="flex flex-wrap gap-2 mb-4">
                  <button
                    onClick={() => setSelectedMonth(stats.currentMonth)}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                      selectedMonth?.month === stats.currentMonth.month
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    {stats.currentMonth.displayMonth}（当月）
                  </button>
                  {stats.previousMonths.map((month) => (
                    <button
                      key={month.month}
                      onClick={() => setSelectedMonth(month)}
                      className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                        selectedMonth?.month === month.month
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      {month.displayMonth}
                    </button>
                  ))}
                </div>

                {/* 選択された月の詳細 */}
                {selectedMonth && (
                  <div className="bg-gray-50 rounded-xl p-6 space-y-6">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xl font-bold text-gray-900">{selectedMonth.displayMonth}</h4>
                      {selectedMonth.month === stats.currentMonth.month && (
                        <span className="px-2 py-1 bg-blue-100 text-blue-700 text-xs rounded-full">当月</span>
                      )}
                    </div>

                    {/* 基本統計 */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div className="bg-white rounded-lg p-4 shadow-sm">
                        <div className="text-2xl font-bold text-gray-900">{selectedMonth.totalReceptions}</div>
                        <div className="text-sm text-gray-500">総受付数</div>
                      </div>
                      <div className="bg-white rounded-lg p-4 shadow-sm">
                        <div className="text-2xl font-bold text-green-600">{selectedMonth.completedCount}</div>
                        <div className="text-sm text-gray-500">完了数</div>
                      </div>
                      <div className="bg-white rounded-lg p-4 shadow-sm">
                        <div className="text-2xl font-bold text-red-500">{selectedMonth.cancelledCount}</div>
                        <div className="text-sm text-gray-500">キャンセル数</div>
                      </div>
                      <div className="bg-white rounded-lg p-4 shadow-sm">
                        <div className="text-2xl font-bold text-blue-600">
                          {selectedMonth.totalReceptions > 0 
                            ? Math.round((selectedMonth.completedCount / selectedMonth.totalReceptions) * 100)
                            : 0}%
                        </div>
                        <div className="text-sm text-gray-500">完了率</div>
                      </div>
                    </div>

                    {/* 受け取り方法別 */}
                    <div>
                      <h5 className="font-semibold text-gray-700 mb-3">受け取り方法別</h5>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="bg-white rounded-lg p-4 shadow-sm flex items-center">
                          <div className="w-10 h-10 bg-purple-100 rounded-full flex items-center justify-center mr-3">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                            </svg>
                          </div>
                          <div>
                            <div className="text-xl font-bold text-gray-900">{selectedMonth.storePickupCount}</div>
                            <div className="text-sm text-gray-500">店舗受取</div>
                          </div>
                        </div>
                        <div className="bg-white rounded-lg p-4 shadow-sm flex items-center">
                          <div className="w-10 h-10 bg-indigo-100 rounded-full flex items-center justify-center mr-3">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                            </svg>
                          </div>
                          <div>
                            <div className="text-xl font-bold text-gray-900">{selectedMonth.homeDeliveryCount}</div>
                            <div className="text-sm text-gray-500">自宅受取</div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* 平均処理時間 */}
                    {selectedMonth.averageProcessingTime !== undefined && (
                      <div className="bg-white rounded-lg p-4 shadow-sm">
                        <div className="flex items-center">
                          <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center mr-3">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                          </div>
                          <div>
                            <div className="text-xl font-bold text-gray-900">
                              {formatProcessingTime(selectedMonth.averageProcessingTime)}
                            </div>
                            <div className="text-sm text-gray-500">平均処理時間（受付〜完了）</div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* 店舗別内訳 */}
                    {selectedMonth.byStore && selectedMonth.byStore.length > 0 && (
                      <div>
                        <h5 className="font-semibold text-gray-700 mb-3">店舗別内訳</h5>
                        <div className="bg-white rounded-lg shadow-sm overflow-hidden">
                          <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                              <tr>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">店舗名</th>
                                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">受付数</th>
                                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">完了数</th>
                                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">完了率</th>
                              </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                              {selectedMonth.byStore.map((store) => (
                                <tr key={store.storeId} className="hover:bg-gray-50">
                                  <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                                    {store.storeName}
                                  </td>
                                  <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-gray-900 font-medium">
                                    {store.count}
                                  </td>
                                  <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-green-600 font-medium">
                                    {store.completedCount}
                                  </td>
                                  <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-gray-500">
                                    {store.count > 0 ? Math.round((store.completedCount / store.count) * 100) : 0}%
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* 月別推移グラフ（簡易版） */}
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-3">月別受付数の推移</h3>
                <div className="bg-white rounded-xl p-4 shadow-sm">
                  {(() => {
                    const allMonths = [...stats.previousMonths].reverse().concat([stats.currentMonth]);
                    const maxCount = Math.max(...allMonths.map((m) => m.totalReceptions), 1);
                    const chartHeight = 140; // px
                    
                    return (
                      <div className="flex items-end justify-between space-x-2" style={{ height: `${chartHeight + 30}px` }}>
                        {allMonths.map((month) => {
                          const barHeight = maxCount > 0 
                            ? Math.max((month.totalReceptions / maxCount) * chartHeight, month.totalReceptions > 0 ? 20 : 4)
                            : 4;
                          
                          return (
                            <div key={month.month} className="flex-1 flex flex-col items-center justify-end h-full">
                              <div className="flex flex-col items-center justify-end" style={{ height: `${chartHeight}px` }}>
                                <div 
                                  className={`w-full rounded-t transition-all flex items-start justify-center ${
                                    month.month === stats.currentMonth.month
                                      ? 'bg-blue-500'
                                      : 'bg-blue-200'
                                  }`}
                                  style={{ height: `${barHeight}px`, minWidth: '30px' }}
                                >
                                  {month.totalReceptions > 0 && (
                                    <span className={`text-xs font-bold mt-1 ${
                                      month.month === stats.currentMonth.month ? 'text-white' : 'text-blue-700'
                                    }`}>
                                      {month.totalReceptions}
                                    </span>
                                  )}
                                </div>
                              </div>
                              <div className="text-xs text-gray-500 mt-2 text-center">
                                {month.displayMonth.replace(/\d+年/, '')}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
