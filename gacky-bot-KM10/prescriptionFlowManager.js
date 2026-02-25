/**
 * 処方箋受付フローマネージャー
 * 
 * 新しい処方箋受付フローを管理するモジュール
 * 
 * フロー:
 * 1. 「処方箋を送る」キーワードでトリガー
 * 2. 受け取り方法選択（店舗 or 自宅）
 * 3. 店舗選択の場合: 店舗検索方法選択（履歴から / 住所から / 現在地から）
 * 4. 店舗選択
 * 5. 希望受け取り時間入力
 * 6. 処方箋画像送信
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient,
  PutCommand,
  UpdateCommand,
  GetCommand,
  QueryCommand,
} = require('@aws-sdk/lib-dynamodb');
const { storeList, getStoreById, getNearestStores } = require('./storeList');

const dynamoDBClient = new DynamoDBClient({});
const dynamoDB = DynamoDBDocumentClient.from(dynamoDBClient);

// テーブル名
const TABLE_CUSTOMER_SESSIONS = process.env.TABLE_CUSTOMER_SESSIONS || 'gacky-prescription-sessions-dev';
const TABLE_PRESCRIPTIONS = process.env.TABLE_PRESCRIPTIONS || 'gacky-prescription-prescriptions-dev';
const TABLE_CUSTOMER_PROFILES = process.env.TABLE_CUSTOMER_PROFILES || 'gacky-prescription-customer-profiles-dev';

// 処方箋フローのタイムアウト（分）
// 「処方箋を送る」トリガーから30分以内に受付完了しない場合、自動的にAI応答停止状態を解除
const PRESCRIPTION_FLOW_TIMEOUT_MINUTES = 30;

// フローのステップ定義
const FLOW_STEPS = {
  IDLE: 'idle',                                // 待機中
  SELECT_DELIVERY_METHOD: 'select_delivery',   // 受け取り方法選択
  SELECT_STORE_SEARCH: 'select_store_search',  // 店舗検索方法選択
  WAITING_LOCATION: 'waiting_location',        // 位置情報待ち
  WAITING_ADDRESS: 'waiting_address',          // 住所入力待ち
  SELECT_STORE: 'select_store',                // 店舗選択中
  CONFIRM_STORE: 'confirm_store',              // 店舗確認中
  INPUT_PICKUP_TIME: 'input_pickup_time',      // 受け取り時間入力
  WAITING_PRESCRIPTION: 'waiting_prescription', // 処方箋画像待ち
};

// postbackデータのプレフィックス
const POSTBACK_PREFIX = {
  DELIVERY_METHOD: 'rx_delivery:',      // rx_delivery:store または rx_delivery:home
  STORE_SEARCH: 'rx_store_search:',     // rx_store_search:history / address / location
  SELECT_STORE: 'rx_select_store:',     // rx_select_store:{storeId}
  CONFIRM_STORE: 'rx_confirm:',         // rx_confirm:yes / rx_confirm:no
  PICKUP_TIME: 'rx_pickup_time:',       // rx_pickup_time:{option}
  RESTART: 'rx_restart',                // やり直し
  BACK: 'rx_back',                      // 戻る
  CANCEL: 'rx_cancel',                  // 処方箋を送るのをやめる
};

// 受け取り方法
const DELIVERY_METHODS = {
  STORE: 'store',   // 店舗受け取り
  HOME: 'home',     // 自宅受け取り（オンライン服薬指導）
};

// 機能フラグ：自宅受け取り機能を有効にするかどうか
// 本番環境で自宅受け取りを有効にする場合は true に変更
const FEATURE_FLAGS = {
  HOME_DELIVERY_ENABLED: false,  // 自宅受け取り機能（オンライン服薬指導）を有効化
};

/**
 * 受け取り方法選択メッセージを生成（店舗 or 自宅）
 * ボタンUIで表示（クイックリプライから変更）
 * 
 * 注意: 自宅受け取り機能は FEATURE_FLAGS.HOME_DELIVERY_ENABLED で制御
 * 無効時は「後日公開」として表示される
 */
