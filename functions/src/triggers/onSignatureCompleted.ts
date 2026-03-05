/**
 * onSignatureCompleted.ts
 * Firestore トリガー: 署名状態が更新された時の処理
 * - 次の署名者への通知
 * - 全員署名完了時の最終処理（KMS署名・PAdES・通知）
 */

import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { getFirestore, Timestamp, FieldValue } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { writeAuditLog } from "../services/auditService";
import { sendSignatureRequest, sendSignatureCompletedNotification } from "../services/notificationService";
import { signPdfWithKms, uploadSignedPdf } from "../services/signService";

export const onSignatureCompletedTrigger = onDocumentUpdated(
  {
    document: "envelopes/{envelopeId}",
    region: "asia-northeast1",
    memory: "512MiB",
    timeoutSeconds: 300,
  },
  async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();

    if (!before || !after) return;

    const envelopeId = event.params.envelopeId;

    // ステータス変化を監視
    const statusChanged = before.status !== after.status;
    const inProgress = after.status === "in_progress";
    const completed = after.status === "completed";

    if (!statusChanged) return;

    if (inProgress) {
      // 次の未署名受信者に通知
      await notifyNextRecipient(envelopeId, after);
    } else if (completed) {
      // 全署名完了処理
      await finalizeSignedDocument(envelopeId, after);
    }
  }
);

/**
 * 次の未署名受信者に署名依頼を送信
 */
async function notifyNextRecipient(
  envelopeId: string,
  envelopeData: Record<string, unknown>
): Promise<void> {
  const db = getFirestore();

  // 次の pending 受信者を取得
  const pendingRecipients = await db
    .collection("envelopes")
    .doc(envelopeId)
    .collection("recipients")
    .where("status", "==", "pending")
    .orderBy("order", "asc")
    .limit(1)
    .get();

  if (pendingRecipients.empty) {
    console.log(`[onSignatureCompleted] 未署名受信者なし: ${envelopeId}`);
    return;
  }

  const nextRecipient = pendingRecipients.docs[0];
  const recipientData = nextRecipient.data();

  const senderUid = envelopeData.createdBy as string;
  const senderDoc = await db.collection("users").doc(senderUid).get();
  const senderData = senderDoc.data() ?? {};

  await sendSignatureRequest({
    envelopeId,
    envelopeTitle: envelopeData.title as string,
    senderName: (senderData.displayName as string) ?? "送信者",
    senderEmail: (senderData.email as string) ?? "",
    recipientId: nextRecipient.id,
    recipientName: recipientData.name as string,
    recipientEmail: recipientData.email as string,
    expiresAt: envelopeData.expiresAt
      ? (envelopeData.expiresAt as Timestamp).toDate()
      : undefined,
  });

  await writeAuditLog({
    organizationId: envelopeData.organizationId as string,
    envelopeId,
    recipientId: nextRecipient.id,
    action: "envelope.sent",
    details: {
      recipientEmail: recipientData.email,
      stage: "sequential_notification",
    },
  });
}

/**
 * 全署名完了時の最終処理
 * 1. Cloud KMS でPDFに組織のデジタル署名を付与
 * 2. PAdES B-LT 相当メタデータを付与
 * 3. 署名済みPDFをCloud Storageに保存
 * 4. Firestoreを更新（締結完了状態に）
 * 5. 全員に完了通知
 */
