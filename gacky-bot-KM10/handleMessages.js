const line = require("@line/bot-sdk");
const moment = require('moment-timezone');
const client = new line.messagingApi.MessagingApiClient(
  { channelAccessToken: process.env.ACCESSTOKEN }
);
// Claudeからの応答を取得する関数をインポート
const { fetchClaudeResponse, fetchClaudeResponseWithCustomSystem, determineNickname } = require('./fetchClaudeResponse');
const {
  saveOrUpdateMessage,
  getMessages,
  saveGetCoupon,
  getCouponStatus,
  getSystemContent,
  updateResponseTone,
  updateRelationshipTone,
  updateCoachingStyle,
  updatePolitenessTone,
  updateAttitudeTone,
  updateUserActivitySummary,
  updateNickname,
  checkAndRecordBroadcastResponse
} = require('./dynamoDBManager');
const {
  prescriptionFlow,
  prepareMessage,
  pickAssistantMessage,
  StoreFlexMessageBuilder,
  SettingMenuFlexMessageBuilder,
  ResponseToneMenuFlexMessageBuilder,
  RelationshipToneMenuFlexMessageBuilder,
  CoachingStyleMenuFlexMessageBuilder,
  PolitenessMenuFlexMessageBuilder,
  AttitudeToneMenuFlexMessageBuilder,
  AllSettingsFlexMessageBuilder
} = require('./utils');
const { handleStoreCommand } = require('./selectStoreManager');
const { startPrescriptionMode } = require('./prescriptionManager');
const { storeList, getStoreById, getNearestStores } = require('./storeList');
const {
  FLOW_STEPS,
  POSTBACK_PREFIX,
  DELIVERY_METHODS,
  createDeliveryMethodSelectionMessage,
  createHomeDeliveryConfirmMessage,
  createStoreSearchMethodMessage,
  createLocationRequestMessage,
  createAddressInputMessage,
  createStoreSelectionMessage,
  createStoreConfirmationMessage,
  createPickupTimeInputMessage,
  createCustomTimeInputMessage,
  createPrescriptionImageRequestMessage,
  saveFlowState,
  getFlowState,
  resetFlowState,
  getUserStoreHistory,
  searchStoresByAddress,
  getPickupTimeText,
} = require('./prescriptionFlowManager');

const availableMessageTypes = [
  'text', //テキスト
  'image', //画像
  'location', //位置情報
];

// 会話履歴を残す数（お客様とAI合わせて）
const numMaxHistory = Number(process.env.NUM_PAST_CHAT);

const errorSticker = {
  type: "sticker",
  packageId: "8515",
  stickerId: "16581259"
};

async function commonAction(props, messages) {
  const { context, parsedBody, userId, text } = props;
  const replyToken = parsedBody.events[0].replyToken;
  await client.replyMessage({ replyToken, messages });

  return {
    statusCode: 200,
    headers: { "x-line-status": "OK" },
    body: '{"result":"completed"}',
  };
}

async function couponAction(props) {
  const { context, parsedBody, userId } = props;
  const isGetCoupon = await getCouponStatus(userId);
  const text = parsedBody.events[0].message.text;
  console.log('Keyword: ' + text);
  console.log('coupon status: ' + isGetCoupon);

  if (!isGetCoupon) {
    await saveGetCoupon(userId);
    console.log(`Coupon saved for user: ${userId}`);
  } else {
    console.log(`User ${userId} already has coupon`);
  }
}

// 何も行わず、200コードだけ返す
function doNothingAction(props) {
  return {
    statusCode: 200,
    headers: { "x-line-status": "OK" },
    body: '{"result":"skipped"}',
  };
}

// 設定メニューを返信
async function showSettingMenuAction(props) {
  // const {context, parsedBody, userId, text} = props;

  // 返信メッセージ作成
  const replyMessages = [];
  const FMB = new SettingMenuFlexMessageBuilder();
  replyMessages.push(FMB.output());

  // await saveOrUpdateMessage(userId, { role: 'user', content: text });
  // await saveOrUpdateMessage(userId, { role: 'assistant', content: '【SYSTEMから返却】設定メニューを表示しました。' });

  await commonAction(props, replyMessages);
}

// 応答メニューを返信
async function showResponseToneMenuAction(props) {
  // const {context, parsedBody, userId, text} = props;

  // 返信メッセージ作成
  const replyMessages = [];
  const FMB = new ResponseToneMenuFlexMessageBuilder();
  replyMessages.push(FMB.output());

  // await saveOrUpdateMessage(userId, { role: 'user', content: text });
  // await saveOrUpdateMessage(userId, { role: 'assistant', content: '【SYSTEMから返却】応対設定メニューを表示しました。あっさり、こってりが選択できます。' });

  await commonAction(props, replyMessages);
}

// 応答メニューを返信
async function showRelationshipToneMenuAction(props) {
  // const {context, parsedBody, userId, text} = props;

  // 返信メッセージ作成
  const replyMessages = [];
  const FMB = new RelationshipToneMenuFlexMessageBuilder();
  replyMessages.push(FMB.output());

  // await saveOrUpdateMessage(userId, { role: 'user', content: text });
  // await saveOrUpdateMessage(userId, { role: 'assistant', content: '【SYSTEMから返却】応対設定メニューを表示しました。肉食系、草食系が選択できます。' });

  await commonAction(props, replyMessages);
}

// 応答メニューを返信
async function showCoachingStyleMenuAction(props) {
  // const {context, parsedBody, userId, text} = props;

  // 返信メッセージ作成
  const replyMessages = [];
  const FMB = new CoachingStyleMenuFlexMessageBuilder();
  replyMessages.push(FMB.output());

  // await saveOrUpdateMessage(userId, { role: 'user', content: text });
  // await saveOrUpdateMessage(userId, { role: 'assistant', content: '【SYSTEMから返却】応対設定メニューを表示しました。食事療法、運動療法が選択できます。' });

  await commonAction(props, replyMessages);
}

// 丁寧語/タメ口メニューを返信
async function showPolitenessToneMenuAction(props) {
  // 返信メッセージ作成
  const replyMessages = [];
  const FMB = new PolitenessMenuFlexMessageBuilder();
  replyMessages.push(FMB.output());

  await commonAction(props, replyMessages);
}

// 応対強度メニューを返信
async function showAttitudeToneMenuAction(props) {
  const replyMessages = [];
  const FMB = new AttitudeToneMenuFlexMessageBuilder();
  replyMessages.push(FMB.output());

  await commonAction(props, replyMessages);
}

// 応答メニューを返信
async function showAllSettingsAction(props) {
  const { userId } = props;

  // 返信メッセージ作成
  const replyMessages = [];
  const { responseTone, coachingStyle, relationshipTone, politenessTone, attitudeTone } = await getMessages(userId);
  const FMB = new AllSettingsFlexMessageBuilder(responseTone, coachingStyle, relationshipTone, politenessTone, attitudeTone);
  replyMessages.push(FMB.output());

  await commonAction(props, replyMessages);
}