function createDeliveryMethodSelectionMessage() {
  const footerContents = [
    {
      type: 'button',
      style: 'primary',
      color: '#4CAF50',
      action: {
        type: 'postback',
        label: '🏪 店舗で受け取る',
        data: `${POSTBACK_PREFIX.DELIVERY_METHOD}store`,
        displayText: '店舗で受け取る',
      },
    },
  ];

  // 自宅受け取り機能の有効/無効による表示切り替え
  if (FEATURE_FLAGS.HOME_DELIVERY_ENABLED) {
    // 機能が有効な場合：通常のボタン
    footerContents.push({
      type: 'button',
      style: 'primary',
      color: '#2196F3',
      action: {
        type: 'postback',
        label: '🏠 自宅で受け取る',
        data: `${POSTBACK_PREFIX.DELIVERY_METHOD}home`,
        displayText: '自宅で受け取る',
      },
    });
  } else {
    // 機能が無効な場合：「後日公開」として無効化ボタンを表示
    // LINEのFlex Messageでは disabled 属性がないため、
    // ダミーのpostbackを設定し、視覚的に無効であることを示す
    footerContents.push({
      type: 'button',
      style: 'secondary',
      color: '#BDBDBD',  // グレーで無効感を演出
      action: {
        type: 'postback',
        label: '🏠 自宅で受け取る（後日公開）',
        data: `${POSTBACK_PREFIX.DELIVERY_METHOD}home_disabled`,
        displayText: '自宅で受け取る',
      },
    });
  }

  footerContents.push({
    type: 'button',
    style: 'secondary',
    action: {
      type: 'postback',
      label: '❌ やめる',
      data: POSTBACK_PREFIX.CANCEL,
      displayText: '処方箋を送るのをやめます',
    },
  });

  return {
    type: 'flex',
    altText: 'お薬の受け取り方法を選択してください',
    contents: {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: '📋 処方箋受付',
            weight: 'bold',
            size: 'lg',
            align: 'center',
          },
          {
            type: 'separator',
            margin: 'lg',
          },
          {
            type: 'text',
            text: 'お薬の受け取り方法を\n選択してください',
            size: 'md',
            wrap: true,
            margin: 'lg',
            align: 'center',
          },
        ],
        paddingAll: '20px',
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: footerContents,
        paddingAll: '10px',
      },
    },
  };
}

/**
 * 自宅受け取り選択時の確認メッセージ
 * 「最短で翌日以降」の注記付き
 * ボタンUIで表示（クイックリプライから変更）
 */
function createHomeDeliveryConfirmMessage() {
  return {
    type: 'flex',
    altText: '自宅受け取りについて',
    contents: {
      type: 'bubble',
      hero: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: '🏠',
            size: '3xl',
            align: 'center',
          },
        ],
        paddingAll: '20px',
        backgroundColor: '#E3F2FD',
      },
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: '自宅受け取り（オンライン服薬指導）',
            weight: 'bold',
            size: 'md',
            align: 'center',
            wrap: true,
          },
          {
            type: 'separator',
            margin: 'lg',
          },
          {
            type: 'box',
            layout: 'vertical',
            contents: [
              {
                type: 'text',
                text: '⚠️ ご注意',
                weight: 'bold',
                color: '#FF6B00',
              },
              {
                type: 'text',
                text: 'お薬のお届けは最短で翌日以降になります',
                size: 'sm',
                color: '#666666',
                wrap: true,
                margin: 'sm',
              },
            ],
            margin: 'lg',
            paddingAll: '12px',
            backgroundColor: '#FFF3E0',
            cornerRadius: '8px',
          },
          {
            type: 'text',
            text: 'オンライン服薬指導を受けていただいた後、ご自宅へお届けします。',
            size: 'sm',
            color: '#666666',
            wrap: true,
            margin: 'lg',
          },
          {
            type: 'text',
            text: '※ すぐにお薬が必要な場合は「店舗で受け取る」を選択してください',
            size: 'xs',
            color: '#888888',
            wrap: true,
            margin: 'md',
          },
        ],
        paddingAll: '20px',
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          {
            type: 'button',
            style: 'primary',
            color: '#4CAF50',
            action: {
              type: 'postback',
              label: '✅ 自宅受け取りで進める',
              data: `${POSTBACK_PREFIX.CONFIRM_STORE}home_confirmed`,
              displayText: '自宅受け取りで進めます',
            },
          },
          {
            type: 'button',
            style: 'secondary',
            action: {
              type: 'postback',
              label: '🏪 店舗受け取りに変更',
              data: `${POSTBACK_PREFIX.DELIVERY_METHOD}store`,
              displayText: '店舗で受け取るに変更します',
            },
          },
          {
            type: 'button',
            style: 'secondary',
            action: {
              type: 'postback',
              label: '🔙 戻る',
              data: POSTBACK_PREFIX.BACK,
              displayText: '戻ります',
            },
          },
          {
            type: 'button',
            style: 'secondary',
            action: {
              type: 'postback',
              label: '❌ やめる',
              data: POSTBACK_PREFIX.CANCEL,
              displayText: '処方箋を送るのをやめます',
            },
          },
        ],
        paddingAll: '10px',
      },
    },
  };
}

/**
 * 店舗検索方法選択メッセージを生成
 * ボタンUIで表示（クイックリプライから変更）
 * @param {boolean} hasHistory - 履歴があるかどうか
 */
