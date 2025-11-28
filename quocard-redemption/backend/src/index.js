const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient();
const dynamoDB = DynamoDBDocumentClient.from(client);

// 参照するテーブル
const tableName = process.env.ENV_EXEC === 'prod' 
    ? process.env.NAME_TABLE 
    : process.env.NAME_TABLE_DEV;

function validateEnvironment() {
    const requiredEnvVars = ['STAFF_AUTH_KEY'];
    if (process.env.ENV_EXEC === 'prod') {
        requiredEnvVars.push('NAME_TABLE');
    }
    
    for (const envVar of requiredEnvVars) {
        if (!process.env[envVar]) {
            throw new Error(`Missing required environment variable: ${envVar}`);
        }
    }
}

// 店舗リスト
const STORES = [
    // 金沢市内
    { id: 'store05', name: '津幡店', region: 'kanazawa' },
    { id: 'store06', name: '鞍月店', region: 'kanazawa' },
    { id: 'store07', name: '森本店', region: 'kanazawa' },
    { id: 'store08', name: '橋場町店', region: 'kanazawa' },
    { id: 'store09', name: '三馬店', region: 'kanazawa' },
    { id: 'store10', name: '広岡店', region: 'kanazawa' },
    { id: 'store11', name: '金沢駅西口店', region: 'kanazawa' },
    { id: 'store12', name: 'スクエア香林坊店', region: 'kanazawa' },
    { id: 'store13', name: '桜町店', region: 'kanazawa' },
    { id: 'store14', name: '若草店', region: 'kanazawa' },
    { id: 'store15', name: 'アイリス店', region: 'kanazawa' },
    { id: 'store16', name: '泉が丘店', region: 'kanazawa' },
    { id: 'store17', name: '中央通町店', region: 'kanazawa' },
    { id: 'store18', name: '八日市店', region: 'kanazawa' },
    { id: 'store19', name: '平和町店', region: 'kanazawa' },
    { id: 'store20', name: '香林坊店', region: 'kanazawa' },
    { id: 'store21', name: '無量寺店', region: 'kanazawa' },
    { id: 'store22', name: '矢木店', region: 'kanazawa' },
    { id: 'store34', name: '押野店', region: 'kanazawa' },
    // 加賀地域
    { id: 'store03', name: '加賀温泉駅前店', region: 'kaga' },
    { id: 'store04', name: '山代店', region: 'kaga' },
    { id: 'store29', name: '小馬出店', region: 'kaga' },
    { id: 'store30', name: '小松店', region: 'kaga' },
    { id: 'store31', name: '軽海店', region: 'kaga' },
    { id: 'store32', name: '福留町店', region: 'kaga' },
    // 能登地域
    { id: 'store01', name: '富来店', region: 'noto' },
    { id: 'store02', name: '鶴多店', region: 'noto' },
    { id: 'store23', name: '徳田店', region: 'noto' },
    { id: 'store24', name: '府中店', region: 'noto' },
    { id: 'store25', name: '神明店', region: 'noto' },
    { id: 'store26', name: '和倉店', region: 'noto' },
    { id: 'store27', name: '中島店', region: 'noto' },
    { id: 'store28', name: '能登総合病院前店', region: 'noto' },
    { id: 'store33', name: '宇出津店', region: 'noto' },
    { id: 'store35', name: '輪島店', region: 'noto' }
];

// 店舗情報を取得する関数を追加
function getStoreInfo(storeId) {
    const store = STORES.find(store => store.id === storeId);
    if (!store) {
        throw new Error(`Store not found: ${storeId}`);
    }
    return store;
}

