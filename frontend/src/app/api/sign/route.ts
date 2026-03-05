import { NextRequest, NextResponse } from "next/server";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import * as crypto from "crypto";
import { initAdminApp } from "../../../lib/firebaseAdmin";
import { validateAccessToken } from "../../../../../../functions/src/services/notificationService";

initAdminApp();

// 署名ページの情報を取得（GET）
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const envelopeId = searchParams.get("envelopeId");
  const token = searchParams.get("token");

  if (!envelopeId || !token) {
    return NextResponse.json({ error: "パラメータが不足しています" }, { status: 400 });
  }

  try {
    // トークン検証
    const tokenValidation = await validateAccessToken(token, envelopeId);
    if (!tokenValidation.valid) {
      return NextResponse.json({ error: tokenValidation.reason }, { status: 401 });
    }

    const db = getFirestore();
    const envelopeDoc = await db.collection("envelopes").doc(envelopeId).get();

    if (!envelopeDoc.exists) {
      return NextResponse.json({ error: "書類が見つかりません" }, { status: 404 });
    }

    const envelopeData = envelopeDoc.data()!;

    // 期限切れチェック
    if (envelopeData.expiresAt && envelopeData.expiresAt.toDate() < new Date()) {
      return NextResponse.json({ status: "expired" }, { status: 200 });
    }

    // 受信者情報取得
    const recipientDoc = await db
      .collection("envelopes")
      .doc(envelopeId)
      .collection("recipients")
      .doc(tokenValidation.recipientId!)
      .get();

    if (!recipientDoc.exists) {
      return NextResponse.json({ error: "受信者情報が見つかりません" }, { status: 404 });
    }

    const recipientData = recipientDoc.data()!;

    // 署名済みチェック
    if (recipientData.status === "signed") {
      return NextResponse.json({ error: "already_signed" }, { status: 409 });
    }

    // 送信者情報取得
    const senderDoc = await db.collection("users").doc(envelopeData.createdBy).get();
    const senderName = senderDoc.data()?.displayName ?? senderDoc.data()?.email ?? "送信者";

    // PDFの署名付きURL生成
    const pdfUrl = envelopeData.originalPdfUrl as string;
    let previewUrl = pdfUrl;

    if (pdfUrl.startsWith("gs://")) {
      const match = pdfUrl.match(/^gs:\/\/([^/]+)\/(.+)$/);
      if (match) {
        const [, bucketName, filePath] = match;
        const bucket = getStorage().bucket(bucketName);
        const [signedUrl] = await bucket.file(filePath).getSignedUrl({
          action: "read",
          expires: Date.now() + 2 * 60 * 60 * 1000, // 2時間
        });
        previewUrl = signedUrl;
      }
    }

    // 閲覧ログを記録
    await db
      .collection("envelopes")
      .doc(envelopeId)
      .collection("recipients")
      .doc(tokenValidation.recipientId!)
      .update({
        status: "viewed",
        updatedAt: FieldValue.serverTimestamp(),
      });

    return NextResponse.json({
      id: envelopeId,
      title: envelopeData.title,
      description: envelopeData.description ?? null,
      senderName,
      recipientName: recipientData.name,
      recipientId: tokenValidation.recipientId,
      pdfUrl: previewUrl,
      status: envelopeData.status,
      expiresAt: envelopeData.expiresAt?.toDate?.()?.toISOString() ?? null,
    });
  } catch (err) {
    console.error("[API Sign GET] エラー:", err);
    return NextResponse.json({ error: "書類情報の取得に失敗しました" }, { status: 500 });
  }
}

// 署名実行（POST）
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { envelopeId, token, signatureImageBase64 } = body;

    if (!envelopeId || !token || !signatureImageBase64) {
      return NextResponse.json({ error: "必須パラメータが不足しています" }, { status: 400 });
    }

    // トークン検証
    const tokenValidation = await validateAccessToken(token, envelopeId);
    if (!tokenValidation.valid) {
      return NextResponse.json({ error: tokenValidation.reason }, { status: 401 });
    }

    const db = getFirestore();
    const envelopeDoc = await db.collection("envelopes").doc(envelopeId).get();
    if (!envelopeDoc.exists) {
      return NextResponse.json({ error: "書類が見つかりません" }, { status: 404 });
    }

    const envelopeData = envelopeDoc.data()!;
    const organizationId = envelopeData.organizationId as string;

    // 受信者を署名済みに更新
    const ipAddress = req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? null;
    const userAgent = req.headers.get("user-agent") ?? null;
    const signedAt = FieldValue.serverTimestamp();

    await db
      .collection("envelopes")
      .doc(envelopeId)
      .collection("recipients")
      .doc(tokenValidation.recipientId!)
      .update({
        status: "signed",
        signedAt,
        ipAddress,
        userAgent,
        signatureImageUrl: `data:image/png;base64,${signatureImageBase64.replace(/^data:image\/(png|jpeg);base64,/, "")}`,
        updatedAt: FieldValue.serverTimestamp(),
      });

    // トークンを使用済みに更新
    await db.collection("signatureTokens").doc(token).update({
      status: "used",
      usedAt: FieldValue.serverTimestamp(),
    });

    // 全受信者の署名状況を確認
    const recipientsSnapshot = await db
      .collection("envelopes")
      .doc(envelopeId)
      .collection("recipients")
      .get();

    const allRecipients = recipientsSnapshot.docs.map((d) => d.data());
    const pendingRecipients = allRecipients.filter((r) => r.status === "pending");
    const signedRecipients = allRecipients.filter((r) => r.status === "signed");

    // エンベロープステータスを更新
    if (pendingRecipients.length === 0) {
      // 全員署名完了 → completed
      await db.collection("envelopes").doc(envelopeId).update({
        status: "completed",
        completedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    } else {
      // 次の署名者がいる → in_progress
      await db.collection("envelopes").doc(envelopeId).update({
        status: "in_progress",
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    // 署名監査ログを記録
    await db.collection("auditLogs").add({
      organizationId,
      envelopeId,
      recipientId: tokenValidation.recipientId,
      action: "envelope.signed",
      actorEmail: tokenValidation.recipientEmail,
      actorIp: ipAddress,
      actorUserAgent: userAgent,
      details: {
        recipientEmail: tokenValidation.recipientEmail,
        allSignedCount: signedRecipients.length + 1,
        totalRecipients: allRecipients.length,
        pendingCount: pendingRecipients.length,
        pdfSha256: envelopeData.originalPdfSha256,
      },
      timestamp: FieldValue.serverTimestamp(),
      currentLogHash: crypto.randomBytes(16).toString("hex"), // Functionsで本番ハッシュに置換
      createdAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({
      success: true,
      allCompleted: pendingRecipients.length === 0,
    });
  } catch (err) {
    console.error("[API Sign POST] エラー:", err);
    return NextResponse.json({ error: "署名処理に失敗しました" }, { status: 500 });
  }
}