function createStoreSearchMethodMessage(hasHistory = false) {
  const footerContents = [];

  // 履歴がある場合のみ「履歴から」を表示
  if (hasHistory) {
    footerContents.push({
      type: 'button',
      style: 'primary',
      color: '#FF9800',
      action: {
        type: 'postback',
        label: '📋 履歴から選ぶ',
        data: `${POSTBACK_PREFIX.STORE_SEARCH}history`,
        displayText: '履歴から選びます',
      },
    });
  }

  footerContents.push(
    {
      type: 'button',
      style: 'primary',
      color: '#4CAF50',
      action: {
        type: 'postback',
        label: '📍 現在地から探す',
        data: `${POSTBACK_PREFIX.STORE_SEARCH}location`,
        displayText: '現在地から探します',
      },
    },
    {
      type: 'button',
      style: 'primary',
      color: '#2196F3',
      action: {
        type: 'postback',
        label: '🏠 住所を入力する',
        data: `${POSTBACK_PREFIX.STORE_SEARCH}address`,
        displayText: '住所を入力します',
      },
    },
    {
      type: 'button',
      style: 'secondary',
      action: {
        type: 'postback',
        label: '🔙 戻る',
        data: POSTBACK_PREFIX.BACK,
        displayText: '戻ります',
      },
    },
    {
      type: 'button',
      style: 'secondary',
      action: {
        type: 'postback',
        label: '❌ やめる',
        data: POSTBACK_PREFIX.CANCEL,
        displayText: '処方箋を送るのをやめます',
      },
    }
  );

  return {
    type: 'flex',
    altText: '店舗の探し方を選択してください',
    contents: {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: '🏪 店舗を選択',
            weight: 'bold',
            size: 'lg',
            align: 'center',
          },
          {
            type: 'separator',
            margin: 'lg',
          },
          {
            type: 'text',
            text: 'どの方法で店舗を探しますか？',
            size: 'md',
            wrap: true,
            margin: 'lg',
            align: 'center',
          },
        ],
        paddingAll: '20px',
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: footerContents,
        paddingAll: '10px',
      },
    },
  };
}

/**
 * 位置情報送信を促すメッセージ
 * ボタンUIで表示（クイックリプライから変更）
 * ※ 位置情報送信ボタンはLINEの仕様上、クイックリプライでのみ動作するため、
 *   位置情報送信のみクイックリプライを残し、他のボタンはFlex Messageで表示
 */
function createLocationRequestMessage() {
  return [
    {
      type: 'flex',
      altText: '現在地を共有してください',
      contents: {
        type: 'bubble',
        body: {
          type: 'box',
          layout: 'vertical',
          contents: [
            {
              type: 'text',
              text: '📍 現在地を共有',
              weight: 'bold',
              size: 'lg',
              align: 'center',
            },
            {
              type: 'separator',
              margin: 'lg',
            },
            {
              type: 'text',
              text: '下の「現在地を送る」ボタンから位置情報を送信すると、最寄りのあおぞら薬局を5件まで表示します。',
              size: 'sm',
              wrap: true,
              margin: 'lg',
            },
          ],
          paddingAll: '20px',
        },
        footer: {
          type: 'box',
          layout: 'vertical',
          spacing: 'sm',
          contents: [
            {
              type: 'button',
              style: 'secondary',
              action: {
                type: 'postback',
                label: '🔙 戻る',
                data: POSTBACK_PREFIX.BACK,
                displayText: '戻ります',
              },
            },
            {
              type: 'button',
              style: 'secondary',
              action: {
                type: 'postback',
                label: '❌ やめる',
                data: POSTBACK_PREFIX.CANCEL,
                displayText: '処方箋を送るのをやめます',
              },
            },
          ],
          paddingAll: '10px',
        },
      },
    },
    {
      type: 'text',
      text: '👇 下のボタンをタップして現在地を送ってね',
      quickReply: {
        items: [
          {
            type: 'action',
            imageUrl: 'https://res-gacky-bot.s3.ap-northeast-1.amazonaws.com/fm_image_location_wh_fixed1.png',
            action: {
              type: 'location',
              label: '📍 現在地を送る',
            },
          },
        ],
      },
    },
  ];
}

/**
 * 住所入力を促すメッセージ
 * ボタンUIで表示（クイックリプライから変更）
 */
