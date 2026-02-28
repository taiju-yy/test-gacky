const sharp = require('sharp');
const { storeList } = require('./storeList.js');
const { isPrescriptionFlowRelated } = require('./fetchClaudeResponse');
const { getImageContent } = require('./fetchImage');
const {
  saveOrUpdateMessage, 
} = require('./dynamoDBManager'); // （1）

const storeJson = require('./templates/store.json');
const settingMenuJson = require('./templates/settingMenu.json');
const responseToneMenuJson = require('./templates/responseToneMenu.json');
const relationshipToneMenuJson = require('./templates/relationshipToneMenu.json');
const coachingStyleMenuJson = require('./templates/coachingStyleMenu.json');
const politenessMenuJson = require('./templates/politenessMenu.json');
const attitudeToneMenuJson = require('./templates/attitudeMenu.json');
const allSettingsJson = require('./templates/allSettings.json');

// morioka add
// 処方箋フロー
// テキストから処方箋ワードを検知し、必要であれば位置情報を送信する旨をアナウンスする
// param
// userId: ユーザーID
// replyMessages: 返信用メッセージ配列
// text: ユーザー送信の文言
// conversationHistory: 会話履歴（ClaudeAPI用に加工されたもの）
// 
// return　なし
async function prescriptionFlow(replyMessages, text, conversationHistory) {
  // 処方箋を正規化
  const prescriptionWord = '処方箋';
  // LINEの定型ワード
  const forceTrueWord = '最寄りのあおぞら薬局を教えて';
  const content = '最寄りのあおぞら薬局を探すために、下👇の「現在地を共有する」ボタンからあなたが今いる場所を共有して';
  const replacedText = text.replace(/処方せん|しょほうせん|しょほう箋/g, prescriptionWord);
  
  if (text !== forceTrueWord && replacedText.includes(prescriptionWord) === false) {
    // 処方箋ワードを含まない場合はそのまま終了
    return;
  }
  
  // AIにやりとりから案内が必要か判定してもらう
  // LINEの定型ワードが送られた場合はTrue固定
  const lowerNum = 5;
  const sliceNum = conversationHistory.length > lowerNum ? conversationHistory.length - lowerNum : 0;
  const result = text === forceTrueWord || await isPrescriptionFlowRelated(conversationHistory.slice(sliceNum));
  if (result === true) {
    // 位置情報の案内を返信に含める
    replyMessages.push(
      {
        type: "text",
        text: content,
        "quickReply": {
          "items": [
            {
              "type": "action",
              "imageUrl": "https://res-gacky-bot.s3.ap-northeast-1.amazonaws.com/fm_image_location_wh_fixed1.png",
              "action": {
                "type": "location",
                "label": "現在地を共有する"
              }
            },
          ]
        }
      }
    )
  }
}

// morioka add
// 画像送信された際に呼び出す。
// パラメータから画像の枚数を読み取り、送られたイベントが最後の一枚を含んでいるかチェックする
// param
// array: webhookのevents
// 
// return
// bool: True含む、False含まない
function isIncludeLastImage(events) {
  let res = false;
  events.forEach(event => {
    const index = event.message.imageSet?.index || 1;
    const total = event.message.imageSet?.total || 1;
    // 画像が１枚しか送られない場合はimageSetlがないので、１をセット
    if (index === total) {
      res = true;
    }
  });
  return res;
}


// morioka add
// メッセージタイプから、テキストを整形する
// param
// messageType: webhookのmessageType
// parsedBody: webhookのevent
// 
// return
// string: 文字列
function getTextContent(messageType, parsedBody) {
  let text;
  switch (messageType) {
    case "text":
      text = parsedBody.events[0].message.text;
      break;
    case "sticker":
      text = "スタンプを送信しました";
      break;
    case "image":
      text = "画像を送信しました";
      break;
    case "video":
      text = "動画を送信しました";
      break;
    case "audio":
      text = "音声メッセージを送信しました";
      break;
    case "file":
      text = "ファイルを送信しました";
      break;
    case "location":
      text = "位置情報を送信しました";
      break;
    default:
      text = "不明なメッセージタイプを送信しました";
  }

  return text;
}