// 応答メニューを更新する
async function saveResponseToneMenuAction(props) {
  const { context, parsedBody, userId, text } = props;
  const responseTone = text.slice(0, 4);
  let responseToneValue;
  let responseText;
  if (responseTone === 'あっさり') {
    responseToneValue = 'A';
    responseText = '分かりました！ポイントを絞ってお話しさせていただきますね🎯';

  } else if (responseTone === 'こってり') {
    responseToneValue = 'K';
    responseText = 'わぁ！嬉しいです！私、実は話し出すと止まらないタイプなんです...！これからいろんなお話、させていただきますね！🌟✨';

  } else if (text === 'ふつうぐらいでいいよ😇') {
    responseToneValue = null;
    responseText = 'はい！いつも通りお話しさせていただきますね！金沢の日常のことも、いろいろお話できたら嬉しいです🌸';

  } else {
    throw new Error("unexpected responseTone");
  }
  await updateResponseTone(userId, responseToneValue);

  const replyMessages = [{
    type: "text",
    text: responseText,
  }];
  await saveOrUpdateMessage(userId, { role: 'user', content: text });
  await saveOrUpdateMessage(userId, { role: 'assistant', content: responseText });
  await commonAction(props, replyMessages);
}

// 応答メニューを更新する
async function saveRelationshipToneMenuAction(props) {
  const { context, parsedBody, userId, text } = props;
  const relationshipTone = text.slice(11, 14);
  let relationshipToneValue;
  let responseText;
  if (relationshipTone === '肉食系') {
    relationshipToneValue = 'N';
    responseText = 'えへへ...見抜かれちゃいました？私、好きなことはハッキリ言う派なんです！化学反応だって、働きかけないと起こらないですもんね！✨';
  } else if (relationshipTone === '草食系') {
    relationshipToneValue = 'S';
    responseText = 'そんな風に思ってもらえるなんて...！私、確かにゆっくり丁寧に関係性を育んでいきたいタイプかもです...🌱';

  } else if (text === 'ノーマルガッキーでいいよ😇') {
    relationshipToneValue = null;
    responseText = 'ありがとうございます！マイペースな私のままで接させていただきますね！これからよろしくお願いします✨';

  } else {
    throw new Error("unexpected relationshipTone");
  }
  await updateRelationshipTone(userId, relationshipToneValue);

  const replyMessages = [{
    type: "text",
    text: responseText,
  }];
  await saveOrUpdateMessage(userId, { role: 'user', content: text });
  await saveOrUpdateMessage(userId, { role: 'assistant', content: responseText });
  await commonAction(props, replyMessages);
}

// 応答メニューを更新する
async function saveCoachingStyleMenuAction(props) {
  const { context, parsedBody, userId, text } = props;
  const coachingStyle = text.slice(0, 1);
  let coachingStyleValue;
  let responseText;
  if (coachingStyle === '体') {
    coachingStyleValue = 'U';
    responseText = 'やった！私も運動大好きなんです！金沢マラソンのボランティアしたときの経験とか、日々の体づくりのコツとか、いろいろお話できたら嬉しいです💪';
  } else if (coachingStyle === '食') {
    coachingStyleValue = 'S';
    responseText = 'そうなんです！私も食事って大事だと思います！金沢には美味しくて体に良い食材がたくさんあるんですよ！これからいろいろご紹介させていただきますね🍴';

  } else if (text === 'バランスよくおねがい😇') {
    coachingStyleValue = null;
    responseText = 'はい！食事のことも運動のことも、バランスよくお話させていただきますね！健康づくり、一緒に頑張りましょう！🌈';

  } else {
    throw new Error("unexpected coachingStyle");
  }
  await updateCoachingStyle(userId, coachingStyleValue);
  const replyMessages = [{
    type: "text",
    text: responseText,
  }];
  await saveOrUpdateMessage(userId, { role: 'user', content: text });
  await saveOrUpdateMessage(userId, { role: 'assistant', content: responseText });
  await commonAction(props, replyMessages);
}

// 丁寧語/タメ口設定を更新する
async function savePolitenessToneMenuAction(props) {
  const { context, parsedBody, userId, text } = props;
  let politenessToneValue;
  let responseText;

  if (text === '丁寧語で話してほしいです！') {
    politenessToneValue = 'P';
    responseText = 'かしこまりました！これからは丁寧な言葉遣いでお話しさせていただきますね。お役に立てるよう頑張ります！';
  } else if (text === 'タメ口で話してほしいな！') {
    politenessToneValue = 'T';
    responseText = 'オッケー！じゃあこれからはタメ口で話すね！親しみやすい感じで話せて嬉しいな♪';
  } else if (text === 'いつも通りでいいよ😇') {
    politenessToneValue = null;
    responseText = 'わかりました！いつも通りの話し方に戻しますね。これからもよろしくお願いします！';
  } else {
    throw new Error("unexpected politenessTone");
  }

  await updatePolitenessTone(userId, politenessToneValue);

  const replyMessages = [{
    type: "text",
    text: responseText,
  }];

  await saveOrUpdateMessage(userId, { role: 'user', content: text });
  await saveOrUpdateMessage(userId, { role: 'assistant', content: responseText });
  await commonAction(props, replyMessages);
}

// 応対強度を更新する
async function saveAttitudeToneMenuAction(props) {
  const { context, parsedBody, userId, text } = props;
  let attitudeToneValue;
  let responseText;

  if (text === 'ガッキーにはスパルタ対応してほしい！') {
    attitudeToneValue = 'S';
    responseText = 'わかった！これからはもっと強気に話すね！困ったことがあったら、遠慮なく言ってよ。必要なのはスパルタ精神だよね！';
  } else if (text === 'ガッキーには癒し系対応でお願いしたいです') {
    attitudeToneValue = 'G';
    responseText = 'わかりました。これからは優しく穏やかに話しかけますね。何か困ったことがあれば、いつでも優しくサポートしますよ。';
  } else if (text === '普通の対応でいいよ😊') {
    attitudeToneValue = null;
    responseText = 'いつも通りの対応に戻しますね！バランスのいい感じで話しかけていきます。これからもよろしくね！';
  } else {
    throw new Error("unexpected attitudeTone");
  }

  await updateAttitudeTone(userId, attitudeToneValue);

  const replyMessages = [{
    type: "text",
    text: responseText,
  }];
  await saveOrUpdateMessage(userId, { role: 'user', content: text });
  await saveOrUpdateMessage(userId, { role: 'assistant', content: responseText });
  await commonAction(props, replyMessages);
}