function createAddressInputMessage() {
  return {
    type: 'flex',
    altText: '住所を入力してください',
    contents: {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: '🏠 住所を入力',
            weight: 'bold',
            size: 'lg',
            align: 'center',
          },
          {
            type: 'separator',
            margin: 'lg',
          },
          {
            type: 'text',
            text: '受け取りたい場所の住所を入力してください',
            size: 'sm',
            wrap: true,
            margin: 'lg',
          },
          {
            type: 'text',
            text: '例: 金沢市鞍月東1丁目',
            size: 'sm',
            color: '#888888',
            margin: 'md',
          },
          {
            type: 'box',
            layout: 'vertical',
            contents: [
              {
                type: 'text',
                text: '💡 ヒント',
                size: 'xs',
                color: '#FF6B00',
                weight: 'bold',
              },
              {
                type: 'text',
                text: '市区町村名からでも検索できます',
                size: 'xs',
                color: '#666666',
                wrap: true,
              },
            ],
            margin: 'lg',
            paddingAll: '10px',
            backgroundColor: '#FFF3E0',
            cornerRadius: '8px',
          },
        ],
        paddingAll: '20px',
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          {
            type: 'button',
            style: 'secondary',
            action: {
              type: 'postback',
              label: '🔙 戻る',
              data: POSTBACK_PREFIX.BACK,
              displayText: '戻ります',
            },
          },
          {
            type: 'button',
            style: 'secondary',
            action: {
              type: 'postback',
              label: '❌ やめる',
              data: POSTBACK_PREFIX.CANCEL,
              displayText: '処方箋を送るのをやめます',
            },
          },
        ],
        paddingAll: '10px',
      },
    },
  };
}

/**
 * 店舗選択用のメッセージを生成
 * ボタンUIで表示（クイックリプライから変更）
 * @param {Array} stores - 店舗リスト（距離付きの場合あり）
 * @param {string} source - 選択元 ('history'|'location'|'address')
 */
function createStoreSelectionMessage(stores, source = 'location') {
  let headerText = '🏪 店舗を選択';
  let descText = '下から店舗を選択してください';

  if (source === 'location') {
    headerText = '📍 最寄りの店舗';
    descText = '現在地から近い順に表示しています';
  } else if (source === 'history') {
    headerText = '📋 利用履歴';
    descText = '過去にご利用いただいた店舗です';
  } else if (source === 'address') {
    headerText = '🏠 検索結果';
    descText = '入力された住所から近い店舗です';
  }

  // 店舗ボタンを生成（最大10件）
  const storeButtons = stores.slice(0, 10).map((store) => {
    let label = store.storeName;
    if (store.distance !== undefined) {
      const distanceText = store.distance < 1 
        ? `${Math.round(store.distance * 1000)}m`
        : `${store.distance.toFixed(1)}km`;
      label = `${store.storeName} (${distanceText})`;
    }
    // ラベルは最大40文字（Flex Messageボタン）
    if (label.length > 40) {
      label = label.substring(0, 37) + '...';
    }

    return {
      type: 'button',
      style: 'primary',
      color: '#4CAF50',
      action: {
        type: 'postback',
        label: label,
        data: `${POSTBACK_PREFIX.SELECT_STORE}${store.storeId}`,
        displayText: `${store.storeName}を選択`,
      },
    };
  });

  // ナビゲーションボタンを追加
  const navButtons = [
    {
      type: 'button',
      style: 'secondary',
      action: {
        type: 'postback',
        label: '🔙 戻る',
        data: POSTBACK_PREFIX.BACK,
        displayText: '戻ります',
      },
    },
    {
      type: 'button',
      style: 'secondary',
      action: {
        type: 'postback',
        label: '❌ やめる',
        data: POSTBACK_PREFIX.CANCEL,
        displayText: '処方箋を送るのをやめます',
      },
    },
  ];

  return {
    type: 'flex',
    altText: '店舗を選択してください',
    contents: {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: headerText,
            weight: 'bold',
            size: 'lg',
            align: 'center',
          },
          {
            type: 'separator',
            margin: 'lg',
          },
          {
            type: 'text',
            text: descText,
            size: 'sm',
            color: '#666666',
            wrap: true,
            margin: 'lg',
            align: 'center',
          },
        ],
        paddingAll: '20px',
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [...storeButtons, ...navButtons],
        paddingAll: '10px',
      },
    },
  };
}

/**
 * 店舗確認メッセージを生成
 * ボタンUIで表示（クイックリプライから変更）
 * @param {Object} store - 店舗情報
 */
