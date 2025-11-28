const Anthropic = require('@anthropic-ai/sdk');
const { getSystemContent } = require('./dynamoDBManager');

const apiKey = process.env.ANTHROPIC_API_KEY;
const anthropic = new Anthropic({ apiKey });

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

async function fetchClaudeResponse(conversationHistory, currentTime, messageType, responseTone, relationshipTone, coachingStyle, politenessTone, attitudeTone) {
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

    // 各プロンプトを結合
    let updatedSystemContent = [
      baseSystemContent,              // 改善されたシステムプロンプト（禁止事項が冒頭）
      responseToneSystemContent,      // 応答量設定
      politenessToneSystemContent,    // 言葉遣い設定（重要）
      attitudeToneSystemContent,      // 対応姿勢設定（重要）
      `\n【再確認】ユーザーを「あんた」と呼ぶことは絶対に禁止です。必ず「〜さん」「〜ちゃん」などの敬称をつけてください。`,
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

module.exports = { fetchClaudeResponse, isPrescriptionFlowRelated };