"use client";

import React, { useState, useEffect } from 'react';
import { Card, CardHeader, CardContent, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { LogOut } from 'lucide-react';
import LoginForm from './LoginForm';
import CodeInputForm from './CodeInputForm';
import ResultDisplay from './ResultDisplay';
import type { ResultType, Credentials } from '../types';

const StaffVerification = () => {
    const [result, setResult] = useState<ResultType | null>(null);
    const [loading, setLoading] = useState<boolean>(false);
    const [authenticated, setAuthenticated] = useState<boolean>(false);
    const [currentStore, setCurrentStore] = useState<string>('');

    useEffect(() => {
        const validateAuth = async () => {
            const auth = localStorage.getItem('staffAuth');
            if (!auth) return;

            try {
                const response = await fetch(`${process.env.NEXT_PUBLIC_LAMBDA_ENDPOINT}/verify-auth`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Basic ${auth}`,
                        'Content-Type': 'application/json'
                    }
                });

                const data = await response.json();
                if (response.ok && data.valid) {
                    setAuthenticated(true);
                    const [storeId] = atob(auth).split(':');
                    setCurrentStore(storeId);
                } else {
                    localStorage.removeItem('staffAuth');
                    setAuthenticated(false);
                }
            } catch (error) {
                console.error('認証検証エラー:', error);
                localStorage.removeItem('staffAuth');
                setAuthenticated(false);
            }
        };

        validateAuth();
    }, []);

    const handleLogin = async (credentials: Credentials) => {
        const authString = btoa(`${credentials.username}:${credentials.password}`);
        try {
            const response = await fetch(`${process.env.NEXT_PUBLIC_LAMBDA_ENDPOINT}/verify-auth`, {
                method: 'POST',
                headers: {
                    'Authorization': `Basic ${authString}`,
                    'Content-Type': 'application/json'
                }
            });
            
            const data = await response.json();
            
            if (response.ok && data.valid) {
                localStorage.setItem('staffAuth', authString);
                setAuthenticated(true);
                setCurrentStore(credentials.username);
            } else {
                alert(data.message || '認証に失敗しました');
            }
        } catch (error) {
            console.error('ログインエラー:', error);
            alert('ネットワークエラーが発生しました');
        }
    };

    const handleLogout = () => {
        localStorage.removeItem('staffAuth');
        setAuthenticated(false);
        setCurrentStore('');
        setResult(null);
    };

    const verifyCode = async (code: string, claim = false) => {
        if (!/^\d{6}$/.test(code)) {
            setResult({
                valid: false,
                message: '6桁の数字を入力してください'
            });
            return;
        }
    
        setLoading(true);
        try {
            const authString = localStorage.getItem('staffAuth');
            const response = await fetch(`${process.env.NEXT_PUBLIC_LAMBDA_ENDPOINT}/verify-code`, {
                method: 'POST',
                headers: {
                    'Authorization': `Basic ${authString}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    code,
                    action: claim ? 'claim' : 'verify'
                })
            });
    
            if (response.status === 401) {
                localStorage.removeItem('staffAuth');
                setAuthenticated(false);
                return;
            }
    
            const data = await response.json() as ResultType;
            setResult({
                ...data,
                code  // 検証時のコードを保存
            });
        } catch (error) {
            console.error('コード検証エラー:', error);
            setResult({
                valid: false,
                message: 'エラーが発生しました',
                code: code  // codeを追加
            });
        }
        setLoading(false);
    };

    if (!authenticated) {
        return (
            <div className="container mx-auto p-4">
                <LoginForm onLogin={handleLogin} />
            </div>
        );
    }

    return (
        <div className="container mx-auto p-4">
            <Card className="max-w-md mx-auto">
                <CardHeader className="flex flex-row items-center justify-between space-x-4">
                    <div className="flex-1 min-w-0">  {/* min-w-0 を追加してテキストの折り返しを制御 */}
                        <CardTitle className="text-xl whitespace-nowrap overflow-hidden text-ellipsis">
                            QUOカード引換コード確認
                        </CardTitle>
                        <p className="text-sm text-gray-500 mt-1 whitespace-nowrap overflow-hidden text-ellipsis">
                            ログイン中: {currentStore}
                        </p>
                    </div>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleLogout}
                        className="text-gray-500 hover:text-gray-700 shrink-0"
                    >
                        <LogOut className="h-4 w-4 mr-2" />
                        <span className="hidden sm:inline">別の店舗で確認</span>
                        <span className="sm:hidden">ログアウト</span>
                    </Button>
                </CardHeader>                <CardContent>
                    <div className="space-y-4">
                        <CodeInputForm 
                            onSubmit={(code) => verifyCode(code, false)}
                            loading={loading}
                        />

                        {result && (
                            <ResultDisplay
                                result={result}
                                onClaim={async () => {
                                    if (result.code) {
                                        await verifyCode(result.code, true);
                                    }
                                }}
                                loading={loading}
                            />
                        )}
                    </div>
                </CardContent>
            </Card>
        </div>
    );
};

export default StaffVerification;