function createStoreConfirmationMessage(store) {
  const bodyContents = [
    {
      type: 'text',
      text: '✅ 店舗を確認',
      weight: 'bold',
      size: 'lg',
      align: 'center',
    },
    {
      type: 'separator',
      margin: 'lg',
    },
    {
      type: 'box',
      layout: 'vertical',
      contents: [
        {
          type: 'text',
          text: `あおぞら薬局 ${store.storeName}`,
          weight: 'bold',
          size: 'md',
        },
        {
          type: 'text',
          text: store.address,
          size: 'sm',
          color: '#666666',
          wrap: true,
          margin: 'sm',
        },
      ],
      margin: 'lg',
      paddingAll: '15px',
      backgroundColor: '#F5F5F5',
      cornerRadius: '8px',
    },
  ];

  // 店舗特有の注記がある場合
  if (store.storeNote) {
    bodyContents.push({
      type: 'box',
      layout: 'vertical',
      contents: [
        {
          type: 'text',
          text: '💡 この店舗について',
          size: 'sm',
          weight: 'bold',
          color: '#4CAF50',
        },
        {
          type: 'text',
          text: store.storeNote,
          size: 'sm',
          color: '#666666',
          wrap: true,
          margin: 'sm',
        },
      ],
      margin: 'lg',
      paddingAll: '12px',
      backgroundColor: '#E8F5E9',
      cornerRadius: '8px',
    });
  }

  bodyContents.push({
    type: 'text',
    text: 'こちらの店舗でよろしいですか？',
    size: 'sm',
    margin: 'lg',
    align: 'center',
  });

  return {
    type: 'flex',
    altText: `あおぞら薬局 ${store.storeName}でよろしいですか？`,
    contents: {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        contents: bodyContents,
        paddingAll: '20px',
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          {
            type: 'button',
            style: 'primary',
            color: '#4CAF50',
            action: {
              type: 'postback',
              label: '✅ この店舗で進める',
              data: `${POSTBACK_PREFIX.CONFIRM_STORE}yes`,
              displayText: 'この店舗で進めます',
            },
          },
          {
            type: 'button',
            style: 'secondary',
            action: {
              type: 'postback',
              label: '🔙 店舗を選び直す',
              data: `${POSTBACK_PREFIX.CONFIRM_STORE}no`,
              displayText: '店舗を選び直します',
            },
          },
          {
            type: 'button',
            style: 'secondary',
            action: {
              type: 'postback',
              label: '❌ やめる',
              data: POSTBACK_PREFIX.CANCEL,
              displayText: '処方箋を送るのをやめます',
            },
          },
        ],
        paddingAll: '10px',
      },
    },
  };
}

/**
 * 希望受け取り時間入力メッセージを生成
 * ボタンUIで表示（クイックリプライから変更）
 */
function createPickupTimeInputMessage() {
  // 現在時刻を基準に選択肢を生成
  const now = new Date();
  const jstOffset = 9 * 60; // JST = UTC+9
  const jstNow = new Date(now.getTime() + (jstOffset + now.getTimezoneOffset()) * 60 * 1000);
  
  const hour = jstNow.getHours();
  
  const footerContents = [];

  // 「30分後」「1時間後」「本日中」「明日以降」などの選択肢
  // 営業時間を考慮（9:00-18:00と仮定）
  if (hour >= 9 && hour < 17) {
    footerContents.push({
      type: 'button',
      style: 'primary',
      color: '#FF5722',
      action: {
        type: 'postback',
        label: '⏱️ できるだけ早く',
        data: `${POSTBACK_PREFIX.PICKUP_TIME}asap`,
        displayText: 'できるだけ早く受け取りたい',
      },
    });
    
    if (hour < 16) {
      footerContents.push({
        type: 'button',
        style: 'primary',
        color: '#FF9800',
        action: {
          type: 'postback',
          label: '🕐 1時間後',
          data: `${POSTBACK_PREFIX.PICKUP_TIME}1hour`,
          displayText: '1時間後に受け取りたい',
        },
      });
    }
    
    footerContents.push({
      type: 'button',
      style: 'primary',
      color: '#4CAF50',
      action: {
        type: 'postback',
        label: '🌅 本日中',
        data: `${POSTBACK_PREFIX.PICKUP_TIME}today`,
        displayText: '本日中に受け取りたい',
      },
    });
  }

  footerContents.push({
    type: 'button',
    style: 'primary',
    color: '#2196F3',
    action: {
      type: 'postback',
      label: '📅 明日以降',
      data: `${POSTBACK_PREFIX.PICKUP_TIME}tomorrow`,
      displayText: '明日以降に受け取りたい',
    },
  });

  footerContents.push({
    type: 'button',
    style: 'secondary',
    action: {
      type: 'postback',
      label: '✏️ 日時を入力',
      data: `${POSTBACK_PREFIX.PICKUP_TIME}custom`,
      displayText: '希望日時を入力します',
    },
  });

  footerContents.push({
    type: 'button',
    style: 'secondary',
    action: {
      type: 'postback',
      label: '🔙 戻る',
      data: POSTBACK_PREFIX.BACK,
      displayText: '戻ります',
    },
  });

  footerContents.push({
    type: 'button',
    style: 'secondary',
    action: {
      type: 'postback',
      label: '❌ やめる',
      data: POSTBACK_PREFIX.CANCEL,
      displayText: '処方箋を送るのをやめます',
    },
  });

  return {
    type: 'flex',
    altText: '受け取り希望日時を選択してください',
    contents: {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: '⏰ 受け取り希望日時',
            weight: 'bold',
            size: 'lg',
            align: 'center',
          },
          {
            type: 'separator',
            margin: 'lg',
          },
          {
            type: 'text',
            text: 'いつ頃お薬を受け取りたいですか？',
            size: 'sm',
            wrap: true,
            margin: 'lg',
            align: 'center',
          },
          {
            type: 'text',
            text: '※ 希望日時に間に合わない場合は\n店舗からご連絡いたします',
            size: 'xs',
            color: '#888888',
            wrap: true,
            margin: 'md',
            align: 'center',
          },
        ],
        paddingAll: '20px',
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: footerContents,
        paddingAll: '10px',
      },
    },
  };
}

