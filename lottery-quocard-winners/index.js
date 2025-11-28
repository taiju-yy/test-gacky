const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient();
const dynamoDB = DynamoDBDocumentClient.from(client);

// 日本時間の2025年2月2日21:30のUTC表現
const TARGET_DATE = '2025-02-02T12:30:00.000Z';
let winnersCount = Number(process.env.WINNERS_NUM_DEV);
const CAMPAIGN_MESSAGE = '「QUOカード1万円プレゼントキャンペーン」';

// 参照するテーブル
let tableName = process.env.NAME_TABLE_DEV;
let winnersTable = process.env.WINNERS_TABLE_DEV;

// 本番環境の設定に置き換え
let envExec = process.env.ENV_EXEC;
let isProd = false;
if ( 'prod' === envExec ) {
    tableName = process.env.NAME_TABLE;
    winnersTable = process.env.WINNERS_TABLE;
    winnersCount = Number(process.env.WINNERS_NUM);
    isProd = true;
}

// バックオフ設定
const INITIAL_BACKOFF = 1000; // 1秒
const MAX_RETRIES = 5;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function scanWithBackoff(params, retryCount = 0) {
    try {
        return await dynamoDB.send(new ScanCommand(params));
    } catch (error) {
        if (error.name === 'ProvisionedThroughputExceededException' && retryCount < MAX_RETRIES) {
            const backoff = Math.min(INITIAL_BACKOFF * Math.pow(2, retryCount), 8000);
            console.log(`Throughput exceeded, waiting ${backoff}ms before retry ${retryCount + 1}/${MAX_RETRIES}`);
            await sleep(backoff);
            return scanWithBackoff(params, retryCount + 1);
        }
        throw error;
    }
}

async function putWithBackoff(params, retryCount = 0) {
    try {
        return await dynamoDB.send(new PutCommand(params));
    } catch (error) {
        if (error.name === 'ProvisionedThroughputExceededException' && retryCount < MAX_RETRIES) {
            const backoff = Math.min(INITIAL_BACKOFF * Math.pow(2, retryCount), 8000);
            console.log(`Throughput exceeded, waiting ${backoff}ms before retry ${retryCount + 1}/${MAX_RETRIES}`);
            await sleep(backoff);
            return putWithBackoff(params, retryCount + 1);
        }
        throw error;
    }
}

exports.handler = async (event) => {
    console.log('Starting lottery process...');
    try {
        const params = {
            TableName: tableName,
            FilterExpression: 'lastInteractionDate >= :targetDate',
            ExpressionAttributeValues: {
                ':targetDate': TARGET_DATE
            },
            Limit: 100
        };

        const eligible_users = [];
        let items;
        
        console.log('Scanning for eligible users...');
        do {
            items = await scanWithBackoff(params);
            for (const item of items.Items) {
                if (isProd) {
                    if (item.messages && item.messages.some(msg =>
                        msg.content && msg.content.includes(CAMPAIGN_MESSAGE)
                    )) {
                        eligible_users.push({
                            userId: item.userId,
                            lastInteractionDate: item.lastInteractionDate
                        });
                    }
                } else {
                    eligible_users.push({
                        userId: item.userId,
                        lastInteractionDate: item.lastInteractionDate
                    });
                }
            }
            params.ExclusiveStartKey = items.LastEvaluatedKey;
            
            if (items.LastEvaluatedKey) {
                await sleep(100); // スキャン間の待機
            }
        } while (items.LastEvaluatedKey);

        console.log(`Found ${eligible_users.length} eligible users`);

        if (eligible_users.length < winnersCount) {
            throw new Error(`Not enough eligible users. Found: ${eligible_users.length}, Required: ${winnersCount}`);
        }

        // ユーザーをランダムに並び替えて上位(winnersCount)名を選択
        const winners = eligible_users
            .sort(() => Math.random() - 0.5)
            .slice(0, winnersCount);

        console.log(`Selected ${winners.length} winners`);

        // 当選者をDynamoDBに保存
        const timestamp = new Date().toISOString();
        console.log('Saving winners to DynamoDB...');
        
        for (const winner of winners) {
            const redemptionCode = String(Math.floor(100000 + Math.random() * 900000));
            await putWithBackoff({
                TableName: winnersTable,
                Item: {
                    userId: winner.userId,
                    timestamp: timestamp,
                    status: 'pending',
                    redemptionCode: redemptionCode,
                    lastInteractionDate: winner.lastInteractionDate,
                    expiryDate: Math.floor(new Date('2025-05-31T23:59:59+09:00').getTime() / 1000)
                }
            });
            
            await sleep(100); // 保存処理間の待機
        }

        console.log('Lottery process completed successfully');
        
        return {
            statusCode: 200,
            body: JSON.stringify({
                message: `Successfully selected ${winners.length} winners`,
                totalEligible: eligible_users.length,
                winners: winners.map(w => ({ 
                    userId: w.userId,
                    lastInteractionDate: w.lastInteractionDate
                }))
            })
        };
    } catch (error) {
        console.error('Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({
                error: error.message,
                winners: []
            })
        };
    }
};