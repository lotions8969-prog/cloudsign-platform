import { NextRequest, NextResponse } from "next/server";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { initAdminApp } from "../../../../lib/firebaseAdmin";

export const dynamic = "force-dynamic";

initAdminApp();

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
    }

    const idToken = authHeader.slice(7);
    const decodedToken = await getAuth().verifyIdToken(idToken);
    const uid = decodedToken.uid;

    const db = getFirestore();
    const envelopeRef = db.collection("envelopes").doc(params.id);
    const envelopeDoc = await envelopeRef.get();

    if (!envelopeDoc.exists) {
      return NextResponse.json({ error: "書類が見つかりません" }, { status: 404 });
    }

    const data = envelopeDoc.data()!;

    // 権限チェック: 作成者のみ削除可能
    if (data.createdBy !== uid) {
      return NextResponse.json({ error: "削除権限がありません" }, { status: 403 });
    }

    // completed の場合は削除不可（電子帳簿保存法）
    if (data.status === "completed") {
      return NextResponse.json(
        { error: "締結完了済みの書類は削除できません（電子帳簿保存法）" },
        { status: 400 }
      );
    }

    // 論理削除（voided に変更）
    await envelopeRef.update({
      status: "voided",
      voidedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    // 監査ログ
    const userDoc = await db.collection("users").doc(uid).get();
    const organizationId = userDoc.data()?.organizationId as string;
    await db.collection("auditLogs").add({
      organizationId,
      envelopeId: params.id,
      action: "envelope.voided",
      actorUid: uid,
      actorEmail: decodedToken.email,
      details: { reason: "ユーザーによる削除" },
      timestamp: FieldValue.serverTimestamp(),
      currentLogHash: "pending",
      createdAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[API Contracts DELETE] エラー:", err);
    return NextResponse.json({ error: "削除に失敗しました" }, { status: 500 });
  }
}