// プリセット設定を適用するアクション
async function applyPresetAction(props) {
  const { context, parsedBody, userId, text } = props;
  let responseToneValue, politenessToneValue, attitudeToneValue;
  let responseText;

  if (text === '師匠ガッキーでお願い！') {
    responseToneValue = 'K';  // こってり
    politenessToneValue = 'T';  // タメ口
    attitudeToneValue = 'S';  // スパルタ
    responseText = 'よっしゃ！今日から私が君の師匠だ！💪\n厳しくいくけど、絶対に結果出させてやるからついてこい！\n一緒に頑張ろうぜ！🔥';
  } else if (text === '保健室ガッキーでお願い！') {
    responseToneValue = 'A';  // あっさり
    politenessToneValue = 'P';  // 丁寧語
    attitudeToneValue = 'G';  // 癒し系
    responseText = 'はい、わかりました。🌿\nこれからは保健室の先生のように、優しく見守りながらサポートさせていただきますね。';
  } else {
    throw new Error("unexpected preset");
  }

  // 3つの設定を一括更新
  await updateResponseTone(userId, responseToneValue);
  await updatePolitenessTone(userId, politenessToneValue);
  await updateAttitudeTone(userId, attitudeToneValue);

  // relationshipToneとcoachingStyleはnullに設定（無効化）
  await updateRelationshipTone(userId, null);
  await updateCoachingStyle(userId, null);

  const replyMessages = [{
    type: "text",
    text: responseText,
  }];

  await saveOrUpdateMessage(userId, { role: 'user', content: text });
  await saveOrUpdateMessage(userId, { role: 'assistant', content: responseText });
  await commonAction(props, replyMessages);
}

// Store Command 処理アクション
async function handleStoreCommandAction(props) {
  const { context, parsedBody, userId, text } = props;
  const replyToken = parsedBody.events[0].replyToken;

  try {
    const response = await handleStoreCommand(userId, text);
    await client.replyMessage({
      replyToken,
      messages: [response]
    });

    return {
      statusCode: 200,
      headers: { "x-line-status": "OK" },
      body: '{"result":"completed"}'
    };
  } catch (error) {
    console.error('Store selection error:', error);
    throw error;
  }
}


// Postback イベント処理用アクション
async function handlePostbackAction(props) {
  const { context, parsedBody, userId } = props;
  const eventObj = parsedBody.events[0];
  const postbackData = eventObj.postback.data;
  const replyToken = eventObj.replyToken;

  console.log("Received postback data:", postbackData);

  // 店舗選択関連のコマンドをチェック
  if (postbackData.startsWith('#cmd_') ||
    postbackData.startsWith('store:') ||
    postbackData.startsWith('region:') ||
    postbackData.startsWith('page:')) {
    try {
      const response = await handleStoreCommand(userId, postbackData);
      await client.replyMessage({
        replyToken,
        messages: [response]
      });

      return {
        statusCode: 200,
        headers: { "x-line-status": "OK" },
        body: '{"result":"completed"}'
      };
    } catch (error) {
      console.error('Store selection error:', error);
      throw error;
    }
  }
}

// AIの返答をチェックする関数
function validateResponse(responseText) {
  const issues = [];

  // 曜日チェック（現在時刻と照合）
  const currentJST = moment().tz('Asia/Tokyo');
  const currentDayOfWeek = currentJST.format('dddd');
  const dayMapping = {
    'Sunday': '日曜日',
    'Monday': '月曜日',
    'Tuesday': '火曜日',
    'Wednesday': '水曜日',
    'Thursday': '木曜日',
    'Friday': '金曜日',
    'Saturday': '土曜日'
  };

  const correctDay = dayMapping[currentDayOfWeek];
  const incorrectDays = Object.values(dayMapping).filter(day => day !== correctDay);

  // 明確に「今日」を言及している場合のみチェック
  const todayPatterns = ['今日は', '今日って', '今日の', '本日は', '本日の'];
  const hasTodayMention = todayPatterns.some(pattern => responseText.includes(pattern));

  if (hasTodayMention) {
    for (const wrongDay of incorrectDays) {
      if (responseText.includes(wrongDay)) {
        issues.push(`曜日が間違っています。今日は${correctDay}です`);
        break;
      }
    }
  }

  return issues;
}

// 「あんた」を「あなた」に置換
function sanitizeResponse(responseText) {
  // 「あんた」を「あなた」に置換
  return responseText.replace(/あんた/g, 'あなた');
}

async function defaultAction(props) {
  const { context, parsedBody, userId, messageType, text, userProfile } = props;
  // 会話履歴の取得
  let { messages, lastInteractionDate, responseTone, relationshipTone, coachingStyle, politenessTone, attitudeTone, displayName, nickname, timestamp, lastBroadcastAt, respondedToBroadcast } = await getMessages(userId);
  
  // 応答率計算: ブロードキャスト配信への反応を記録（24時間以内の場合）
  if (lastBroadcastAt && !respondedToBroadcast && timestamp) {
    const responseResult = await checkAndRecordBroadcastResponse(userId, timestamp, lastBroadcastAt, respondedToBroadcast);
    if (responseResult.recorded) {
      console.log(`ブロードキャスト反応記録: userId=${userId}, 配信から${responseResult.hoursSinceBroadcast}時間後`);
    }
  }
  
  // displayName の決定（LINEプロフィールから取得した最新の名前、またはDBに保存されている名前）
  const currentDisplayName = userProfile?.displayName || displayName || null;
  
  // nickname の決定と生成
  // 1. DBに既に保存されている nickname があればそれを使用
  // 2. なければ displayName から AI で生成して保存
  let currentNickname = nickname;
  if (!currentNickname && currentDisplayName) {
    console.log(`No nickname found, generating from displayName: ${currentDisplayName}`);
    currentNickname = await determineNickname(currentDisplayName);
    if (currentNickname) {
      // 生成した nickname を DB に保存
      await updateNickname(userId, currentNickname);
      console.log(`Nickname generated and saved: ${currentNickname}`);
    }
  }
  console.log(`Using nickname for conversation: ${currentNickname || 'N/A'}`);

  // 新しいメッセージを履歴に追加
  messages = [...messages, ...(await prepareMessage(messageType, parsedBody))]

  // 履歴が長い場合は直近のみにする
  if (numMaxHistory < messages.length) {
    messages = messages.slice(messages.length - (numMaxHistory + 1));
  }

  // Claude APIに渡すmessagesを準備
  let claudeMessages = messages;
  if (claudeMessages[0].role !== 'user') {
    claudeMessages = claudeMessages.slice(1);
  }

  // 現在の日本時間を取得
  const currentJST = moment().tz('Asia/Tokyo').format('YYYY-MM-DD HH:mm:ss');

  // LLMからの応答を取得
  let assistantMessage = "";
  let assistantMessageObj = {};
  if (!availableMessageTypes.includes(messageType)) {
    assistantMessage = "ごめんね。スタンプや動画はまだ分からないんだ。テキストでお話しよ！";
  } else {
    assistantMessageObj = await fetchClaudeResponse(claudeMessages, currentJST, messageType, responseTone, relationshipTone, coachingStyle, politenessTone, attitudeTone, currentNickname);
    assistantMessage = pickAssistantMessage(parsedBody, messageType, assistantMessageObj);

    // 「あんた」を「あなた」に置換
    assistantMessage = sanitizeResponse(assistantMessage);

    // マークダウン記号を除去・置換（追加）
    assistantMessage = sanitizeMarkdown(assistantMessage);

    // 曜日チェックのみ実行
    const issues = validateResponse(assistantMessage);
    if (issues.length > 0) {
      console.error('Response validation failed:', issues);
      assistantMessage = "あ、ゴメン。ちょっと3025年のこと考えてたわ...もう一度話しかけてもらえる？😅";
    }
  }

  // timestampがある場合は会話履歴が保存されているので更新
  let isError = false;
  if ('LLM API error' == assistantMessage) {
    assistantMessage = 'ごめんなさい！いま勉強に集中してて\n\n[エラーコード: GAJR-10001]';
    isError = true;
    console.log(`LLM API error for userId: ${userId}`);
  } else {
    // 応答を履歴に追加（displayNameも一緒に保存）
    await saveOrUpdateMessage(userId, { role: 'user', content: text }, 0, currentDisplayName); // ユーザーからのメッセージ
    await saveOrUpdateMessage(userId, {
      role: 'assistant',
      content: assistantMessage,
      systemGenerated: false // AIの応答はsystemGeneratedではない（ユーザーとの会話の一部）
    }, 0, currentDisplayName);
    
    // ユーザーアクティビティサマリーを更新（MAU計算用）
    await updateUserActivitySummary(userId);
  }

  // LINEに応答を返す
  let replyMessages = [
    {
      type: "text",
      text: assistantMessage,
    }
  ];

  // 応答内容の追加
  if (isError) {
    // エラーの場合はスタンプを追加
    replyMessages.push(errorSticker);
  } else {
    if (messageType === 'text') {
      // 処方箋フロー　１　処方箋ワードがある場合は、位置情報の案内を追加
      await prescriptionFlow(replyMessages, text, claudeMessages);

    } else if (messageType === 'location') {
      // 処方箋フロー　２　位置情報を送信された場合は、AIにはLocation形式でレスポンスさせているので、そのままpush
      const FMB = new StoreFlexMessageBuilder(
        assistantMessageObj.storeName.replace("あおぞら薬局", "").trim(),
        assistantMessageObj.address,
        assistantMessageObj.lineUrl,
        assistantMessageObj.mapUrl,
        assistantMessageObj.commentFromGacky
      )
      replyMessages.push({
        type: "text",
        text: `${assistantMessageObj.storeName}のLINE公式アカウントから「オンライン処方」を受け付けてるよ🏥 ぜひ使ってみて❗️`
      });
      replyMessages.push(FMB.output());
    }
  }

  const replyToken = parsedBody.events[0].replyToken;

  await client.replyMessage({ replyToken, messages: replyMessages });
  return {
    statusCode: 200,
    headers: { "x-line-status": "OK" },
    body: '{"result":"completed"}',
  };
}

