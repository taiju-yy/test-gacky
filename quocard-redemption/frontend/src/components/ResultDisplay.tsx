import React from 'react';
import { Alert, AlertDescription } from './ui/alert';
import { Button } from './ui/button';
import type { ResultType } from '../types';

interface ResultDisplayProps {
    result: ResultType;
    onClaim: () => void;  // Promise<void> から void に変更
    loading: boolean;
}

const ResultDisplay: React.FC<ResultDisplayProps> = ({ result, onClaim, loading }) => {
    return (
        <Alert className={result.valid ? 'bg-green-50' : 'bg-red-50'}>
            <AlertDescription>
                {result.valid ? (
                    <div className="text-green-700">
                        <p>✓ {result.message}</p>
                        <p>店舗: {result.storeName || '-'}</p>
                        {result.claimedAt ? (
                            <p>引き換え日時: {new Date(result.claimedAt).toLocaleString()}</p>
                        ) : (
                            <p>発行日: {result.issueDate ? new Date(result.issueDate).toLocaleString() : '-'}</p>
                        )}
                        {!result.claimedAt && (
                            <Button
                                onClick={onClaim}  // verifyCode(true)ではなく、onClaimを呼び出す
                                disabled={loading}
                                className="mt-4 w-full bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded shadow-lg"
                                variant="default"
                            >
                                QUOカードを引き換える
                            </Button>
                        )}
                    </div>
                ) : (
                    <div className="text-red-700">
                        ✗ {result.message}
                    </div>
                )}
            </AlertDescription>
        </Alert>
    );
};

export default ResultDisplay;