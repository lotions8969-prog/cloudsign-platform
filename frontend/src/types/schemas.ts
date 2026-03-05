import { z } from "zod";
import { Timestamp } from "firebase/firestore";

// =========================================
// 基本型定義
// =========================================

export const TimestampSchema = z.custom<Timestamp>(
  (val) => val instanceof Timestamp,
  { message: "Firestore Timestamp が必要です" }
);

// =========================================
// Organization スキーマ
// =========================================

export const OrganizationPlanSchema = z.enum(["free", "standard", "enterprise"]);

export const OrganizationSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(200),
  displayName: z.string().min(1).max(200),
  email: z.string().email(),
  phoneNumber: z.string().optional(),
  address: z.string().optional(),
  plan: OrganizationPlanSchema.default("free"),
  monthlyEnvelopeCount: z.number().int().min(0).default(0),
  totalEnvelopeCount: z.number().int().min(0).default(0),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  // 電子帳簿保存法: 保存義務開始日
  ebookkeepingStartDate: z.string().optional(), // ISO 8601
  // KMS キーリソース名（組織固有）
  kmsKeyName: z.string().optional(),
});

export type Organization = z.infer<typeof OrganizationSchema>;

// =========================================
// Recipient スキーマ
// =========================================

export const RecipientStatusSchema = z.enum([
  "pending",      // 未署名
  "viewed",       // 閲覧済み
  "signed",       // 署名済み
  "declined",     // 拒否
  "bounced",      // メール不達
]);

