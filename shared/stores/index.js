/**
 * 店舗データ共通モジュール
 * 
 * 信頼できる唯一の情報源（Single Source of Truth）として機能
 * 
 * データ取得優先順位:
 * 1. DynamoDB（gacky-prescription-stores-{env}）
 * 2. フォールバック（ローカルデータ）
 * 
 * 使用方法:
 *   const { getStoreById, storeList, getNearestStores } = require('../shared/stores');
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, GetCommand } = require('@aws-sdk/lib-dynamodb');

// フォールバック用店舗データをJSONファイルから読み込み
// このJSONファイルは prescription-manager からも参照される
const fallbackStoreList = require('./fallback-data.json');

// 環境変数
const ENV = process.env.ENV_EXEC || process.env.NODE_ENV || 'dev';
const TABLE_NAME = process.env.TABLE_STORES || `gacky-prescription-stores-${ENV}`;

// DynamoDB クライアント（遅延初期化）
let dynamoDBClient = null;
let docClient = null;

function getDynamoDBClient() {
  if (!dynamoDBClient) {
    dynamoDBClient = new DynamoDBClient({ region: 'ap-northeast-1' });
    docClient = DynamoDBDocumentClient.from(dynamoDBClient);
  }
  return docClient;
}

// 地域の表示名マッピング
const REGION_NAMES = {
  'kanazawa': '金沢市内',
  'kaga': '加賀地域',
  'noto': '能登地域'
};

// 地域コードマッピング（市区町村名 → 地域コード）
const REGION_MAPPING = {
  '金沢市': 'kanazawa',
  '野々市市': 'kanazawa',
  '河北郡': 'kanazawa',
  '小松市': 'kaga',
  '加賀市': 'kaga',
  '白山市': 'kaga',
  '能美市': 'kaga',
  '七尾市': 'noto',
  '輪島市': 'noto',
  '羽咋市': 'noto',
  '羽咋郡': 'noto',
  '鳳珠郡': 'noto',
};

// キャッシュ（Lambda実行中のメモリ内キャッシュ）
let storeListCache = null;
let cacheTimestamp = null;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5分

/**
 * DynamoDBから店舗リストを取得
 * @returns {Promise<Array>} 店舗リスト
 */
async function fetchStoresFromDynamoDB() {
  try {
    const db = getDynamoDBClient();
    const result = await db.send(new ScanCommand({
      TableName: TABLE_NAME,
    }));

    if (result.Items && result.Items.length > 0) {
      // DynamoDBのデータをフォールバックと同じ形式に正規化
      return result.Items.map(item => ({
        storeId: item.storeId,
        storeName: item.storeName,
        region: item.region,
        postalCode: item.postalCode,
        address: item.address,
        lat: parseFloat(item.latitude || item.lat) || 0,
        lon: parseFloat(item.longitude || item.lon) || 0,
        lineUrl: item.lineUrl || '',
        mapUrl: item.mapUrl || '',
        phone: item.phone || '',
        businessHours: item.businessHours || '',
        storeNote: item.storeNote || null,
      }));
    }
    return null;
  } catch (error) {
    console.error('Error fetching stores from DynamoDB:', error.message);
    return null;
  }
}

/**
 * 店舗リストを取得（DynamoDB優先、フォールバックあり）
 * @param {boolean} forceRefresh - キャッシュを無視して再取得
 * @returns {Promise<Array>} 店舗リスト
 */
async function getStoreList(forceRefresh = false) {
  const now = Date.now();

  // キャッシュが有効ならキャッシュを返す
  if (!forceRefresh && storeListCache && cacheTimestamp && (now - cacheTimestamp < CACHE_TTL_MS)) {
    return storeListCache;
  }

  // DynamoDBから取得を試みる
  const dynamoStores = await fetchStoresFromDynamoDB();

  if (dynamoStores && dynamoStores.length > 0) {
    storeListCache = dynamoStores;
    cacheTimestamp = now;
    console.log(`Loaded ${dynamoStores.length} stores from DynamoDB`);
    return dynamoStores;
  }

  // フォールバック
  console.log('Using fallback store list');
  storeListCache = fallbackStoreList;
  cacheTimestamp = now;
  return fallbackStoreList;
}

/**
 * 店舗IDから店舗情報を取得
 * @param {string} storeId - 店舗ID
 * @returns {Promise<Object|null>} 店舗情報
 */
async function getStoreById(storeId) {
  const stores = await getStoreList();
  return stores.find(store => store.storeId === storeId) || null;
}