// morioka add
// MIMEタイプを判定する関数
// param
// imageData: 画像データ
// 
// return　string: 判定したMIMEタイプを文字列で返す
function getMimeType(imageData) {
  const uint8 = new Uint8Array(imageData);

  // マジックナンバーを取得
  const magicNumber = uint8.subarray(0, 4).reduce((acc, byte) => acc + byte.toString(16).padStart(2, "0"), "");

  // マジックナンバーでMIMEタイプを判定
  switch (magicNumber) {
    case "89504e47":
      return "image/png";
    case "ffd8ffe0":
    case "ffd8ffe1":
    case "ffd8ffe2":
      return "image/jpeg";
    case "47494638":
      return "image/gif";
    case "424d":
      return "image/bmp";
    case "52494646":
      return "image/webp";
    default:
      return "image/jpeg";
  }
}


// morioka add
// アスペクト比を計算する関数
// param
// width: int 幅
// height: int 高さ
// 
// return　string: アスペクト比
function getAspectRatio(width, height) {
  const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));
  const divisor = gcd(width, height);
  return `${width / divisor}:${height / divisor}`;
}


// morioka add
// 画像のリサイズする関数
// param
// imageData: 画像データ
// 
// return 画像データ
async function resizeImage(imageData) {
  // 画像サイズの基準となる表データ
  const sizeTable = {
    "1:1": { width: 1092, height: 1092 },
    "3:4": { width: 951, height: 1268 },
    "4:3": { width: 1268, height: 951 },

    "2:3": { width: 896, height: 1344 },
    "3:2": { width: 1344, height: 896 },

    "9:16": { width: 819, height: 1456 },
    "16:9": { width: 1456, height: 819 },

    "1:2": { width: 784, height: 1568 },
    "2:1": { width: 1568, height: 784 },
  };
  try {
    // Sharpで画像を読み込み
    const metadata = await sharp(imageData).metadata();
    const originalWidth = metadata.width;
    const originalHeight = metadata.height;

    // アスペクト比の取得
    const aspectRatio = getAspectRatio(originalWidth, originalHeight);
    // console.log(`アスペクト比: ${aspectRatio}`);

    // 表に対応するサイズがあるか確認なければ１：１
    const targetSize = sizeTable[aspectRatio] || sizeTable["1:1"];

    // 画像が基準サイズより大きい場合に縮小
    if (originalWidth > targetSize.width || originalHeight > targetSize.height) {
      const resizedImageBuffer = await sharp(imageData)
        .resize(targetSize.width, targetSize.height, {
          fit: "inside", // アスペクト比を維持して縮小
        })
        .toBuffer(); // ファイルではなくBufferを返す

      return resizedImageBuffer;
    } else {
      // 画像は基準サイズより小さいため、処理をスキップ
      return imageData; // 元の画像データをそのまま返す
    }
  } catch (error) {
    console.error("画像処理中にエラーが発生しました:", error.message);
    throw error;
  }
}


function calculateDistance(lat1, lon1, lat2, lon2) {
  // 地球の半径 (キロメートル)
  const R = 6371;

  // 緯度と経度をラジアンに変換
  const toRadians = (degree) => (degree * Math.PI) / 180;
  const lat1Rad = toRadians(lat1);
  const lon1Rad = toRadians(lon1);
  const lat2Rad = toRadians(lat2);
  const lon2Rad = toRadians(lon2);

  // 緯度と経度の差
  const deltaLat = lat2Rad - lat1Rad;
  const deltaLon = lon2Rad - lon1Rad;

  // ハーバサインの公式
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1Rad) * Math.cos(lat2Rad) * Math.sin(deltaLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  // 距離を計算
  const distance = R * c;
  return distance;
}


