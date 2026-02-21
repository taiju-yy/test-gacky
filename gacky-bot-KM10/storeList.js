/**
 * あおぞら薬局 店舗リスト
 * 
 * 店舗情報は以下のフィールドを持つ:
 * - storeId: 店舗ID（ユニーク、store_XXX形式で統一）
 * - storeName: 店舗名
 * - address: 住所
 * - lat, lon: 緯度・経度
 * - lineUrl: LINE公式アカウントURL
 * - mapUrl: GoogleマップURL
 * - region: 地域 ('kanazawa'|'kaga'|'noto')
 * - storeNote: 店舗特有の注記メッセージ（ドライブスルー対応等）
 * - businessHours: 営業時間
 * - phone: 電話番号
 * 
 * 注意: storeIdは prescription-manager/src/app/api/stores/route.ts と統一すること
 */
const storeList = [
  {
    "storeId": "store_033",
    "storeName": "宇出津店",
    "address": "927-0433 石川県鳳珠郡能登町宇出津ﾀ56番地5",
    "lat": 37.30858923794464,
    "lon": 137.14821052718307,
    "lineUrl": "https://line.me/R/ti/p/@931dwjlq",
    "mapUrl": "https://maps.app.goo.gl/2pZjvKbWpADqHXbN7",
    "region": "noto",
    "storeNote": null,
    "phone": "0768-62-8870",
    "businessHours": "（月－金） 8:30～18:00\n（土） 　　9:00～13:00"
  },
  {
    "storeId": "store_035",
    "storeName": "輪島店",
    "address": "928-0024 石川県輪島市山岸町は27番地",
    "lat": 37.384682189370515,
    "lon": 136.9048389135428,
    "lineUrl": "https://line.me/R/ti/p/@873ezvav",
    "mapUrl": "https://maps.app.goo.gl/bEUztPrv3GzwMzkcA",
    "region": "noto",
    "storeNote": null,
    "phone": "0768-23-8008",
    "businessHours": "（月－日） 8:00～20:00"
  },
  {
    "storeId": "store_001",
    "storeName": "富来店",
    "address": "925-0446 石川県羽咋郡志賀町富来地頭町七98番地26",
    "lat": 37.13692067581873,
    "lon": 136.72962313109466,
    "lineUrl": "https://line.me/R/ti/p/@266mfaia",
    "mapUrl": "https://maps.app.goo.gl/mJ8WMEtb7T77cddUA",
    "region": "noto",
    "storeNote": null,
    "phone": "0767-42-2224",
    "businessHours": "（月－金） 9:00～18:00\n（土） 　　9:00～13:00"
  },
  {
    "storeId": "store_027",
    "storeName": "中島店",
    "address": "929-2241 石川県七尾市中島町浜田1丁目34番地1",
    "lat": 37.11328346868235,
    "lon": 136.85358989824587,
    "lineUrl": "https://line.me/R/ti/p/@266rnfkj",
    "mapUrl": "https://maps.app.goo.gl/soNxQna3k9q5SJQq5",
    "region": "noto",
    "storeNote": null,
    "phone": "0767-66-8888",
    "businessHours": "（月－金） 9:00～19:00\n（土） 　　9:00～17:00"
  },
  {
    "storeId": "store_028",
    "storeName": "能登総合病院前店",
    "address": "926-0816 石川県七尾市藤橋町ｱ部6番地19",
    "lat": 37.04442253948692,
    "lon": 136.94723325357668,
    "lineUrl": "https://line.me/R/ti/p/@093kncwy",
    "mapUrl": "https://maps.app.goo.gl/MUS4Pjcbs7YaHk5U9",
    "region": "noto",
    "storeNote": null,
    "phone": "0767-52-9800",
    "businessHours": "（月－金） 8:30～18:00\n（土）　　 8:30～13:00"
  },
  {
    "storeId": "store_026",
    "storeName": "和倉店",
    "address": "926-0171 石川県七尾市石崎町ﾀ部15番地5",
    "lat": 37.076222725628725,
    "lon": 136.92424064942898,
    "lineUrl": "https://line.me/R/ti/p/@316rzbih",
    "mapUrl": "https://maps.app.goo.gl/ybJE6LoMpuJcNisR8",
    "region": "noto",
    "storeNote": null,
    "phone": "0767-62-8931",
    "businessHours": "（月ー土） 9:00～18:00"
  },
  {
    "storeId": "store_024",
    "storeName": "府中店",
    "address": "926-0042 石川県七尾市作事町58番地2",
    "lat": 37.04561100690085,
    "lon": 136.96794188752304,
    "lineUrl": "https://line.me/R/ti/p/@371lgphm",
    "mapUrl": "https://maps.app.goo.gl/HELRsVEpDF4bMaZa9",
    "region": "noto",
    "storeNote": null,
    "phone": "0767-54-8931",
    "businessHours": "（月－土） 9:00～18:30"
  },
  {
    "storeId": "store_025",
    "storeName": "神明店",
    "address": "926-0046 石川県七尾市神明町ロ17番地4",
    "lat": 37.04245722528676,
    "lon": 136.96575537856148,
    "lineUrl": "https://line.me/R/ti/p/@948ppeoe",
    "mapUrl": "https://maps.app.goo.gl/FvhmDFpSN3H9D1JS9",
    "region": "noto",
    "storeNote": null,
    "phone": "0767-53-8931",
    "businessHours": "（月－土） 9:00～18:00"
  },
  {
    "storeId": "store_023",
    "storeName": "徳田店",
    "address": "926-0824 石川県七尾市下町ﾆ16番地1",
    "lat": 37.010436080583304,
    "lon": 136.94434076762883,
    "lineUrl": "https://line.me/R/ti/p/@150gqbka",
    "mapUrl": "https://maps.app.goo.gl/5Mg3KQJyY9Rcvepg6",
    "region": "noto",
    "storeNote": null,
    "phone": "0767-57-0891",
    "businessHours": "（月－金） 8:30～18:30\n（木） 　　8:30～17:30\n（土） 　　8:30～14:30"
  },
  {
    "storeId": "store_002",
    "storeName": "鶴多店",
    "address": "925-0027 石川県羽咋市鶴多町亀田4番地5",
    "lat": 36.89630150298933,
    "lon": 136.79212236422342,
    "lineUrl": "https://line.me/R/ti/p/@282xdqri",
    "mapUrl": "https://maps.app.goo.gl/LZu5Rb3qWk18489F8",
    "region": "noto",
    "storeNote": null,
    "phone": "0767-22-8931",
    "businessHours": "（月、火、水、金、土） 9:00～18:30　\n（木） 　　9:00～17:00"
  },
  {
    "storeId": "store_006",
    "storeName": "鞍月店",
    "address": "920-8201 石川県金沢市鞍月東1丁目8番地2",
    "lat": 36.59426624795712,
    "lon": 136.62962938764983,
    "lineUrl": "https://line.me/R/ti/p/@590rsdov",
    "mapUrl": "https://maps.app.goo.gl/BisTwBQprvcRtnpcA",
    "region": "kanazawa",
    "storeNote": "ドライブスルー対応しています🚗 駐車場から出ずにお薬をお受け取りいただけます。",
    "phone": "076-237-8938",
    "businessHours": "（月－日、祝） 9:00～18:00"
  },
  {
    "storeId": "store_021",
    "storeName": "無量寺店",
    "address": "920-0333 石川県金沢市無量寺5丁目71番地1",
    "lat": 36.60291660218606,
    "lon": 136.61236579575345,
    "lineUrl": "https://line.me/R/ti/p/@011fmcxw",
    "mapUrl": "https://maps.app.goo.gl/CQMGUqEaK8VHUfQj8",
    "region": "kanazawa",
    "storeNote": null,
    "phone": "076-266-8931",
    "businessHours": "（月－土） 9:00～18:00"
  },
  {
    "storeId": "store_015",
    "storeName": "アイリス店",
    "address": "920-0024 石川県金沢市西念2丁目36番地5",
    "lat": 36.58702907559102,
    "lon": 136.63986765439748,
    "lineUrl": "https://line.me/R/ti/p/@404gpzmr",
    "mapUrl": "https://maps.app.goo.gl/x17ScU1N52sV7oKL9",
    "region": "kanazawa",
    "storeNote": null,
    "phone": "076-232-4193",
    "businessHours": "（月－金） 9:00～18:00　\n（土）　　 9:00～17:00"
  },
  {
    "storeId": "store_011",
    "storeName": "金沢駅西口店",
    "address": "920-0031 石川県金沢市広岡一丁目1番5",
    "lat": 36.57748087530893,
    "lon": 136.6448392250586,
    "lineUrl": "https://line.me/R/ti/p/@127eophr",
    "mapUrl": "https://maps.app.goo.gl/2MabFdUWad7p5W6D8",
    "region": "kanazawa",
    "storeNote": "金沢駅西口から徒歩1分です🚶 お仕事帰りにもお立ち寄りいただけます。",
    "phone": "076-222-8931",
    "businessHours": "（月－土） 9:00～18:00"
  },
  {
    "storeId": "store_010",
    "storeName": "広岡店",
    "address": "920-0031 石川県金沢市広岡1丁目12番地1",
    "lat": 36.57628018591524,
    "lon": 136.6460248839084,
    "lineUrl": "https://line.me/R/ti/p/@932yqegk",
    "mapUrl": "https://maps.app.goo.gl/M1RgjPx2by5yDAq27",
    "region": "kanazawa",
    "storeNote": null,
    "phone": "076-222-2262",
    "businessHours": "（月－金） 8:30～17:30　\n（土）　　 8:30～12:30"
  },
  {
    "storeId": "store_020",
    "storeName": "香林坊店",
    "address": "920-0981 石川県金沢市片町1丁目1番地1",
    "lat": 36.56193137261904,
    "lon": 136.65472548455313,
    "lineUrl": "https://line.me/R/ti/p/@204thuuh",
    "mapUrl": "https://maps.app.goo.gl/uoob9YTJQVXydKRd8",
    "region": "kanazawa",
    "storeNote": null,
    "phone": "076-224-8931",
    "businessHours": "（月－土） 9:00～19:00"
  },
  {
    "storeId": "store_017",
    "storeName": "中央通町店",
    "address": "920-0866 石川県金沢市中央通町11番50号",
    "lat": 36.56407786556738,
    "lon": 136.64769590324298,
    "lineUrl": "https://line.me/R/ti/p/@530fnzyw",
    "mapUrl": "https://maps.app.goo.gl/CZmhBLiKRXWp1tBc8",
    "region": "kanazawa",
    "storeNote": null,
    "phone": "076-234-8931",
    "businessHours": "（月－土） 9:00～18:00"
  },

  {
    "storeId": "store_008",
    "storeName": "橋場町店",
    "address": "920-0911 石川県金沢市橋場町3番地15",
    "lat": 36.57098587704741,
    "lon": 136.66410245906718,
    "lineUrl": "https://line.me/R/ti/p/@304zkowb",
    "mapUrl": "https://maps.app.goo.gl/g7DZFJHk2j14wp6HA",
    "region": "kanazawa",
    "storeNote": null,
    "phone": "076-263-7177",
    "businessHours": "（月－土） 8:30～18:00"
  },
  {
    "storeId": "store_007",
    "storeName": "森本店",
    "address": "920-3114 石川県金沢市吉原町ﾊ24番地1",
    "lat": 36.61211037816509,
    "lon": 136.69357252071867,
    "lineUrl": "https://line.me/R/ti/p/@707jbygg",
    "mapUrl": "https://maps.app.goo.gl/V86Z3XjEphbcW4ai8",
    "region": "kanazawa",
    "storeNote": null,
    "phone": "076-257-8931",
    "businessHours": "（月－土） 9:00～18:00"
  },
  {
    "storeId": "store_005",
    "storeName": "津幡店",
    "address": "929-0341 石川県河北郡津幡町字横浜へ35番地1",
    "lat": 36.66540402096022,
    "lon": 136.72869423427798,
    "lineUrl": "https://line.me/R/ti/p/@819fzlhc",
    "mapUrl": "https://maps.app.goo.gl/tNP9kc8vQokNhPQF8",
    "region": "kanazawa",
    "storeNote": null,
    "phone": "076-289-5855",
    "businessHours": "（月－土） 9:00～18:00"
  },
  {
    "storeId": "store_036",
    "storeName": "北中条店",
    "address": "929-0342 石川県河北郡津幡町北中条2丁目31番地",
    "lat": 36.66296,
    "lon": 136.72585,
    "lineUrl": "",
    "mapUrl": "",
    "region": "kanazawa",
    "storeNote": null,
    "phone": "076-204-8920",
    "businessHours": "（月－土） 9:00～18:00"
  },
  {
    "storeId": "store_013",
    "storeName": "桜町店",
    "address": "920-0923 石川県金沢市桜町19番23号",
    "lat": 36.56118865648519,
    "lon": 136.6775446867525,
    "lineUrl": "https://line.me/R/ti/p/@508cvene",
    "mapUrl": "https://maps.app.goo.gl/os6MAzGJ4ad6Wc1i6",
    "region": "kanazawa",
    "storeNote": null,
    "phone": "076-233-8931",
    "businessHours": "（月－土） 9:00～18:00"
  },
  {
    "storeId": "store_019",
    "storeName": "平和町店",
    "address": "921-8105 石川県金沢市平和町3丁目2番地13",
    "lat": 36.541369094221324,
    "lon": 136.66258131709472,
    "lineUrl": "https://line.me/R/ti/p/@080jbtfm",
    "mapUrl": "https://maps.app.goo.gl/YYUrTRypePCVhc2t8",
    "region": "kanazawa",
    "storeNote": null,
    "phone": "076-242-2220",
    "businessHours": "（月－金） 9:00～18:00\n（土）　　 9:00～12:00"
  },
  {
    "storeId": "store_038",
    "storeName": "アルコ店",
    "address": "921-8105 石川県金沢市平和町2丁目13番地18",
    "lat": 36.54203,
    "lon": 136.66186,
    "lineUrl": "",
    "mapUrl": "",
    "region": "kanazawa",
    "storeNote": null,
    "phone": "076-242-8931",
    "businessHours": "（月－金） 9:00～16:00"
  },
  {
    "storeId": "store_014",
    "storeName": "若草店",
    "address": "921-8111 石川県金沢市若草町2番地38",
    "lat": 36.54486794168494,
    "lon": 136.65679780728482,
    "lineUrl": "https://line.me/R/ti/p/@351hchfl",
    "mapUrl": "https://maps.app.goo.gl/JrYSoCvwzqgBgyDH9",
    "region": "kanazawa",
    "storeNote": null,
    "phone": "076-243-8931",
    "businessHours": "（月－土） 9:00～18:00"
  },
  {
    "storeId": "store_016",
    "storeName": "泉が丘店",
    "address": "921-8035 石川県金沢市泉が丘2丁目13番39",
    "lat": 36.54262190763349,
    "lon": 136.64434865945776,
    "lineUrl": "https://line.me/R/ti/p/@382iefwp",
    "mapUrl": "https://maps.app.goo.gl/Bmbj5bG5rsHhaTW1A",
    "region": "kanazawa",
    "storeNote": null,
    "phone": "076-245-8931",
    "businessHours": "（月－土） 9:00～18:00"
  },
  {
    "storeId": "store_009",
    "storeName": "三馬店",
    "address": "921-8151 石川県金沢市窪7丁目200番地",
    "lat": 36.52965520100299,
    "lon": 136.63710482988694,
    "lineUrl": "https://line.me/R/ti/p/@064qsrdx",
    "mapUrl": "https://maps.app.goo.gl/La9C6J5aWZziW2En8",
    "region": "kanazawa",
    "storeNote": null,
    "phone": "076-280-8931",
    "businessHours": "（月－土） 9:00～18:00"
  },
  {
    "storeId": "store_022",
    "storeName": "矢木店",
    "address": "921‐8066 石川県金沢市矢木1丁目44番地",
    "lat": 36.55420751102454,
    "lon": 136.5970585798115,
    "lineUrl": "https://line.me/R/ti/p/@024esmca",
    "mapUrl": "https://maps.app.goo.gl/93VeEQySefaCUFV66",
    "region": "kanazawa",
    "storeNote": null,
    "phone": "076-269-8931",
    "businessHours": "（月－土） 9:00～18:00"
  },
  {
    "storeId": "store_018",
    "storeName": "八日市店",
    "address": "921-8064 石川県金沢市八日市4丁目364番地",
    "lat": 36.5494740957765,
    "lon": 136.60837389586013,
    "lineUrl": "https://line.me/R/ti/p/@402yvros",
    "mapUrl": "https://maps.app.goo.gl/EwYce8X1yiTydcDdA",
    "region": "kanazawa",
    "storeNote": null,
    "phone": "076-240-8931",
    "businessHours": "（月－土） 9:00～18:00"
  },
  {
    "storeId": "store_034",
    "storeName": "押野店",
    "address": "921-8802 石川県野々市市押野6丁目174番地",
    "lat": 36.544560605208346,
    "lon": 136.61872980305327,
    "lineUrl": "https://line.me/R/ti/p/@412hckrp",
    "mapUrl": "https://maps.app.goo.gl/GkYfcdeu69tBDe1P8",
    "region": "kanazawa",
    "storeNote": null,
    "phone": "076-294-3953",
    "businessHours": "（月－土） 9:00～18:00"
  },
  {
    "storeId": "store_037",
    "storeName": "片町店",
    "address": "920-0981 石川県金沢市片町2丁目13番13号",
    "lat": 36.56032,
    "lon": 136.65543,
    "lineUrl": "",
    "mapUrl": "",
    "region": "kanazawa",
    "storeNote": null,
    "phone": "076-204-8931",
    "businessHours": "（月－土） 8:30～18:00"
  },
  {
    "storeId": "store_032",
    "storeName": "福留町店",
    "address": "924-0051 石川県白山市福留町173番地1",
    "lat": 36.490639149075655,
    "lon": 136.52616202137114,
    "lineUrl": "https://line.me/R/ti/p/@744nytkq",
    "mapUrl": "https://maps.app.goo.gl/kqWF6PDcCnGtbsk19",
    "region": "kaga",
    "storeNote": null,
    "phone": "076-277-2951",
    "businessHours": "（月－土） 9:00～18:00"
  },
  {
    "storeId": "store_030",
    "storeName": "小松店",
    "address": "923-0961 石川県小松市向本折町ﾎ81番地1",
    "lat": 36.39929229538969,
    "lon": 136.44021347149206,
    "lineUrl": "https://line.me/R/ti/p/@985fualb",
    "mapUrl": "https://maps.app.goo.gl/Mit4sUHjCjzYPgco6",
    "region": "kaga",
    "storeNote": null,
    "phone": "0761-23-2024",
    "businessHours": "（月－土） 8:30～18:00"
  },
  {
    "storeId": "store_031",
    "storeName": "軽海店",
    "address": "923-0825 石川県小松市西軽海町1丁目137番地",
    "lat": 36.39776161052722,
    "lon": 136.499765537365,
    "lineUrl": "https://line.me/R/ti/p/@122focnm",
    "mapUrl": "https://maps.app.goo.gl/gSK82SipQBYyWsPP9",
    "region": "kaga",
    "storeNote": null,
    "phone": "0761-47-8931",
    "businessHours": "（月－金） 9:00～18:00\n（土）　　 9:00～17:00"
  },
  {
    "storeId": "store_029",
    "storeName": "小馬出店",
    "address": "923-0918 石川県小松市京町54番地2",
    "lat": 36.40622606618214,
    "lon": 136.44802717256198,
    "lineUrl": "https://line.me/R/ti/p/@378voszd",
    "mapUrl": "https://maps.app.goo.gl/D8A2AHZvSPHa8LqXA",
    "region": "kaga",
    "storeNote": null,
    "phone": "0761-21-4884",
    "businessHours": "（月－金） 9:00～18:00\n（土） 　　9:00～17:00"
  },
  {
    "storeId": "store_003",
    "storeName": "加賀温泉駅前店",
    "address": "922-0423 石川県加賀市作見町ﾘ28番地1",
    "lat": 36.317890573778996,
    "lon": 136.35099657595936,
    "lineUrl": "https://line.me/R/ti/p/@028pskce",
    "mapUrl": "https://maps.app.goo.gl/aZbD9WwwsCmUZKYw8",
    "region": "kaga",
    "storeNote": null,
    "phone": "0761-72-8911",
    "businessHours": "（月－金） 9:00～18:00\n（土） 　　9:00～12:00"
  },
  {
    "storeId": "store_004",
    "storeName": "山代店",
    "address": "922-0245 石川県加賀市山代温泉山背台1丁目67番地2",
    "lat": 36.29213764928674,
    "lon": 136.35894154649822,
    "lineUrl": "https://line.me/R/ti/p/@302rqvdc",
    "mapUrl": "https://maps.app.goo.gl/TW4nrfsKY34khkfcA",
    "region": "kaga",
    "storeNote": null,
    "phone": "0761-77-6000",
    "businessHours": "（月－土） 9:00～18:00"
  }
];

