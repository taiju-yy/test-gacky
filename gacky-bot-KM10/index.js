"use strict";
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const { LambdaClient, InvokeCommand } = require("@aws-sdk/client-lambda");
const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");
const { SQSClient, SendMessageBatchCommand } = require("@aws-sdk/client-sqs"); // Added SQS client
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const lambdaClient = new LambdaClient();
const s3Client = new S3Client();
const sqsClient = new SQSClient(); // Initialize SQS client
const line = require("@line/bot-sdk");
const moment = require('moment-timezone');
const { setTimeout } = require('timers/promises');
const client = new line.messagingApi.MessagingApiClient(
  { channelAccessToken: process.env.ACCESSTOKEN }
);
// 画像取得用の BlobClient
const blobClient = new line.messagingApi.MessagingApiBlobClient(
  { channelAccessToken: process.env.ACCESSTOKEN }
);
const {
  prescriptionFlow,
  getTextContent,
  isIncludeLastImage,
  prepareMessage,
  pickAssistantMessage,
  StoreFlexMessageBuilder
} = require('./utils');
const {
  defaultAction,
  couponAction,
  doNothingAction,
  showSettingMenuAction,
  showResponseToneMenuAction,
  saveResponseToneMenuAction,
  saveRelationshipToneMenuAction,
  saveCoachingStyleMenuAction,
  showRelationshipToneMenuAction,
  showCoachingStyleMenuAction,
  showPolitenessToneMenuAction,
  savePolitenessToneMenuAction,
  showAttitudeToneMenuAction,
  saveAttitudeToneMenuAction,
  applyPresetAction,
  showAllSettingsAction,
  handleStoreCommandAction,
  handlePostbackAction,
  showLuckyFoodFortuneAction,
  startChatWithGackyAction,
  showPrescriptionGuideAction,
  keywordPrescription
} = require('./handleMessages');

// Error sticker
const errorSticker = {
  type: "sticker",
  packageId: "8515",
  stickerId: "16581259"
};

const keywordCoffee = 'あおぞら';
const keywordCoupon = null; // 'トープ'  // クーポンキーワードを無効化
const keywordShowSettingMenu = '応対方法を変える';
const keywordLuckyFoodFortune = 'ラッキーフード占い';
const keywordChatWithGacky = 'Gackyとおしゃべりする';
const keywordShowResponseToneMenuAction = 'あっさり or こってり';
const regexSaveResponseToneMenuAction = /^あっさりした返事でいいよ|こってり長めの返事が欲しいな❗️|ふつうぐらいでいいよ😇$/;

const keywordShowRelationshipToneMenuAction = '肉食系 or 草食系';
const regexSaveRelationshipToneMenuAction = /^ガッキーの恋愛タイプは肉食系でしょ？笑|ガッキーの恋愛タイプは草食系な気がする|ノーマルガッキーでいいよ😇$/;

const keywordShowCoachingStyleMenuAction = '食事療法 or 運動療法';
const regexSaveCoachingStyleMenuAction = /^食事で健康になれたらイイと思う|体を動かしながら健康だったらイイな|バランスよくおねがい😇$/;

const keywordShowPolitenessToneMenuAction = '丁寧語 or タメ口';
const regexSavePolitenessToneMenuAction = /^丁寧語で話してほしいです！|タメ口で話してほしいな！|いつも通りでいいよ😇$/;

const keywordShowAttitudeToneMenuAction = 'スパルタ or 癒し系';
const regexSaveAttitudeToneMenuAction = /^ガッキーにはスパルタ対応してほしい！|ガッキーには癒し系対応でお願いしたいです|普通の対応でいいよ😊$/;

const regexApplyPreset = /^師匠ガッキーでお願い！|保健室ガッキーでお願い！$/;

const keywordShowAllSettings = '今の応対方法を教えて';