export const RecipientSchema = z.object({
  id: z.string().min(1),
  envelopeId: z.string().min(1),
  name: z.string().min(1).max(200),
  email: z.string().email(),
  order: z.number().int().min(1), // 署名順
  status: RecipientStatusSchema.default("pending"),
  // 署名メタデータ
  signedAt: TimestampSchema.optional(),
  ipAddress: z.string().optional(),
  userAgent: z.string().optional(),
  // 本人確認
  emailVerifiedAt: TimestampSchema.optional(),
  // 署名画像（Base64またはStorage URL）
  signatureImageUrl: z.string().optional(),
  // ワンタイムトークン（送付時に生成）
  accessToken: z.string().optional(),
  accessTokenExpiresAt: TimestampSchema.optional(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type Recipient = z.infer<typeof RecipientSchema>;

// =========================================
// 電子帳簿保存法 検索インデックス
// =========================================

export const EbookkeepingIndexSchema = z.object({
  // 必須3項目: 日付・金額・取引先（電子帳簿保存法 第7条）
  transactionDate: z.string().optional(), // ISO 8601 (YYYY-MM-DD)
  amount: z.number().optional(),          // 金額（円）
  counterpartyName: z.string().optional(), // 取引先名
  // 補助情報
  currency: z.string().default("JPY"),
  contractType: z.string().optional(),    // 契約種別（売買、業務委託等）
  documentNumber: z.string().optional(),  // 文書番号
});

export type EbookkeepingIndex = z.infer<typeof EbookkeepingIndexSchema>;

// =========================================
// Envelope スキーマ（電子契約の中心）
// =========================================

export const EnvelopeStatusSchema = z.enum([
  "draft",        // 下書き
  "sent",         // 送信済み（署名待ち）
  "in_progress",  // 署名進行中
  "completed",    // 締結完了
  "voided",       // 無効化
  "expired",      // 期限切れ
  "declined",     // 受信者が拒否
]);

export const SignatureInfoSchema = z.object({
  // KMS署名情報
  kmsKeyName: z.string(),
  kmsKeyVersion: z.string(),
  signatureAlgorithm: z.literal("RSA_SIGN_PSS_4096_SHA256").or(
    z.literal("EC_SIGN_P384_SHA384")
  ),
  // PDFハッシュ
  pdfSha256Hash: z.string(),
  // 署名値（Base64）
  signatureBase64: z.string(),
  // 公開鍵（PEM）
  publicKeyPem: z.string(),
  // タイムスタンプ（TSA）
  timestampToken: z.string().optional(),
  timestampAuthority: z.string().optional(),
  // PAdES B-LT メタデータ
  padesSigningTime: z.string(), // ISO 8601
  padesSignaturePolicyId: z.string().optional(),
});

export const EnvelopeSchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
  createdBy: z.string().min(1), // Firebase Auth UID
  title: z.string().min(1).max(500),
  description: z.string().max(2000).optional(),
  status: EnvelopeStatusSchema.default("draft"),
  // 受信者メールアドレス（Firestore配列クエリ用）
  recipientEmails: z.array(z.string().email()),
  // PDFファイル情報
  originalPdfUrl: z.string().url(),
  originalPdfSha256: z.string(), // 改ざん検知
  signedPdfUrl: z.string().url().optional(),
  signedPdfSha256: z.string().optional(),
  // 署名情報
  signatureInfo: SignatureInfoSchema.optional(),
  // 有効期限
  expiresAt: TimestampSchema.optional(),
  // 完了日時（電子帳簿保存法: 保存開始日）
  completedAt: TimestampSchema.optional(),
  voidedAt: TimestampSchema.optional(),
  voidReason: z.string().optional(),
  // 電子帳簿保存法 検索インデックス（必須）
  ebookkeepingIndex: EbookkeepingIndexSchema,
  // メタデータ
  tags: z.array(z.string()).default([]),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type Envelope = z.infer<typeof EnvelopeSchema>;
export type EnvelopeStatus = z.infer<typeof EnvelopeStatusSchema>;

// =========================================
// AuditLog スキーマ（監査ログ - 不変）
// =========================================

export const AuditActionSchema = z.enum([
  // Envelope操作
  "envelope.created",
  "envelope.sent",
  "envelope.viewed",
  "envelope.signed",
  "envelope.completed",
  "envelope.voided",
  "envelope.expired",
  "envelope.downloaded",
  // 認証操作
  "auth.login",
  "auth.logout",
  "auth.token_generated",
  // セキュリティ
  "security.signature_verified",
  "security.tamper_detected",
  "security.kms_sign_requested",
  // 管理操作
  "admin.member_added",
  "admin.member_removed",
  "admin.settings_changed",
]);

export const AuditLogSchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
  envelopeId: z.string().optional(),
  recipientId: z.string().optional(),
  action: AuditActionSchema,
  actorUid: z.string().optional(),        // Firebase Auth UID
  actorEmail: z.string().email().optional(),
  actorIp: z.string().optional(),
  actorUserAgent: z.string().optional(),
  // 操作詳細（JSON）
  details: z.record(z.unknown()).default({}),
  // 前後の状態スナップショット
  beforeState: z.record(z.unknown()).optional(),
  afterState: z.record(z.unknown()).optional(),
  // 不変タイムスタンプ（サーバー側で設定）
  timestamp: TimestampSchema,
  // ハッシュチェーン（前のログとの連続性検証）
  previousLogHash: z.string().optional(),
  currentLogHash: z.string(),
});

export type AuditLog = z.infer<typeof AuditLogSchema>;

// =========================================
// API リクエスト/レスポンス型
// =========================================

export const CreateEnvelopeRequestSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().max(2000).optional(),
  recipients: z.array(z.object({
    name: z.string().min(1).max(200),
    email: z.string().email(),
    order: z.number().int().min(1),
  })).min(1).max(20),
  ebookkeepingIndex: EbookkeepingIndexSchema,
  expiresAt: z.string().datetime().optional(),
  tags: z.array(z.string()).default([]),
});

export type CreateEnvelopeRequest = z.infer<typeof CreateEnvelopeRequestSchema>;

export const SignDocumentRequestSchema = z.object({
  envelopeId: z.string().min(1),
  recipientId: z.string().min(1),
  accessToken: z.string().min(1),
  signatureImageBase64: z.string().min(1), // Canvas から取得
  ipAddress: z.string().optional(),
  userAgent: z.string().optional(),
});

export type SignDocumentRequest = z.infer<typeof SignDocumentRequestSchema>;

export const SearchEnvelopesRequestSchema = z.object({
  organizationId: z.string().min(1),
  status: EnvelopeStatusSchema.optional(),
  // 電子帳簿保存法 検索条件
  transactionDateFrom: z.string().optional(),
  transactionDateTo: z.string().optional(),
  amountMin: z.number().optional(),
  amountMax: z.number().optional(),
  counterpartyName: z.string().optional(),
  // ページネーション
  limit: z.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

export type SearchEnvelopesRequest = z.infer<typeof SearchEnvelopesRequestSchema>;
