// 地域の表示名マッピング
const REGION_NAMES = {
    'kanazawa': '金沢市内',
    'kaga': '加賀地域',
    'noto': '能登地域'
};

// 店舗リスト
const STORES = [
    // 金沢市内
    { id: 'store05', name: '津幡店', region: 'kanazawa' },
    { id: 'store06', name: '鞍月店', region: 'kanazawa' },
    { id: 'store07', name: '森本店', region: 'kanazawa' },
    { id: 'store08', name: '橋場町店', region: 'kanazawa' },
    { id: 'store09', name: '三馬店', region: 'kanazawa' },
    { id: 'store10', name: '広岡店', region: 'kanazawa' },
    { id: 'store11', name: '金沢駅西口店', region: 'kanazawa' },
    { id: 'store12', name: 'スクエア香林坊店', region: 'kanazawa' },
    { id: 'store13', name: '桜町店', region: 'kanazawa' },
    { id: 'store14', name: '若草店', region: 'kanazawa' },
    { id: 'store15', name: 'アイリス店', region: 'kanazawa' },
    { id: 'store16', name: '泉が丘店', region: 'kanazawa' },
    { id: 'store17', name: '中央通町店', region: 'kanazawa' },
    { id: 'store18', name: '八日市店', region: 'kanazawa' },
    { id: 'store19', name: '平和町店', region: 'kanazawa' },
    { id: 'store20', name: '香林坊店', region: 'kanazawa' },
    { id: 'store21', name: '無量寺店', region: 'kanazawa' },
    { id: 'store22', name: '矢木店', region: 'kanazawa' },
    { id: 'store34', name: '押野店', region: 'kanazawa' },
    // 加賀地域
    { id: 'store03', name: '加賀温泉駅前店', region: 'kaga' },
    { id: 'store04', name: '山代店', region: 'kaga' },
    { id: 'store29', name: '小馬出店', region: 'kaga' },
    { id: 'store30', name: '小松店', region: 'kaga' },
    { id: 'store31', name: '軽海店', region: 'kaga' },
    { id: 'store32', name: '福留町店', region: 'kaga' },
    // 能登地域
    { id: 'store01', name: '富来店', region: 'noto' },
    { id: 'store02', name: '鶴多店', region: 'noto' },
    { id: 'store23', name: '徳田店', region: 'noto' },
    { id: 'store24', name: '府中店', region: 'noto' },
    { id: 'store25', name: '神明店', region: 'noto' },
    { id: 'store26', name: '和倉店', region: 'noto' },
    { id: 'store27', name: '中島店', region: 'noto' },
    { id: 'store28', name: '能登総合病院前店', region: 'noto' },
    { id: 'store33', name: '宇出津店', region: 'noto' },
    { id: 'store35', name: '輪島店', region: 'noto' }
];

class StoreManager {
    constructor() {
        this.stores = STORES;
        this.regionNames = REGION_NAMES;
    }

    getAllStores() {
        return this.stores;
    }

    getStoresByRegion(region) {
        return this.stores.filter(store => store.region === region);
    }

    getStore(storeId) {
        return this.stores.find(store => store.id === storeId);
    }

    getRegionName(regionCode) {
        return this.regionNames[regionCode];
    }

    getAllRegions() {
        return Object.entries(this.regionNames).map(([code, name]) => ({
            code,
            name
        }));
    }

    validateStore(storeId) {
        return !!this.getStore(storeId);
    }

    // 店舗の追加
    addStore(storeData) {
        if (!storeData.id || !storeData.name || !storeData.region) {
            throw new Error('Invalid store data. Required: id, name, region');
        }
        
        if (!this.regionNames[storeData.region]) {
            throw new Error(`Invalid region: ${storeData.region}`);
        }

        if (this.getStore(storeData.id)) {
            throw new Error(`Store with ID ${storeData.id} already exists`);
        }

        this.stores.push(storeData);
    }

    // 店舗の更新
    updateStore(storeId, updateData) {
        const storeIndex = this.stores.findIndex(store => store.id === storeId);
        if (storeIndex === -1) {
            throw new Error(`Store with ID ${storeId} not found`);
        }

        if (updateData.region && !this.regionNames[updateData.region]) {
            throw new Error(`Invalid region: ${updateData.region}`);
        }

        this.stores[storeIndex] = {
            ...this.stores[storeIndex],
            ...updateData
        };
    }

    // 店舗の削除
    removeStore(storeId) {
        const storeIndex = this.stores.findIndex(store => store.id === storeId);
        if (storeIndex === -1) {
            throw new Error(`Store with ID ${storeId} not found`);
        }

        this.stores.splice(storeIndex, 1);
    }
}

// シングルトンインスタンスをエクスポート
const storeManager = new StoreManager();
Object.freeze(storeManager);

module.exports = storeManager;