const {
  deleteUser,
  addBroadcastConversation,
  getCouponStatus,
  createBroadcastLog,
  updateBroadcastLog,
  getMonthlyActiveUsers,
  getUserActivityHistory,
  getRecentBroadcastLogs,
  getBroadcastSummary,
  getEngagementRate
} = require('./dynamoDBManager');

// 処方箋管理モジュール
const {
  handlePrescriptionImage,
  checkActiveMessagingSession,
  routeMessageToStore,
  generateReceptionConfirmMessage,
  startPrescriptionMode,
  checkPrescriptionMode,
  clearPrescriptionMode,
  startWaitingSession,
} = require('./prescriptionManager');

// Modified handler to support SQS messages and analytics
exports.handler = async (event, context) => {
  if (event.handler === 'broadcastHandler') {
    return await broadcastHandler(event, context);
  } else if (event.handler === 'analyticsHandler') {
    // Analytics handler for MAU and other metrics
    return await analyticsHandler(event, context);    
  } else if (event.Records && event.Records[0]?.eventSource === 'aws:sqs') {
    // Handle SQS events
    return await sqsHandler(event, context);
  } else {
    // Default handler for LINE webhook
    return await defaultHandler(event, context);
  }
};

async function defaultHandler(event, context) {
  const body = event.body;
  const parsedBody = JSON.parse(body);
  const signature = event.headers?.["x-line-signature"];

  // メッセージの署名を検証
  if (line.validateSignature(body, process.env.CHANNELSECRET, signature)) {
    console.log("署名認証成功");
    if (parsedBody.events.length === 0) {
      // Webhook URLの検証リクエストの場合
      return {
        statusCode: 200,
        headers: { "x-line-status": "OK" },
        body: '{"result":"connect check"}',
      };
    } else {
      try {
        // ブロックや友だち(再)登録の場合
        const eventObj = parsedBody.events[0];
        const eventType = eventObj.type;
        const userId = eventObj.source.userId;
        console.log("eventType: " + eventType);

        switch (eventType) {
          case "postback":
            await handlePostbackAction({ context, parsedBody, userId });
            break;

          case "follow":
            console.log("eventType: " + eventType);
            break;
          case "unfollow":
            console.log("eventType: " + eventType);
            if (1) {
              const params = {
                FunctionName: process.env.NAME_FUNC_EXPORT_UNFOLLOWED_USER_ITEM,
                InvocationType: 'RequestResponse', // 同期呼び出し
                Payload: JSON.stringify({ userId: userId })
              }
              try {
                const command = new InvokeCommand(params);
                const result = await lambdaClient.send(command);
                const payload = JSON.parse(new TextDecoder().decode(result.Payload));
                console.log('Export function result:', payload);
                await deleteUser(userId);
                return {
                  statusCode: 200,
                  body: JSON.stringify('Export function called successfully')
                };
              } catch (error) {
                console.error('Error calling export function:', error);
                return {
                  statusCode: 500,
                  body: JSON.stringify('Failed to call export function')
                };
              }
            }
            break;
          case "message":
            const messageType = parsedBody.events[0].message.type;
            const text = getTextContent(messageType, parsedBody);
            const actions = [];
            
            // ユーザープロフィールを取得（displayNameの活用のため）
            let userProfile = null;
            try {
              userProfile = await client.getProfile(userId);
              console.log(`User profile retrieved: ${userProfile?.displayName || 'N/A'}`);
            } catch (profileError) {
              console.warn('Could not get user profile:', profileError.message);
            }

            // ========================================
            // 処方箋関連: メッセージングセッションチェック
            // 店舗とのやりとり中は、AI応答をスキップしてメッセージを店舗にルーティング
            // ========================================
            const messagingSession = await checkActiveMessagingSession(userId);
            if (messagingSession.shouldRouteToStore && messagingSession.receptionId) {
              console.log(`Routing message to store for reception: ${messagingSession.receptionId}`);

              // テキストメッセージの場合、店舗にルーティング
              if (messageType === 'text') {
                await routeMessageToStore(userId, messagingSession.receptionId, text, 'text');
              }

              // AI応答をスキップ
              const replyToken = parsedBody.events[0].replyToken;
              await client.replyMessage({
                replyToken,
                messages: [{
                  type: 'text',
                  text: '💬 メッセージを店舗に送信しました。\n店舗からの返信をお待ちください。'
                }]
              });

              return {
                statusCode: 200,
                headers: { "x-line-status": "OK" },
                body: '{"result":"routed_to_store"}',
              };
            }

            // ========================================
            // 処方箋画像受付チェック
            // リッチメニューから「処方箋を送る」押下後の画像のみ受け付ける
            // ========================================
            if (messageType === 'image') {
              const prescriptionMode = await checkPrescriptionMode(userId);
              if (prescriptionMode.isActive) {
                console.log(`Prescription mode active for user ${userId}, processing image as prescription`);

                // 処方箋モードを解除
                await clearPrescriptionMode(userId);

                // 画像を取得して処方箋として処理
                const messageId = parsedBody.events[0].message.id;
                try {
                  // LINEから画像コンテンツを取得
                  const imageContent = await blobClient.getMessageContent(messageId);
                  const chunks = [];
                  for await (const chunk of imageContent) {
                    chunks.push(chunk);
                  }
                  const imageBuffer = Buffer.concat(chunks);

                  // ユーザープロフィールを取得
                  let userProfile = null;
                  try {
                    userProfile = await client.getProfile(userId);
                  } catch (profileError) {
                    console.warn('Could not get user profile:', profileError.message);
                  }

                  // 処方箋として保存
                  const result = await handlePrescriptionImage(userId, userProfile, imageBuffer, messageId);

                  if (result.success) {
                    // 「待機中」セッションを開始（店舗からの連絡待ち）
                    await startWaitingSession(userId, result.receptionId);

                    // 受付確認メッセージを送信
                    const replyToken = parsedBody.events[0].replyToken;
                    const confirmMessage = generateReceptionConfirmMessage(result.receptionId);
                    await client.replyMessage({
                      replyToken,
                      messages: [confirmMessage]
                    });

                    return {
                      statusCode: 200,
                      headers: { "x-line-status": "OK" },
                      body: '{"result":"prescription_received"}',
                    };
                  } else {
                    throw new Error(result.error || 'Failed to process prescription');
                  }
                } catch (imageError) {
                  console.error('Error processing prescription image:', imageError);
                  const replyToken = parsedBody.events[0].replyToken;
                  await client.replyMessage({
                    replyToken,
                    messages: [{
                      type: 'text',
                      text: 'ごめんなさい、処方箋の受付中にエラーが発生しました。\nお手数ですが、もう一度「処方箋を送る」からやり直してください。'
                    }]
                  });
                  return {
                    statusCode: 200,
                    headers: { "x-line-status": "OK" },
                    body: '{"result":"prescription_error"}',
                  };
                }
              }
              // 処方箋モードでない場合は通常のAI応答へ
            }

            // ========================================
            // 処方箋送付案内
            // ========================================
            if (messageType === 'text' && text === keywordPrescription) {
              actions.push(showPrescriptionGuideAction);
            }
            // 「トープ」キーワードの完全一致検出を最初に追加
            else if (messageType === 'text' && text === keywordCoupon) {
              // クーポン取得状況を確認
              const isGetCoupon = await getCouponStatus(userId);

              // 未取得の場合のみクーポンアクションを実行
              if (!isGetCoupon) {
                actions.push(couponAction);
                actions.push(doNothingAction); // AIの返信を防ぐ（LINE Auto-responseが動作）
              } else {
                // 既に取得済みの場合は通常のAI応答
                actions.push(defaultAction);
              }

            } else if (messageType === 'text' && text === keywordShowSettingMenu) {
              actions.push(showSettingMenuAction);

            } else if (messageType === 'text' && text === keywordLuckyFoodFortune) {
              actions.push(showLuckyFoodFortuneAction);

            } else if (messageType === 'text' && text === keywordChatWithGacky) {
              actions.push(startChatWithGackyAction);

            } else if (messageType === 'text' && text === keywordShowResponseToneMenuAction) {
              // リッチメニュー＞設定＞あっさり・こってりを押下した　→ あっさりこってり設定メニューをレスポンスする
              actions.push(showResponseToneMenuAction);

            } else if (messageType === 'text' && text === keywordShowRelationshipToneMenuAction) {
              // リッチメニュー＞設定＞肉食系 or 草食系を押下した　→ 肉食系 or 草食系設定メニューをレスポンスする
              actions.push(showRelationshipToneMenuAction);

            } else if (messageType === 'text' && text === keywordShowCoachingStyleMenuAction) {
              // リッチメニュー＞設定＞食事療法 or 運動療法を押下した　→ 食事療法 or 運動療法設定メニューをレスポンスする
              actions.push(showCoachingStyleMenuAction);

            } else if (messageType === 'text' && text === keywordShowPolitenessToneMenuAction) {
              // リッチメニュー＞設定＞丁寧語 or タメ口を押下した　→ 丁寧語 or タメ口設定メニューをレスポンスする
              actions.push(showPolitenessToneMenuAction);

            } else if (messageType === 'text' && text === keywordShowAttitudeToneMenuAction) {
              // リッチメニュー＞設定＞スパルタ or 癒し系を押下した　→ スパルタ or 癒し系設定メニューをレスポンスする
              actions.push(showAttitudeToneMenuAction);

            } else if (messageType === 'text' && regexApplyPreset.test(text)) {
              // プリセット設定を適用
              actions.push(applyPresetAction);

            } else if (messageType === 'text' && text === keywordShowAllSettings) {
              // リッチメニュー＞設定＞設定確認を押下した　→ 現在の設定をレスポンスする
              actions.push(showAllSettingsAction);

            } else if (messageType === 'image' && isIncludeLastImage(parsedBody.events) === false) {
              // 複数の画像が送られ、リクエストが最後の一枚がないときは何もしない
              actions.push(doNothingAction);

            } else if (messageType === 'text' && regexSaveResponseToneMenuAction.test(text)) {
              // リッチメニュー＞設定＞あっさり・こってり＞項目を選択した　→ DBに保存する
              actions.push(saveResponseToneMenuAction);

            } else if (messageType === 'text' && regexSaveRelationshipToneMenuAction.test(text)) {
              // リッチメニュー＞設定＞肉食系 or 草食系＞項目を選択した　→ DBに保存する
              actions.push(saveRelationshipToneMenuAction);

            } else if (messageType === 'text' && regexSaveCoachingStyleMenuAction.test(text)) {
              // リッチメニュー＞設定＞食事療法 or 運動療法＞項目を選択した　→ DBに保存する
              actions.push(saveCoachingStyleMenuAction);

            } else if (messageType === 'text' && regexSavePolitenessToneMenuAction.test(text)) {
              // リッチメニュー＞設定＞丁寧語 or タメ口＞項目を選択した　→ DBに保存する
              actions.push(savePolitenessToneMenuAction);

            } else if (messageType === 'text' && regexSaveAttitudeToneMenuAction.test(text)) {
              actions.push(saveAttitudeToneMenuAction);
            } else if (messageType === 'text' && text.startsWith('#cmd_')) {
              // 手入力されたコマンドをチェック
              actions.push(handleStoreCommandAction);
            } else {
              // デフォルトアクション（AIとやりとりする）
              actions.push(defaultAction);
            }

            for (const action of actions) {
              const result = await action({ context, parsedBody, userId, messageType, text, userProfile });
              if (result) return result;
            }
          default:
            break;
        }
        // 正常終了
        return {
          statusCode: 200,
          headers: { "x-line-status": "OK" },
          body: '{"result":"completed"}',
        };
      } catch (error) {
        console.log("メッセージ取得エラー: ", error);

        // LINEにエラー応答を返す
        let errorMessage = [
          {
            type: "text",
            text: "エラーが発生しました\n\n[エラーコード: GAJR-10000]",
          }
        ];

        errorMessage.push(errorSticker);

        const replyToken = parsedBody.events[0].replyToken;

        await client.replyMessage({ replyToken, messages: errorMessage })
        return {
          statusCode: 500,
          headers: { "Content-Type": "application/json" },
          body: '{"result":"error"}'
        };
      }
    }
  } else {
    console.log("署名認証エラー");
    return {
      statusCode: 401,
      headers: { "Content-Type": "application/json" },
      body: '{"result":"unauthorized"}'
    };
  }
};

