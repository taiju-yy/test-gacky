'use client';

/**
 * 認証コンテキスト
 * アプリケーション全体で認証状態を管理する
 */

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { AuthUser, AuthState } from '@/types/auth';
import {
  signInUser,
  signOutUser,
  getCurrentAuthUser,
  saveSelectedStore,
  getSelectedStore,
  configureAmplify,
} from '@/lib/auth';

// コンテキストの型
interface AuthContextType extends AuthState {
  // サインイン
  login: (username: string, password: string) => Promise<void>;
  
  // サインアウト
  logout: () => Promise<void>;
  
  // 店舗を設定（メールアドレスログインの店舗スタッフ用）
  setSelectedStore: (storeId: string, storeName: string) => void;
  
  // ユーザー情報をリフレッシュ
  refreshUser: () => Promise<void>;
  
  // 管理者かどうか
  isAdmin: boolean;
  
  // 店舗スタッフかどうか
  isStoreStaff: boolean;
  
  // 店舗が設定済みかどうか（店舗スタッフ用）
  hasStoreAssigned: boolean;
}

// デフォルト値
const defaultAuthState: AuthState = {
  isAuthenticated: false,
  isLoading: true,
  user: null,
  error: null,
};

// コンテキスト作成
const AuthContext = createContext<AuthContextType | undefined>(undefined);

// プロバイダーProps
interface AuthProviderProps {
  children: ReactNode;
}

/**
 * 認証プロバイダー
 */
export function AuthProvider({ children }: AuthProviderProps) {
  const [authState, setAuthState] = useState<AuthState>(defaultAuthState);
  const router = useRouter();

  // 初期化時に認証状態を確認
  useEffect(() => {
    const initAuth = async () => {
      try {
        // Amplifyを設定
        configureAmplify();
        
        // 現在の認証済みユーザーを取得
        const user = await getCurrentAuthUser();
        
        if (user) {
          // 店舗スタッフでメールアドレスログインの場合、ローカルストレージから店舗情報を取得
          if (user.role === 'store_staff' && !user.assignedStoreId) {
            const savedStore = getSelectedStore();
            if (savedStore) {
              user.assignedStoreId = savedStore.storeId;
              user.assignedStoreName = savedStore.storeName;
            }
          }
          
          setAuthState({
            isAuthenticated: true,
            isLoading: false,
            user,
            error: null,
          });
        } else {
          setAuthState({
            isAuthenticated: false,
            isLoading: false,
            user: null,
            error: null,
          });
        }
      } catch (error) {
        console.error('[AuthContext] Init error:', error);
        setAuthState({
          isAuthenticated: false,
          isLoading: false,
          user: null,
          error: null,
        });
      }
    };

    initAuth();
  }, []);

  // ログイン
  const login = useCallback(async (username: string, password: string) => {
    setAuthState((prev) => ({ ...prev, isLoading: true, error: null }));
    
    try {
      const user = await signInUser(username, password);
      
      setAuthState({
        isAuthenticated: true,
        isLoading: false,
        user,
        error: null,
      });
      
      // ダッシュボードにリダイレクト
      router.push('/');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'ログインに失敗しました。';
      setAuthState((prev) => ({
        ...prev,
        isLoading: false,
        error: errorMessage,
      }));
      throw error;
    }
  }, [router]);

  // ログアウト
  const logout = useCallback(async () => {
    setAuthState((prev) => ({ ...prev, isLoading: true }));
    
    try {
      await signOutUser();
      
      setAuthState({
        isAuthenticated: false,
        isLoading: false,
        user: null,
        error: null,
      });
      
      // ログインページにリダイレクト
      router.push('/login');
    } catch (error) {
      console.error('[AuthContext] Logout error:', error);
      // エラーでも状態をリセット
      setAuthState({
        isAuthenticated: false,
        isLoading: false,
        user: null,
        error: null,
      });
      router.push('/login');
    }
  }, [router]);

  // 店舗を設定
  const setSelectedStoreHandler = useCallback((storeId: string, storeName: string) => {
    // ローカルストレージに保存
    saveSelectedStore(storeId, storeName);
    
    // 状態を更新
    setAuthState((prev) => {
      if (!prev.user) return prev;
      return {
        ...prev,
        user: {
          ...prev.user,
          assignedStoreId: storeId,
          assignedStoreName: storeName,
        },
      };
    });
  }, []);

  // ユーザー情報をリフレッシュ
  const refreshUser = useCallback(async () => {
    try {
      const user = await getCurrentAuthUser();
      if (user) {
        // 店舗スタッフでメールアドレスログインの場合
        if (user.role === 'store_staff' && !user.assignedStoreId) {
          const savedStore = getSelectedStore();
          if (savedStore) {
            user.assignedStoreId = savedStore.storeId;
            user.assignedStoreName = savedStore.storeName;
          }
        }
        
        setAuthState({
          isAuthenticated: true,
          isLoading: false,
          user,
          error: null,
        });
      }
    } catch (error) {
      console.error('[AuthContext] Refresh error:', error);
    }
  }, []);

  // 計算プロパティ
  const isAdmin = authState.user?.role === 'admin';
  const isStoreStaff = authState.user?.role === 'store_staff';
  const hasStoreAssigned = !!authState.user?.assignedStoreId;

  const value: AuthContextType = {
    ...authState,
    login,
    logout,
    setSelectedStore: setSelectedStoreHandler,
    refreshUser,
    isAdmin,
    isStoreStaff,
    hasStoreAssigned,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

/**
 * 認証コンテキストを使用するフック
 */
export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

/**
 * 認証が必要なページで使用するフック
 * 未認証の場合はログインページにリダイレクト
 */
export function useRequireAuth(): AuthContextType {
  const auth = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!auth.isLoading && !auth.isAuthenticated) {
      router.push('/login');
    }
  }, [auth.isLoading, auth.isAuthenticated, router]);

  return auth;
}

/**
 * 管理者権限が必要なページで使用するフック
 */
export function useRequireAdmin(): AuthContextType {
  const auth = useRequireAuth();
  const router = useRouter();

  useEffect(() => {
    if (!auth.isLoading && auth.isAuthenticated && !auth.isAdmin) {
      // 管理者でない場合はダッシュボードにリダイレクト
      router.push('/');
    }
  }, [auth.isLoading, auth.isAuthenticated, auth.isAdmin, router]);

  return auth;
}