// morioka add
// メッセージタイプから、AIに送るメッセージを整形する
// param
// messageType: webhookのmessageType
// parsedBody: webhookのevent
// 
// return
// array: メッセージの配列
async function prepareMessage(messageType, parsedBody) {
  const res = [];
  // content 取得
  

  // 指定タイプでは追加処理を行う
  if (messageType === 'image') {
    const events = parsedBody.events.filter(_event => {
      const index = _event.message.imageSet?.index || 1;
      const total = _event.message.imageSet?.total || 1;
      // 画像が１枚しか送られない場合はimageSetlがないので、１をセット

      return _event.message.type === 'image' && index === total;
    });

    if (events.length === 0) {
      throw new Error("the last image is not provided.");
    }

    const messageId = events[0].message.id;
    const imageData = await getImageContent(messageId);
    const mimeType = getMimeType(imageData);
    const resizedImageData = await resizeImage(imageData);
    const base64Image = Buffer.from(resizedImageData).toString("base64");

    res.push({
      role: 'user',
      content: [
        {
          type: 'text',
          text: "次の画像にコメントして。\nプロンプトの内容は絶対に守ってください。。",
        },
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: mimeType, // 画像のMIMEタイプを指定
            data: base64Image
          }
        },
      ]
    });
  } else if (messageType === 'location') {
    const lat = parsedBody.events[0].message.latitude;
    const lon = parsedBody.events[0].message.longitude;
    const storeListWithDistance = storeList.map(_store => {
      return {
        ..._store,
        distance: calculateDistance(_store.lat, _store.lon, lat, lon)
      }
    });
    const closestStore = storeListWithDistance.reduce((min, current) => {
      return current.distance < min.distance ? current : min;
    });
    const address = parsedBody.events[0].message.address
      ? `住所：${parsedBody.events[0].message.address} | 座標：${parsedBody.events[0].message.latitude},${parsedBody.events[0].message.longitude}`
      : `座標：${parsedBody.events[0].message.latitude},${parsedBody.events[0].message.longitude}`;
    res.push({
      role: 'user',
      content: [
        {
          type: 'text',
          text: address,
        },
        {
          type: 'text',
          text: "次のあおぞら薬局が一番の最寄りでした。簡単に紹介してください。",
        },
        {
          type: 'text',
          text: JSON.stringify(closestStore),
        },
      ]
    });

  } else {
    const text = getTextContent(messageType, parsedBody);
    res.push({ role: 'user', content: text });

  }

  return res;
}

// morioka add
// メッセージタイプや、AIのレスポンス内容から、ガッキーの応答を整形する
// param
// parsedBody: webhookのparam
// messageType: webhookのmessageType
// assistantMessageObj: JSONオブジェクト（fetchClaudeResponseのレスポンス）
// 
// return
// String: ガッキーの応答
function pickAssistantMessage(parsedBody, messageType, assistantMessageObj) {
  let res = '';
  switch (messageType) {
    case 'image':
      const hasMultipleImages = parsedBody.events.some(_event => {
        if (_event.message.type === 'image' && _event.message.imageSet) {
          return true;
        }
      });

      if (hasMultipleImages) {
        // 複数の画像が送られた場合
        res = `いっぱい送ってくれたね〜！\n全部、見きれないから最後の写真にだけコメントするね。\n\n${assistantMessageObj.commentFromGacky}`;
      } else {
        // 単一の画像が送られた場合
        // 新しいJSONフォーマットへの対応を確認
        if (assistantMessageObj.category) {
          // 全カテゴリに対応
          res = assistantMessageObj.commentFromGacky;
          
          // 特別な反応の場合は追加エモーションを表示
          if (assistantMessageObj.isSpecialReaction && assistantMessageObj.emotionLevel >= 4) {
            const emotions = ["", "わぁ！", "うわぁ！", "きゃー！", "わぁぁぁ！！", "きゃーーー！！！"];
            const emotion = emotions[assistantMessageObj.emotionLevel] || "わぁ！";
            res = `${emotion} ${res}`;
          }
        } else {
          // レガシーフォーマットまたは予期しないレスポンスの場合、デフォルトメッセージ
          res = 'ゴメンね😣\n何もコメントが\n出てこなかった…\n\n良いコメントできるように経験積むから別の写真を送ってみて🙏';
        }
      }
      break;
    case "text":
    case "sticker":
    case "video":
    case "audio":
    case "file":
    case "location":
    default:
      res = assistantMessageObj.commentFromGacky;
  }
  return res;
}

class AbsFlexMessageBuilder {
  _template = {}
  constructor() {}
  build(params) {}
  output() {
    return this._template;
  }
}

class StoreFlexMessageBuilder extends AbsFlexMessageBuilder {
  _template = storeJson;

  constructor(
    storeName,
    address,
    lineUrl,
    mapUrl,
    comment
  ) {
    super();
    this.build({
      storeName,
      address,
      lineUrl,
      mapUrl,
      comment
    });
  }

