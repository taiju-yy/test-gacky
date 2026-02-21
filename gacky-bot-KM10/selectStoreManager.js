const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient();
const dynamoDB = DynamoDBDocumentClient.from(client);

// 地域の表示名マッピング
const REGION_NAMES = {
    'kanazawa': '金沢市内',
    'kaga': '加賀地域',
    'noto': '能登地域'
};

// 店舗リスト
// 注意: IDは store_XXX 形式（3桁ゼロパディング）に統一
// prescription-manager/src/app/api/stores/route.ts および gacky-bot-KM10/storeList.js と一致させること
const STORES = [
    // 金沢市内
    { id: 'store_005', name: '津幡店', region: 'kanazawa' },
    { id: 'store_006', name: '鞍月店', region: 'kanazawa' },
    { id: 'store_007', name: '森本店', region: 'kanazawa' },
    { id: 'store_008', name: '橋場町店', region: 'kanazawa' },
    { id: 'store_009', name: '三馬店', region: 'kanazawa' },
    { id: 'store_010', name: '広岡店', region: 'kanazawa' },
    { id: 'store_011', name: '金沢駅西口店', region: 'kanazawa' },
    { id: 'store_013', name: '桜町店', region: 'kanazawa' },
    { id: 'store_014', name: '若草店', region: 'kanazawa' },
    { id: 'store_015', name: 'アイリス店', region: 'kanazawa' },
    { id: 'store_016', name: '泉が丘店', region: 'kanazawa' },
    { id: 'store_017', name: '中央通町店', region: 'kanazawa' },
    { id: 'store_018', name: '八日市店', region: 'kanazawa' },
    { id: 'store_019', name: '平和町店', region: 'kanazawa' },
    { id: 'store_020', name: '香林坊店', region: 'kanazawa' },
    { id: 'store_021', name: '無量寺店', region: 'kanazawa' },
    { id: 'store_022', name: '矢木店', region: 'kanazawa' },
    { id: 'store_034', name: '押野店', region: 'kanazawa' },
    { id: 'store_036', name: '北中条店', region: 'kanazawa' },
    { id: 'store_037', name: '片町店', region: 'kanazawa' },
    { id: 'store_038', name: 'アルコ店', region: 'kanazawa' },
    // 加賀地域
    { id: 'store_003', name: '加賀温泉駅前店', region: 'kaga' },
    { id: 'store_004', name: '山代店', region: 'kaga' },
    { id: 'store_029', name: '小馬出店', region: 'kaga' },
    { id: 'store_030', name: '小松店', region: 'kaga' },
    { id: 'store_031', name: '軽海店', region: 'kaga' },
    { id: 'store_032', name: '福留町店', region: 'kaga' },
    // 能登地域
    { id: 'store_001', name: '富来店', region: 'noto' },
    { id: 'store_002', name: '鶴多店', region: 'noto' },
    { id: 'store_023', name: '徳田店', region: 'noto' },
    { id: 'store_024', name: '府中店', region: 'noto' },
    { id: 'store_025', name: '神明店', region: 'noto' },
    { id: 'store_026', name: '和倉店', region: 'noto' },
    { id: 'store_027', name: '中島店', region: 'noto' },
    { id: 'store_028', name: '能登総合病院前店', region: 'noto' },
    { id: 'store_033', name: '宇出津店', region: 'noto' },
    { id: 'store_035', name: '輪島店', region: 'noto' }
];

// エラー定数
const ERRORS = {
    NOT_WINNER: 'NOT_WINNER',
    ALREADY_CLAIMED: 'ALREADY_CLAIMED',
    INVALID_STORE: 'INVALID_STORE',
    STORE_CHANGE_INVALID: 'STORE_CHANGE_INVALID'
};

// コマンド定数を拡張
const COMMANDS = {
    SELECT_STORE: '#cmd_select_store',
    CHANGE_STORE: '#cmd_change_store',
    CONFIRM_CHANGE: '#cmd_confirm_change',
    CANCEL_CHANGE: '#cmd_cancel_change',
    SELECT_REGION: 'region:',
    STORE_PAGE: 'page:'
};

// 参照するテーブル
let winnersTable = process.env.WINNERS_TABLE;
if ( 'dev' === process.env.ENV_EXEC ) {
    winnersTable = process.env.WINNERS_TABLE_DEV;
}

// 地域選択メッセージの作成
function createRegionSelectionMessage() {
    return {
        type: 'text',
        text: 'QUOカードを受け取りたい店舗の地域を選択してください。',
        quickReply: {
            items: Object.entries(REGION_NAMES).map(([key, name]) => ({
                type: 'action',
                action: {
                    type: 'postback',
                    label: name,
                    data: `${COMMANDS.SELECT_REGION}${key}`,
                    displayText: name // ユーザーに表示するテキスト
                }
            }))
        }
    };
}

