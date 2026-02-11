/**
 * 認証関連の型定義
 * Cognito User Pool を使用した認証システム
 */

// ユーザーロール
export type UserRole = 'admin' | 'store_staff';

// 認証済みユーザー情報
export interface AuthUser {
  // Cognito User ID
  userId: string;
  
  // ユーザー名（メールアドレス or store ID）
  username: string;
  
  // メールアドレス（管理者とメールアドレスを持つスタッフのみ）
  email?: string;
  
  // ユーザーロール
  role: UserRole;
  
  // 店舗スタッフの場合の店舗ID
  // ・store_xxx 形式でログインした場合: そのstore ID
  // ・メールアドレスでログインした場合: ローカルストレージから取得/設定モーダルで設定
  assignedStoreId?: string;
  
  // 店舗スタッフの場合の店舗名（表示用）
  assignedStoreName?: string;
  
  // Cognitoから取得したカスタム属性
  customAttributes?: {
    // カスタム属性: role
    'custom:role'?: string;
    // カスタム属性: storeId（店舗IDでログインした場合）
    'custom:storeId'?: string;
  };
}

// 認証状態
export interface AuthState {
  // 認証済みかどうか
  isAuthenticated: boolean;
  
  // 認証中（ロード中）かどうか
  isLoading: boolean;
  
  // 認証済みユーザー情報
  user: AuthUser | null;
  
  // エラーメッセージ
  error: string | null;
}

// ログインフォームの入力値
export interface LoginCredentials {
  // メールアドレス or store ID
  username: string;
  
  // パスワード
  password: string;
}

// 管理者メールアドレスリスト
// これらのメールアドレスでログインした場合は管理者ロールとして扱う
export const ADMIN_EMAILS = [
  'admin-vpp-line@granpharma.co.jp',
  'granpharmaline@gmail.com',
];

// 店舗IDのプレフィックス
// store_ で始まるユーザー名は店舗スタッフとして扱う
export const STORE_ID_PREFIX = 'store_';

/**
 * ユーザー名から役割を判定する
 * @param username ユーザー名（メールアドレス or store ID）
 * @returns 役割（admin or store_staff）
 */
export function determineUserRole(username: string): UserRole {
  // 管理者メールアドレスの場合
  if (ADMIN_EMAILS.includes(username.toLowerCase())) {
    return 'admin';
  }
  
  // それ以外はすべて店舗スタッフ
  return 'store_staff';
}

/**
 * 店舗IDかどうかを判定する
 * @param username ユーザー名
 * @returns 店舗IDかどうか
 */
export function isStoreId(username: string): boolean {
  return username.startsWith(STORE_ID_PREFIX);
}

/**
 * ユーザー名から店舗IDを抽出する
 * @param username ユーザー名（store_xxx 形式）
 * @returns 店舗ID（store_xxx）またはnull
 */
export function extractStoreIdFromUsername(username: string): string | null {
  if (isStoreId(username)) {
    return username;
  }
  return null;
}

// ローカルストレージのキー
export const AUTH_STORAGE_KEYS = {
  // メールアドレスログインユーザーの選択店舗
  SELECTED_STORE_ID: 'gacky_prescription_selected_store_id',
  SELECTED_STORE_NAME: 'gacky_prescription_selected_store_name',
};
