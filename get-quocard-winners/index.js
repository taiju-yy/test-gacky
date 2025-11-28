const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient();
const dynamoDB = DynamoDBDocumentClient.from(client);

// バックオフ設定
const INITIAL_BACKOFF = 1000;
const MAX_RETRIES = 5;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function queryWithBackoff(params, retryCount = 0) {
    try {
        return await dynamoDB.send(new QueryCommand(params));
    } catch (error) {
        if (error.name === 'ProvisionedThroughputExceededException' && retryCount < MAX_RETRIES) {
            const backoff = Math.min(INITIAL_BACKOFF * Math.pow(2, retryCount), 8000);
            console.log(`Throughput exceeded, waiting ${backoff}ms before retry ${retryCount + 1}/${MAX_RETRIES}`);
            await sleep(backoff);
            return queryWithBackoff(params, retryCount + 1);
        }
        throw error;
    }
}

exports.handler = async (event) => {
    try {
        // Step Functionから渡されたstatusを使用
        const status = event.status || 'pending';  // デフォルト値も設定
        console.log('Requested status:', status);

        const params = {
            TableName: 'QuoCardWinners',
            IndexName: 'status-index',
            KeyConditionExpression: '#status = :status',
            ExpressionAttributeNames: {
                '#status': 'status'
            },
            ExpressionAttributeValues: {
                ':status': status
            }
        };

        console.log('Fetching winners with status:', status);
        const result = await queryWithBackoff(params);

        const winners = result.Items.map(item => ({
            userId: item.userId,
            timestamp: item.timestamp,
            redemptionCode: item.redemptionCode,
            status: item.status
        }));

        return {
            statusCode: 200,
            Payload: {
                userIds: winners.map(w => w.userId)
            }
        };
    } catch (error) {
        console.error('Error:', error);
        throw error;
    }
};