/**
 * Cognito認証ユーティリティ
 * AWS Amplify v6 を使用
 */

import { Amplify } from 'aws-amplify';
import {
  signIn,
  signOut,
  getCurrentUser,
  fetchAuthSession,
  AuthError,
} from 'aws-amplify/auth';
import {
  AuthUser,
  UserRole,
  determineUserRole,
  isStoreId,
  extractStoreIdFromUsername,
  AUTH_STORAGE_KEYS,
} from '@/types/auth';

// Amplifyの設定フラグ
let isAmplifyConfigured = false;

/**
 * Amplifyを設定する（クライアントサイドのみ）
 */
export function configureAmplify(): void {
  if (typeof window === 'undefined') {
    return; // サーバーサイドでは実行しない
  }
  
  if (isAmplifyConfigured) {
    return; // 既に設定済み
  }

  const userPoolId = process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID;
  const userPoolClientId = process.env.NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID;
  const region = process.env.NEXT_PUBLIC_AWS_REGION || 'ap-northeast-1';

  if (!userPoolId || !userPoolClientId) {
    console.error('[Auth] Cognito configuration missing. Please set environment variables.');
    return;
  }

  try {
    Amplify.configure({
      Auth: {
        Cognito: {
          userPoolId,
          userPoolClientId,
          loginWith: {
            username: true,
            email: true,
          },
        },
      },
    });
    
    isAmplifyConfigured = true;
    console.log('[Auth] Amplify configured successfully');
  } catch (error) {
    console.error('[Auth] Failed to configure Amplify:', error);
  }
}

/**
 * サインイン
 * @param username ユーザー名（メールアドレス or store ID）
 * @param password パスワード
 * @returns 認証済みユーザー情報
 */
export async function signInUser(username: string, password: string): Promise<AuthUser> {
  configureAmplify();
  
  try {
    // Cognitoにサインイン
    const signInResult = await signIn({
      username: username.toLowerCase().trim(),
      password,
    });
    
    console.log('[Auth] Sign in result:', signInResult.isSignedIn);
    
    if (!signInResult.isSignedIn) {
      // パスワード変更が必要な場合などの追加ステップ
      if (signInResult.nextStep?.signInStep === 'CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED') {
        throw new Error('初回ログイン時はパスワードの変更が必要です。管理者にお問い合わせください。');
      }
      throw new Error('ログインに失敗しました。');
    }
    
    // 現在のユーザー情報を取得
    const cognitoUser = await getCurrentUser();
    
    // ユーザーロールを判定
    const role = determineUserRole(username);
    
    // AuthUserオブジェクトを構築
    const authUser: AuthUser = {
      userId: cognitoUser.userId,
      username: cognitoUser.username,
      role,
    };
    
    // メールアドレスの場合
    if (username.includes('@')) {
      authUser.email = username.toLowerCase().trim();
    }
    
    // 店舗IDの場合、店舗IDを設定
    const storeIdFromUsername = extractStoreIdFromUsername(username);
    if (storeIdFromUsername) {
      authUser.assignedStoreId = storeIdFromUsername;
    } else if (role === 'store_staff') {
      // メールアドレスログインの店舗スタッフの場合、ローカルストレージから店舗IDを取得
      const savedStoreId = localStorage.getItem(AUTH_STORAGE_KEYS.SELECTED_STORE_ID);
      const savedStoreName = localStorage.getItem(AUTH_STORAGE_KEYS.SELECTED_STORE_NAME);
      if (savedStoreId) {
        authUser.assignedStoreId = savedStoreId;
        authUser.assignedStoreName = savedStoreName || undefined;
      }
    }
    
    return authUser;
  } catch (error) {
    console.error('[Auth] Sign in error:', error);
    
    if (error instanceof AuthError) {
      switch (error.name) {
        case 'NotAuthorizedException':
          throw new Error('メールアドレス/IDまたはパスワードが正しくありません。');
        case 'UserNotFoundException':
          throw new Error('ユーザーが見つかりません。');
        case 'UserNotConfirmedException':
          throw new Error('ユーザー確認が完了していません。管理者にお問い合わせください。');
        default:
          throw new Error(`認証エラー: ${error.message}`);
      }
    }
    
    throw error;
  }
}