/**
 * 店舗IDから店舗情報を取得
 * @param {string} storeId - 店舗ID
 * @returns {Object|null} 店舗情報
 */
function getStoreById(storeId) {
    return storeList.find(store => store.storeId === storeId) || null;
}

/**
 * 店舗名から店舗情報を取得
 * @param {string} storeName - 店舗名
 * @returns {Object|null} 店舗情報
 */
function getStoreByName(storeName) {
    return storeList.find(store => store.storeName === storeName) || null;
}

/**
 * 地域で店舗をフィルタリング
 * @param {string} region - 地域 ('kanazawa'|'kaga'|'noto')
 * @returns {Array} 店舗リスト
 */
function getStoresByRegion(region) {
    return storeList.filter(store => store.region === region);
}

/**
 * 座標から最寄りの店舗を取得（複数）
 * @param {number} lat - 緯度
 * @param {number} lon - 経度
 * @param {number} limit - 取得件数（デフォルト5）
 * @returns {Array} 距離付き店舗リスト（近い順）
 */
function getNearestStores(lat, lon, limit = 5) {
    const storesWithDistance = storeList.map(store => ({
        ...store,
        distance: calculateDistance(lat, lon, store.lat, store.lon)
    }));
    
    storesWithDistance.sort((a, b) => a.distance - b.distance);
    return storesWithDistance.slice(0, limit);
}

/**
 * 2点間の距離を計算（Haversine公式）
 * @param {number} lat1 - 緯度1
 * @param {number} lon1 - 経度1
 * @param {number} lat2 - 緯度2
 * @param {number} lon2 - 経度2
 * @returns {number} 距離（km）
 */
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // 地球の半径（km）
    const toRad = (deg) => deg * Math.PI / 180;
    
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
              Math.sin(dLon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    
    return R * c;
}

module.exports = {
    storeList,
    getStoreById,
    getStoreByName,
    getStoresByRegion,
    getNearestStores,
    calculateDistance
};
