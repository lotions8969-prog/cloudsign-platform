import { NextRequest, NextResponse } from "next/server";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { initAdminApp } from "../../../lib/firebaseAdmin";

export const dynamic = "force-dynamic";

initAdminApp();

export async function POST(req: NextRequest) {
  try {
    // 認証確認
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
    }

    const idToken = authHeader.slice(7);
    const decodedToken = await getAuth().verifyIdToken(idToken);
    const uid = decodedToken.uid;

    const body = await req.json();
    const { title, description, recipients, pdfUrl, pdfSha256, ebookkeepingIndex } = body;

    // バリデーション
    if (!title || !recipients?.length || !pdfUrl || !pdfSha256) {
      return NextResponse.json(
        { error: "必須パラメータが不足しています" },
        { status: 400 }
      );
    }

    // ユーザーの組織ID取得
    const db = getFirestore();
    const userDoc = await db.collection("users").doc(uid).get();
    if (!userDoc.exists) {
      return NextResponse.json({ error: "ユーザーが見つかりません" }, { status: 404 });
    }
    const organizationId = userDoc.data()!.organizationId as string;

    // エンベロープ作成
    const recipientEmails = (recipients as Array<{ email: string }>).map((r) => r.email);

    const envelopeRef = await db.collection("envelopes").add({
      organizationId,
      createdBy: uid,
      title,
      description: description ?? null,
      status: "sent", // 即時送信
      recipientEmails,
      originalPdfUrl: pdfUrl,
      originalPdfSha256: pdfSha256,
      signedPdfUrl: null,
      signedPdfSha256: null,
      signatureInfo: null,
      ebookkeepingIndex: {
        transactionDate: ebookkeepingIndex?.transactionDate ?? null,
        amount: ebookkeepingIndex?.amount ?? null,
        counterpartyName: ebookkeepingIndex?.counterpartyName ?? null,
        contractType: ebookkeepingIndex?.contractType ?? null,
        currency: "JPY",
        documentNumber: null,
      },
      tags: [],
      expiresAt: null,
      completedAt: null,
      voidedAt: null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    // 受信者をサブコレクションに追加
    const batch = db.batch();
    for (const recipient of recipients as Array<{ name: string; email: string; order: number }>) {
      const recipientRef = db
        .collection("envelopes")
        .doc(envelopeRef.id)
        .collection("recipients")
        .doc();

      batch.set(recipientRef, {
        envelopeId: envelopeRef.id,
        name: recipient.name,
        email: recipient.email,
        order: recipient.order,
        status: "pending",
        signedAt: null,
        ipAddress: null,
        userAgent: null,
        emailVerifiedAt: null,
        signatureImageUrl: null,
        accessToken: null,
        accessTokenExpiresAt: null,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();

    // 監査ログ記録
    await db.collection("auditLogs").add({
      organizationId,
      envelopeId: envelopeRef.id,
      action: "envelope.created",
      actorUid: uid,
      actorEmail: decodedToken.email,
      actorIp: req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? null,
      actorUserAgent: req.headers.get("user-agent") ?? null,
      details: {
        title,
        recipientCount: recipients.length,
        pdfSha256,
      },
      timestamp: FieldValue.serverTimestamp(),
      currentLogHash: "pending", // auditService でハッシュチェーン計算
      createdAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ envelopeId: envelopeRef.id }, { status: 201 });
  } catch (err) {
    console.error("[API Contracts POST] エラー:", err);
    return NextResponse.json(
      { error: "書類の作成に失敗しました" },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
    }

    const idToken = authHeader.slice(7);
    const decodedToken = await getAuth().verifyIdToken(idToken);
    const uid = decodedToken.uid;

    const db = getFirestore();
    const userDoc = await db.collection("users").doc(uid).get();
    const organizationId = userDoc.data()?.organizationId as string;

    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status");
    const limitParam = parseInt(searchParams.get("limit") ?? "20");

    let query = db
      .collection("envelopes")
      .where("organizationId", "==", organizationId)
      .orderBy("createdAt", "desc")
      .limit(Math.min(limitParam, 100));

    if (status) {
      query = query.where("status", "==", status) as typeof query;
    }

    const snapshot = await query.get();
    const envelopes = snapshot.docs.map((d) => ({
      id: d.id,
      ...d.data(),
      createdAt: d.data().createdAt?.toDate?.()?.toISOString() ?? null,
      updatedAt: d.data().updatedAt?.toDate?.()?.toISOString() ?? null,
      completedAt: d.data().completedAt?.toDate?.()?.toISOString() ?? null,
    }));

    return NextResponse.json({ envelopes });
  } catch (err) {
    console.error("[API Contracts GET] エラー:", err);
    return NextResponse.json({ error: "書類の取得に失敗しました" }, { status: 500 });
  }
}
