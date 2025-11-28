const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient();
const dynamoDB = DynamoDBDocumentClient.from(client);
const TABLE_NAME = process.env.NAME_TABLE;

exports.handler = async (event) => {
  try {
    // 全てのアイテムを取得
    let items = [];
    let lastEvaluatedKey = undefined;
    
    do {
      // ページネーションを使ってスキャン
      const params = {
        TableName: TABLE_NAME,
        Limit: 100, // 一度に取得する最大アイテム数
        ExclusiveStartKey: lastEvaluatedKey
      };
      
      const scanResult = await dynamoDB.send(new ScanCommand(params));
      items = items.concat(scanResult.Items);
      lastEvaluatedKey = scanResult.LastEvaluatedKey;
      
      console.log(`取得済みアイテム数: ${items.length}`);
      
    } while (lastEvaluatedKey);
    
    console.log(`最終的な取得アイテム数: ${items.length}`);
    
    // 古い形式のメッセージを持つレコードを処理
    const recordsToUpdate = items.filter(item => 
      item.messages && Array.isArray(item.messages) && 
      item.messages.some(msg => 
        'broadcastId' in msg || 
        'systemGenerated' in msg
      )
    );
    
    console.log(`更新が必要なレコード数: ${recordsToUpdate.length}`);
    
    let successCount = 0;
    let errorCount = 0;
    
    // 各レコードを処理
    for (const record of recordsToUpdate) {
      try {
        // 古い形式のメッセージを新しい形式に変換
        const migratedMessages = record.messages.map(msg => {
          // 基本的なメッセージ構造
          const newMsg = {
            role: msg.role,
            content: msg.content
          };
          
          // metadata属性の抽出
          const metadataProps = {};
          if ('broadcastId' in msg) metadataProps.broadcastId = msg.broadcastId;
          if ('systemGenerated' in msg) metadataProps.systemGenerated = msg.systemGenerated;
          
          // metadataがあれば追加
          if (Object.keys(metadataProps).length > 0) {
            newMsg.metadata = metadataProps;
          }
          
          return newMsg;
        });
        
        // レコードを更新
        const updateParams = {
          TableName: TABLE_NAME,
          Key: {
            userId: record.userId,
            timestamp: record.timestamp
          },
          UpdateExpression: 'SET messages = :messages',
          ExpressionAttributeValues: {
            ':messages': migratedMessages
          }
        };
        
        await dynamoDB.send(new UpdateCommand(updateParams));
        successCount++;
        
        if (successCount % 10 === 0) {
          console.log(`${successCount}/${recordsToUpdate.length} レコードの更新が完了しました`);
        }
      } catch (error) {
        console.error(`ユーザー ${record.userId} の更新中にエラーが発生しました:`, error);
        errorCount++;
      }
    }
    
    return {
      statusCode: 200,
      body: JSON.stringify({
        totalRecords: items.length,
        recordsToUpdate: recordsToUpdate.length,
        successCount,
        errorCount
      })
    };
  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};