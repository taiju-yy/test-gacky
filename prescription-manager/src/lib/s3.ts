/**
 * S3 クライアント設定
 * AWS SDK for JavaScript v3 を使用
 * 
 * 処方箋画像の署名付きURL再生成に使用
 */

import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// シングルトンインスタンスをキャッシュ
let s3ClientInstance: S3Client | null = null;

/**
 * S3 Client を取得（ランタイム時に初期化）
 */
export function getS3Client(): S3Client {
  if (!s3ClientInstance) {
    const region = process.env.APP_AWS_REGION || process.env.NEXT_PUBLIC_AWS_REGION || 'ap-northeast-1';
    console.log('[S3] Initializing client with region:', region);
    
    s3ClientInstance = new S3Client({ region });
  }
  return s3ClientInstance;
}

// バケット名を取得
export function getBucketName(): string {
  return process.env.PRESCRIPTION_BUCKET || 'gacky-prescriptions';
}

/**
 * S3キーから署名付きURLを生成
 * 
 * @param s3Key - S3オブジェクトキー（例: prescriptions/userId/receptionId/messageId.jpg）
 * @param expiresIn - 有効期限（秒）デフォルト7日間
 * @returns 署名付きURL
 */
export async function generateSignedUrl(s3Key: string, expiresIn: number = 7 * 24 * 60 * 60): Promise<string> {
  const s3Client = getS3Client();
  const bucketName = getBucketName();
  
  const url = await getSignedUrl(
    s3Client,
    new GetObjectCommand({
      Bucket: bucketName,
      Key: s3Key,
    }),
    { expiresIn }
  );
  
  return url;
}

/**
 * 処方箋受付データの画像URLを新しい署名付きURLに置き換え
 * 
 * prescriptionImageKeyが存在する場合、新しい署名付きURLを生成して返す
 * 
 * @param reception - 処方箋受付データ
 * @returns 更新された処方箋受付データ
 */
export async function refreshPrescriptionImageUrl(reception: any): Promise<any> {
  // prescriptionImageKeyがない場合は元のデータをそのまま返す
  if (!reception.prescriptionImageKey) {
    return reception;
  }
  
  try {
    const newImageUrl = await generateSignedUrl(reception.prescriptionImageKey);
    return {
      ...reception,
      prescriptionImageUrl: newImageUrl,
    };
  } catch (error) {
    console.error(`Error regenerating signed URL for ${reception.receptionId}:`, error);
    // エラーの場合は元のURLを維持
    return reception;
  }
}

/**
 * 複数の処方箋受付データの画像URLを一括で更新
 * 
 * @param receptions - 処方箋受付データの配列
 * @returns 更新された処方箋受付データの配列
 */
export async function refreshPrescriptionImageUrls(receptions: any[]): Promise<any[]> {
  return Promise.all(receptions.map(refreshPrescriptionImageUrl));
}
