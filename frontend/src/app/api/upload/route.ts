import { NextRequest, NextResponse } from "next/server";
import { Storage } from "@google-cloud/storage";
import * as crypto from "crypto";
import { getAdminAuth } from "../../../lib/firebaseAdmin";

export const dynamic = "force-dynamic";

function getStorage() {
  return new Storage({
    projectId: process.env.FIREBASE_PROJECT_ID,
    credentials: {
      client_email: process.env.FIREBASE_CLIENT_EMAIL,
      private_key: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    },
  });
}

export async function POST(req: NextRequest) {
  try {
    // 認証確認
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
    }

    const idToken = authHeader.slice(7);
    const { getAuth } = await import("firebase-admin/auth");
    await getAuth().verifyIdToken(idToken);

    // マルチパートフォームデータを取得
    const formData = await req.formData();
    const pdfFile = formData.get("pdf") as File | null;

    if (!pdfFile) {
      return NextResponse.json({ error: "PDFファイルが必要です" }, { status: 400 });
    }

    if (pdfFile.type !== "application/pdf") {
      return NextResponse.json({ error: "PDFファイルのみアップロード可能です" }, { status: 400 });
    }

    const maxSize = 50 * 1024 * 1024; // 50MB
    if (pdfFile.size > maxSize) {
      return NextResponse.json({ error: "ファイルサイズは50MB以下にしてください" }, { status: 400 });
    }

    // ファイルを Buffer に変換
    const arrayBuffer = await pdfFile.arrayBuffer();
    const pdfBuffer = Buffer.from(arrayBuffer);

    // SHA-256ハッシュを計算（改ざん検知用）
    const sha256 = crypto.createHash("sha256").update(pdfBuffer).digest("hex");

    // Cloud Storage にアップロード
    const bucketName = process.env.STORAGE_BUCKET ?? "";
    const bucket = getStorage().bucket(bucketName);
    const fileName = `original-pdfs/${Date.now()}_${sha256.substring(0, 8)}.pdf`;
    const file = bucket.file(fileName);

    await file.save(pdfBuffer, {
      contentType: "application/pdf",
      metadata: {
        contentType: "application/pdf",
        metadata: {
          originalName: pdfFile.name,
          sha256,
          uploadedAt: new Date().toISOString(),
        },
      },
    });

    // gs:// 形式のURLを返す（Functionsから直接アクセス用）
    const gcsUrl = `gs://${bucketName}/${fileName}`;

    // 署名付きURL（PDFプレビュー用、1時間有効）
    const [signedUrl] = await file.getSignedUrl({
      action: "read",
      expires: Date.now() + 60 * 60 * 1000,
    });

    return NextResponse.json({
      url: gcsUrl,
      previewUrl: signedUrl,
      sha256,
      fileName,
      size: pdfFile.size,
    });
  } catch (err) {
    console.error("[API Upload] エラー:", err);
    return NextResponse.json(
      { error: "アップロードに失敗しました" },
      { status: 500 }
    );
  }
}