async function broadcastHandler(event) {
  try {
    console.log('Broadcast event:', JSON.stringify(event));

    // ブロードキャストIDを生成（冪等性確保のため）
    const broadcastId = event.broadcastId || `broadcast_${new Date().toISOString()}_${require('crypto').randomBytes(4).toString('hex')}`;
    console.log(`ブロードキャストID: ${broadcastId}`);

    const { messages, sendToAll = false, userIds = [], title = null } = event;

    // ユーザーID取得
    let targetUserIds = userIds;
    console.log('Target user IDs count:', targetUserIds.length);

    // ブロードキャストログを作成
    const logResult = await createBroadcastLog({
      broadcastId,
      title,
      messages,
      targetUserCount: targetUserIds.length
    });
    
    if (logResult.status === 'error') {
      console.warn('Failed to create broadcast log, continuing with broadcast:', logResult.error);
    }
    const logTimestamp = logResult.timestamp;

    // SQSに送信
    const results = await sendBroadcastToSQS(targetUserIds, messages, broadcastId, 10, logTimestamp);
    
    const queuedCount = results.filter(r => r.status === 'queued').length;
    const errorCount = results.filter(r => r.status === 'error').length;
    
    console.log('SQS queue results summary:',
      `Total: ${results.length}, ` +
      `Successful: ${queuedCount}, ` +
      `Failed: ${errorCount}`);

    // ブロードキャストログのステータスを更新（キュー投入完了）
    if (logTimestamp) {
      await updateBroadcastLog(broadcastId, logTimestamp, {
        status: 'processing'
      });
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "Broadcast messages queued for processing",
        broadcastId,
        logTimestamp,
        summary: {
          total: results.length,
          queued: queuedCount,
          failed: errorCount
        },
        results
      })
    };
  } catch (error) {
    console.error('Broadcast handler error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ message: "Error in broadcast processing", error: error.message })
    };
  }
}

