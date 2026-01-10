const Anthropic = require('@anthropic-ai/sdk');
const { getSystemContent } = require('./dynamoDBManager');

const apiKey = process.env.ANTHROPIC_API_KEY;
const anthropic = new Anthropic({ apiKey });

/**
 * LINE displayName から適切な呼び名（nickname）を判断する
 * 
 * 例:
 * - "Taiju Suzuki / 鈴木太樹" → "太樹"
 * - "西垣佳奈子" → "佳奈子"
 * - "kanako" → "kanako"
 * - "Mike@Tokyo" → "Mike"
 * - "ゆうこりん" → "ゆうこりん"
 * 
 * @param {string} displayName - LINE の表示名
 * @returns {Promise<string>} - 適切な呼び名
 */
async function determineNickname(displayName) {
  if (!displayName) return null;
  
  try {
    const model = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';
    
    const response = await anthropic.messages.create({
      max_tokens: 100,
      model: model,
      system: `あなたはLINEの表示名から、友達として呼びかけるのに最適な呼び名を判断するアシスタントです。

以下のルールで呼び名を決定してください：
1. 日本人名（漢字/ひらがな）の場合：下の名前（ファーストネーム）を使う
   - 例: "鈴木太樹" → "太樹"、"西垣佳奈子" → "佳奈子"
2. 英語名/ローマ字名の場合：ファーストネームを使う
   - 例: "Taiju Suzuki" → "Taiju"、"Mike Johnson" → "Mike"
3. 日英併記の場合：日本語の下の名前を優先
   - 例: "Taiju Suzuki / 鈴木太樹" → "太樹"
4. ニックネーム風の場合：そのまま使う
   - 例: "ゆうこりん" → "ゆうこりん"、"たっくん" → "たっくん"
5. 記号や@以降は無視する
   - 例: "Mike@Tokyo" → "Mike"
6. 絵文字は除去する

呼び名のみを返してください。説明は不要です。`,
      messages: [{
        role: 'user',
        content: `この表示名から適切な呼び名を判断してください: "${displayName}"`
      }]
    });
    
    const nickname = response.content[0].text.trim();
    console.log(`Nickname determined: "${displayName}" → "${nickname}"`);
    return nickname;
  } catch (error) {
    console.error('Error determining nickname:', error);
    // エラー時はdisplayNameをそのまま返す
    return displayName;
  }
}

// JSONパース用のヘルパー関数
function parseClaudeJSON(text) {
  // マークダウンコードブロックを除去
  let cleanedText = text.trim();
  
  // ```json と ``` で囲まれている場合は除去
  const jsonBlockRegex = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/;
  const match = cleanedText.match(jsonBlockRegex);
  
  if (match) {
    cleanedText = match[1].trim();
  }
  
  return JSON.parse(cleanedText);
}