// 地域に基づく店舗選択メッセージの作成
function createStoreListMessage(regionCode, page = 1) {
    const stores = STORES.filter(store => store.region === regionCode);
    const STORES_PER_PAGE = 10;  // 1ページあたりの店舗数（ページネーションボタン用に余裕を持たせる）
    const totalPages = Math.ceil(stores.length / STORES_PER_PAGE);
    
    // ページ番号の正規化
    page = Math.max(1, Math.min(page, totalPages));
    
    // 現在のページの店舗を取得
    const startIndex = (page - 1) * STORES_PER_PAGE;
    const currentStores = stores.slice(startIndex, startIndex + STORES_PER_PAGE);
    
    // クイックリプライアイテムを作成
    const storeItems = currentStores.map(store => ({
        type: 'action',
        action: {
            type: 'postback',
            label: store.name,
            data: `store:${store.id}`,
            displayText: store.name
        }
    }));
    
    // ページネーションボタンを準備
    const paginationItems = [];
    
    // 前のページボタン
    if (page > 1) {
        paginationItems.push({
            type: 'action',
            action: {
                type: 'postback',
                label: '◀️ 前へ',
                data: `${COMMANDS.STORE_PAGE}${regionCode}:${page - 1}`,
                displayText: '前のページへ'
            }
        });
    }
    
    // 次のページボタン
    if (page < totalPages) {
        paginationItems.push({
            type: 'action',
            action: {
                type: 'postback',
                label: '次へ ▶️',
                data: `${COMMANDS.STORE_PAGE}${regionCode}:${page + 1}`,
                displayText: '次のページへ'
            }
        });
    }

    // メッセージテキストの作成
    let messageText = `${REGION_NAMES[regionCode]}の受取店舗一覧`;
    if (totalPages > 1) {
        messageText += `\n(${page}/${totalPages}ページ)`;
    }
    messageText += '\n\n下のボタンから選択してください。';
    
    return {
        type: 'text',
        text: messageText,
        quickReply: {
            items: [...storeItems, ...paginationItems]
        }
    };
}

// 店舗選択メッセージの作成
function createStoreSelectionMessage() {
    const storeGroups = chunk(STORES, 9);
    return {
        type: 'template',
        altText: 'QUOカードを受け取りたい店舗を選択してください',
        template: {
            type: 'carousel',
            columns: storeGroups.map((group, index) => ({
                title: `受取店舗選択 (${index + 1}/${Math.ceil(STORES.length / 9)})`,
                text: '下記から選択してください',
                actions: group.map(store => ({
                    type: 'message',
                    label: store.name,
                    text: store.name // 表示テキストを店舗名に変更
                }))
            }))
        }
    };
}

// 店舗変更確認メッセージの作成
function createChangeStoreMessage() {
    return {
        type: 'text',
        text: '既に受取店舗を選択済みです。変更しますか？',
        quickReply: {
            items: [
                {
                    type: 'action',
                    action: {
                        type: 'postback',
                        label: 'はい、変更します',
                        data: COMMANDS.CONFIRM_CHANGE,
                        displayText: 'はい、変更します'
                    }
                },
                {
                    type: 'action',
                    action: {
                        type: 'postback',
                        label: 'そのままで',
                        data: COMMANDS.CANCEL_CHANGE,
                        displayText: 'そのままで'
                    }
                }
            ]
        }
    };
}

// メインのハンドラー関数
async function handleStoreCommand(userId, command) {
    try {
        // 当選者確認
        const winner = await checkWinnerStatus(userId);
        if (!winner) {
            throw new Error(ERRORS.NOT_WINNER);
        }

        // コマンドに応じて処理を分岐
        if (command === COMMANDS.SELECT_STORE) {
            if (winner.status === 'store_selected') {
                return createChangeStoreMessage();
            }
            return createRegionSelectionMessage();
        }
        
        if (command.startsWith(COMMANDS.SELECT_REGION)) {
            const regionCode = command.replace(COMMANDS.SELECT_REGION, '');
            return createStoreListMessage(regionCode, 1);  // 最初のページを表示
        }
        
        if (command.startsWith(COMMANDS.STORE_PAGE)) {
            const [regionCode, page] = command.replace(COMMANDS.STORE_PAGE, '').split(':');
            return createStoreListMessage(regionCode, parseInt(page));
        }

        // コマンドに応じて処理を分岐
        switch (command) {
            case COMMANDS.CHANGE_STORE:
                return createRegionSelectionMessage();
            case COMMANDS.CONFIRM_CHANGE:
                if (winner.status !== 'store_selected') {
                    throw new Error(ERRORS.STORE_CHANGE_INVALID);
                }
                await resetStoreSelection(userId);
                return createRegionSelectionMessage();

            case COMMANDS.CANCEL_CHANGE:
                return {
                    type: 'text',
                    text: '受取店舗変更をキャンセルしました。',
                    quickReply: {
                        items: [{
                            type: 'action',
                            action: {
                                type: 'message',
                                label: '受取店舗を変更する',
                                text: COMMANDS.CHANGE_STORE
                            }
                        }]
                    }
                };

            default:
                if (command.startsWith('store:')) {
                    const storeId = command.replace('store:', '');
                    return await handleStoreSelection(userId, storeId, winner);
                }        
                return null;
        }
    } catch (error) {
        console.error('Error in handleStoreCommand:', error);
        console.log('Error message:', error.message);

        // カスタムエラーメッセージの判定
        switch (error.message) {
            case ERRORS.NOT_WINNER:
                console.log('Returning NOT_WINNER message');  // 追加
                return {
                    type: 'text',
                    text: '申し訳ありませんが、このサービスは当選者のみご利用いただけます。'
                };
            case ERRORS.ALREADY_CLAIMED:
                return {
                    type: 'text',
                    text: 'すでにQUOカードを受け取り済みです。'
                };
            case ERRORS.INVALID_STORE:
                return {
                    type: 'text',
                    text: '無効な店舗が選択されました。もう一度受取店舗を選択してください。'
                };
            case ERRORS.STORE_CHANGE_INVALID:
                return {
                    type: 'text',
                    text: '受取店舗変更の手続きが正しくありません。最初からやり直してください。'
                };
            default:
                console.log('Returning default error message');  // 追加
                return {
                    type: 'text',
                    text: 'エラーが発生しました。しばらく時間をおいて再度お試しください。\n\n[エラーコード: GAJR-20001]'
                };
        }
    }
}

