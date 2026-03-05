/**
 * signatureToken.ts
 * 署名用アクセストークンの検証（フロントエンド/API route用）
 */

import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { initAdminApp } from "./firebaseAdmin";

initAdminApp();

export async function validateAccessToken(
  token: string,
  envelopeId: string
): Promise<{ valid: boolean; recipientId?: string; recipientEmail?: string; reason?: string }> {
  const db = getFirestore();
  const tokenDoc = await db.collection("signatureTokens").doc(token).get();

  if (!tokenDoc.exists) {
    return { valid: false, reason: "トークンが存在しません" };
  }

  const tokenData = tokenDoc.data()!;

  if (tokenData.envelopeId !== envelopeId) {
    return { valid: false, reason: "トークンとエンベロープIDが一致しません" };
  }

  if (tokenData.status !== "active") {
    return { valid: false, reason: "トークンは使用済みまたは無効です" };
  }

  const expiresAt = tokenData.expiresAt.toDate() as Date;
  if (expiresAt < new Date()) {
    return { valid: false, reason: "トークンの有効期限が切れています" };
  }

  return {
    valid: true,
    recipientId: tokenData.recipientId,
    recipientEmail: tokenData.recipientEmail,
  };
}