/**
 * 分析用ハンドラー - MAUやブロードキャストログを取得
 * 
 * テストイベント例:
 * 
 * 1. 月別アクティブユーザー取得:
 * {
 *   "handler": "analyticsHandler",
 *   "action": "getMonthlyActiveUsers",
 *   "yearMonth": "2025-12"
 * }
 * 
 * 2. ユーザーのアクティビティ履歴取得:
 * {
 *   "handler": "analyticsHandler",
 *   "action": "getUserActivityHistory",
 *   "userId": "Uxxxxxxxx",
 *   "months": 6
 * }
 * 
 * 3. 最近のブロードキャストログ取得:
 * {
 *   "handler": "analyticsHandler",
 *   "action": "getRecentBroadcastLogs",
 *   "limit": 10
 * }
 */
async function analyticsHandler(event) {
  try {
    console.log('Analytics event:', JSON.stringify(event));

    const { action, yearMonth, userId, months, limit } = event;

    switch (action) {
      case 'getMonthlyActiveUsers': {
        // 月別アクティブユーザー取得
        const targetYearMonth = yearMonth || getCurrentYearMonth();
        const result = await getMonthlyActiveUsers(targetYearMonth);

        return {
          statusCode: 200,
          body: JSON.stringify({
            action: 'getMonthlyActiveUsers',
            ...result
          }, null, 2)
        };
      }

      case 'getUserActivityHistory': {
        // ユーザーのアクティビティ履歴取得
        if (!userId) {
          return {
            statusCode: 400,
            body: JSON.stringify({ error: 'userId is required' })
          };
        }

        const result = await getUserActivityHistory(userId, months || 12);

        return {
          statusCode: 200,
          body: JSON.stringify({
            action: 'getUserActivityHistory',
            userId,
            months: months || 12,
            history: result
          }, null, 2)
        };
      }

      case 'getRecentBroadcastLogs': {
        // 最近のブロードキャストログ取得
        const result = await getRecentBroadcastLogs(limit || 50);

        return {
          statusCode: 200,
          body: JSON.stringify({
            action: 'getRecentBroadcastLogs',
            count: result.length,
            logs: result
          }, null, 2)
        };
      }

      case 'getBroadcastSummary': {
        // 同一配信をグループ化して取得
        const { date, days } = event;
        const result = await getBroadcastSummary({ date, days: days || 7 });

        return {
          statusCode: 200,
          body: JSON.stringify({
            action: 'getBroadcastSummary',
            count: result.length,
            summary: result
          }, null, 2)
        };
      }

      case 'getEngagementRate': {
        // 対話継続率（エンゲージメント率）取得
        const targetYearMonth = yearMonth || getCurrentYearMonth();
        const threshold = event.threshold || 3;
        const result = await getEngagementRate(targetYearMonth, threshold);

        return {
          statusCode: 200,
          body: JSON.stringify({
            action: 'getEngagementRate',
            ...result
          }, null, 2)
        };
      }

      default:
        return {
          statusCode: 400,
          body: JSON.stringify({
            error: 'Invalid action',
            availableActions: [
              'getMonthlyActiveUsers',
              'getUserActivityHistory',
              'getRecentBroadcastLogs',
              'getBroadcastSummary',
              'getEngagementRate'
            ],
            examples: {
              getMonthlyActiveUsers: {
                handler: 'analyticsHandler',
                action: 'getMonthlyActiveUsers',
                yearMonth: '2025-12'
              },
              getUserActivityHistory: {
                handler: 'analyticsHandler',
                action: 'getUserActivityHistory',
                userId: 'Uxxxxxxxx',
                months: 6
              },
              getRecentBroadcastLogs: {
                handler: 'analyticsHandler',
                action: 'getRecentBroadcastLogs',
                limit: 10
              },
              getBroadcastSummary: {
                handler: 'analyticsHandler',
                action: 'getBroadcastSummary',
                days: 7,
                date: '2025-12-29'
              },
              getEngagementRate: {
                handler: 'analyticsHandler',
                action: 'getEngagementRate',
                yearMonth: '2025-12',
                threshold: 3
              }
            }
          }, null, 2)
        };
    }
  } catch (error) {
    console.error('Analytics handler error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
}

// 現在の年月を取得するヘルパー関数
function getCurrentYearMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

async function sendBroadcastToSQS(userIds, messages, broadcastId, batchSize = 10, logTimestamp = null) {
  const queueUrl = process.env.SQS_QUEUE_URL;

  if (!queueUrl) {
    throw new Error("SQS_QUEUE_URL environment variable is not set");
  }

  const results = [];
  for (let i = 0; i < userIds.length; i += batchSize) {
    const batch = userIds.slice(i, i + batchSize);
    try {
      const entries = batch.map(userId => ({
        Id: uuidv4().replace(/-/g, ''),
        MessageBody: JSON.stringify({
          userId,
          messages,
          broadcastId,  // 追加: 冪等性確保のため
          logTimestamp,  // 追加: ブロードキャストログ更新用
          timestamp: new Date().toISOString()  // 追加: デバッグに役立つタイムスタンプ
        }),
        // 再試行ポリシーを設定
        MessageAttributes: {
          "RetryCount": {
            DataType: "Number",
            StringValue: "0"
          }
        },
        // メッセージの遅延を設定（バッチ間の時間差を作る）
        DelaySeconds: Math.floor(i / batchSize) % 10  // 0-9秒の遅延（バッチごとに異なる）
      }));

      const params = {
        Entries: entries,
        QueueUrl: queueUrl
      };

      const command = new SendMessageBatchCommand(params);
      const result = await sqsClient.send(command);

      // 処理結果の管理
      const idToUserMap = {};
      batch.forEach((userId, index) => {
        idToUserMap[entries[index].Id] = userId;
      });

      if (result.Successful && result.Successful.length > 0) {
        for (const msg of result.Successful) {
          const userId = idToUserMap[msg.Id];
          console.log(`Message sent to SQS for user ${userId}, MessageId: ${msg.MessageId}, BroadcastId: ${broadcastId}`);
          results.push({
            userId,
            status: 'queued',
            messageId: msg.MessageId,
            broadcastId
          });
        }
      }

      if (result.Failed && result.Failed.length > 0) {
        for (const msg of result.Failed) {
          const userId = idToUserMap[msg.Id];
          console.error(`Failed to send message to SQS for user ${userId}: ${msg.Message}`);
          results.push({
            userId,
            status: 'error',
            message: msg.Message,
            broadcastId
          });
        }
      }
    } catch (error) {
      console.error(`Error sending batch to SQS:`, error);
      // エラーログ
      for (const userId of batch) {
        results.push({
          userId,
          status: 'error',
          message: error.message,
          broadcastId
        });
      }
    }

    // バッチ間に短い遅延を入れる
    if (i + batchSize < userIds.length) {
      await setTimeout(100);
    }
  }

  return results;
}

async function sqsHandler(event, context) {
  try {
    console.log('Processing SQS event with', event.Records?.length || 0, 'records');

    const execEnv = process.env.ENV_EXEC || 'dev';
    const results = [];
    
    // ブロードキャストログ更新用の集計（broadcastId + logTimestamp ごとに集計）
    const logUpdates = {};

    // メッセージごとに処理
    for (const record of event.Records) {
      try {
        const body = JSON.parse(record.body);
        const { userId, messages, broadcastId, logTimestamp, timestamp } = body;

        console.log(`Processing message for user ${userId} in environment: ${execEnv}`);
        console.log(`BroadcastId: ${broadcastId}, LogTimestamp: ${logTimestamp}, Original timestamp: ${timestamp}`);

        // メッセージにタグをつける（開発環境用）
        const taggedMessages = messages.map(msg => {
          if (msg.messageType === 'text') {
            return {
              ...msg,
              message: execEnv === 'dev' ? `[DEV] ${msg.message}` : msg.message
            };
          }
          return msg;
        });

        // ユーザーデータを処理（冪等性を持つ関数を呼び出し）
        const result = await processUserMessages(userId, taggedMessages, broadcastId);

        // 結果を記録
        results.push({
          userId,
          status: result.status || 'unknown',
          environment: execEnv,
          broadcastId
        });
        
        // ブロードキャストログ更新用の集計
        if (broadcastId && logTimestamp) {
          const logKey = `${broadcastId}|${logTimestamp}`;
          if (!logUpdates[logKey]) {
            logUpdates[logKey] = {
              broadcastId,
              logTimestamp,
              successCount: 0,
              failureCount: 0,
              skippedCount: 0
            };
          }
          
          if (result.status === 'success') {
            logUpdates[logKey].successCount++;
          } else if (result.status === 'skipped') {
            logUpdates[logKey].skippedCount++;
          } else {
            logUpdates[logKey].failureCount++;
          }
        }
      } catch (error) {
        console.error(`Error processing SQS message:`, error);
        results.push({
          status: 'error',
          message: error.message,
          record: record.messageId
        });
      }
    }
    
    // ブロードキャストログを更新
    for (const logKey of Object.keys(logUpdates)) {
      const update = logUpdates[logKey];
      try {
        await updateBroadcastLog(update.broadcastId, update.logTimestamp, {
          successCount: update.successCount,
          failureCount: update.failureCount,
          skippedCount: update.skippedCount
        });
        console.log(`Updated broadcast log for ${update.broadcastId}: success=${update.successCount}, failed=${update.failureCount}, skipped=${update.skippedCount}`);
      } catch (logError) {
        console.error(`Failed to update broadcast log for ${update.broadcastId}:`, logError);
      }
    }

    console.log('SQS processing completed:', JSON.stringify(results, null, 2));
    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "SQS processing completed",
        environment: execEnv,
        summary: {
          total: results.length,
          successful: results.filter(r => r.status === 'success').length,
          skipped: results.filter(r => r.status === 'skipped').length,
          failed: results.filter(r => r.status === 'error').length
        }
      })
    };
  } catch (error) {
    console.error('SQS handler error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ message: "Error in SQS processing", error: error.message })
    };
  }
}