async function finalizeSignedDocument(
  envelopeId: string,
  envelopeData: Record<string, unknown>
): Promise<void> {
  const db = getFirestore();
  const organizationId = envelopeData.organizationId as string;

  console.log(`[Finalize] 署名完了処理開始: ${envelopeId}`);

  try {
    // 1. 原本PDFを取得
    const originalPdfUrl = envelopeData.originalPdfUrl as string;
    const pdfBuffer = await downloadPdfFromStorage(originalPdfUrl);

    // 2. 組織のKMSキー設定を取得
    const orgDoc = await db.collection("organizations").doc(organizationId).get();
    const orgData = orgDoc.data() ?? {};

    const kmsConfig = {
      projectId: process.env.GCP_PROJECT_ID ?? "",
      locationId: process.env.KMS_LOCATION ?? "asia-northeast1",
      keyRingId: process.env.KMS_KEY_RING ?? "all-contract-keyring",
      keyId: (orgData.kmsKeyId as string) ?? process.env.KMS_KEY_ID ?? "document-signing-key",
      storageBucket: process.env.STORAGE_BUCKET ?? "",
      tsaUrl: process.env.TSA_URL, // オプション
    };

    // 3. Cloud KMS でPDF全体に組織署名を付与
    const signResult = await signPdfWithKms(
      pdfBuffer,
      "", // 完了時は画像なし（既に各受信者の署名画像が埋め込み済み）
      `${envelopeData.title as string} - 電子署名完了`,
      kmsConfig
    );

    // 4. 署名済みPDFをCloud Storageにアップロード
    const signedPdfUrl = await uploadSignedPdf(
      signResult.signedPdfBuffer,
      envelopeId,
      kmsConfig.storageBucket
    );

    // 5. Firestoreの締結完了状態を更新（セキュリティルールにより以降は変更不可）
    const completedAt = Timestamp.now();
    await db.collection("envelopes").doc(envelopeId).update({
      signedPdfUrl,
      signedPdfSha256: signResult.signedPdfSha256,
      completedAt,
      "signatureInfo.kmsKeyName": signResult.padesMetadata.kmsKeyName,
      "signatureInfo.kmsKeyVersion": signResult.kmsKeyVersion,
      "signatureInfo.signatureAlgorithm": "RSA_SIGN_PSS_4096_SHA256",
      "signatureInfo.pdfSha256Hash": signResult.padesMetadata.pdfSha256Hash,
      "signatureInfo.signatureBase64": signResult.signatureBase64,
      "signatureInfo.publicKeyPem": signResult.publicKeyPem,
      "signatureInfo.padesSigningTime": signResult.padesMetadata.signingTime,
      "signatureInfo.timestampToken": signResult.padesMetadata.timestampToken ?? null,
      "signatureInfo.timestampAuthority": signResult.padesMetadata.timestampAuthority ?? null,
      updatedAt: FieldValue.serverTimestamp(),
    });

    // 6. 監査ログ記録
    await writeAuditLog({
      organizationId,
      envelopeId,
      action: "envelope.completed",
      details: {
        signedPdfUrl,
        signedPdfSha256: signResult.signedPdfSha256,
        kmsKeyVersion: signResult.kmsKeyVersion,
        pdfSha256Hash: signResult.padesMetadata.pdfSha256Hash,
        padesSigningTime: signResult.padesMetadata.signingTime,
        timestampAuthority: signResult.padesMetadata.timestampAuthority,
        ltMetadata: signResult.padesMetadata.ltMetadata,
      },
    });

    // 7. 全受信者と送信者に完了通知
    await sendCompletionNotifications(envelopeId, envelopeData, db);

    console.log(`[Finalize] 署名完了処理成功: ${envelopeId}`);
  } catch (err) {
    console.error(`[Finalize] 署名完了処理エラー: ${envelopeId}`, err);

    await writeAuditLog({
      organizationId,
      envelopeId,
      action: "security.tamper_detected",
      details: {
        error: err instanceof Error ? err.message : String(err),
        stage: "finalize_signed_document",
      },
    });

    throw err;
  }
}

/**
 * 完了通知を全関係者に送信
 */
async function sendCompletionNotifications(
  envelopeId: string,
  envelopeData: Record<string, unknown>,
  db: ReturnType<typeof getFirestore>
): Promise<void> {
  const recipientsSnapshot = await db
    .collection("envelopes")
    .doc(envelopeId)
    .collection("recipients")
    .orderBy("order", "asc")
    .get();

  const signers = recipientsSnapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      name: data.name as string,
      email: data.email as string,
      signedAt: data.signedAt ? (data.signedAt as Timestamp).toDate() : new Date(),
    };
  });

  const senderUid = envelopeData.createdBy as string;
  const senderDoc = await db.collection("users").doc(senderUid).get();
  const senderData = senderDoc.data() ?? {};

  await sendSignatureCompletedNotification(
    senderData.email as string,
    (senderData.displayName as string) ?? "送信者",
    envelopeData.title as string,
    envelopeId,
    signers
  );
}

/**
 * Cloud Storage から PDF をダウンロード
 */
async function downloadPdfFromStorage(gcsUrl: string): Promise<Buffer> {
  // gs://bucket/path 形式のURLを解析
  const gsMatch = gcsUrl.match(/^gs:\/\/([^/]+)\/(.+)$/);
  if (gsMatch) {
    const [, bucketName, filePath] = gsMatch;
    const bucket = getStorage().bucket(bucketName);
    const file = bucket.file(filePath);
    const [buffer] = await file.download();
    return buffer;
  }

  // HTTPSのURLの場合はfetchで取得
  const response = await fetch(gcsUrl);
  if (!response.ok) {
    throw new Error(`PDFダウンロード失敗: ${response.status}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
