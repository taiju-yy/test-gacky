import React, { useState } from 'react';
import { Card, CardHeader, CardContent, CardTitle } from './ui/card';
import { Input } from './ui/input';
import { Button } from './ui/button';
import type { Credentials } from '../types';

interface LoginFormProps {
    onLogin: (credentials: Credentials) => Promise<void>;
}

const LoginForm: React.FC<LoginFormProps> = ({ onLogin }) => {
    const [credentials, setCredentials] = useState<Credentials>({
        username: '',
        password: ''
    });

    const handleSubmit = () => {
        onLogin(credentials);  // handleLoginではなく、onLoginを呼び出す
    };

    return (
        <Card className="max-w-md mx-auto">
            <CardHeader>
                <CardTitle>スタッフログイン</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                <Input
                    type="text"
                    placeholder="店舗ID"
                    value={credentials.username}
                    onChange={(e) => setCredentials(prev => ({
                        ...prev,
                        username: e.target.value
                    }))}
                />
                <Input
                    type="password"
                    placeholder="パスワード"
                    value={credentials.password}
                    onChange={(e) => setCredentials(prev => ({
                        ...prev,
                        password: e.target.value
                    }))}
                />
                <Button
                    onClick={handleSubmit}
                    className="w-full"
                >
                    ログイン
                </Button>
            </CardContent>
        </Card>
    );
};

export default LoginForm;