/**
 * カスタム日時入力を促すメッセージ
 * ボタンUIで表示（クイックリプライから変更）
 */
function createCustomTimeInputMessage() {
  return {
    type: 'flex',
    altText: '希望日時を入力してください',
    contents: {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: '📅 希望日時を入力',
            weight: 'bold',
            size: 'lg',
            align: 'center',
          },
          {
            type: 'separator',
            margin: 'lg',
          },
          {
            type: 'text',
            text: '希望の受け取り日時を入力してください',
            size: 'sm',
            wrap: true,
            margin: 'lg',
          },
          {
            type: 'text',
            text: '例:\n・1月20日の14時頃\n・明日の午後\n・今週土曜の午前中',
            size: 'sm',
            color: '#666666',
            wrap: true,
            margin: 'md',
          },
        ],
        paddingAll: '20px',
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          {
            type: 'button',
            style: 'secondary',
            action: {
              type: 'postback',
              label: '🔙 戻る',
              data: POSTBACK_PREFIX.BACK,
              displayText: '戻ります',
            },
          },
          {
            type: 'button',
            style: 'secondary',
            action: {
              type: 'postback',
              label: '❌ やめる',
              data: POSTBACK_PREFIX.CANCEL,
              displayText: '処方箋を送るのをやめます',
            },
          },
        ],
        paddingAll: '10px',
      },
    },
  };
}

/**
 * 処方箋画像送信を促すメッセージ
 */
function createPrescriptionImageRequestMessage(selectedStore, pickupTime, deliveryMethod) {
  let headerText = '📋 処方箋を送信';
  let storeInfo = null;
  let timeInfo = null;

  if (deliveryMethod === DELIVERY_METHODS.STORE && selectedStore) {
    storeInfo = {
      type: 'box',
      layout: 'vertical',
      contents: [
        {
          type: 'text',
          text: '🏪 受取店舗',
          size: 'xs',
          color: '#888888',
        },
        {
          type: 'text',
          text: `あおぞら薬局 ${selectedStore.storeName}`,
          size: 'sm',
          weight: 'bold',
        },
      ],
      margin: 'lg',
    };
  } else if (deliveryMethod === DELIVERY_METHODS.HOME) {
    storeInfo = {
      type: 'box',
      layout: 'vertical',
      contents: [
        {
          type: 'text',
          text: '🏠 受取方法',
          size: 'xs',
          color: '#888888',
        },
        {
          type: 'text',
          text: '自宅受け取り（オンライン服薬指導）',
          size: 'sm',
          weight: 'bold',
        },
      ],
      margin: 'lg',
    };
  }

  if (pickupTime) {
    timeInfo = {
      type: 'box',
      layout: 'vertical',
      contents: [
        {
          type: 'text',
          text: '⏰ 希望日時',
          size: 'xs',
          color: '#888888',
        },
        {
          type: 'text',
          text: pickupTime,
          size: 'sm',
          weight: 'bold',
        },
      ],
      margin: 'md',
    };
  }

  const bodyContents = [
    {
      type: 'text',
      text: headerText,
      weight: 'bold',
      size: 'lg',
      align: 'center',
    },
    {
      type: 'separator',
      margin: 'lg',
    },
  ];

  if (storeInfo) bodyContents.push(storeInfo);
  if (timeInfo) bodyContents.push(timeInfo);

  bodyContents.push({
    type: 'box',
    layout: 'vertical',
    contents: [
      {
        type: 'text',
        text: '📸 処方箋の写真を撮って送ってください',
        size: 'sm',
        wrap: true,
        align: 'center',
      },
      {
        type: 'text',
        text: '処方箋全体が写るように撮影してね',
        size: 'xs',
        color: '#666666',
        wrap: true,
        margin: 'sm',
        align: 'center',
      },
    ],
    margin: 'lg',
    paddingAll: '15px',
    backgroundColor: '#E3F2FD',
    cornerRadius: '8px',
  });

  bodyContents.push({
    type: 'text',
    text: '※ 10分以内に画像を送信してください',
    size: 'xs',
    color: '#888888',
    align: 'center',
    margin: 'lg',
  });

  return {
    type: 'flex',
    altText: '処方箋の写真を送ってください',
    contents: {
      type: 'bubble',
      hero: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: '📋',
            size: '3xl',
            align: 'center',
          },
        ],
        paddingAll: '20px',
        backgroundColor: '#E8F5E9',
      },
      body: {
        type: 'box',
        layout: 'vertical',
        contents: bodyContents,
        paddingAll: '20px',
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          {
            type: 'button',
            style: 'secondary',
            action: {
              type: 'postback',
              label: '🔙 戻る',
              data: POSTBACK_PREFIX.BACK,
              displayText: '戻ります',
            },
          },
          {
            type: 'button',
            style: 'secondary',
            action: {
              type: 'postback',
              label: '❌ やめる',
              data: POSTBACK_PREFIX.CANCEL,
              displayText: '処方箋を送るのをやめます',
            },
          },
        ],
        paddingAll: '10px',
      },
    },
  };
}

