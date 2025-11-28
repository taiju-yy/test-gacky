const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient();
const dynamoDB = DynamoDBDocumentClient.from(client);

// 参照するテーブル
let tableName = process.env.NAME_TABLE_DEV;

// 当選者数
let winnersCount = Number(process.env.WINNERS_NUM_DEV);

// 本番環境設定
let isProd = false;
if ( 'prod' === process.env.ENV_EXEC ) {
    tableName = process.env.NAME_TABLE;
    winnersCount = Number(process.env.WINNERS_NUM);
    isProd = true;
}

// 日本時間の2025年2月2日21:30のUTC表現
const TARGET_DATE = '2025-02-02T12:30:00.000Z';
const CAMPAIGN_MESSAGE = '「QUOカード1万円プレゼントキャンペーン」';

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

exports.handler = async (event) => {
    try {
        const params = {
            TableName: tableName,
            FilterExpression: 'lastInteractionDate >= :targetDate',
            ExpressionAttributeValues: {
                ':targetDate': TARGET_DATE
            },
            // Limit を設定して1回のスキャンでの取得数を制限
            Limit: 100
        };

        console.log('Checking eligible users...');
        let totalUsers = 0;
        let eligibleUsers = 0;
        let items;
        
        do {
            items = await scanWithBackoff(params);
            totalUsers += items.Items.length;
            
            for (const item of items.Items) {
                if (isProd) {
                    if (item.messages && item.messages.some(msg =>
                        msg.content && msg.content.includes(CAMPAIGN_MESSAGE)
                    )) {
                        eligibleUsers++;
                    }
                } else {
                    eligibleUsers++;
                }
            }
            
            params.ExclusiveStartKey = items.LastEvaluatedKey;
            
            // 100件スキャンするごとに少し待機
            if (items.LastEvaluatedKey) {
                await sleep(100);
            }
        } while (items.LastEvaluatedKey);

        return {
            statusCode: 200,
            body: JSON.stringify({
                totalScannedUsers: totalUsers,
                eligibleUsers: eligibleUsers,
                sufficientForLottery: eligibleUsers >= winnersCount,
                minimumRequired: winnersCount,
                dateChecked: new Date().toISOString()
            })
        };
    } catch (error) {
        console.error('Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({
                error: error.message,
                totalScannedUsers: totalUsers || 0,
                eligibleUsers: eligibleUsers || 0
            })
        };
    }
};