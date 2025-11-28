const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const dbClient = new DynamoDBClient();
const dynamoDB = DynamoDBDocumentClient.from(dbClient);
const s3Client = new S3Client();

// スキャン間の遅延を追加
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

exports.handler = async (event) => {
  try {
    const table = process.env.ENV_EXEC === 'prod'
      ? process.env.NAME_TABLE
      : process.env.NAME_TABLE_DEV;
    const bucketName = process.env.ENV_EXEC === 'prod'
      ? process.env.BACKUP_BUCKET_NAME
      : process.env.BACKUP_BUCKET_NAME_DEV;
    
    if (!bucketName) {
      throw new Error('BACKUP_BUCKET_NAME environment variable is not set');
    }
    
    const date = new Date().toISOString().split('T')[0];
    let lastEvaluatedKey = undefined;
    let totalCount = 0;
    let successCount = 0;
    let failedCount = 0;
    
    console.log(`Starting full backup of ${table} to S3 bucket ${bucketName}`);
    
    // DynamoDBからすべてのデータをページングしながら取得
    do {
      const scanParams = {
        TableName: table,
        ExclusiveStartKey: lastEvaluatedKey,
        Limit: 20 // 小さいバッチサイズに制限
      };
      
      const result = await dynamoDB.send(new ScanCommand(scanParams));
      totalCount += result.Items.length;
      console.log(`Retrieved ${result.Items.length} items from DynamoDB`);
      
      // バッチで並列処理
      const batchPromises = [];
      for (const item of result.Items) {
        const userId = item.userId;
        const timestamp = item.timestamp;
        const key = `full-backups/${date}/${userId}/${timestamp}.json`;
        
        const s3Params = {
          Bucket: bucketName,
          Key: key,
          Body: JSON.stringify(item),
          ContentType: 'application/json'
        };
        
        const promise = s3Client.send(new PutObjectCommand(s3Params))
          .then(() => {
            successCount++;
            if (successCount % 100 === 0) {
              console.log(`Backed up ${successCount} conversations so far`);
            }
            return { userId, status: 'success' };
          })
          .catch(error => {
            failedCount++;
            console.error(`Failed to backup conversation for user ${userId}:`, error);
            return { userId, status: 'failed', error: error.message };
          });
        
        batchPromises.push(promise);
      }
      
      await Promise.all(batchPromises);

      // 次のスキャン前に待機
      await delay(1000); // 1秒待機

      lastEvaluatedKey = result.LastEvaluatedKey;
      
    } while (lastEvaluatedKey);
    
    console.log(`Backup completed. Total: ${totalCount}, Success: ${successCount}, Failed: ${failedCount}`);
    
    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Backup completed',
        totalItems: totalCount,
        successCount,
        failedCount
      })
    };
  } catch (error) {
    console.error('Backup error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ message: 'Backup failed', error: error.message })
    };
  }
};