// 店舗選択の処理
async function handleStoreSelection(userId, storeId, winner) {
    const store = STORES.find(s => s.id === storeId);
    if (!store) {
        throw new Error(ERRORS.INVALID_STORE);
    }
    
    if (winner.status === 'claimed') {
        throw new Error(ERRORS.ALREADY_CLAIMED);
    }

    // 引換コード生成（変更の場合は既存のコードを使用）
    const redemptionCode = winner.redemptionCode || String(Math.floor(100000 + Math.random() * 900000));

    // DynamoDBを更新
    await updateWinnerStatus(userId, storeId, redemptionCode);

    return {
        type: 'text',
        text: `受取店舗選択が完了しました！\n\n■ 選択店舗\n${store.name}\n\n■ 引換コード\n${redemptionCode}\n\n※このコードを店舗スタッフにお見せください\n※引換期限は2025年5月31日までです`,
        quickReply: {
            items: [{
                type: 'action',
                action: {
                    type: 'postback',
                    label: '受取店舗を変更する',
                    data: COMMANDS.CHANGE_STORE,
                    displayText: '受取店舗を変更する'
                }
            }]
        }
    };
}

// DB操作関連の関数
async function checkWinnerStatus(userId) {
    try {
        console.log('Using table:', winnersTable); // テーブル名のログ出力を追加

        const params = {
            TableName: winnersTable,
            KeyConditionExpression: 'userId = :userId',
            ExpressionAttributeValues: {
                ':userId': userId
            },
            Limit: 1,  // 最新の1件のみ取得
            ScanIndexForward: false  // 降順（最新のものから）
        };

        const result = await dynamoDB.send(new QueryCommand(params));
        console.log('Query result:', result); // 結果のログ出力を追加

        return result.Items?.[0] || null;
    } catch (error) {
        console.error('Error in checkWinnerStatus:', error);
        throw error;
    }
}

async function updateWinnerStatus(userId, storeId, redemptionCode) {
    // 最新のレコードのtimestampを取得
    const currentRecord = await checkWinnerStatus(userId);
    if (!currentRecord || !currentRecord.timestamp) {
        throw new Error('Record not found');
    }

    const params = {
        TableName: winnersTable,
        Key: {
            userId: userId,
            timestamp: currentRecord.timestamp  // ソートキーを追加
        },
        UpdateExpression: 'SET #status = :status, storeId = :storeId, redemptionCode = :code',
        ExpressionAttributeNames: {
            '#status': 'status'
        },
        ExpressionAttributeValues: {
            ':status': 'store_selected',
            ':storeId': storeId,
            ':code': redemptionCode
        }
    };
    await dynamoDB.send(new UpdateCommand(params));
}

async function resetStoreSelection(userId) {
    // 最新のレコードのtimestampを取得
    const currentRecord = await checkWinnerStatus(userId);
    if (!currentRecord || !currentRecord.timestamp) {
        throw new Error('Record not found');
    }

    const params = {
        TableName: winnersTable,
        Key: {
            userId: userId,
            timestamp: currentRecord.timestamp  // ソートキーを追加
        },
        UpdateExpression: 'SET #status = :status REMOVE storeId',
        ExpressionAttributeNames: {
            '#status': 'status'
        },
        ExpressionAttributeValues: {
            ':status': 'pending'
        }
    };
    await dynamoDB.send(new UpdateCommand(params));
}

// ユーティリティ関数
function chunk(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
        chunks.push(array.slice(i, i + Math.min(size, array.length - i)));
    }
    return chunks;
}

module.exports = {
    COMMANDS,
    ERRORS,
    handleStoreCommand
};