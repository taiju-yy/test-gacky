const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  QueryCommand,
  ScanCommand,
  GetCommand,
  TransactWriteCommand
} = require('@aws-sdk/lib-dynamodb');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const s3Client = new S3Client();
const client = new DynamoDBClient();
const dynamoDB = DynamoDBDocumentClient.from(client);
const table = process.env.NAME_TABLE;
const tableCoupon = process.env.TABLE_COUPON_MANAGEMENT || "couponManagementTable";
const tableBroadcastLogs = process.env.TABLE_BROADCAST_LOGS || "gacky-bot-broadcast-logs";
const tableUserActivitySummary = process.env.TABLE_USER_ACTIVITY_SUMMARY || "gacky-bot-user-activity-summary";

// メッセージハッシュ生成ヘルパー関数
function generateMessageHash(messages) {
  return require('crypto')
    .createHash('md5')
    .update(JSON.stringify(messages))
    .digest('hex');
}

// S3バックアップ機能を追加 (既存の関数の上に追加)
async function backupToS3(userId, data, customKey = null) {
  if (!process.env.BACKUP_BUCKET_NAME) {
    console.warn('BACKUP_BUCKET_NAME environment variable not set, skipping backup');
    return false;
  }

  try {
    const date = new Date().toISOString().split('T')[0];
    // カスタムキーが提供されていればそれを使用、そうでなければデフォルトのパス
    const key = customKey || `chat-backups/${date}/${userId}/${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    
    const params = {
      Bucket: process.env.BACKUP_BUCKET_NAME,
      Key: key,
      Body: JSON.stringify(data),
      ContentType: 'application/json'
    };
    
    await s3Client.send(new PutObjectCommand(params));
    console.log(`Backup saved to S3: ${key}`);
    return true;
  } catch (error) {
    console.error('Error backing up to S3:', error);
    return false;
  }
}


// メッセージの切り詰め機能を追加 (既存の関数の上に追加)
function truncateMessage(message, maxLength = 4000) {
  if (message && message.content && typeof message.content === 'string' && message.content.length > maxLength) {
    console.log(`Message truncated from ${message.content.length} to ${maxLength} characters for userId: ${message.userId || 'unknown'}`);
    return {
      ...message,
      content: message.content.substring(0, maxLength) + "...(以下省略)"
    };
  }
  return message;
}


async function saveGetCoupon(userId) { // （2）
    try {
        const newTimestamp = new Date().toISOString();  // 新しいタイムスタンプ
        const createParams = {
        TableName: tableCoupon,
        Item: {
          userId,
          timestamp: newTimestamp,  // 新しいタイムスタンプ
          isGetCoupon: true
        }
      };
      await dynamoDB.send(new PutCommand(createParams));
    } catch (error) {
      console.error('Error saving isGetCoupon:', error);
      return new Error("Failed to save getting coupon: " + error.message);
    }
  }

// ユーザーIDに基づいてメッセージを取得する関数
async function getMessages(userId) {
  try {
    const params = {
      TableName: table,
      KeyConditionExpression: "userId = :userId",
      ExpressionAttributeValues: {
        ":userId": userId
      },
      ScanIndexForward: false,  // 最新の項目を最初に取得
      Limit: 1  // 最新の会話だけを取得
    };
    const data = await dynamoDB.send(new QueryCommand(params));
    // console.log('DynamoDB query result:', JSON.stringify(data));

    if (data.Items.length > 0) {
      const result = {
        messages: data.Items[0].messages,
        timestamp: data.Items[0].timestamp,
        lastInteractionDate: data.Items[0].lastInteractionDate,
        responseTone: data.Items[0].responseTone,
        coachingStyle: data.Items[0].coachingStyle,
        relationshipTone: data.Items[0].relationshipTone,
        politenessTone: data.Items[0].politenessTone,
        attitudeTone: data.Items[0].attitudeTone,
        displayName: data.Items[0].displayName,
        nickname: data.Items[0].nickname,
        // 応答率計算用フィールド
        lastBroadcastId: data.Items[0].lastBroadcastId,
        lastBroadcastAt: data.Items[0].lastBroadcastAt,
        respondedToBroadcast: data.Items[0].respondedToBroadcast,
      };
      // console.log('getMessages result:', JSON.stringify(result));
      return result;
    } else {
      // console.log('No messages found for user:', userId);
      return {
        messages: [],
        timestamp: null,
        lastInteractionDate: null,
        responseTone: null,
        coachingStyle: null,
        relationshipTone: null,
        politenessTone: null,
        attitudeTone: null,
        displayName: null,
        nickname: null,
        // 応答率計算用フィールド
        lastBroadcastId: null,
        lastBroadcastAt: null,
        respondedToBroadcast: null,
      };
    }
  } catch (error) {
    // エラーをキャッチし、Errorオブジェクトを生成して返却
    console.error("Error fetching messages:", error);
    return new Error("An error occurred while fetching messages: " + error.message);
  }
}

// ユーザーIDに基づいてクーポンの取得状況を取得する関数
async function getCouponStatus(userId) { // （4）
    try {
      const params = {
        TableName: tableCoupon,
        KeyConditionExpression: "userId = :userId",
        ExpressionAttributeValues: {
          ":userId": userId
        },
        ScanIndexForward: false,  // 最新の項目を最初に取得
        Limit: 1  // 最新の会話だけを取得
      };
      const data = await dynamoDB.send(new QueryCommand(params));
  
      // メッセージが存在するかどうかを確認
      if (data.Items[0]) {
        // console.log(data.Items[0].isGetCoupon);
        if (data.Items[0].isGetCoupon) {
            return true;
        }
      }
      return false;
    } catch (error) {
      // エラーをキャッチし、Errorオブジェクトを生成して返却
      console.error("Error fetching messages:", error);
      return new Error("An error occurred while fetching messages: " + error.message);
    }
  }

// ユーザーIDに基づいて会話履歴を削除する関数
async function deleteUser(userId) {
  try {
    const getParams = {
      TableName: table,
      KeyConditionExpression: "userId = :userId",
      ExpressionAttributeValues: {
        ":userId": userId
      },
      ScanIndexForward: false,  // 最新の項目を最初に取得
      Limit: 2  // 最新の会話だけを取得
    };
    const data = await dynamoDB.send(new QueryCommand(getParams));

    // メッセージが存在するかどうかを確認
    if (data.Items[0]) {
      const deleteParams = {
        TableName: table,
        Key: {
          userId: userId,
          timestamp: data.Items[0].timestamp
        },
      }; 
      await dynamoDB.send(new DeleteCommand(deleteParams)); 
    }    
  } catch (error) {
    console.error('Error delete user:', error);
    return new Error("Failed to delete user: " + error.message);
  }
}

async function updateResponseTone(userId, responseTone) {
  try {
    const { timestamp } = await getMessages(userId);
    const params = {
      TableName: table,
      Key: {
        userId: userId,
        timestamp: timestamp
      },
      UpdateExpression: "SET responseTone = :val1",
      ExpressionAttributeValues: {
        ":val1": responseTone
      },
    }
    
    // コマンドを送信
    await dynamoDB.send(new UpdateCommand(params));
  } catch (error) {
    console.error('Error updating responseTone:', error);
    return new Error("Failed to update responseTone: " + error.message);
  }  
}

async function updateRelationshipTone(userId, relationshipTone) {
  try {
    const { timestamp } = await getMessages(userId);
    const params = {
      TableName: table,
      Key: {
        userId: userId,
        timestamp: timestamp
      },
      UpdateExpression: "SET relationshipTone = :val1",
      ExpressionAttributeValues: {
        ":val1": relationshipTone
      },
    }
    
    // コマンドを送信
    await dynamoDB.send(new UpdateCommand(params));
  } catch (error) {
    console.error('Error updating relationshipTone:', error);
    return new Error("Failed to update relationshipTone: " + error.message);
  }  
}

async function updatePolitenessTone(userId, politenessTone) {
  try {
    const { timestamp } = await getMessages(userId);
    const params = {
      TableName: table,
      Key: {
        userId: userId,
        timestamp: timestamp
      },
      UpdateExpression: "SET politenessTone = :val1",
      ExpressionAttributeValues: {
        ":val1": politenessTone
      },
    }
    
    // コマンドを送信
    await dynamoDB.send(new UpdateCommand(params));
  } catch (error) {
    console.error('Error updating politenessTone:', error);
    return new Error("Failed to update politenessTone: " + error.message);
  }  
}

async function updateCoachingStyle(userId, coachingStyle) {
  try {
    const { timestamp } = await getMessages(userId);
    const params = {
      TableName: table,
      Key: {
        userId: userId,
        timestamp: timestamp
      },
      UpdateExpression: "SET coachingStyle = :val1",
      ExpressionAttributeValues: {
        ":val1": coachingStyle
      },
    }
    
    // コマンドを送信
    await dynamoDB.send(new UpdateCommand(params));
  } catch (error) {
    console.error('Error updating coachingStyle:', error);
    return new Error("Failed to update coachingStyle: " + error.message);
  }  
}

async function updateAttitudeTone(userId, attitudeTone) {
  try {
    const { timestamp } = await getMessages(userId);
    const params = {
      TableName: table,
      Key: {
        userId: userId,
        timestamp: timestamp
      },
      UpdateExpression: "SET attitudeTone = :val1",
      ExpressionAttributeValues: {
        ":val1": attitudeTone
      },
    }
    
    // コマンドを送信
    await dynamoDB.send(new UpdateCommand(params));
  } catch (error) {
    console.error('Error updating attitudeTone:', error);
    return new Error("Failed to update attitudeTone: " + error.message);
  }  
}

/**
 * ユーザーのdisplayNameを更新する
 * LINE APIから取得したユーザーの表示名を保存し、会話で活用する
 * @param {string} userId - LINEユーザーID
 * @param {string} displayName - LINEの表示名
 */
async function updateDisplayName(userId, displayName) {
  try {
    const { timestamp } = await getMessages(userId);
    
    if (!timestamp) {
      // 会話履歴がまだない場合は新規作成時に設定される
      console.log(`No existing conversation for user ${userId}, displayName will be set on first message`);
      return { success: true, newUser: true };
    }
    
    const params = {
      TableName: table,
      Key: {
        userId: userId,
        timestamp: timestamp
      },
      UpdateExpression: "SET displayName = :displayName",
      ExpressionAttributeValues: {
        ":displayName": displayName
      },
    }
    
    await dynamoDB.send(new UpdateCommand(params));
    console.log(`DisplayName updated for user ${userId}: ${displayName}`);
    return { success: true };
  } catch (error) {
    console.error('Error updating displayName:', error);
    return { success: false, error: error.message };
  }  
}

/**
 * ユーザーのnicknameを更新する
 * AIが判断した適切な呼び名を保存する
 * @param {string} userId - LINEユーザーID
 * @param {string} nickname - AIが判断した呼び名（例：「太樹」「佳奈子」）
 */
async function updateNickname(userId, nickname) {
  try {
    const { timestamp } = await getMessages(userId);
    
    if (!timestamp) {
      console.log(`No existing conversation for user ${userId}, nickname will be set on first message`);
      return { success: true, newUser: true };
    }
    
    const params = {
      TableName: table,
      Key: {
        userId: userId,
        timestamp: timestamp
      },
      UpdateExpression: "SET nickname = :nickname",
      ExpressionAttributeValues: {
        ":nickname": nickname
      },
    }
    
    await dynamoDB.send(new UpdateCommand(params));
    console.log(`Nickname updated for user ${userId}: ${nickname}`);
    return { success: true };
  } catch (error) {
    console.error('Error updating nickname:', error);
    return { success: false, error: error.message };
  }  
}

async function saveOrUpdateMessage(userId, newMessage, retryCount = 0, userDisplayName = null) {
  try {
    const { timestamp, messages, responseTone, relationshipTone, coachingStyle, politenessTone, attitudeTone, displayName } = await getMessages(userId);
    const newTimestamp = new Date().toISOString();
    
    // メッセージを切り詰める
    const truncatedMessage = truncateMessage(newMessage);
    
    // 新しいデータ構造への移行
    // 追加のメタデータがある場合、metadata オブジェクトに移動
    const messageForStorage = { 
      role: truncatedMessage.role, 
      content: truncatedMessage.content,
      timestamp: newTimestamp  // メッセージごとにタイムスタンプを追加
    };
    
    // metadata オブジェクトの作成
    const metadata = {};
    
    // 以前のプロパティを抽出して metadata に移動
    const metadataProps = ['broadcastId', 'systemGenerated'];
    metadataProps.forEach(prop => {
      if (prop in truncatedMessage) {
        metadata[prop] = truncatedMessage[prop];
      }
    });
    
    // metadata が空でなければ追加
    if (Object.keys(metadata).length > 0) {
      messageForStorage.metadata = metadata;
    }
    
    let updatedMessages = messages ? [...messages] : [];
    
    // ユーザーの連続メッセージは置き換え
    if (truncatedMessage.role === 'user' && updatedMessages.length > 0 && 
        updatedMessages[updatedMessages.length - 1].role === 'user') {
      updatedMessages[updatedMessages.length - 1] = messageForStorage;
    } else {
      updatedMessages.push(messageForStorage);
    }
    
    // バックアップ処理
    const MAX_MESSAGES = Number(process.env.MAX_SAVED_MESSAGES) || 50;
    const BATCH_SIZE = 50;
    const THRESHOLD = MAX_MESSAGES * 0.9;
    
    if (updatedMessages.length > THRESHOLD) {
      const batchesToBackup = Math.min(BATCH_SIZE, Math.floor(updatedMessages.length / 2));
      
      if (batchesToBackup > 0) {
        // バックアップ処理（非同期で実行）
        const date = new Date().toISOString().split('T')[0];
        const messagesToBackup = updatedMessages.slice(0, batchesToBackup);
        
        const backupData = {
          userId,
          timestamp: newTimestamp,
          batchMessages: messagesToBackup,
          messageRange: `0-${batchesToBackup-1}`,
          totalMessagesAtBackup: updatedMessages.length,
          backupDate: new Date().toISOString(),
          backupType: "batch"
        };
        
        const backupKey = `batches/${date}/${userId}/${newTimestamp.replace(/[:.]/g, '-')}-batch${batchesToBackup}.json`;
        
        backupToS3(userId, backupData, backupKey).catch(err => {
          console.error(`Failed to backup batch for ${userId}:`, err);
        });
        
        // バックアップ済みのメッセージを削除
        updatedMessages = updatedMessages.slice(batchesToBackup);
        console.log(`Backed up and removed ${batchesToBackup} old messages for user ${userId}`);
      }
    }
    
    // ユーザーからのメッセージの場合のみ lastInteractionDate を更新
    // システム生成のメッセージの場合は更新しない
    const shouldUpdateLastInteraction = 
      truncatedMessage.role === 'user' && 
      (!truncatedMessage.systemGenerated && !truncatedMessage.metadata?.systemGenerated);
    
    // DynamoDBに保存（条件付き更新）
    try {
      if (timestamp) {
        // 既存レコードの更新
        let updateExpression = 'SET messages = :messages';
        let expressionAttributeValues = {
          ':messages': updatedMessages
        };
        
        // ユーザーからのメッセージの場合のみ lastInteractionDate を更新
        if (shouldUpdateLastInteraction) {
          updateExpression += ', lastInteractionDate = :lastInteractionDate';
          expressionAttributeValues[':lastInteractionDate'] = newTimestamp;
          console.log(`Updating lastInteractionDate for user ${userId} to ${newTimestamp}`);
        }
        
        // displayNameが渡されていて、まだ保存されていない場合は更新
        if (userDisplayName && !displayName) {
          updateExpression += ', displayName = :displayName';
          expressionAttributeValues[':displayName'] = userDisplayName;
          console.log(`Setting displayName for user ${userId}: ${userDisplayName}`);
        }
        
        const params = {
          TableName: table,
          Key: {
            userId: userId,
            timestamp: timestamp
          },
          UpdateExpression: updateExpression,
          ConditionExpression: 'attribute_exists(userId) AND attribute_exists(#T)',
          ExpressionAttributeNames: {
            '#T': 'timestamp'
          },
          ExpressionAttributeValues: expressionAttributeValues
        };
        
        await dynamoDB.send(new UpdateCommand(params));
      } else {
        // 新規レコードの作成
        const params = {
          TableName: table,
          Item: {
            userId,
            timestamp: newTimestamp,
            messages: updatedMessages,
            lastInteractionDate: shouldUpdateLastInteraction ? newTimestamp : undefined,
            responseTone,
            relationshipTone,
            coachingStyle,
            politenessTone,
            attitudeTone,
            displayName: userDisplayName || null
          },
          ConditionExpression: 'attribute_not_exists(userId) OR attribute_not_exists(#T)',
          ExpressionAttributeNames: {
            '#T': 'timestamp'
          }
        };
        
        await dynamoDB.send(new PutCommand(params));
      }
    } catch (error) {
      if (error.name === 'ConditionalCheckFailedException') {
        // 条件チェック失敗 - 最新データで再試行
        console.warn(`ユーザー ${userId} のレコード更新で条件チェックに失敗しました - 再試行します`);
        return await saveOrUpdateMessage(userId, newMessage, retryCount + 1, userDisplayName);
      }
      throw error;
    }
  } catch (error) {
    if (error.name === 'ProvisionedThroughputExceededException' && retryCount < 5) {
      // 指数バックオフでリトライ
      const delay = Math.pow(2, retryCount) * 100;
      console.log(`DynamoDB throughput exceeded, retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return saveOrUpdateMessage(userId, newMessage, retryCount + 1, userDisplayName);
    }
    console.error('Error saving/updating message:', error);
    return new Error("Failed to save/update message: " + error.message);
  }
}

