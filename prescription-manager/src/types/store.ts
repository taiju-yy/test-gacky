/**
 * 店舗データの型定義
 * 
 * Single Source of Truth: src/data/stores-fallback.json
 * DynamoDB テーブル: gacky-prescription-stores-{env}
 */

/**
 * フォールバックJSON用の店舗データ型（lat/lon形式）
 */
export interface StoreFallback {
  storeId: string;
  storeName: string;
  region: string;
  postalCode: string;
  address: string;
  lat: number;
  lon: number;
  lineUrl: string;
  mapUrl: string;
  phone: string;
  businessHours: string;
  storeNote: string | null;
}

/**
 * API/DynamoDB用の店舗データ型（latitude/longitude形式）
 */
export interface Store {
  storeId: string;
  storeName: string;
  region: string;
  postalCode: string;
  address: string;
  latitude: string;
  longitude: string;
  lineUrl: string;
  phone: string;
  mapUrl: string;
  businessHours: string;
  storeNote?: string;
}

/**
 * 地域コード
 */
export type RegionCode = 'kanazawa' | 'kaga' | 'noto';

/**
 * 地域表示名マッピング
 */
export const REGION_NAMES: Record<RegionCode, string> = {
  kanazawa: '金沢市内',
  kaga: '加賀地域',
  noto: '能登地域',
};