/**
 * 店舗IDから店舗情報を取得（同期版 - フォールバックのみ）
 * @param {string} storeId - 店舗ID
 * @returns {Object|null} 店舗情報
 */
function getStoreByIdSync(storeId) {
  // キャッシュがあればキャッシュから
  if (storeListCache) {
    return storeListCache.find(store => store.storeId === storeId) || null;
  }
  // なければフォールバックから
  return fallbackStoreList.find(store => store.storeId === storeId) || null;
}

/**
 * 店舗名から店舗情報を取得
 * @param {string} storeName - 店舗名
 * @returns {Promise<Object|null>} 店舗情報
 */
async function getStoreByName(storeName) {
  const stores = await getStoreList();
  return stores.find(store => store.storeName === storeName) || null;
}

/**
 * 地域で店舗をフィルタリング
 * @param {string} region - 地域 ('kanazawa'|'kaga'|'noto')
 * @returns {Promise<Array>} 店舗リスト
 */
async function getStoresByRegion(region) {
  const stores = await getStoreList();
  return stores.filter(store => store.region === region);
}

/**
 * 地域で店舗をフィルタリング（同期版）
 * @param {string} region - 地域 ('kanazawa'|'kaga'|'noto')
 * @returns {Array} 店舗リスト
 */
function getStoresByRegionSync(region) {
  const stores = storeListCache || fallbackStoreList;
  return stores.filter(store => store.region === region);
}

/**
 * 2点間の距離を計算（Haversine公式）
 * @param {number} lat1 - 緯度1
 * @param {number} lon1 - 経度1
 * @param {number} lat2 - 緯度2
 * @param {number} lon2 - 経度2
 * @returns {number} 距離（km）
 */
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // 地球の半径（km）
  const toRad = (deg) => deg * Math.PI / 180;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

/**
 * 座標から最寄りの店舗を取得（複数）
 * @param {number} lat - 緯度
 * @param {number} lon - 経度
 * @param {number} limit - 取得件数（デフォルト5）
 * @returns {Promise<Array>} 距離付き店舗リスト（近い順）
 */
async function getNearestStores(lat, lon, limit = 5) {
  const stores = await getStoreList();
  const storesWithDistance = stores.map(store => ({
    ...store,
    distance: calculateDistance(lat, lon, store.lat, store.lon)
  }));

  storesWithDistance.sort((a, b) => a.distance - b.distance);
  return storesWithDistance.slice(0, limit);
}

/**
 * 座標から最寄りの店舗を取得（同期版）
 * @param {number} lat - 緯度
 * @param {number} lon - 経度
 * @param {number} limit - 取得件数（デフォルト5）
 * @returns {Array} 距離付き店舗リスト（近い順）
 */
function getNearestStoresSync(lat, lon, limit = 5) {
  const stores = storeListCache || fallbackStoreList;
  const storesWithDistance = stores.map(store => ({
    ...store,
    distance: calculateDistance(lat, lon, store.lat, store.lon)
  }));

  storesWithDistance.sort((a, b) => a.distance - b.distance);
  return storesWithDistance.slice(0, limit);
}

/**
 * QUOカード店舗選択用の簡易店舗リストを取得
 * @returns {Promise<Array>} { id, name, region } 形式のリスト
 */
async function getSimpleStoreList() {
  const stores = await getStoreList();
  return stores.map(store => ({
    id: store.storeId,
    name: store.storeName,
    region: store.region,
  }));
}

/**
 * QUOカード店舗選択用の簡易店舗リストを取得（同期版）
 * @returns {Array} { id, name, region } 形式のリスト
 */
function getSimpleStoreListSync() {
  const stores = storeListCache || fallbackStoreList;
  return stores.map(store => ({
    id: store.storeId,
    name: store.storeName,
    region: store.region,
  }));
}

// 後方互換性のため、同期的に使えるstoreListも公開（フォールバックデータ）
// 注意: 最新データが必要な場合は getStoreList() を使用すること
const storeList = fallbackStoreList;

module.exports = {
  // 定数
  REGION_NAMES,
  REGION_MAPPING,
  TABLE_NAME,

  // 店舗リスト（フォールバック - 後方互換性用）
  storeList,
  fallbackStoreList,

  // 非同期API（推奨）
  getStoreList,
  getStoreById,
  getStoreByName,
  getStoresByRegion,
  getNearestStores,
  getSimpleStoreList,

  // 同期API（キャッシュまたはフォールバック使用）
  getStoreByIdSync,
  getStoresByRegionSync,
  getNearestStoresSync,
  getSimpleStoreListSync,

  // ユーティリティ
  calculateDistance,
};
