/**
 * 統計API
 * GET: 月別統計データを取得
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDynamoDBClient, TABLES, ScanCommand } from '@/lib/dynamodb';
import { MonthlyStatsData, MonthlyStatsResponse } from '@/types/prescription';

const getDB = () => getDynamoDBClient();

// 日本時間で月の範囲を取得
const getMonthRange = (year: number, month: number): { start: string; end: string } => {
  const startDate = new Date(`${year}-${String(month).padStart(2, '0')}-01T00:00:00+09:00`);
  
  // 翌月の1日を取得して1ミリ秒引く
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const endDate = new Date(`${nextYear}-${String(nextMonth).padStart(2, '0')}-01T00:00:00+09:00`);
  endDate.setMilliseconds(endDate.getMilliseconds() - 1);
  
  return {
    start: startDate.toISOString(),
    end: endDate.toISOString(),
  };
};

// 月の表示名を取得
const getDisplayMonth = (year: number, month: number): string => {
  return `${year}年${month}月`;
};

// 受付データから月別統計を計算
const calculateMonthlyStats = (
  receptions: any[],
  year: number,
  month: number
): MonthlyStatsData => {
  const { start, end } = getMonthRange(year, month);
  
  // 対象月の受付をフィルタ
  const monthReceptions = receptions.filter(
    (r) => r.timestamp >= start && r.timestamp <= end
  );
  
  // 店舗別集計
  const byStoreMap = new Map<string, { storeId: string; storeName: string; count: number; completedCount: number }>();
  
  monthReceptions.forEach((r) => {
    const storeId = r.selectedStoreId || 'unassigned';
    const storeName = r.selectedStoreName || '未割当';
    
    if (!byStoreMap.has(storeId)) {
      byStoreMap.set(storeId, { storeId, storeName, count: 0, completedCount: 0 });
    }
    
    const store = byStoreMap.get(storeId)!;
    store.count++;
    if (r.status === 'completed') {
      store.completedCount++;
    }
  });
  
  // 平均処理時間の計算（完了した受付のみ）
  const completedReceptions = monthReceptions.filter(
    (r) => r.status === 'completed' && r.completedAt && r.timestamp
  );
  
  let averageProcessingTime: number | undefined;
  if (completedReceptions.length > 0) {
    const totalMinutes = completedReceptions.reduce((sum, r) => {
      const start = new Date(r.timestamp).getTime();
      const end = new Date(r.completedAt).getTime();
      return sum + (end - start) / (1000 * 60);
    }, 0);
    averageProcessingTime = Math.round(totalMinutes / completedReceptions.length);
  }
  
  return {
    month: `${year}-${String(month).padStart(2, '0')}`,
    displayMonth: getDisplayMonth(year, month),
    totalReceptions: monthReceptions.length,
    completedCount: monthReceptions.filter((r) => r.status === 'completed').length,
    cancelledCount: monthReceptions.filter((r) => r.status === 'cancelled').length,
    storePickupCount: monthReceptions.filter((r) => r.deliveryMethod === 'store').length,
    homeDeliveryCount: monthReceptions.filter((r) => r.deliveryMethod === 'home').length,
    averageProcessingTime,
    byStore: Array.from(byStoreMap.values()).sort((a, b) => b.count - a.count),
  };
};

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const monthsToFetch = parseInt(searchParams.get('months') || '6', 10);
    const storeId = searchParams.get('storeId'); // 特定店舗でフィルタ（オプション）
    
    // 現在の日本時間を取得
    const now = new Date();
    const jstOffset = 9 * 60 * 60 * 1000;
    const jstNow = new Date(now.getTime() + jstOffset);
    const currentYear = jstNow.getFullYear();
    const currentMonth = jstNow.getMonth() + 1;
    
    // 過去のデータも含めて取得するため、制限を増やす
    const scanParams: any = {
      TableName: TABLES.PRESCRIPTIONS,
      Limit: 1000, // 統計用に多めに取得
    };
    
    // 店舗フィルタがある場合
    if (storeId) {
      scanParams.FilterExpression = 'selectedStoreId = :storeId';
      scanParams.ExpressionAttributeValues = {
        ':storeId': storeId,
      };
    }
    
    const result = await getDB().send(new ScanCommand(scanParams));
    const allReceptions = result.Items || [];
    
    // 当月の統計
    const currentMonthStats = calculateMonthlyStats(allReceptions, currentYear, currentMonth);
    
    // 過去の月の統計（最大monthsToFetch-1ヶ月分）
    const previousMonths: MonthlyStatsData[] = [];
    let year = currentYear;
    let month = currentMonth;
    
    for (let i = 1; i < monthsToFetch; i++) {
      month--;
      if (month === 0) {
        month = 12;
        year--;
      }
      previousMonths.push(calculateMonthlyStats(allReceptions, year, month));
    }
    
    // 年間累計（1月から現在まで）
    const yearStart = new Date(`${currentYear}-01-01T00:00:00+09:00`).toISOString();
    const yearReceptions = allReceptions.filter((r) => r.timestamp >= yearStart);
    
    const yearToDate = {
      totalReceptions: yearReceptions.length,
      completedCount: yearReceptions.filter((r: any) => r.status === 'completed').length,
      cancelledCount: yearReceptions.filter((r: any) => r.status === 'cancelled').length,
    };
    
    const response: MonthlyStatsResponse = {
      currentMonth: currentMonthStats,
      previousMonths,
      yearToDate,
    };
    
    return NextResponse.json({
      success: true,
      data: response,
    });
  } catch (error) {
    console.error('Error fetching monthly stats:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch monthly stats' },
      { status: 500 }
    );
  }
}