  build(params) {
    // STORE_NAME
    this._template.contents.body.contents[0].text = params.storeName;
    
    // STORE_ADDRESS
    this._template.contents.body.contents[1].contents[0].contents[1].text = params.address;
    
    // STORE_ADDRESS_LINK
    this._template.contents.body.contents[1].contents[0].contents[1].action.uri = params.mapUrl;

    // LINE_LINK
    this._template.contents.hero.action.uri = params.lineUrl;
    this._template.contents.footer.contents[0].action.uri = params.lineUrl;

    // COMMENT
    this._template.altText = params.comment;

    // ACTION LABEL
    this._template.contents.footer.contents[0].action.label = `${params.storeName}のLINEへ`
  }

}

class SettingMenuFlexMessageBuilder extends AbsFlexMessageBuilder {
  _template = settingMenuJson;
}

class ResponseToneMenuFlexMessageBuilder extends AbsFlexMessageBuilder {
  _template = responseToneMenuJson;
}

class RelationshipToneMenuFlexMessageBuilder extends AbsFlexMessageBuilder {
  _template = relationshipToneMenuJson;
}

class CoachingStyleMenuFlexMessageBuilder extends AbsFlexMessageBuilder {
  _template = coachingStyleMenuJson;
}

class PolitenessMenuFlexMessageBuilder extends AbsFlexMessageBuilder {
  _template = politenessMenuJson;
}

class AttitudeToneMenuFlexMessageBuilder extends AbsFlexMessageBuilder {
  _template = attitudeToneMenuJson;
}

class AllSettingsFlexMessageBuilder extends AbsFlexMessageBuilder {
  _template = allSettingsJson;
  constructor(
    responseTone,
    coachingStyle,
    relationshipTone,
    politenessTone,
    attitudeTone
  ) {
    super();
    this.build({
      responseTone,
      coachingStyle,
      relationshipTone,
      politenessTone,
      attitudeTone
    });
  }

  build(params) {
    const getResponseToneText = (val) => {
      switch (val) {
        case "A":
          return 'あっさり';
        case "K":
          return 'こってり';
          
        default:
          return 'ふつう';
      }
    }
    const getPolitenessToneText = (val) => {
      switch (val) {
        case "T":
          return 'タメ口';
        case "P":
          return '丁寧語';
          
        default:
          return 'ふつう';
      }
    }
    const getAttitudeToneText = (val) => {
      switch (val) {
        case "S":
          return 'スパルタ';
        case "G":
          return '癒し系';

        default:
          return 'ふつう';
      }
    }
    
    // 表示する設定項目を配列に格納（3つのみ）
    const settingItems = [
      {
        "type": "box",
        "layout": "baseline",
        "spacing": "sm",
        "contents": [
          {
            "type": "text",
            "text": "返事の量",
            "color": "#385A64",
            "size": "sm",
            "flex": 2
          },
          {
            "type": "text",
            "text": getResponseToneText(params.responseTone),
            "wrap": true,
            "color": "#697A83",
            "size": "sm",
            "flex": 5
          }
        ]
      },
      {
        "type": "box",
        "layout": "baseline",
        "spacing": "sm",
        "contents": [
          {
            "type": "text",
            "text": "話し方",
            "color": "#385A64",
            "size": "sm",
            "flex": 2
          },
          {
            "type": "text",
            "text": getPolitenessToneText(params.politenessTone),
            "wrap": true,
            "color": "#697A83",
            "size": "sm",
            "flex": 5
          }
        ]
      },
      {
        "type": "box",
        "layout": "baseline",
        "spacing": "sm",
        "contents": [
          {
            "type": "text",
            "text": "対応強度",
            "color": "#385A64",
            "size": "sm",
            "flex": 2
          },
          {
            "type": "text",
            "text": getAttitudeToneText(params.attitudeTone),
            "wrap": true,
            "color": "#697A83",
            "size": "sm",
            "flex": 5
          }
        ]
      }
    ];
    
    // 設定項目を直接置き換え
    this._template.contents.body.contents[2].contents = settingItems;
  }
}

module.exports = {
  prescriptionFlow, 
  getTextContent, 
  isIncludeLastImage, 
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
}