/**
 * onEnvelopeCreated.ts
 * Firestore トリガー: Envelope作成時に受信者へ署名依頼メールを送信
 */

import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { writeAuditLog } from "../services/auditService";
import { sendSignatureRequest } from "../services/notificationService";

export const onEnvelopeCreatedTrigger = onDocumentCreated(
  {
    document: "envelopes/{envelopeId}",
    region: "asia-northeast1",
    memory: "256MiB",
    timeoutSeconds: 60,
  },
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) {
      console.log("[onEnvelopeCreated] データなし、スキップ");
      return;
    }

    const envelopeData = snapshot.data();
    const envelopeId = event.params.envelopeId;

    // draft状態は通知しない（送信時に処理）
    if (envelopeData.status !== "sent") {
      console.log(`[onEnvelopeCreated] status=${envelopeData.status}, スキップ`);
      return;
    }

    try {
      await processEnvelopeSent(envelopeId, envelopeData);
    } catch (err) {
      console.error("[onEnvelopeCreated] エラー:", err);
      throw err;
    }
  }
);

/**
 * 送信済みエンベロープの処理
 */
export async function processEnvelopeSent(
  envelopeId: string,
  envelopeData: Record<string, unknown>
): Promise<void> {
  const db = getFirestore();

  // 受信者を順番順に取得
  const recipientsSnapshot = await db
    .collection("envelopes")
    .doc(envelopeId)
    .collection("recipients")
    .orderBy("order", "asc")
    .get();

  if (recipientsSnapshot.empty) {
    console.log(`[onEnvelopeCreated] 受信者なし: ${envelopeId}`);
    return;
  }

  // 送信者情報を取得
  const senderUid = envelopeData.createdBy as string;
  const senderDoc = await db.collection("users").doc(senderUid).get();
  const senderData = senderDoc.data() ?? {};

  // 最初の受信者のみに通知（順次署名の場合）
  const firstRecipient = recipientsSnapshot.docs[0];
  const recipientData = firstRecipient.data();

  await sendSignatureRequest({
    envelopeId,
    envelopeTitle: envelopeData.title as string,
    senderName: (senderData.displayName as string) ?? (senderData.email as string) ?? "送信者",
    senderEmail: (senderData.email as string) ?? "",
    recipientId: firstRecipient.id,
    recipientName: recipientData.name as string,
    recipientEmail: recipientData.email as string,
    message: envelopeData.description as string | undefined,
    expiresAt: envelopeData.expiresAt
      ? (envelopeData.expiresAt as Timestamp).toDate()
      : undefined,
  });

  // 監査ログ記録
  await writeAuditLog({
    organizationId: envelopeData.organizationId as string,
    envelopeId,
    recipientId: firstRecipient.id,
    action: "envelope.sent",
    actorUid: senderUid,
    actorEmail: senderData.email as string,
    details: {
      recipientEmail: recipientData.email,
      recipientName: recipientData.name,
      recipientOrder: recipientData.order,
    },
  });

  console.log(`[onEnvelopeCreated] 署名依頼送信完了: ${recipientData.email}`);
}