async function addBroadcastConversation(userId, messages, broadcastId = null) {
  try {
    // ブロードキャストIDがない場合はメッセージのハッシュを使用
    const messageId = broadcastId || generateMessageHash(messages);
    console.log(`ブロードキャスト処理: ユーザー=${userId}, メッセージID=${messageId}`);
    
    // 既存の会話を取得
    const { messages: existingMessages, timestamp, lastInteractionDate } = await getMessages(userId);
    const newTimestamp = new Date().toISOString();
    
    // 既存メッセージのチェック（冪等性確保のため）
    if (existingMessages && existingMessages.length > 0) {
      // このブロードキャストメッセージが既に適用されていないか確認
      // 新しい構造でのチェック
      const isAlreadyApplied = existingMessages.some(msg => 
        msg.metadata && msg.metadata.broadcastId === messageId
      );
      
      if (isAlreadyApplied) {
        console.log(`ブロードキャストメッセージ ${messageId} はユーザー ${userId} に既に適用済みです。スキップします。`);
        return { status: 'skipped', reason: 'already_applied' };
      }
    }
    
    let newMessages = [...(existingMessages || [])];
    
    // ブロードキャストメッセージを追加（新しい構造で）
    messages.forEach((msg, index) => {
      // 各メッセージのタイムスタンプを生成（順番を保持するために小さなオフセットを追加）
      const msgTimestamp = new Date(new Date(newTimestamp).getTime() + index * 100).toISOString();
      
      if (index === 0 && (newMessages.length === 0 || newMessages[newMessages.length - 1].role === 'assistant')) {
        newMessages.push({ 
          role: 'user', 
          content: 'こんにちは',
          timestamp: msgTimestamp,  // メッセージごとにタイムスタンプを追加
          metadata: {
            broadcastId: messageId,
            systemGenerated: true
          }
        });
      }
      
      let content = msg.message;
      if (msg.messageType === 'image' || msg.messageType === 'video') {
        content = `[${msg.messageType.toUpperCase()}] ${msg.message || ''}`;
      }
      
      // assistantメッセージのタイムスタンプ
      const assistantMsgTimestamp = new Date(new Date(newTimestamp).getTime() + index * 100 + 50).toISOString();
      newMessages.push({ 
        role: 'assistant', 
        content: content,
        timestamp: assistantMsgTimestamp,  // メッセージごとにタイムスタンプを追加
        metadata: {
          broadcastId: messageId,
          systemGenerated: true
        }
      });
      
      if (index < messages.length - 1) {
        // 続きメッセージのタイムスタンプ
        const continueMsgTimestamp = new Date(new Date(newTimestamp).getTime() + index * 100 + 75).toISOString();
        newMessages.push({ 
          role: 'user', 
          content: '続けて',
          timestamp: continueMsgTimestamp,  // メッセージごとにタイムスタンプを追加
          metadata: {
            broadcastId: messageId,
            systemGenerated: true
          }
        });
      }
    });
    
    // undefined値を除去するヘルパー関数
    const removeUndefined = (obj) => {
      return Object.fromEntries(
        Object.entries(obj).filter(([_, v]) => v !== undefined)
      );
    };
    
    // バックアップを作成（変更前のレコード）
    if (timestamp) {
      await backupToS3(userId, {
        userId,
        timestamp,
        messages: existingMessages,
        backupReason: 'broadcast_update',
        broadcastId: messageId,
        backupDate: new Date().toISOString()
      }, `backups/broadcast/${userId}/${messageId}.json`);
    }
    
    // トランザクション処理による安全な更新
    try {
      if (timestamp) {
        // 既存レコードの更新（条件付き）
        // 重要な変更: lastInteractionDateを更新しない
        // 応答率計算用: lastBroadcastAt を記録、respondedToBroadcast を false にリセット
        const params = {
          TableName: table,
          Key: {
            userId: userId,
            timestamp: timestamp
          },
          UpdateExpression: 'SET messages = :messages, lastBroadcastId = :broadcastId, lastBroadcastAt = :broadcastAt, respondedToBroadcast = :responded',
          ConditionExpression: 'attribute_exists(userId) AND attribute_exists(#ts)',
          ExpressionAttributeNames: {
            '#ts': 'timestamp'
          },
          ExpressionAttributeValues: removeUndefined({
            ':messages': newMessages,
            ':broadcastId': messageId,
            ':broadcastAt': newTimestamp,
            ':responded': false
          })
        };
        
        await dynamoDB.send(new UpdateCommand(params));
        console.log(`ユーザー ${userId} の既存会話を更新しました（lastBroadcastAt: ${newTimestamp}）`);
      } else {
        // 新しい会話の作成
        // 応答率計算用: lastBroadcastAt を記録、respondedToBroadcast を false に設定
        const params = {
          TableName: table,
          Item: removeUndefined({
            userId,
            timestamp: newTimestamp,
            messages: newMessages,
            lastInteractionDate: lastInteractionDate || newTimestamp, // 既存の値があれば維持、なければ初期値として設定
            lastBroadcastId: messageId,
            lastBroadcastAt: newTimestamp,
            respondedToBroadcast: false,
            responseTone: null,
            coachingStyle: null,
            relationshipTone: null,
            politenessTone: null,
          }),
          ConditionExpression: 'attribute_not_exists(userId) OR attribute_not_exists(#ts)',
          ExpressionAttributeNames: {
            '#ts': 'timestamp'
          }
        };
        
        await dynamoDB.send(new PutCommand(params));
        console.log(`ユーザー ${userId} の新しい会話を作成しました（lastBroadcastAt: ${newTimestamp}）`);
      }
      
      return { status: 'success', timestamp: timestamp || newTimestamp };
    } catch (error) {
      if (error.name === 'ConditionalCheckFailedException') {
        // 条件チェック失敗 - レコードが既に変更されている可能性
        console.warn(`ユーザー ${userId} のレコード更新で条件チェックに失敗しました - 最新データを再取得します`);
        
        // 最新のデータを再取得して再試行
        const freshData = await getMessages(userId);
        if (freshData && freshData.timestamp) {
          // ブロードキャストIDを確認（冪等性チェック）
          if (freshData.lastBroadcastId === messageId) {
            console.log(`ブロードキャストメッセージ ${messageId} は既に適用済みです`);
            return { status: 'skipped', reason: 'already_applied' };
          }
          
          // 最新データで再試行
          return await addBroadcastConversation(userId, messages, messageId);
        }
      }
      throw error; // その他のエラーは上位に伝播
    }
  } catch (error) {
    console.error('Error adding broadcast conversation:', error);
    console.error('Error details:', JSON.stringify(error, null, 2));
    console.error('User ID:', userId);
    
    // エラーを記録するが、プロセス全体を中断しない
    await backupToS3(userId, {
      userId,
      error: error.message,
      errorDetails: error.stack,
      messages,
      timestamp: new Date().toISOString(),
      operation: 'addBroadcastConversation',
      status: 'error'
    }, `errors/broadcast/${userId}/${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    
    return { status: 'error', error: error.message };
  }
}

async function getMarathonInfo(infoKey) {
  try {
    const params = {
      TableName: 'KanazawaMarathon2024',
      Key: {
        infoKey: infoKey
      }
    };
    const data = await dynamoDB.send(new GetCommand(params));
    return data.Item ? data.Item.info : null;
  } catch (error) {
    console.error('マラソン情報取得エラー:', error);
    return null;
  }
}

async function getSystemContent(infoKey) {
  const params = {
    TableName: process.env.SYSCONTENT_TABLE,
    Key: {
      infoKey: infoKey
    }
  };
  try {
    const data = await dynamoDB.send(new GetCommand(params));
    return data.Item ? data.Item.info : null;
  } catch (error) {
    console.error('SystemContent取得エラー:', error);
    return null;
  }
}

// ========================================
// Broadcast Logs 関連関数
// ========================================

/**
 * ブロードキャスト配信ログを作成
 * @param {Object} logData - ログデータ
 * @param {string} logData.broadcastId - ブロードキャストID
 * @param {string} logData.title - 配信タイトル（任意）
 * @param {Array} logData.messages - 配信メッセージ
 * @param {number} logData.targetUserCount - 配信対象ユーザー数
 * @returns {Object} 作成結果
 */
async function createBroadcastLog(logData) {
  try {
    const timestamp = new Date().toISOString();
    // TTL: 1年後に自動削除（秒単位のUnixタイムスタンプ）
    const ttl = Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60);
    
    const item = {
      broadcastId: logData.broadcastId,
      timestamp: timestamp,
      title: logData.title || null,
      messages: logData.messages || [],
      targetUserCount: logData.targetUserCount || 0,
      successCount: 0,
      failureCount: 0,
      skippedCount: 0,
      status: 'queued',
      createdAt: timestamp,
      completedAt: null,
      ttl: ttl
    };
    
    const params = {
      TableName: tableBroadcastLogs,
      Item: item
    };
    
    await dynamoDB.send(new PutCommand(params));
    console.log(`Broadcast log created: ${logData.broadcastId}`);
    
    return { status: 'success', broadcastId: logData.broadcastId, timestamp };
  } catch (error) {
    console.error('Error creating broadcast log:', error);
    return { status: 'error', error: error.message };
  }
}

/**
 * ブロードキャスト配信ログを更新（配信結果の集計）
 * @param {string} broadcastId - ブロードキャストID
 * @param {string} timestamp - 作成時のタイムスタンプ
 * @param {Object} updateData - 更新データ
 * @returns {Object} 更新結果
 */
async function updateBroadcastLog(broadcastId, timestamp, updateData) {
  try {
    const updateExpressions = [];
    const expressionAttributeNames = {};
    const expressionAttributeValues = {};
    
    if (updateData.successCount !== undefined) {
      updateExpressions.push('successCount = successCount + :successInc');
      expressionAttributeValues[':successInc'] = updateData.successCount;
    }
    
    if (updateData.failureCount !== undefined) {
      updateExpressions.push('failureCount = failureCount + :failureInc');
      expressionAttributeValues[':failureInc'] = updateData.failureCount;
    }
    
    if (updateData.skippedCount !== undefined) {
      updateExpressions.push('skippedCount = skippedCount + :skippedInc');
      expressionAttributeValues[':skippedInc'] = updateData.skippedCount;
    }
    
    if (updateData.status) {
      updateExpressions.push('#status = :status');
      expressionAttributeNames['#status'] = 'status';
      expressionAttributeValues[':status'] = updateData.status;
    }
    
    if (updateData.completedAt) {
      updateExpressions.push('completedAt = :completedAt');
      expressionAttributeValues[':completedAt'] = updateData.completedAt;
    }
    
    if (updateExpressions.length === 0) {
      return { status: 'skipped', reason: 'no_updates' };
    }
    
    const params = {
      TableName: tableBroadcastLogs,
      Key: {
        broadcastId: broadcastId,
        timestamp: timestamp
      },
      UpdateExpression: 'SET ' + updateExpressions.join(', '),
      ExpressionAttributeValues: expressionAttributeValues
    };
    
    if (Object.keys(expressionAttributeNames).length > 0) {
      params.ExpressionAttributeNames = expressionAttributeNames;
    }
    
    await dynamoDB.send(new UpdateCommand(params));
    console.log(`Broadcast log updated: ${broadcastId}`);
    
    return { status: 'success' };
  } catch (error) {
    console.error('Error updating broadcast log:', error);
    return { status: 'error', error: error.message };
  }
}

/**
 * ブロードキャスト配信ログを取得
 * @param {string} broadcastId - ブロードキャストID
 * @returns {Object|null} ログデータ
 */
async function getBroadcastLog(broadcastId) {
  try {
    const params = {
      TableName: tableBroadcastLogs,
      KeyConditionExpression: 'broadcastId = :broadcastId',
      ExpressionAttributeValues: {
        ':broadcastId': broadcastId
      },
      ScanIndexForward: false,
      Limit: 1
    };
    
    const data = await dynamoDB.send(new QueryCommand(params));
    return data.Items && data.Items.length > 0 ? data.Items[0] : null;
  } catch (error) {
    console.error('Error getting broadcast log:', error);
    return null;
  }
}

/**
 * 最近のブロードキャスト配信ログを取得（分析用）
 * @param {number} limit - 取得件数（デフォルト: 50）
 * @returns {Array} ログデータの配列
 */
async function getRecentBroadcastLogs(limit = 50) {
  try {
    const params = {
      TableName: tableBroadcastLogs,
      Limit: limit
    };
    
    const data = await dynamoDB.send(new ScanCommand(params));
    
    // timestampでソート（降順）
    const sortedItems = (data.Items || []).sort((a, b) => 
      new Date(b.timestamp) - new Date(a.timestamp)
    );
    
    return sortedItems;
  } catch (error) {
    console.error('Error getting recent broadcast logs:', error);
    return [];
  }
}

// ========================================
// User Activity Summary 関連関数
// ========================================

/**
 * ユーザーアクティビティサマリーを更新（ユーザーからのメッセージ時に呼び出し）
 * @param {string} userId - ユーザーID
 * @param {string} messageTimestamp - メッセージのタイムスタンプ（ISO 8601）
 * @returns {Object} 更新結果
 */
async function updateUserActivitySummary(userId, messageTimestamp = null) {
  try {
    const now = messageTimestamp ? new Date(messageTimestamp) : new Date();
    const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
    const timestampStr = now.toISOString();

    // DynamoDB UpdateExpressionを使用してアトミックに更新
    const params = {
      TableName: tableUserActivitySummary,
      Key: {
        userId: userId,
        yearMonth: yearMonth
      },
      UpdateExpression: `
        SET messageCount = if_not_exists(messageCount, :zero) + :one,
            lastMessageAt = :timestamp,
            updatedAt = :timestamp,
            firstMessageAt = if_not_exists(firstMessageAt, :timestamp)
        ADD activeDates :dateSet
      `,
      ExpressionAttributeValues: {
        ':zero': 0,
        ':one': 1,
        ':timestamp': timestampStr,
        ':dateSet': new Set([dateStr])
      },
      ReturnValues: 'ALL_NEW'
    };

    const result = await dynamoDB.send(new UpdateCommand(params));

    // activeDatesのサイズからconversationDaysを計算して更新
    const activeDatesCount = result.Attributes.activeDates ? 
      (result.Attributes.activeDates.size || result.Attributes.activeDates.length || 0) : 0;

    // conversationDaysを別途更新
    const updateDaysParams = {
      TableName: tableUserActivitySummary,
      Key: {
        userId: userId,
        yearMonth: yearMonth
      },
      UpdateExpression: 'SET conversationDays = :days',
      ExpressionAttributeValues: {
        ':days': activeDatesCount
      }
    };

    await dynamoDB.send(new UpdateCommand(updateDaysParams));

    console.log(`User activity updated: userId=${userId}, yearMonth=${yearMonth}, date=${dateStr}`);
    return { status: 'success', yearMonth, activeDatesCount };
  } catch (error) {
    console.error('Error updating user activity summary:', error);
    // エラーが発生しても会話処理は継続させる
    return { status: 'error', error: error.message };
  }
}

/**
 * ユーザーの特定月のアクティビティサマリーを取得
 * @param {string} userId - ユーザーID
 * @param {string} yearMonth - 年月（例: "2025-12"）
 * @returns {Object|null} サマリーデータ
 */
async function getUserActivitySummary(userId, yearMonth) {
  try {
    const params = {
      TableName: tableUserActivitySummary,
      Key: {
        userId: userId,
        yearMonth: yearMonth
      }
    };

    const data = await dynamoDB.send(new GetCommand(params));
    return data.Item || null;
  } catch (error) {
    console.error('Error getting user activity summary:', error);
    return null;
  }
}

/**
 * 特定月のアクティブユーザー数を取得（MAU計算用）
 * @param {string} yearMonth - 年月（例: "2025-12"）
 * @returns {Object} MAUデータ
 */
async function getMonthlyActiveUsers(yearMonth) {
  try {
    const params = {
      TableName: tableUserActivitySummary,
      FilterExpression: 'yearMonth = :yearMonth',
      ExpressionAttributeValues: {
        ':yearMonth': yearMonth
      }
    };

    const data = await dynamoDB.send(new ScanCommand(params));
    const items = data.Items || [];

    // 集計
    const totalUsers = items.length;
    const totalMessages = items.reduce((sum, item) => sum + (item.messageCount || 0), 0);
    const avgMessagesPerUser = totalUsers > 0 ? totalMessages / totalUsers : 0;

    return {
      yearMonth,
      activeUserCount: totalUsers,
      totalMessages,
      avgMessagesPerUser: Math.round(avgMessagesPerUser * 100) / 100,
      users: items.map(item => ({
        userId: item.userId,
        messageCount: item.messageCount,
        conversationDays: item.conversationDays,
        firstMessageAt: item.firstMessageAt,
        lastMessageAt: item.lastMessageAt
      }))
    };
  } catch (error) {
    console.error('Error getting monthly active users:', error);
    return { yearMonth, activeUserCount: 0, totalMessages: 0, avgMessagesPerUser: 0, users: [] };
  }
}

/**
 * ユーザーのアクティビティ履歴を取得（過去N ヶ月）
 * @param {string} userId - ユーザーID
 * @param {number} months - 取得する月数（デフォルト: 12）
 * @returns {Array} 月別サマリーの配列
 */
async function getUserActivityHistory(userId, months = 12) {
  try {
    const params = {
      TableName: tableUserActivitySummary,
      KeyConditionExpression: 'userId = :userId',
      ExpressionAttributeValues: {
        ':userId': userId
      },
      ScanIndexForward: false, // 新しい順
      Limit: months
    };

    const data = await dynamoDB.send(new QueryCommand(params));
    return data.Items || [];
  } catch (error) {
    console.error('Error getting user activity history:', error);
    return [];
  }
}

/**
 * ブロードキャストログを同一配信でグループ化して取得
 * 同じメッセージ内容・同じ日付の配信を1つにまとめる
 * @param {Object} options - オプション
 * @param {string} options.date - 特定日付でフィルタ（例: "2025-12-29"）
 * @param {number} options.days - 過去N日分を取得（デフォルト: 7）
 * @returns {Array} グループ化された配信サマリー
 */
async function getBroadcastSummary(options = {}) {
  try {
    const { date, days = 7 } = options;
    
    // 全ログを取得
    const params = {
      TableName: tableBroadcastLogs
    };
    
    const data = await dynamoDB.send(new ScanCommand(params));
    let items = data.Items || [];
    
    // 日付フィルタ
    if (date) {
      items = items.filter(item => item.timestamp && item.timestamp.startsWith(date));
    } else if (days) {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);
      items = items.filter(item => new Date(item.timestamp) >= cutoffDate);
    }
    
    // メッセージ内容と日付でグループ化
    const groupedMap = new Map();
    
    items.forEach(item => {
      // メッセージ内容のハッシュキーを生成
      const messageKey = JSON.stringify(item.messages || []);
      const dateKey = item.timestamp ? item.timestamp.split('T')[0] : 'unknown';
      const groupKey = `${dateKey}_${messageKey}`;
      
      if (!groupedMap.has(groupKey)) {
        groupedMap.set(groupKey, {
          date: dateKey,
          messages: item.messages || [],
          title: item.title,
          broadcastIds: [],
          totalTargetUserCount: 0,
          totalSuccessCount: 0,
          totalFailureCount: 0,
          totalSkippedCount: 0,
          firstTimestamp: item.timestamp,
          lastTimestamp: item.timestamp,
          batchCount: 0
        });
      }
      
      const group = groupedMap.get(groupKey);
      group.broadcastIds.push(item.broadcastId);
      group.totalTargetUserCount += item.targetUserCount || 0;
      group.totalSuccessCount += item.successCount || 0;
      group.totalFailureCount += item.failureCount || 0;
      group.totalSkippedCount += item.skippedCount || 0;
      group.batchCount += 1;
      
      // タイムスタンプの範囲を更新
      if (item.timestamp < group.firstTimestamp) {
        group.firstTimestamp = item.timestamp;
      }
      if (item.timestamp > group.lastTimestamp) {
        group.lastTimestamp = item.timestamp;
      }
    });
    
    // 結果を配列に変換してソート（新しい順）
    const result = Array.from(groupedMap.values())
      .sort((a, b) => new Date(b.firstTimestamp) - new Date(a.firstTimestamp))
      .map(group => ({
        ...group,
        successRate: group.totalTargetUserCount > 0 
          ? Math.round((group.totalSuccessCount / group.totalTargetUserCount) * 10000) / 100 
          : 0,
        messagePreview: group.messages[0]?.message?.substring(0, 50) + '...' || ''
      }));
    
    return result;
  } catch (error) {
    console.error('Error getting broadcast summary:', error);
    return [];
  }
}

/**
 * 対話継続率（エンゲージメント率）を取得
 * @param {string} yearMonth - 年月（例: "2025-12"）
 * @param {number} threshold - 対話日数の閾値（デフォルト: 3）
 * @returns {Object} エンゲージメントデータ
 */
async function getEngagementRate(yearMonth, threshold = 3) {
  try {
    const params = {
      TableName: tableUserActivitySummary,
      FilterExpression: 'yearMonth = :yearMonth',
      ExpressionAttributeValues: {
        ':yearMonth': yearMonth
      }
    };

    const data = await dynamoDB.send(new ScanCommand(params));
    const items = data.Items || [];

    const totalActiveUsers = items.length;
    const engagedUsers = items.filter(item => (item.conversationDays || 0) >= threshold);
    const engagementRate = totalActiveUsers > 0 
      ? Math.round((engagedUsers.length / totalActiveUsers) * 10000) / 100 
      : 0;

    // 会話日数の分布
    const distribution = {
      '1日': items.filter(item => (item.conversationDays || 0) === 1).length,
      '2日': items.filter(item => (item.conversationDays || 0) === 2).length,
      '3-5日': items.filter(item => (item.conversationDays || 0) >= 3 && (item.conversationDays || 0) <= 5).length,
      '6-10日': items.filter(item => (item.conversationDays || 0) >= 6 && (item.conversationDays || 0) <= 10).length,
      '11日以上': items.filter(item => (item.conversationDays || 0) >= 11).length
    };

    return {
      yearMonth,
      threshold,
      totalActiveUsers,
      engagedUserCount: engagedUsers.length,
      engagementRate,
      distribution,
      engagedUsers: engagedUsers.map(item => ({
        userId: item.userId,
        conversationDays: item.conversationDays,
        messageCount: item.messageCount,
        firstMessageAt: item.firstMessageAt,
        lastMessageAt: item.lastMessageAt
      }))
    };
  } catch (error) {
    console.error('Error getting engagement rate:', error);
    return { 
      yearMonth, 
      threshold, 
      totalActiveUsers: 0, 
      engagedUserCount: 0, 
      engagementRate: 0, 
      distribution: {},
      engagedUsers: [] 
    };
  }
}

// ========================================
// 応答率（Response Rate）関連関数
// ========================================

/**
 * ブロードキャスト配信への反応を記録
 * ユーザーがメッセージを送信した時に呼び出し、
 * 最後の配信から24時間以内なら反応としてカウント
 * @param {string} userId - ユーザーID
 * @param {string} timestamp - レコードのタイムスタンプ
 * @param {string} lastBroadcastAt - 最後の配信時刻
 * @param {boolean} respondedToBroadcast - 既に反応済みかどうか
 * @param {number} responseWindowHours - 反応とみなす時間枠（デフォルト: 24時間）
 * @returns {Object} 更新結果
 */
async function checkAndRecordBroadcastResponse(userId, timestamp, lastBroadcastAt, respondedToBroadcast, responseWindowHours = 24) {
  try {
    // 既に反応済み、または配信を受けていない場合はスキップ
    if (respondedToBroadcast || !lastBroadcastAt) {
      return { recorded: false, reason: respondedToBroadcast ? 'already_responded' : 'no_broadcast' };
    }

    const now = new Date();
    const broadcastTime = new Date(lastBroadcastAt);
    const hoursSinceBroadcast = (now - broadcastTime) / (1000 * 60 * 60);

    // 24時間（または指定時間）以内の場合のみ反応として記録
    if (hoursSinceBroadcast <= responseWindowHours) {
      const params = {
        TableName: table,
        Key: {
          userId: userId,
          timestamp: timestamp
        },
        UpdateExpression: 'SET respondedToBroadcast = :responded, respondedAt = :respondedAt',
        ExpressionAttributeValues: {
          ':responded': true,
          ':respondedAt': now.toISOString()
        }
      };

      await dynamoDB.send(new UpdateCommand(params));
      console.log(`ユーザー ${userId} のブロードキャスト反応を記録しました（配信から ${hoursSinceBroadcast.toFixed(1)} 時間後）`);
      
      return { 
        recorded: true, 
        hoursSinceBroadcast: Math.round(hoursSinceBroadcast * 10) / 10,
        lastBroadcastAt 
      };
    }

    return { 
      recorded: false, 
      reason: 'outside_response_window',
      hoursSinceBroadcast: Math.round(hoursSinceBroadcast * 10) / 10 
    };
  } catch (error) {
    console.error('Error recording broadcast response:', error);
    return { recorded: false, error: error.message };
  }
}

/**
 * 応答率を取得
 * 指定期間内の配信に対するユーザー反応率を計算
 * @param {Object} options - オプション
 * @param {string} options.startDate - 開始日（例: "2025-12-22"）
 * @param {string} options.endDate - 終了日（例: "2025-12-31"）
 * @param {number} options.days - 過去N日間（startDate/endDateの代わりに使用可能）
 * @returns {Object} 応答率データ
 */
async function getResponseRate(options = {}) {
  try {
    const { startDate, endDate, days = 7 } = options;
    
    // 日付範囲を決定
    let start, end;
    if (startDate && endDate) {
      start = new Date(startDate);
      end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
    } else {
      end = new Date();
      start = new Date();
      start.setDate(start.getDate() - days);
    }

    // 全ユーザーのデータをスキャン
    const params = {
      TableName: table,
      FilterExpression: 'attribute_exists(lastBroadcastAt)',
      ProjectionExpression: 'userId, lastBroadcastAt, respondedToBroadcast, respondedAt, lastBroadcastId'
    };

    const data = await dynamoDB.send(new ScanCommand(params));
    const items = data.Items || [];

    // 指定期間内の配信を受けたユーザーをフィルタ
    const usersInPeriod = items.filter(item => {
      const broadcastTime = new Date(item.lastBroadcastAt);
      return broadcastTime >= start && broadcastTime <= end;
    });

    const totalBroadcastRecipients = usersInPeriod.length;
    const respondedUsers = usersInPeriod.filter(item => item.respondedToBroadcast === true);
    const responseCount = respondedUsers.length;
    const responseRate = totalBroadcastRecipients > 0 
      ? Math.round((responseCount / totalBroadcastRecipients) * 10000) / 100 
      : 0;

    // 配信IDごとの反応率を計算
    const broadcastStats = {};
    usersInPeriod.forEach(item => {
      const broadcastId = item.lastBroadcastId || 'unknown';
      if (!broadcastStats[broadcastId]) {
        broadcastStats[broadcastId] = {
          broadcastId,
          broadcastAt: item.lastBroadcastAt,
          totalRecipients: 0,
          respondedCount: 0
        };
      }
      broadcastStats[broadcastId].totalRecipients++;
      if (item.respondedToBroadcast) {
        broadcastStats[broadcastId].respondedCount++;
      }
    });

    // 配信ごとの応答率を計算
    const broadcastResponseRates = Object.values(broadcastStats)
      .map(stat => ({
        ...stat,
        responseRate: stat.totalRecipients > 0 
          ? Math.round((stat.respondedCount / stat.totalRecipients) * 10000) / 100 
          : 0
      }))
      .sort((a, b) => new Date(b.broadcastAt) - new Date(a.broadcastAt));

    return {
      period: {
        startDate: start.toISOString().split('T')[0],
        endDate: end.toISOString().split('T')[0]
      },
      totalBroadcastRecipients,
      responseCount,
      responseRate,
      broadcastResponseRates,
      respondedUsers: respondedUsers.map(item => ({
        userId: item.userId,
        lastBroadcastAt: item.lastBroadcastAt,
        respondedAt: item.respondedAt
      }))
    };
  } catch (error) {
    console.error('Error getting response rate:', error);
    return {
      period: {},
      totalBroadcastRecipients: 0,
      responseCount: 0,
      responseRate: 0,
      broadcastResponseRates: [],
      respondedUsers: [],
      error: error.message
    };
  }
}

// 外部からの利用を可能にするために関数をエクスポート
module.exports = {
  saveOrUpdateMessage,
  getMessages,
  saveGetCoupon,
  getCouponStatus,
  deleteUser,
  addBroadcastConversation,
  getMarathonInfo,
  getSystemContent,
  updateResponseTone,
  updateRelationshipTone,
  updatePolitenessTone,
  updateCoachingStyle,
  updateAttitudeTone,
  updateDisplayName,
  updateNickname,
  backupToS3,
  truncateMessage,
  // Broadcast Logs
  createBroadcastLog,
  updateBroadcastLog,
  getBroadcastLog,
  getRecentBroadcastLogs,
  // User Activity Summary
  updateUserActivitySummary,
  getUserActivitySummary,
  getMonthlyActiveUsers,
  getUserActivityHistory,
  // Analytics (Enhanced)
  getBroadcastSummary,
  getEngagementRate,
  // Response Rate
  checkAndRecordBroadcastResponse,
  getResponseRate
};
