/**
 * 処方箋管理システムの型定義
 */

// 受付ステータス
export type ReceptionStatus = 
  | 'pending'      // 受付待ち（管理者確認前）
  | 'confirmed'    // 確認済み（店舗に割振り済み）
  | 'preparing'    // 調剤中
  | 'ready'        // 準備完了
  | 'completed'    // 受取完了
  | 'cancelled';   // キャンセル

// 受け取り方法
export type DeliveryMethod = 
  | 'store'        // 店舗受け取り
  | 'home';        // 自宅受け取り（オンライン服薬指導）

  // メッセージングセッションのステータス
export type MessagingSessionStatus = 
  | 'inactive'     // 店舗とのやりとりなし（AI応答有効）
  | 'active'       // 店舗とやりとり中（AI応答スキップ）
  | 'closed';      // やりとり終了（AI応答有効に戻る）

// セッション終了理由
export type SessionCloseReason = 
  | 'manual'       // 手動終了
  | 'ready'        // 準備完了
  | 'completed'    // 受取完了
  | 'cancelled'    // キャンセル
  | 'timeout';     // タイムアウト

// 店舗情報
export interface Store {
  storeId: string;
  storeName: string;
  region: string;
  address: string;
  phone: string;
  lineUrl: string;
  mapUrl: string;
  businessHours: string;
}

// 処方箋受付情報
export interface PrescriptionReception {
  receptionId: string;           // 受付ID（PK）
  timestamp: string;             // 受付日時（SK）
  userId: string;                // LINE ユーザーID
  userDisplayName?: string;      // ユーザー表示名
  userProfileImage?: string;     // ユーザープロフィール画像
  
  // 処方箋情報
  prescriptionImageUrl: string;  // 処方箋画像URL（S3）
  prescriptionImageKey: string;  // S3キー
  ocrResult?: string;            // OCR結果（参考情報）
  
  // 受け取り方法
  deliveryMethod?: DeliveryMethod;     // 受け取り方法（店舗 or 自宅）
  preferredPickupTime?: string;        // 希望受け取り時間
  preferredPickupTimeText?: string;    // 希望受け取り時間（表示用テキスト）

  // 店舗情報
  selectedStoreId?: string;      // 選択された店舗ID
  selectedStoreName?: string;    // 選択された店舗名
  preferredStoreId?: string;     // お客様希望店舗ID
  
  // ステータス
  status: ReceptionStatus;
  messagingSessionStatus: MessagingSessionStatus;
  
  // メタ情報
  customerNote?: string;         // お客様からのメモ
  staffNote?: string;            // 管理者/店舗からのメモ
  
  // 日時情報
  confirmedAt?: string;          // 確認日時
  assignedAt?: string;           // 店舗割振り日時
  readyAt?: string;              // 準備完了日時
  completedAt?: string;          // 受取完了日時
  sessionClosedAt?: string;      // セッション終了日時
  sessionCloseReason?: SessionCloseReason; // セッション終了理由
  sessionReactivatedAt?: string; // セッション再開日時
  lastStoreMessageAt?: string;   // 最後の店舗メッセージ日時
  lastCustomerMessageAt?: string; // 最後のお客様メッセージ日時
  
  // メッセージ関連（UI表示用）
  unreadMessageCount?: number;   // 未読メッセージ数
  lastMessage?: {                // 最新メッセージ
    content: string;
    timestamp: string;
    senderType: 'customer' | 'store' | 'system';
  };
  
  // TTL（1年後に自動削除）
  ttl: number;
}

// 処方箋関連メッセージ（店舗⇔お客様）
export interface PrescriptionMessage {
  receptionId: string;           // 受付ID（PK）
  messageId: string;             // メッセージID（SK）
  timestamp: string;             // 送信日時
  
  // 送信者情報
  senderType: 'customer' | 'store' | 'system';
  senderId: string;              // ユーザーID or 店舗ID or 'system'
  senderName: string;            // 表示名
  
  // メッセージ内容
  messageType: 'text' | 'image';
  content: string;               // テキスト or 画像URL
  
  // LINE配信情報
  lineDelivered: boolean;        // LINE送信済みフラグ
  lineDeliveredAt?: string;      // LINE送信日時
  
  // 既読情報
  readByCustomer: boolean;
  readByStore: boolean;
  
  // TTL
  ttl: number;
}

// お客様のアクティブセッション情報（DynamoDBに保存）
export interface CustomerMessagingSession {
  userId: string;                         // LINE ユーザーID（PK）
  activeReceptionId: string | null;       // アクティブな受付ID
  messagingSessionStatus: MessagingSessionStatus;
  lastStoreMessageAt?: string;            // 最後の店舗メッセージ日時
  sessionStartedAt?: string;              // セッション開始日時
  sessionTimeoutMinutes: number;          // タイムアウト時間（分）
  updatedAt: string;
}

// API レスポンス
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

// ダッシュボード統計
export interface DashboardStats {
  pendingCount: number;       // 受付待ち
  preparingCount: number;     // 調剤中
  readyCount: number;         // 準備完了
  todayTotal: number;         // 本日合計
}

// 通知タイプ
export type NotificationType = 
  | 'new_reception'           // 新規受付
  | 'store_assigned'          // 店舗割振り
  | 'preparation_started'     // 調剤開始
  | 'ready_for_pickup'        // 準備完了
  | 'message_from_store';     // 店舗からのメッセージ

// ビデオ通話ルームのステータス
export type VideoCallStatus = 
  | 'waiting'     // 参加者待ち
  | 'connecting'  // 接続中
  | 'active'      // 通話中
  | 'ended';      // 終了

// ビデオ通話ルーム情報（DynamoDBに保存）
export interface VideoCallRoom {
  roomId: string;              // ルームID（PK）
  receptionId: string;         // 関連する受付ID
  
  // 参加者情報
  storeId?: string;            // 店舗ID
  storeName?: string;          // 店舗名
  userId?: string;             // お客様のLINE ユーザーID
  userDisplayName?: string;    // お客様の表示名
  
  // ステータス
  status: VideoCallStatus;
  
  // WebRTCシグナリング用
  offer?: string;              // SDP Offer（JSON文字列）
  answer?: string;             // SDP Answer（JSON文字列）
  storeCandidates?: string[];  // 店舗側のICE Candidates
  customerCandidates?: string[]; // お客様側のICE Candidates
  
  // 日時情報
  createdAt: string;           // ルーム作成日時
  startedAt?: string;          // 通話開始日時
  endedAt?: string;            // 通話終了日時
  
  // TTL（24時間後に自動削除）
  ttl: number;
}