/**
 * フローの状態を保存
 */
async function saveFlowState(userId, flowState) {
  try {
    const timestamp = new Date().toISOString();
    await dynamoDB.send(new UpdateCommand({
      TableName: TABLE_CUSTOMER_SESSIONS,
      Key: { userId },
      UpdateExpression: `SET 
        prescriptionFlowState = :flowState,
        prescriptionFlowStep = :step,
        prescriptionFlowDeliveryMethod = :deliveryMethod,
        prescriptionFlowSelectedStoreId = :storeId,
        prescriptionFlowPickupTime = :pickupTime,
        prescriptionFlowPickupTimeText = :pickupTimeText,
        prescriptionFlowUpdatedAt = :updatedAt,
        prescriptionFlowPreviousStep = :previousStep`,
      ExpressionAttributeValues: {
        ':flowState': flowState,
        ':step': flowState.step || FLOW_STEPS.IDLE,
        ':deliveryMethod': flowState.deliveryMethod || null,
        ':storeId': flowState.selectedStoreId || null,
        ':pickupTime': flowState.pickupTime || null,
        ':pickupTimeText': flowState.pickupTimeText || null,
        ':updatedAt': timestamp,
        ':previousStep': flowState.previousStep || null,
      },
    }));
    console.log(`Flow state saved for user ${userId}:`, flowState);
    return { success: true };
  } catch (error) {
    console.error('Error saving flow state:', error);
    return { success: false, error: error.message };
  }
}

/**
 * フローの状態を取得
 * タイムアウトチェック付き：30分以上経過している場合は自動的にIDLEにリセット
 */
async function getFlowState(userId) {
  try {
    const result = await dynamoDB.send(new GetCommand({
      TableName: TABLE_CUSTOMER_SESSIONS,
      Key: { userId },
    }));

    if (!result.Item || !result.Item.prescriptionFlowState) {
      return {
        step: FLOW_STEPS.IDLE,
        deliveryMethod: null,
        selectedStoreId: null,
        pickupTime: null,
        pickupTimeText: null,
        previousStep: null,
      };
    }

    const flowState = result.Item.prescriptionFlowState;
    const updatedAt = result.Item.prescriptionFlowUpdatedAt;

    // タイムアウトチェック：IDLE以外のステップで、30分以上経過している場合はリセット
    if (flowState.step && flowState.step !== FLOW_STEPS.IDLE && updatedAt) {
      const lastUpdatedTime = new Date(updatedAt).getTime();
      const now = Date.now();
      const elapsedMinutes = (now - lastUpdatedTime) / (1000 * 60);

      if (elapsedMinutes >= PRESCRIPTION_FLOW_TIMEOUT_MINUTES) {
        console.log(`Prescription flow timeout for user ${userId}: ${elapsedMinutes.toFixed(1)} minutes elapsed (threshold: ${PRESCRIPTION_FLOW_TIMEOUT_MINUTES} min)`);
        
        // フローをリセット（非同期で実行、結果は待たない）
        resetFlowState(userId).catch(err => {
          console.error('Error resetting timed out flow state:', err);
        });

        // IDLE状態を返す
        return {
          step: FLOW_STEPS.IDLE,
          deliveryMethod: null,
          selectedStoreId: null,
          pickupTime: null,
          pickupTimeText: null,
          previousStep: null,
          timedOut: true, // タイムアウトしたことを示すフラグ
        };
      }
    }

    return flowState;
  } catch (error) {
    console.error('Error getting flow state:', error);
    return {
      step: FLOW_STEPS.IDLE,
      deliveryMethod: null,
      selectedStoreId: null,
      pickupTime: null,
      pickupTimeText: null,
      previousStep: null,
    };
  }
}

/**
 * フローをリセット
 */
async function resetFlowState(userId) {
  return await saveFlowState(userId, {
    step: FLOW_STEPS.IDLE,
    deliveryMethod: null,
    selectedStoreId: null,
    pickupTime: null,
    pickupTimeText: null,
    previousStep: null,
  });
}

/**
 * ユーザーの利用履歴店舗を取得
 */