/**
 * サインアウト
 */
export async function signOutUser(): Promise<void> {
  configureAmplify();
  
  try {
    await signOut();
    console.log('[Auth] Signed out successfully');
  } catch (error) {
    console.error('[Auth] Sign out error:', error);
    throw new Error('ログアウトに失敗しました。');
  }
}

/**
 * 現在の認証済みユーザーを取得
 * @returns 認証済みユーザー情報（未認証の場合はnull）
 */
export async function getCurrentAuthUser(): Promise<AuthUser | null> {
  configureAmplify();
  
  try {
    const cognitoUser = await getCurrentUser();
    const session = await fetchAuthSession();
    
    if (!cognitoUser || !session.tokens) {
      return null;
    }
    
    const username = cognitoUser.username;
    const role = determineUserRole(username);
    
    const authUser: AuthUser = {
      userId: cognitoUser.userId,
      username,
      role,
    };
    
    // メールアドレスの場合
    if (username.includes('@')) {
      authUser.email = username.toLowerCase().trim();
    }
    
    // 店舗IDの場合
    const storeIdFromUsername = extractStoreIdFromUsername(username);
    if (storeIdFromUsername) {
      authUser.assignedStoreId = storeIdFromUsername;
    } else if (role === 'store_staff') {
      // メールアドレスログインの店舗スタッフの場合、ローカルストレージから店舗IDを取得
      if (typeof window !== 'undefined') {
        const savedStoreId = localStorage.getItem(AUTH_STORAGE_KEYS.SELECTED_STORE_ID);
        const savedStoreName = localStorage.getItem(AUTH_STORAGE_KEYS.SELECTED_STORE_NAME);
        if (savedStoreId) {
          authUser.assignedStoreId = savedStoreId;
          authUser.assignedStoreName = savedStoreName || undefined;
        }
      }
    }
    
    return authUser;
  } catch (error) {
    // 未認証の場合はnullを返す
    console.log('[Auth] No authenticated user');
    return null;
  }
}

/**
 * セッションが有効かどうかをチェック
 * @returns セッションが有効かどうか
 */
export async function isSessionValid(): Promise<boolean> {
  configureAmplify();
  
  try {
    const session = await fetchAuthSession();
    return !!session.tokens?.accessToken;
  } catch (error) {
    return false;
  }
}

/**
 * 店舗スタッフの選択店舗を保存（メールアドレスログインの場合）
 * @param storeId 店舗ID
 * @param storeName 店舗名
 */
export function saveSelectedStore(storeId: string, storeName: string): void {
  if (typeof window === 'undefined') return;
  
  localStorage.setItem(AUTH_STORAGE_KEYS.SELECTED_STORE_ID, storeId);
  localStorage.setItem(AUTH_STORAGE_KEYS.SELECTED_STORE_NAME, storeName);
  console.log('[Auth] Saved selected store:', storeId, storeName);
}

/**
 * 店舗スタッフの選択店舗をクリア
 */
export function clearSelectedStore(): void {
  if (typeof window === 'undefined') return;
  
  localStorage.removeItem(AUTH_STORAGE_KEYS.SELECTED_STORE_ID);
  localStorage.removeItem(AUTH_STORAGE_KEYS.SELECTED_STORE_NAME);
  console.log('[Auth] Cleared selected store');
}

/**
 * 店舗スタッフの選択店舗を取得
 * @returns { storeId, storeName } または null
 */
export function getSelectedStore(): { storeId: string; storeName: string } | null {
  if (typeof window === 'undefined') return null;
  
  const storeId = localStorage.getItem(AUTH_STORAGE_KEYS.SELECTED_STORE_ID);
  const storeName = localStorage.getItem(AUTH_STORAGE_KEYS.SELECTED_STORE_NAME);
  
  if (storeId && storeName) {
    return { storeId, storeName };
  }
  return null;
}
