/**
 * auditService.ts
 * 電子帳簿保存法 真実性確保のための不変監査ログサービス
 * すべての操作をハッシュチェーンで連鎖させ、改ざんを検出可能にする
 */

import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import * as crypto from "crypto";

export type AuditAction =
  | "envelope.created"
  | "envelope.sent"
  | "envelope.viewed"
  | "envelope.signed"
  | "envelope.completed"
  | "envelope.voided"
  | "envelope.expired"
  | "envelope.downloaded"
  | "auth.login"
  | "auth.logout"
  | "auth.token_generated"
  | "security.signature_verified"
  | "security.tamper_detected"
  | "security.kms_sign_requested"
  | "admin.member_added"
  | "admin.member_removed"
  | "admin.settings_changed";

export interface AuditLogEntry {
  organizationId: string;
  envelopeId?: string;
  recipientId?: string;
  action: AuditAction;
  actorUid?: string;
  actorEmail?: string;
  actorIp?: string;
  actorUserAgent?: string;
  details?: Record<string, unknown>;
  beforeState?: Record<string, unknown>;
  afterState?: Record<string, unknown>;
}

const db = getFirestore();

/**
 * 監査ログを記録する（Cloud Functionsのサービスアカウントのみ実行可）
 * ハッシュチェーン方式で改ざん検知を実現
 */
export async function writeAuditLog(entry: AuditLogEntry): Promise<string> {
  const logsRef = db.collection("auditLogs");

  // 直前のログを取得してハッシュチェーンを構築
  const previousLogQuery = await logsRef
    .where("organizationId", "==", entry.organizationId)
    .orderBy("timestamp", "desc")
    .limit(1)
    .get();

  let previousLogHash: string | undefined;
  let previousLogId: string | undefined;

  if (!previousLogQuery.empty) {
    const prevDoc = previousLogQuery.docs[0];
    previousLogHash = prevDoc.data().currentLogHash;
    previousLogId = prevDoc.id;
  }

  // 現在のログデータを構築
  const timestamp = Timestamp.now();
  const logData = {
    ...entry,
    timestamp,
    details: entry.details ?? {},
    previousLogHash: previousLogHash ?? null,
    previousLogId: previousLogId ?? null,
  };

  // 現在のログのハッシュを計算（改ざん検知用）
  const currentLogHash = calculateLogHash(logData);

  const finalLogData = {
    ...logData,
    currentLogHash,
    // createdAt は Firestore サーバータイムスタンプで設定（改ざん防止）
    createdAt: FieldValue.serverTimestamp(),
  };

  // 監査ログを保存（セキュリティルールにより更新・削除は禁止）
  const docRef = await logsRef.add(finalLogData);

  console.log(`[AuditLog] 記録完了: ${entry.action} (ID: ${docRef.id})`);

  return docRef.id;
}

/**
 * ログエントリのSHA-256ハッシュを計算
 */
function calculateLogHash(logData: Record<string, unknown>): string {
  // タイムスタンプをシリアライズ可能な形式に変換
  const serializable = {
    organizationId: logData.organizationId,
    envelopeId: logData.envelopeId ?? null,
    action: logData.action,
    actorEmail: logData.actorEmail ?? null,
    actorIp: logData.actorIp ?? null,
    timestamp: logData.timestamp instanceof Timestamp
      ? logData.timestamp.toMillis()
      : String(logData.timestamp),
    details: logData.details,
    previousLogHash: logData.previousLogHash ?? null,
  };

  return crypto
    .createHash("sha256")
    .update(JSON.stringify(serializable, Object.keys(serializable).sort()))
    .digest("hex");
}

/**
 * 監査ログのハッシュチェーン整合性を検証する
 * 電子帳簿保存法の真実性確認に使用
 */
export async function verifyAuditLogChain(
  organizationId: string,
  fromDate?: Date,
  toDate?: Date
): Promise<{
  valid: boolean;
  totalLogs: number;
  brokenAt?: string;
  reason?: string;
}> {
  const logsRef = db.collection("auditLogs");
  let query = logsRef
    .where("organizationId", "==", organizationId)
    .orderBy("timestamp", "asc");

  if (fromDate) {
    query = query.where("timestamp", ">=", Timestamp.fromDate(fromDate));
  }
  if (toDate) {
    query = query.where("timestamp", "<=", Timestamp.fromDate(toDate));
  }

  const logsSnapshot = await query.get();
  const logs = logsSnapshot.docs;

  if (logs.length === 0) {
    return { valid: true, totalLogs: 0 };
  }

  // チェーンを順番に検証
  for (let i = 0; i < logs.length; i++) {
    const logData = logs[i].data();
    const storedHash = logData.currentLogHash;

    // ハッシュを再計算して一致確認
    const recalculatedHash = calculateLogHash(logData);

    if (storedHash !== recalculatedHash) {
      return {
        valid: false,
        totalLogs: logs.length,
        brokenAt: logs[i].id,
        reason: `ログID ${logs[i].id} のハッシュが一致しません（改ざんの可能性）`,
      };
    }

    // 前のログとの連鎖を確認
    if (i > 0) {
      const prevLogHash = logs[i - 1].data().currentLogHash;
      if (logData.previousLogHash !== prevLogHash) {
        return {
          valid: false,
          totalLogs: logs.length,
          brokenAt: logs[i].id,
          reason: `ログID ${logs[i].id} の前方ハッシュが一致しません（ログの欠損または挿入の可能性）`,
        };
      }
    }
  }

  return { valid: true, totalLogs: logs.length };
}

/**
 * エンベロープの操作履歴を取得
 */
export async function getEnvelopeAuditTrail(
  envelopeId: string,
  organizationId: string
): Promise<Array<Record<string, unknown>>> {
  const logsRef = db.collection("auditLogs");
  const snapshot = await logsRef
    .where("organizationId", "==", organizationId)
    .where("envelopeId", "==", envelopeId)
    .orderBy("timestamp", "asc")
    .get();

  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
    timestamp: doc.data().timestamp?.toDate?.()?.toISOString() ?? null,
  }));
}