async function getUserStoreHistory(userId, limit = 5) {
  try {
    // 処方箋履歴から店舗情報を取得
    const result = await dynamoDB.send(new QueryCommand({
      TableName: TABLE_PRESCRIPTIONS,
      IndexName: 'userId-timestamp-index',
      KeyConditionExpression: 'userId = :userId',
      ExpressionAttributeValues: {
        ':userId': userId,
      },
      ScanIndexForward: false, // 新しい順
      Limit: 20, // まず20件取得してユニークな店舗を抽出
    }));

    const storeIds = new Set();
    const stores = [];

    for (const item of result.Items || []) {
      if (item.selectedStoreId && !storeIds.has(item.selectedStoreId)) {
        storeIds.add(item.selectedStoreId);
        const storeInfo = getStoreById(item.selectedStoreId);
        if (storeInfo) {
          stores.push(storeInfo);
        }
        if (stores.length >= limit) break;
      }
    }

    return stores;
  } catch (error) {
    console.error('Error getting user store history:', error);
    return [];
  }
}

/**
 * Google Maps Geocoding APIを使用して住所から座標を取得
 * @param {string} address - 住所文字列
 * @returns {Promise<{lat: number, lon: number} | null>} 座標またはnull
 */
async function geocodeAddress(address) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  
  if (!apiKey) {
    console.warn('GOOGLE_MAPS_API_KEY is not set, falling back to region-based search');
    return null;
  }

  try {
    // 石川県を優先するため、住所に「石川県」を追加（まだ含まれていない場合）
    const searchAddress = address.includes('石川県') ? address : `石川県${address}`;
    
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(searchAddress)}&key=${apiKey}&language=ja&region=jp`;
    
    const response = await fetch(url);
    const data = await response.json();
    
    if (data.status === 'OK' && data.results && data.results.length > 0) {
      const location = data.results[0].geometry.location;
      console.log(`Geocoded "${address}" to lat: ${location.lat}, lon: ${location.lng}`);
      return {
        lat: location.lat,
        lon: location.lng
      };
    } else {
      console.warn(`Geocoding failed for "${address}": ${data.status}`);
      return null;
    }
  } catch (error) {
    console.error('Geocoding API error:', error);
    return null;
  }
}

/**
 * 住所から店舗を検索
 * 
 * Google Maps Geocoding APIを使用して住所を座標に変換し、
 * 最寄りの店舗を距離順で返す
 * 
 * @param {string} address - 検索住所
 * @param {number} limit - 取得件数（デフォルト5）
 * @returns {Promise<Array>} 距離付き店舗リスト（近い順）
 */
async function searchStoresByAddress(address, limit = 5) {
  // 1. Geocoding APIで座標を取得
  const coords = await geocodeAddress(address);
  
  if (coords) {
    // 2. 座標から最寄り店舗を取得（距離付き）
    const nearestStores = getNearestStores(coords.lat, coords.lon, limit);
    console.log(`Found ${nearestStores.length} nearest stores for address: "${address}"`);
    return nearestStores;
  }
  
  // 3. Geocodingが失敗した場合は地域ベースのフォールバック
  console.log(`Falling back to region-based search for address: "${address}"`);
  return searchStoresByRegion(address);
}

/**
 * 地域名による店舗検索（フォールバック）
 * @param {string} address - 住所文字列
 * @returns {Array} 店舗リスト
 */
function searchStoresByRegion(address) {
  const addressLower = address.toLowerCase();
  
  // 地域判定
  let region = null;
  if (addressLower.includes('金沢') || addressLower.includes('かなざわ') ||
      addressLower.includes('野々市') || addressLower.includes('津幡') ||
      addressLower.includes('内灘')) {
    region = 'kanazawa';
  } else if (addressLower.includes('小松') || addressLower.includes('加賀') ||
             addressLower.includes('白山') || addressLower.includes('能美')) {
    region = 'kaga';
  } else if (addressLower.includes('七尾') || addressLower.includes('能登') ||
             addressLower.includes('輪島') || addressLower.includes('珠洲') ||
             addressLower.includes('羽咋')) {
    region = 'noto';
  }

  if (region) {
    // 地域でフィルタリング
    return storeList.filter(store => store.region === region);
  }

  // 地域が判定できない場合は全店舗を返す
  return storeList;
}

/**
 * 受け取り時間オプションをテキストに変換
 */
function getPickupTimeText(option) {
  switch (option) {
    case 'asap':
      return 'できるだけ早く';
    case '1hour':
      return '1時間後';
    case 'today':
      return '本日中';
    case 'tomorrow':
      return '明日以降';
    case 'custom':
      return null; // カスタム入力
    default:
      return option;
  }
}

module.exports = {
  // フローステップ定数
  FLOW_STEPS,
  POSTBACK_PREFIX,
  DELIVERY_METHODS,
  FEATURE_FLAGS,
  PRESCRIPTION_FLOW_TIMEOUT_MINUTES,
  
  // メッセージ生成関数
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
  
  // フロー状態管理
  saveFlowState,
  getFlowState,
  resetFlowState,
  
  // ユーティリティ
  getUserStoreHistory,
  searchStoresByAddress,
  getPickupTimeText,
};