async function fetchClaudeResponse(conversationHistory, currentTime, messageType, responseTone, relationshipTone, coachingStyle, politenessTone, attitudeTone, nickname = null) {
  try {
    // 基本的なSYSTEM_CONTENTをDynamoDBから取得
    let baseSystemContent = await getSystemContent('base');
    let responseToneSystemContent = await getSystemContent(`responseTone${responseTone}`) || '';
    let relationshipToneSystemContent = await getSystemContent(`relationshipTone${relationshipTone}`) || '';
    let coachingStyleSystemContent = await getSystemContent(`coachingStyle${coachingStyle}`) || '';
    let politenessToneSystemContent = await getSystemContent(`politenessTone${politenessTone}`) || '';
    let attitudeToneSystemContent = await getSystemContent(`attitudeTone${attitudeTone}`) || '';

    // 重要: politenessToneの設定を明示的にattitudeToneに引き継ぐ
    if (politenessTone && attitudeTone) {
      attitudeToneSystemContent += `\n\n現在の言葉遣い設定は「${politenessTone === 'P' ? '丁寧語' : 'タメ口'}」です。この言葉遣いを尊重して対応してください。`;
    }

    // 画像送信と位置情報送信の場合のプロンプト
    let imageSystemContent = messageType === 'image' ? await getSystemContent('image') : '';
    let locationSystemContent = messageType === 'location' ? await getSystemContent('location') : '';

    // 現在時刻情報をシステムプロンプトに追加
    const timeInfo = `現在：${currentTime}\n\n`;
    baseSystemContent = timeInfo + baseSystemContent;
    
    // ユーザーの呼び名（nickname）がある場合、親しみを込めて名前を呼ぶようプロンプトに追加
    let nicknamePrompt = '';
    if (nickname) {
      nicknamePrompt = `
【重要：お話し相手の情報】
今お話ししているお客様の呼び名は「${nickname}」さんです。
会話の中で自然に「${nickname}さん」と呼びかけてあげてください。
- 毎回の返答で名前を呼ぶ必要はありません。会話の流れで自然なタイミングで使ってください
- 名前を呼ぶことで、より親しみを感じていただけます
- 初めての会話や久しぶりの会話では、挨拶と一緒に名前を呼んであげると喜ばれます
- 例：「${nickname}さん、こんにちは！」「${nickname}さんって○○なんですね！」

`;
      console.log(`Nickname prompt added for: ${nickname}`);
    }

    // 各プロンプトを結合
    let updatedSystemContent = [
      baseSystemContent,              // 改善されたシステムプロンプト（禁止事項が冒頭）
      nicknamePrompt,                 // ユーザーの呼び名（親しみを込めて呼ぶため）
      responseToneSystemContent,      // 応答量設定
      politenessToneSystemContent,    // 言葉遣い設定（重要）
      attitudeToneSystemContent,      // 対応姿勢設定（重要）
      relationshipToneSystemContent,  // 恋愛観設定
      coachingStyleSystemContent,     // 健康指導設定
      imageSystemContent,            // 画像対応（使用時のみ）
      locationSystemContent,         // 位置情報対応（使用時のみ）
    ].filter(content => content).join('\n\n');

    // 追加のイベント情報があれば取得して追加
    if (process.env.ADDITIONAL_EVENT_PROMPT) {
      const additionalInfo = await getSystemContent(process.env.ADDITIONAL_EVENT_PROMPT);
      if (additionalInfo) {
        updatedSystemContent += `\n\n${additionalInfo}`;
      }
    }

    // Claude API送信前にメッセージをクリーニング
    const cleanedMessages = conversationHistory.map(message => {
      // メッセージの基本構造（role, content）のみを取得
      const { role, content } = message;

      // 新しい構造のメッセージ（metadata内にある場合）
      if (message.metadata) {
        return { role, content };
      }

      // 古い構造のメッセージ（直接プロパティがある場合）
      return { role, content };
    });

    // 環境変数からモデル名を取得、なければデフォルトを使用
    const model = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';
    console.log(`Using Claude model: ${model}`);

    // レスポンスを取得
    const response = await anthropic.messages.create({
      max_tokens: 1024,
      messages: cleanedMessages,
      model: model,
      system: updatedSystemContent
    });

    // Claudeからの応答文を取得
    return messageType === 'location' || messageType === 'image'
      ? parseClaudeJSON(response.content[0].text)  // ヘルパー関数を使用
      : { commentFromGacky: response.content[0].text };

  } catch (error) {
    console.error('Claudeエラー:', error);
    return { commentFromGacky: 'LLM API error' };
  }
}

