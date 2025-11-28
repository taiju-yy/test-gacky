import React, { useState } from 'react';
import { Input } from './ui/input';
import { Button } from './ui/button';

interface CodeInputFormProps {
    onSubmit: (code: string) => Promise<void>;
    loading: boolean;
}

const CodeInputForm: React.FC<CodeInputFormProps> = ({ onSubmit, loading }) => {
    const [code, setCode] = useState('');

    const handleSubmit = () => {
        onSubmit(code);  // verifyCode(false) ではなく、onSubmitを呼び出す
    };

    return (
        <div className="flex space-x-2">
            <Input
                type="text"
                placeholder="6桁の引換コード"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="flex-1"
                maxLength={6}
            />
            <Button
                onClick={handleSubmit}  // 修正
                disabled={loading}
            >
                確認
            </Button>
        </div>
    );
};

export default CodeInputForm;