// マークダウン記号を除去または置換する関数
function sanitizeMarkdown(text) {
  if (!text) return text;
  
  // **太字** を「」に置換(空の場合は削除)
  text = text.replace(/\*\*([^*]*)\*\*/g, (match, p1) => p1.trim() ? `「${p1}」` : '');
  
  // *イタリック* を削除(空でも削除)
  text = text.replace(/\*([^*]*)\*/g, '$1');
  
  // __下線__ を「」に置換(空の場合は削除)
  text = text.replace(/__([^_]*)__/g, (match, p1) => p1.trim() ? `「${p1}」` : '');
  
  // _イタリック_ を削除(空でも削除)
  text = text.replace(/_([^_]*)_/g, '$1');
  
  // ###見出し を削除
  text = text.replace(/^#{1,6}\s+/gm, '');
  
  // - リスト記号を・に置換(行頭のみ)
  text = text.replace(/^-\s+/gm, '・');
  
  // * リスト記号を・に置換(行頭のみ)
  text = text.replace(/^\*\s+/gm, '・');
  
  // `コード` を「」に置換(空の場合は削除)
  text = text.replace(/`([^`]*)`/g, (match, p1) => p1.trim() ? `「${p1}」` : '');
  
  // [リンクテキスト](URL) をリンクテキストのみに(空の場合は削除)
  text = text.replace(/\[([^\]]*)\]\([^)]+\)/g, (match, p1) => p1.trim() ? p1 : '');
  
  return text;
}

// 季節を判定する関数
function getSeason(month) {
  if (month >= 3 && month <= 5) return '春';
  if (month >= 6 && month <= 8) return '夏';
  if (month >= 9 && month <= 11) return '秋';
  return '冬';
}

// 季節ごとの旬の食材（例示用）
function getSeasonalFoodsExample(season) {
  const seasonalFoods = {
    '春': ['菜の花', '新たまねぎ', 'アスパラガス', 'たけのこ', '春キャベツ', 'さわら', 'いちご'],
    '夏': ['トマト', 'きゅうり', 'なす', 'ゴーヤ', 'すいか', 'とうもろこし', 'あじ'],
    '秋': ['さつまいも', 'きのこ類', '栗', 'さんま', '柿', 'ぶどう', 'れんこん'],
    '冬': ['大根', '白菜', 'ブリ', 'かに', 'みかん', 'ほうれん草', 'ねぎ']
  };
  return seasonalFoods[season] || seasonalFoods['冬'];
}

// ③ ラッキーフード占い（季節感対応版）
async function showLuckyFoodFortuneAction(props) {
  const { userId, text, userProfile } = props;
  
  try {
    // 現在の日本時間を取得
    const currentJST = moment().tz('Asia/Tokyo');
    const currentTimeStr = currentJST.format('YYYY-MM-DD HH:mm:ss');
    const month = currentJST.month() + 1;
    const day = currentJST.date();
    const hour = currentJST.hour();
    
    // 季節を判定
    const season = getSeason(month);
    const seasonalFoodsExample = getSeasonalFoodsExample(season);
    
    // ユーザー設定を取得
    const { messages, responseTone, relationshipTone, coachingStyle, politenessTone, attitudeTone, displayName, nickname } = await getMessages(userId);
    
    // displayName の決定
    const currentDisplayName = userProfile?.displayName || displayName || null;
    
    // nickname の決定（なければ生成）
    let currentNickname = nickname;
    if (!currentNickname && currentDisplayName) {
      currentNickname = await determineNickname(currentDisplayName);
      if (currentNickname) {
        await updateNickname(userId, currentNickname);
      }
    }
    
    // ラッキーフード占い用のシステムプロンプトを取得（改良版）
    let fortuneSystemPrompt = await getSystemContent('luckyFoodFortune');
    if (!fortuneSystemPrompt) {
      fortuneSystemPrompt = `あなたはGackyです。ラッキーフード占いを求められています。
現在の季節を考慮して、健康に良い旬の食材を1つ選んで提案してください。
その食材の栄養価や健康効果を、薬ZEROの視点から説明してください。
石川県・金沢の地元食材も時々混ぜてください。
140文字以内で、親しみやすく楽しい雰囲気で回答してください。

【重要】
- マークダウン記法（**、*、__、_、###、など）は絶対に使用しないでください
- 強調したい部分は「」（鍵括弧）で囲んでください
- LINEのテキストメッセージとして自然に読めるよう、記号は最小限にしてください
- 絵文字は適度に使用してください（1〜2個）`;
    }
    
    // 占い生成用のプロンプト（季節情報を自然に伝える）
    const luckyFoodPrompt = {
      role: 'user',
      content: `「ラッキーフード占い」をお願いします！

今日は${month}月${day}日だよ。今の季節（${season}）にぴったりのラッキーフードを教えて！
${currentNickname ? `（${currentNickname}さんへの占いだよ！名前を呼んであげてね）` : ''}

参考までに${season}の食材の例：${seasonalFoodsExample.join('、')} など
（これ以外の${season}らしい食材でもOK！石川県の地元食材も大歓迎！）

※マークダウン記法（**太字**など）は使わず、強調は「」で囲んでね`
    };
    
    // 会話履歴を作成
    const fortuneMessages = [luckyFoodPrompt];
    
    // Claude APIでresponseを生成（季節情報付きシステムプロンプトを使用）
    const assistantMessageObj = await fetchClaudeResponseWithCustomSystem(
      fortuneMessages,
      currentTimeStr,
      fortuneSystemPrompt,
      responseTone || 'N',
      relationshipTone || null,
      coachingStyle || 'B',
      politenessTone || 'N',
      attitudeTone || null,
      season  // 季節情報を渡す
    );
    
    let fortuneMessage = assistantMessageObj.commentFromGacky;
    
    // マークダウン記号を除去・置換
    fortuneMessage = sanitizeMarkdown(fortuneMessage);
    
    // エラーハンドリング（既に定義済みの season 変数を使用）
    if (fortuneMessage === 'LLM API error') {
      const fallbackFoods = {
        '春': '「菜の花」！春のデトックスにぴったりだよ🌸',
        '夏': '「トマト」！リコピンで紫外線対策バッチリ🍅',
        '秋': '「きのこ」！免疫力アップで風邪予防🍄',
        '冬': '「ブリ」！DHAで頭も体もポカポカ🐟'
      };
      
      fortuneMessage = `今日のラッキーフードは${fallbackFoods[season]}\n薬ZEROの健康を目指そう✨`;
    }
    
    // 返信メッセージ
    const replyMessages = [{
      type: 'text',
      text: fortuneMessage
    }];
    
    // 履歴保存
    await saveOrUpdateMessage(userId, { role: 'user', content: text || 'ラッキーフード占い' });
    await saveOrUpdateMessage(userId, { role: 'assistant', content: fortuneMessage });
    
    await commonAction(props, replyMessages);
    
  } catch (error) {
    console.error('Lucky food fortune error:', error);
    
    const replyMessages = [{
      type: 'text',
      text: 'ごめんね、占いの調子が悪いみたい😣\nでも季節の野菜を食べれば間違いなし！薬ZEROを目指そう✨'
    }];
    
    await commonAction(props, replyMessages);
  }
}

// 月ごとの季節イベントや話題を定義
const getMonthlyContext = (month, day) => {
  const monthlyTopics = {
    1: {
      events: '正月、成人式、初詣、新年の抱負',
      seasonal: '雪、寒さ対策、おせち料理、七草粥',
      gacky: '3025年の正月は全然違ったんだよ！VRで世界中の人と初詣してた'
    },
    2: {
      events: '節分、バレンタイン、梅の開花',
      seasonal: '恵方巻、チョコレート、花粉症対策',
      gacky: 'Virtual Pharmacy Projectでチョコレートの健康効果を研究中！'
    },
    3: {
      events: 'ひな祭り、卒業式、春分の日、お花見準備',
      seasonal: '桜餅、菜の花、春の訪れ',
      gacky: '金沢の桜は3025年でも変わらず美しかったなぁ'
    },
    4: {
      events: '入学式、新生活、お花見、ゴールデンウィーク準備',
      seasonal: '桜、新緑、春野菜',
      gacky: 'ファーマシューティカル大学の新学期が始まる！'
    },
    5: {
      events: 'こどもの日、母の日、ゴールデンウィーク',
      seasonal: '鯉のぼり、新茶、初夏の陽気',
      gacky: '鈴木さんご夫婦とGWに能登へドライブしたい！'
    },
    6: {
      events: '父の日、梅雨入り、夏至',
      seasonal: '紫陽花、梅仕事、除湿対策',
      gacky: '3025年は天候コントロールで梅雨がなかったんだ'
    },
    7: {
      events: '七夕、海開き、夏祭り準備、土用の丑の日',
      seasonal: '浴衣、花火、熱中症対策',
      gacky: '金沢の夏祭り、初めて体験するから楽しみ！'
    },
    8: {
      events: 'お盆、夏祭り、高校野球',
      seasonal: '盆踊り、スイカ、夏バテ対策',
      gacky: 'グランファルマで熱中症予防の啓発活動してるよ'
    },
    9: {
      events: '防災の日、敬老の日、秋分の日、お月見',
      seasonal: '月見団子、秋の味覚、台風対策',
      gacky: '3025年の防災技術、2025年にも活かしたい！'
    },
    10: {
      events: 'ハロウィン、体育の日、紅葉狩り計画',
      seasonal: 'かぼちゃ、栗、読書の秋',
      gacky: 'Virtual Pharmacy Projectで秋の薬膳研究中！'
    },
    11: {
      events: '文化の日、七五三、勤労感謝の日、紅葉',
      seasonal: '紅葉狩り、新米、年末準備',
      gacky: '兼六園の紅葉、3025年と変わらず綺麗だね！'
    },
    12: {
      events: 'クリスマス、大掃除、年越し準備、冬至',
      seasonal: 'イルミネーション、ゆず湯、おせち準備',
      gacky: '鈴木さんご夫婦と過ごす初めての年越し！'
    }
  };
  
  const topic = monthlyTopics[month] || monthlyTopics[1];
  
  // 日付によってさらに具体的に
  let specificEvent = '';
  if (month === 12 && day >= 20 && day <= 25) {
    specificEvent = 'クリスマスシーズン真っ只中！';
  } else if (month === 1 && day <= 7) {
    specificEvent = 'お正月気分がまだ残ってるね！';
  } else if (month === 2 && day === 14) {
    specificEvent = '今日はバレンタインデー！';
  }
  // 他の特定日も追加可能
  
  return {
    ...topic,
    specific: specificEvent
  };
};

// ④ Gackyとおしゃべりする - 改善版（全月対応）
async function startChatWithGackyAction(props) {
  const { userId, text, userProfile } = props;
  
  try {
    // 現在の日本時間を取得
    const currentJST = moment().tz('Asia/Tokyo');
    const currentTimeStr = currentJST.format('YYYY-MM-DD HH:mm:ss');
    const dayOfWeek = currentJST.format('dddd');
    const hour = currentJST.hour();
    const month = currentJST.month() + 1;
    const day = currentJST.date();
    
    // 月ごとの話題を取得
    const monthlyContext = getMonthlyContext(month, day);
    
    // 曜日を日本語に変換
    const dayMapping = {
      'Monday': '月曜日', 'Tuesday': '火曜日', 'Wednesday': '水曜日',
      'Thursday': '木曜日', 'Friday': '金曜日', 'Saturday': '土曜日', 'Sunday': '日曜日'
    };
    const japaneseDayOfWeek = dayMapping[dayOfWeek];
    
    // ユーザー設定と履歴を取得
    const { messages, responseTone, relationshipTone, coachingStyle, politenessTone, attitudeTone, displayName, nickname } = await getMessages(userId);
    
    // displayName の決定
    const currentDisplayName = userProfile?.displayName || displayName || null;
    
    // nickname の決定（なければ生成）
    let currentNickname = nickname;
    if (!currentNickname && currentDisplayName) {
      currentNickname = await determineNickname(currentDisplayName);
      if (currentNickname) {
        await updateNickname(userId, currentNickname);
      }
    }
    
    // 時間帯別のコンテキスト
    let timeContext = '';
    if (hour >= 5 && hour < 10) {
      timeContext = '朝の挨拶。朝食や一日の始まりについて';
    } else if (hour >= 10 && hour < 14) {
      timeContext = 'お昼時。ランチや午後の予定について';
    } else if (hour >= 14 && hour < 18) {
      timeContext = '午後。おやつや夕方の過ごし方について';
    } else if (hour >= 18 && hour < 22) {
      timeContext = '夜。夕食や今日の振り返りについて';
    } else {
      timeContext = '深夜。夜更かしの心配や睡眠について';
    }
    
    // 挨拶生成用のプロンプト（月ごとの話題を含む）
    const greetingPrompt = {
      role: 'user',
      content: `「Gackyとおしゃべりする」ボタンが押されました。会話を始めるための挨拶をお願いします。

現在：${currentTimeStr}（${japaneseDayOfWeek}）
時間帯：${timeContext}
${currentNickname ? `お客様の呼び名：${currentNickname}さん（挨拶で呼びかけてあげてね！）` : ''}

【今月の話題】
- イベント：${monthlyContext.events}
- 季節の話題：${monthlyContext.seasonal}
- Gackyの視点：${monthlyContext.gacky}
${monthlyContext.specific ? `- 特記事項：${monthlyContext.specific}` : ''}

これらの話題から1つ選んで、自然に会話に織り込んでください。
ユーザーID末尾：${userId.slice(-4)}（ユーザーごとに異なる話題を）`
    };
    
    // 会話履歴（最近のもの少しだけ含める）
    const greetingMessages = messages.slice(-2).concat([greetingPrompt]);
    
    // Claude APIで生成（nicknameを渡す）
    const assistantMessageObj = await fetchClaudeResponse(
      greetingMessages,
      currentTimeStr,
      'text',
      responseTone || 'N',
      relationshipTone || null,
      coachingStyle || null,
      politenessTone || 'N',
      attitudeTone || null,
      currentNickname
    );
    
    let greetingMessage = assistantMessageObj.commentFromGacky;
    
    // マークダウン記号を除去・置換
    greetingMessage = sanitizeMarkdown(greetingMessage);
    
    // エラーハンドリング
    if (greetingMessage === 'LLM API error') {
      // エラー時は月に応じた簡単な挨拶
      greetingMessage = `やっほー！${month}月だね！${monthlyContext.seasonal.split('、')[0]}の季節！\n今日はどんな話をしようか？😊`;
    }
    
    // クイックリプライも月に応じて変更
    const quickReplyItems = [
      {
        type: 'action',
        action: { 
          type: 'message', 
          label: monthlyContext.events.split('、')[0], // その月の最初のイベント
          text: `${monthlyContext.events.split('、')[0]}について教えて`
        }
      },
      {
        type: 'action',
        action: { type: 'message', label: '健康相談', text: `${month}月の健康管理について` }
      },
      {
        type: 'action',
        action: { type: 'message', label: '3025年の話', text: `3025年の${month}月はどんな感じ？` }
      },
      {
        type: 'action',
        action: { type: 'message', label: 'Virtual Pharmacy', text: 'Virtual Pharmacy Projectについて' }
      }
    ];
    
    // 返信メッセージ
    const replyMessages = [{
      type: 'text',
      text: greetingMessage,
      quickReply: { items: quickReplyItems }
    }];
    
    // 履歴保存
    await saveOrUpdateMessage(userId, { role: 'user', content: text || 'Gackyとおしゃべりする' });
    await saveOrUpdateMessage(userId, { role: 'assistant', content: greetingMessage });
    
    await commonAction(props, replyMessages);
    
  } catch (error) {
    console.error('Chat greeting error:', error);
    
    // エラー時のフォールバック
    const replyMessages = [{
      type: 'text',
      text: 'やっほー！Gackyだよ😊\n今日はどんな話をしようか？'
    }];
    
    await commonAction(props, replyMessages);
  }
}

// 処方箋画像受付キーワード
const keywordPrescription = '処方箋を送る';

// 処方箋送付案内アクション
// リッチメニューから「処方箋を送る」を押したときに呼び出される
// 新しいフロー: まず受け取り方法（店舗 or 自宅）を選択させる
async function showPrescriptionGuideAction(props) {
  const { userId } = props;

  console.log(`Prescription flow started for user ${userId}`);

  // フローの初期状態を設定
  await saveFlowState(userId, {
    step: FLOW_STEPS.SELECT_DELIVERY_METHOD,
    deliveryMethod: null,
    selectedStoreId: null,
    pickupTime: null,
    pickupTimeText: null,
    previousStep: FLOW_STEPS.IDLE,
  });

  // 受け取り方法選択メッセージを送信
  const replyMessages = [createDeliveryMethodSelectionMessage()];

  await commonAction(props, replyMessages);
}

/**
 * 処方箋フローのpostbackハンドラー
 * 新しいフロー: 受け取り方法選択 → 店舗選択 → 受け取り時間入力 → 処方箋送信
 */
async function handlePrescriptionFlowPostback(props, postbackData) {
  const { userId } = props;
  
  console.log(`Handling prescription flow postback for user ${userId}: ${postbackData}`);

  // 現在のフロー状態を取得
  let flowState = await getFlowState(userId);

  // やり直し
  if (postbackData === POSTBACK_PREFIX.RESTART) {
    await resetFlowState(userId);
    const replyMessages = [createDeliveryMethodSelectionMessage()];
    await saveFlowState(userId, {
      step: FLOW_STEPS.SELECT_DELIVERY_METHOD,
      deliveryMethod: null,
      selectedStoreId: null,
      pickupTime: null,
      pickupTimeText: null,
      previousStep: FLOW_STEPS.IDLE,
    });
    return await commonAction(props, replyMessages);
  }

  // 戻るボタン
  if (postbackData === POSTBACK_PREFIX.BACK) {
    return await handleBackAction(props, flowState);
  }

  // 受け取り方法選択
  if (postbackData.startsWith(POSTBACK_PREFIX.DELIVERY_METHOD)) {
    const method = postbackData.replace(POSTBACK_PREFIX.DELIVERY_METHOD, '');
    return await handleDeliveryMethodSelection(props, method, flowState);
  }

  // 店舗検索方法選択
  if (postbackData.startsWith(POSTBACK_PREFIX.STORE_SEARCH)) {
    const searchMethod = postbackData.replace(POSTBACK_PREFIX.STORE_SEARCH, '');
    return await handleStoreSearchMethodSelection(props, searchMethod, flowState);
  }

  // 店舗選択
  if (postbackData.startsWith(POSTBACK_PREFIX.SELECT_STORE)) {
    const storeId = postbackData.replace(POSTBACK_PREFIX.SELECT_STORE, '');
    return await handleStoreSelection(props, storeId, flowState);
  }

  // 店舗確認
  if (postbackData.startsWith(POSTBACK_PREFIX.CONFIRM_STORE)) {
    const confirmation = postbackData.replace(POSTBACK_PREFIX.CONFIRM_STORE, '');
    return await handleStoreConfirmation(props, confirmation, flowState);
  }

  // 受け取り時間選択
  if (postbackData.startsWith(POSTBACK_PREFIX.PICKUP_TIME)) {
    const timeOption = postbackData.replace(POSTBACK_PREFIX.PICKUP_TIME, '');
    return await handlePickupTimeSelection(props, timeOption, flowState);
  }

  console.log(`Unknown postback data: ${postbackData}`);
  return null;
}

/**
 * 戻るボタンの処理
 */
async function handleBackAction(props, flowState) {
  const { userId } = props;
  let replyMessages;
  let newState;

  switch (flowState.step) {
    case FLOW_STEPS.SELECT_STORE_SEARCH:
      // 店舗検索方法選択 → 受け取り方法選択
      replyMessages = [createDeliveryMethodSelectionMessage()];
      newState = {
        ...flowState,
        step: FLOW_STEPS.SELECT_DELIVERY_METHOD,
        previousStep: flowState.step,
      };
      break;

    case FLOW_STEPS.WAITING_LOCATION:
    case FLOW_STEPS.WAITING_ADDRESS:
    case FLOW_STEPS.SELECT_STORE:
      // 位置情報/住所入力/店舗選択 → 店舗検索方法選択
      const hasHistory = (await getUserStoreHistory(userId)).length > 0;
      replyMessages = [createStoreSearchMethodMessage(hasHistory)];
      newState = {
        ...flowState,
        step: FLOW_STEPS.SELECT_STORE_SEARCH,
        previousStep: flowState.step,
      };
      break;

    case FLOW_STEPS.CONFIRM_STORE:
      // 店舗確認 → 店舗検索方法選択
      const hasHistory2 = (await getUserStoreHistory(userId)).length > 0;
      replyMessages = [createStoreSearchMethodMessage(hasHistory2)];
      newState = {
        ...flowState,
        step: FLOW_STEPS.SELECT_STORE_SEARCH,
        selectedStoreId: null,
        previousStep: flowState.step,
      };
      break;

    case FLOW_STEPS.INPUT_PICKUP_TIME:
      // 受け取り時間入力 → 店舗確認（または店舗検索）
      if (flowState.selectedStoreId) {
        const store = getStoreById(flowState.selectedStoreId);
        replyMessages = [createStoreConfirmationMessage(store)];
        newState = {
          ...flowState,
          step: FLOW_STEPS.CONFIRM_STORE,
          previousStep: flowState.step,
        };
      } else {
        const hasHistory3 = (await getUserStoreHistory(userId)).length > 0;
        replyMessages = [createStoreSearchMethodMessage(hasHistory3)];
        newState = {
          ...flowState,
          step: FLOW_STEPS.SELECT_STORE_SEARCH,
          previousStep: flowState.step,
        };
      }
      break;

    case FLOW_STEPS.WAITING_PRESCRIPTION:
      // 処方箋画像待ち → 受け取り時間入力
      replyMessages = [createPickupTimeInputMessage()];
      newState = {
        ...flowState,
        step: FLOW_STEPS.INPUT_PICKUP_TIME,
        pickupTime: null,
        pickupTimeText: null,
        previousStep: flowState.step,
      };
      break;

    default:
      // デフォルト: 最初から
      replyMessages = [createDeliveryMethodSelectionMessage()];
      newState = {
        step: FLOW_STEPS.SELECT_DELIVERY_METHOD,
        deliveryMethod: null,
        selectedStoreId: null,
        pickupTime: null,
        pickupTimeText: null,
        previousStep: flowState.step,
      };
  }

  await saveFlowState(userId, newState);
  return await commonAction(props, replyMessages);
}

/**
 * 受け取り方法選択の処理
 */
async function handleDeliveryMethodSelection(props, method, flowState) {
  const { userId } = props;
  let replyMessages;
  let newState;

  if (method === DELIVERY_METHODS.STORE) {
    // 店舗受け取り → 店舗検索方法選択
    const storeHistory = await getUserStoreHistory(userId);
    const hasHistory = storeHistory.length > 0;
    replyMessages = [createStoreSearchMethodMessage(hasHistory)];
    newState = {
      ...flowState,
      step: FLOW_STEPS.SELECT_STORE_SEARCH,
      deliveryMethod: DELIVERY_METHODS.STORE,
      previousStep: flowState.step,
    };
  } else if (method === DELIVERY_METHODS.HOME) {
    // 自宅受け取り → 注意事項確認
    replyMessages = [createHomeDeliveryConfirmMessage()];
    newState = {
      ...flowState,
      step: FLOW_STEPS.SELECT_DELIVERY_METHOD, // まだ確認中
      deliveryMethod: DELIVERY_METHODS.HOME,
      previousStep: flowState.step,
    };
  } else {
    console.log(`Unknown delivery method: ${method}`);
    return null;
  }

  await saveFlowState(userId, newState);
  return await commonAction(props, replyMessages);
}

/**
 * 店舗検索方法選択の処理
 */
async function handleStoreSearchMethodSelection(props, searchMethod, flowState) {
  const { userId } = props;
  let replyMessages;
  let newState;

  switch (searchMethod) {
    case 'history':
      // 履歴から選択
      const storeHistory = await getUserStoreHistory(userId);
      if (storeHistory.length === 0) {
        // 履歴がない場合は店舗検索方法選択に戻す
        replyMessages = [{
          type: 'text',
          text: '過去の利用履歴がありません。\n別の方法で店舗を探してください。',
        }, createStoreSearchMethodMessage(false)];
        newState = flowState;
      } else {
        replyMessages = [createStoreSelectionMessage(storeHistory, 'history')];
        newState = {
          ...flowState,
          step: FLOW_STEPS.SELECT_STORE,
          previousStep: flowState.step,
        };
      }
      break;

    case 'location':
      // 現在地から探す
      replyMessages = [createLocationRequestMessage()];
      newState = {
        ...flowState,
        step: FLOW_STEPS.WAITING_LOCATION,
        previousStep: flowState.step,
      };
      break;

    case 'address':
      // 住所を入力
      replyMessages = [createAddressInputMessage()];
      newState = {
        ...flowState,
        step: FLOW_STEPS.WAITING_ADDRESS,
        previousStep: flowState.step,
      };
      break;

    default:
      console.log(`Unknown search method: ${searchMethod}`);
      return null;
  }

  await saveFlowState(userId, newState);
  return await commonAction(props, replyMessages);
}

/**
 * 店舗選択の処理
 */
async function handleStoreSelection(props, storeId, flowState) {
  const { userId } = props;
  
  const store = getStoreById(storeId);
  if (!store) {
    console.log(`Store not found: ${storeId}`);
    return null;
  }

  // 店舗確認メッセージを表示
  const replyMessages = [createStoreConfirmationMessage(store)];
  const newState = {
    ...flowState,
    step: FLOW_STEPS.CONFIRM_STORE,
    selectedStoreId: storeId,
    previousStep: flowState.step,
  };

  await saveFlowState(userId, newState);
  return await commonAction(props, replyMessages);
}

/**
 * 店舗確認の処理
 */
async function handleStoreConfirmation(props, confirmation, flowState) {
  const { userId } = props;
  let replyMessages;
  let newState;

  if (confirmation === 'yes') {
    // 店舗確定 → 受け取り時間入力
    replyMessages = [createPickupTimeInputMessage()];
    newState = {
      ...flowState,
      step: FLOW_STEPS.INPUT_PICKUP_TIME,
      previousStep: flowState.step,
    };
  } else if (confirmation === 'no') {
    // 店舗選び直し
    const hasHistory = (await getUserStoreHistory(userId)).length > 0;
    replyMessages = [createStoreSearchMethodMessage(hasHistory)];
    newState = {
      ...flowState,
      step: FLOW_STEPS.SELECT_STORE_SEARCH,
      selectedStoreId: null,
      previousStep: flowState.step,
    };
  } else if (confirmation === 'home_confirmed') {
    // 自宅受け取り確定 → 受け取り時間入力をスキップして処方箋画像待ち
    await startPrescriptionMode(userId);
    replyMessages = [createPrescriptionImageRequestMessage(null, null, DELIVERY_METHODS.HOME)];
    newState = {
      ...flowState,
      step: FLOW_STEPS.WAITING_PRESCRIPTION,
      deliveryMethod: DELIVERY_METHODS.HOME,
      previousStep: flowState.step,
    };
  } else {
    console.log(`Unknown confirmation: ${confirmation}`);
    return null;
  }

  await saveFlowState(userId, newState);
  return await commonAction(props, replyMessages);
}

/**
 * 受け取り時間選択の処理
 */
async function handlePickupTimeSelection(props, timeOption, flowState) {
  const { userId } = props;
  let replyMessages;
  let newState;

  if (timeOption === 'custom') {
    // カスタム日時入力
    replyMessages = [createCustomTimeInputMessage()];
    newState = {
      ...flowState,
      step: FLOW_STEPS.INPUT_PICKUP_TIME, // 入力待ち
      pickupTime: 'custom',
      previousStep: flowState.step,
    };
  } else {
    // 選択肢から選んだ場合 → 処方箋画像待ち
    const pickupTimeText = getPickupTimeText(timeOption);
    await startPrescriptionMode(userId);
    
    const store = flowState.selectedStoreId ? getStoreById(flowState.selectedStoreId) : null;
    replyMessages = [createPrescriptionImageRequestMessage(store, pickupTimeText, flowState.deliveryMethod)];
    newState = {
      ...flowState,
      step: FLOW_STEPS.WAITING_PRESCRIPTION,
      pickupTime: timeOption,
      pickupTimeText: pickupTimeText,
      previousStep: flowState.step,
    };
  }

  await saveFlowState(userId, newState);
  return await commonAction(props, replyMessages);
}

/**
 * 位置情報受信時の処理（処方箋フロー用）
 */
async function handlePrescriptionFlowLocation(props, latitude, longitude) {
  const { userId } = props;
  
  const flowState = await getFlowState(userId);
  
  if (flowState.step !== FLOW_STEPS.WAITING_LOCATION) {
    return null; // フローの状態が位置情報待ちでない場合は処理しない
  }

  // 最寄り5店舗を取得
  const nearestStores = getNearestStores(latitude, longitude, 5);
  
  const replyMessages = [createStoreSelectionMessage(nearestStores, 'location')];
  const newState = {
    ...flowState,
    step: FLOW_STEPS.SELECT_STORE,
    previousStep: flowState.step,
  };

  await saveFlowState(userId, newState);
  return await commonAction(props, replyMessages);
}

/**
 * 住所入力時の処理（処方箋フロー用）
 */
async function handlePrescriptionFlowAddressInput(props, address) {
  const { userId } = props;
  
  const flowState = await getFlowState(userId);
  
  if (flowState.step !== FLOW_STEPS.WAITING_ADDRESS) {
    return null; // フローの状態が住所入力待ちでない場合は処理しない
  }

  // 住所から店舗を検索
  const stores = await searchStoresByAddress(address);
  
  if (stores.length === 0) {
    const replyMessages = [
      {
        type: 'text',
        text: '入力された住所の近くに店舗が見つかりませんでした。\n住所を確認して再度入力するか、別の方法で店舗を探してください。',
      },
      createAddressInputMessage(),
    ];
    return await commonAction(props, replyMessages);
  }

  const replyMessages = [createStoreSelectionMessage(stores, 'address')];
  const newState = {
    ...flowState,
    step: FLOW_STEPS.SELECT_STORE,
    previousStep: flowState.step,
  };

  await saveFlowState(userId, newState);
  return await commonAction(props, replyMessages);
}

/**
 * カスタム日時入力の処理
 */
async function handleCustomPickupTimeInput(props, timeText) {
  const { userId } = props;
  
  const flowState = await getFlowState(userId);
  
  if (flowState.step !== FLOW_STEPS.INPUT_PICKUP_TIME || flowState.pickupTime !== 'custom') {
    return null;
  }

  // 処方箋モードを開始
  await startPrescriptionMode(userId);
  
  const store = flowState.selectedStoreId ? getStoreById(flowState.selectedStoreId) : null;
  const replyMessages = [createPrescriptionImageRequestMessage(store, timeText, flowState.deliveryMethod)];
  const newState = {
    ...flowState,
    step: FLOW_STEPS.WAITING_PRESCRIPTION,
    pickupTimeText: timeText,
    previousStep: flowState.step,
  };

  await saveFlowState(userId, newState);
  return await commonAction(props, replyMessages);
}

module.exports = {
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
  keywordPrescription,
  // 新しい処方箋フロー用
  handlePrescriptionFlowPostback,
  handlePrescriptionFlowLocation,
  handlePrescriptionFlowAddressInput,
  handleCustomPickupTimeInput,
  // フローステップ定数
  FLOW_STEPS,
  POSTBACK_PREFIX,
}