// ラッキーフード占い専用：カスタムシステムプロンプトを使用する関数
async function fetchClaudeResponseWithCustomSystem(conversationHistory, currentTime, customSystemPrompt, responseTone, relationshipTone, coachingStyle, politenessTone, attitudeTone, season) {
  try {
    // 基本的な追加プロンプトを取得
    let politenessToneSystemContent = await getSystemContent(`politenessTone${politenessTone}`) || '';
    let attitudeToneSystemContent = await getSystemContent(`attitudeTone${attitudeTone}`) || '';

    // 重要: politenessToneの設定を明示的にattitudeToneに引き継ぐ
    if (politenessTone && attitudeTone) {
      attitudeToneSystemContent += `\n\n現在の言葉遣い設定は「${politenessTone === 'P' ? '丁寧語' : 'タメ口'}」です。この言葉遣いを尊重して対応してください。`;
    }

    // 季節情報を自然に伝えるプロンプト（人間らしさを重視）
    const seasonInfo = `
【現在の季節についてのヒント】
現在の日時：${currentTime}
今の季節：${season}

Gackyとして、今の季節「${season}」を意識した食材を提案してね。
ただし、以下の点を心がけて：
- ${season}らしい旬の食材を基本にしつつ、自由に選んでOK
- 石川県・金沢の地元食材（加賀野菜、能登の食材など）も時々取り入れて
- 時々、季節の変わり目を感じさせる食材や、Gackyらしいユニークな選択もアリ
- 完璧じゃなくていい。人間らしく、時には「え、それ今の季節？」というツッコミどころがあっても大丈夫

`;

    // システムプロンプトを構築（カスタムプロンプト + 季節情報を優先）
    let updatedSystemContent = [
      seasonInfo,                       // 季節情報を最優先
      customSystemPrompt,               // カスタムシステムプロンプト（luckyFoodFortune）
      politenessToneSystemContent,      // 言葉遣い設定
      attitudeToneSystemContent,        // 対応姿勢設定
    ].filter(content => content).join('\n\n');

    // Claude API送信前にメッセージをクリーニング
    const cleanedMessages = conversationHistory.map(message => {
      const { role, content } = message;
      return { role, content };
    });

    // 環境変数からモデル名を取得、なければデフォルトを使用
    const model = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';
    console.log(`Using Claude model for lucky food fortune: ${model}`);
    console.log(`Current season: ${season}`);

    // レスポンスを取得
    const response = await anthropic.messages.create({
      max_tokens: 1024,
      messages: cleanedMessages,
      model: model,
      system: updatedSystemContent
    });

    // Claudeからの応答文を取得
    return { commentFromGacky: response.content[0].text };

  } catch (error) {
    console.error('Claude（ラッキーフード占い）エラー:', error);
    return { commentFromGacky: 'LLM API error' };
  }
}

async function isPrescriptionFlowRelated(conversationHistory) {
  try {
    // 基本的なSYSTEM_CONTENTをDynamoDBから取得
    const prescriptionFlowContent = await getSystemContent('prescriptionFlow');

    // Claude API送信前にメッセージをクリーニング
    const cleanedMessages = conversationHistory.map(message => {
      // メッセージの基本構造（role, content）のみを取得
      const { role, content } = message;

      // 新しい構造のメッセージ（metadata内にある場合）
      if (message.metadata) {
        return { role, content };
      }

      // 古い構造のメッセージ（直接プロパティがある場合）
      return { role, content };
    });

    // 環境変数からモデル名を取得、なければデフォルトを使用
    const model = process.env.ANTHROPIC_MODEL || 'claude-3-7-sonnet-20250219';

    // レスポンスを取得
    const response = await anthropic.messages.create({
      max_tokens: 1024,
      messages: cleanedMessages,
      model: model,
      system: prescriptionFlowContent
    });

    // Claudeからの応答文を取得
    const result = response.content[0].text;

    if (result === 'YES' || result === 'NO') {
      // 期待通りの答えが返ってきた
      return result === 'YES';
    } else {
      // 期待通りの答えが返ってこない場合はエラー
      throw new Error(`UNEXPECTED RESPONSE: ${result}`);
    }

  } catch (error) {
    console.error('Claudeエラー:', error);
    return 'LLM API error';
  }
}

module.exports = { fetchClaudeResponse, fetchClaudeResponseWithCustomSystem, isPrescriptionFlowRelated, determineNickname };