async function processUserMessages(userId, messages, broadcastId = null) {
  try {
    // ブロードキャストIDがある場合、冪等性を持つ関数を呼び出す
    if (broadcastId) {
      const result = await addBroadcastConversation(userId, messages, broadcastId);

      // 既に適用済みの場合はそのまま終了
      if (result.status === 'skipped') {
        console.log(`ユーザー ${userId} へのメッセージ ${broadcastId} は既に適用済みです。スキップします。`);
        return result;
      }

      if (result.status === 'error') {
        console.error(`ユーザー ${userId} へのメッセージ適用中にエラーが発生しました: ${result.error}`);
        return result;
      }
    } else {
      // 従来の方法（ブロードキャストIDなし）
      await addBroadcastConversation(userId, messages);
    }

    // LINE APIを使用してプッシュメッセージを送信
    const retryKey = uuidv4();
    console.log(`Sending messages to ${userId} with retry key: ${retryKey}`);

    // LINEメッセージフォーマットに変換
    const lineMessages = await Promise.all(messages.map(async (msg) => {
      switch (msg.messageType) {
        case 'text':
          return { type: "text", text: msg.message };
        case 'textV2':
          return {
            type: "textV2",
            text: msg.message,
            ...msg.substitution && { substitution: msg.substitution },
            quickReply: msg.quickReply
          };
        case 'image':
          const imageUrl = await getS3ObjectUrl(msg.s3Object.bucket, msg.s3Object.key);
          return { type: "image", originalContentUrl: imageUrl, previewImageUrl: imageUrl };
        case 'video':
          const videoUrl = await getS3ObjectUrl(msg.s3Object.bucket, msg.s3Object.key);
          const thumbnailUrl = await getS3ObjectUrl(msg.thumbnailS3Object.bucket, msg.thumbnailS3Object.key);
          return { type: "video", originalContentUrl: videoUrl, previewImageUrl: thumbnailUrl };
        default:
          throw new Error(`Unsupported message type: ${msg.messageType}`);
      }
    }));

    // LINE APIを呼び出し
    try {
      const response = await axios.post(
        'https://api.line.me/v2/bot/message/push',
        {
          to: userId,
          messages: lineMessages
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.ACCESSTOKEN}`,
            'X-Line-Retry-Key': retryKey
          }
        }
      );

      console.log(`Push messages response for ${userId}:`, response.data);
      return { status: 'success' };
    } catch (error) {
      console.error(`Error sending LINE messages to user ${userId}:`, error.response?.data || error.message);

      // エラーログを記録
      await backupToS3(userId, {
        userId,
        error: error.message,
        errorResponse: error.response?.data,
        broadcastId,
        timestamp: new Date().toISOString(),
        operation: 'sendLineMessage',
        status: 'error'
      }, `errors/line/${userId}/${new Date().toISOString().replace(/[:.]/g, '-')}.json`);

      return { status: 'error', error: error.message };
    }
  } catch (error) {
    console.error(`Error processing messages for user ${userId}:`, error);
    return { status: 'error', error: error.message };
  }
}

async function getS3ObjectUrl(bucket, key) {
  const command = new GetObjectCommand({ Bucket: bucket, Key: key });
  return await getSignedUrl(s3Client, command, { expiresIn: 3600 * 24 * 7 });
}