// CORS ヘッダーを含む共通のレスポンスを生成する関数
function createResponse(statusCode, body) {
    return {
        statusCode,
        headers: {
            'Access-Control-Allow-Origin': 'https://main.d15mxnkg2ajjbm.amplifyapp.com',
            'Access-Control-Allow-Methods': 'POST,OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type,Authorization',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    };
}

exports.handler = async (event) => {
    // OPTIONSリクエストの処理を最初に行う
    if (event.httpMethod === 'OPTIONS') {
        return createResponse(200, {});
    }

    console.log('Raw event:', JSON.stringify(event, null, 2));

    // API Gateway プロキシ統合のための変換
    const request = {
        headers: event.headers || {},
        path: event.path || event.rawPath,  // HTTP API v2対応
        httpMethod: event.httpMethod || event.requestContext?.http?.method,  // HTTP API v2対応
        body: event.body
    };
    
    console.log('Processed request:', JSON.stringify(request, null, 2));
    
    console.log('Environment:', {
        STAFF_AUTH_KEY: process.env.STAFF_AUTH_KEY,
        ENV_EXEC: process.env.ENV_EXEC
    });
    
    validateEnvironment();
    
    // Basic認証のチェック
    const auth = request.headers['Authorization'] || request.headers['authorization'] || '';
    console.log('Auth header:', auth);
    
    if (!validateBasicAuth(auth)) {
        return createResponse(401, {
            valid: false,
            message: '店舗IDまたはパスワードが正しくありません'
        });
    }

    try {
        // パスの取得（API Gateway プロキシ統合用）
        const path = event.path || event.resource || '';
        
        // リクエストボディの解析を安全に行う
        let body = {};
        if (event.body) {
            try {
                body = JSON.parse(event.body);
            } catch (e) {
                return createResponse(400, {
                    valid: false,
                    message: '不正なリクエスト形式です'
                });
            }
        }

        // 認証エンドポイント
        if (path.endsWith('/verify-auth')) {
            const { storeId } = extractStoreIdFromAuth(auth);
            try {
                getStoreInfo(storeId);
                return createResponse(200, {
                    valid: true,
                    message: '認証成功'
                });
            } catch (error) {
                return createResponse(401, {
                    valid: false,
                    message: '無効な店舗IDです'
                });
            }
        }

        // verify-code のエンドポイント処理
        if (path.endsWith('/verify-code')) {
            const { code, action } = body;
            const { storeId } = extractStoreIdFromAuth(auth);  // Basic認証からstoreIdを取得

            console.log('Processing request:', { code, action, storeId });
            
            if (!code || !/^\d{6}$/.test(code)) {
                return createResponse(400, {
                    valid: false,
                    message: '6桁の数字を入力してください'
                });
            }

            // 店舗情報の取得
            let storeInfo;
            try {
                storeInfo = getStoreInfo(storeId);
            } catch (error) {
                return createResponse(400, {
                    valid: false,
                    message: '無効な店舗IDです'
                });
            }

            // コードの検索
            const winner = await findWinnerByCode(code);
            console.log('Winner data:', winner);

            if (!winner) {
                return createResponse(200, {
                    valid: false,
                    message: '無効な引き換えコードです'
                });
            }

            // 店舗の確認
            if (winner.storeId !== storeId) {
                return createResponse(200, {  // createResponse を使用
                    valid: false,
                    message: 'このコードは別の店舗で引き換える必要があります'
                });
            }

            // 期限切れチェック
            const now = Math.floor(Date.now() / 1000);
            if (now > winner.expiryDate) {
                return createResponse(200, {  // createResponse を使用
                    valid: false,
                    message: 'このコードは有効期限が切れています'
                });
            }

            // ステータスチェック
            if (winner.status === 'claimed') {
                return createResponse(200, {  // createResponse を使用
                    valid: false,
                    message: 'このコードは既に使用済みです'
                });
            }

            // 引き換え処理
            if (action === 'claim') {
                try {
                    console.log('Claiming code:', {
                        userId: winner.userId,
                        currentStatus: winner.status,
                        newStatus: 'claimed',
                        timestamp: winner.timestamp
                    });
            
                    if (!winner.userId || !winner.timestamp) {
                        console.error('Missing required fields in winner data:', winner);
                        throw new Error('Invalid winner data: missing required fields');
                    }
            
                    const result = await updateWinnerStatus(winner.userId, 'claimed', winner.timestamp);
                    const claimedAt = result.Attributes?.claimedAt || new Date().toISOString();
            
                    console.log('Successfully claimed code');
            
                    return createResponse(200, {
                        valid: true,
                        message: '引き換えが完了しました',
                        storeName: storeInfo.name,
                        region: storeInfo.region,
                        issueDate: winner.timestamp,  // 発行日を保持
                        claimedAt: claimedAt         // 引き換え日時を追加
                    });
                } catch (error) {
                    console.error('Error during claim process:', error);
                    return createResponse(500, {
                        valid: false,
                        message: 'ステータス更新中にエラーが発生しました'
                    });
                }
            }
        
            // 確認処理（verify）の場合
            return createResponse(200, {
                valid: true,
                message: 'コードは有効です',
                storeName: storeInfo.name,
                region: storeInfo.region,
                issueDate: winner.timestamp,
                claimedAt: winner.claimedAt
            });
        }
        // 未知のエンドポイント
        return createResponse(404, {
            valid: false,
            message: '無効なエンドポイントです'
        });
    } catch (error) {
        console.error('Error:', error);
        return createResponse(500, {
            valid: false,
            message: 'システムエラーが発生しました'
        });
    }
};

async function findWinnerByCode(code) {
    console.log('Searching for winner with code:', {
        code,
        tableName,
        indexName: 'redemptionCode-index'
    });

    const params = {
        TableName: tableName,
        IndexName: 'redemptionCode-index',
        KeyConditionExpression: 'redemptionCode = :code',
        ExpressionAttributeValues: {
            ':code': code
        }
    };

    try {
        const result = await dynamoDB.send(new QueryCommand(params));
        console.log('Query result:', {
            itemCount: result.Items?.length,
            firstItem: result.Items?.[0]
        });
        return result.Items?.[0];
    } catch (error) {
        console.error('Error in findWinnerByCode:', error);
        throw error;
    }
}

async function updateWinnerStatus(userId, status, timestamp) {
    if (!userId) {
        throw new Error('userId is required for status update');
    }

    console.log('Updating winner status:', {
        userId,
        status,
        timestamp,
        tableName
    });

    const params = {
        TableName: tableName,
        Key: {
            "userId": userId,         // パーティションキー
            "timestamp": timestamp    // ソートキー
        },
        UpdateExpression: 'SET #s = :status, claimedAt = :claimedAt',
        ExpressionAttributeNames: {
            '#s': 'status'
        },
        ExpressionAttributeValues: {
            ':status': status,
            ':claimedAt': new Date().toISOString()
        },
        ReturnValues: 'ALL_NEW'
    };

    try {
        console.log('DynamoDB update params:', JSON.stringify(params, null, 2));
        const result = await dynamoDB.send(new UpdateCommand(params));
        console.log('Update success. New item:', JSON.stringify(result.Attributes, null, 2));
        return result;
    } catch (error) {
        console.error('DynamoDB update error:', {
            message: error.message,
            code: error.code,
            statusCode: error.statusCode,
            params: JSON.stringify(params, null, 2)
        });
        throw error;
    }
}

function validateBasicAuth(auth) {
    if (!auth.startsWith('Basic ')) {
        console.log('Invalid auth format - missing Basic prefix');
        return false;
    }
    
    try {
        const [username, password] = Buffer.from(auth.slice(6), 'base64')
            .toString()
            .split(':');
        
        console.log('Auth debug:', {
            receivedUsername: username,
            receivedPassword: password,
            expectedKey: process.env.STAFF_AUTH_KEY,
            passwordMatch: password === process.env.STAFF_AUTH_KEY
        });
        
        // ユーザー名は店舗ID、パスワードは共通の秘密キー
        return password === process.env.STAFF_AUTH_KEY;
    } catch (error) {
        console.log('Auth parsing error:', error);
        return false;
    }
}

function extractStoreIdFromAuth(auth) {
    const [username] = Buffer.from(auth.slice(6), 'base64')
        .toString()
        .split(':');
    return { storeId: username };
}