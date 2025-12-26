/**
 * 店舗API
 * GET: 店舗一覧を取得
 */

import { NextRequest, NextResponse } from 'next/server';

// あおぞら薬局の店舗データ
const stores = [
  { storeId: 'store_001', storeName: '金沢駅前', region: '金沢市', address: '石川県金沢市此花町1-1', phone: '076-xxx-xxxx', lineUrl: 'https://line.me/xxx', mapUrl: 'https://goo.gl/maps/xxx', businessHours: '9:00-19:00' },
  { storeId: 'store_002', storeName: '野々市', region: '野々市市', address: '石川県野々市市xxx', phone: '076-xxx-xxxx', lineUrl: 'https://line.me/xxx', mapUrl: 'https://goo.gl/maps/xxx', businessHours: '9:00-19:00' },
  { storeId: 'store_003', storeName: '小松', region: '小松市', address: '石川県小松市xxx', phone: '076-xxx-xxxx', lineUrl: 'https://line.me/xxx', mapUrl: 'https://goo.gl/maps/xxx', businessHours: '9:00-18:00' },
  { storeId: 'store_004', storeName: '白山', region: '白山市', address: '石川県白山市xxx', phone: '076-xxx-xxxx', lineUrl: 'https://line.me/xxx', mapUrl: 'https://goo.gl/maps/xxx', businessHours: '9:00-19:00' },
  { storeId: 'store_005', storeName: '津幡', region: '河北郡', address: '石川県河北郡津幡町xxx', phone: '076-xxx-xxxx', lineUrl: 'https://line.me/xxx', mapUrl: 'https://goo.gl/maps/xxx', businessHours: '9:00-18:00' },
  { storeId: 'store_006', storeName: '高尾', region: '金沢市', address: '石川県金沢市高尾xxx', phone: '076-xxx-xxxx', lineUrl: 'https://line.me/xxx', mapUrl: 'https://goo.gl/maps/xxx', businessHours: '9:00-18:00' },
  { storeId: 'store_007', storeName: '増泉', region: '金沢市', address: '石川県金沢市増泉xxx', phone: '076-xxx-xxxx', lineUrl: 'https://line.me/xxx', mapUrl: 'https://goo.gl/maps/xxx', businessHours: '9:00-19:00' },
  { storeId: 'store_008', storeName: '鳴和', region: '金沢市', address: '石川県金沢市鳴和xxx', phone: '076-xxx-xxxx', lineUrl: 'https://line.me/xxx', mapUrl: 'https://goo.gl/maps/xxx', businessHours: '9:00-18:00' },
  { storeId: 'store_009', storeName: '松任', region: '白山市', address: '石川県白山市松任xxx', phone: '076-xxx-xxxx', lineUrl: 'https://line.me/xxx', mapUrl: 'https://goo.gl/maps/xxx', businessHours: '9:00-19:00' },
  { storeId: 'store_010', storeName: '鶴来', region: '白山市', address: '石川県白山市鶴来xxx', phone: '076-xxx-xxxx', lineUrl: 'https://line.me/xxx', mapUrl: 'https://goo.gl/maps/xxx', businessHours: '9:00-17:00' },
];

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const region = searchParams.get('region');

    let filteredStores = [...stores];

    if (region) {
      filteredStores = filteredStores.filter((s) => s.region === region);
    }

    return NextResponse.json({
      success: true,
      data: filteredStores,
    });
  } catch (error) {
    console.error('Error fetching stores:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch stores' },
      { status: 500 }
    );
  }
}
