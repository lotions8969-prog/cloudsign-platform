/**
 * notificationService.ts
 * SendGrid を使用したメール通知サービス
 */

import sgMail from "@sendgrid/mail";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import * as crypto from "crypto";

sgMail.setApiKey(process.env.SENDGRID_API_KEY ?? "");

const FROM_EMAIL = process.env.FROM_EMAIL ?? "noreply@all-contract.example.com";
const APP_URL = process.env.APP_URL ?? "https://all-contract.example.com";

export interface NotificationData {
  envelopeId: string;
  envelopeTitle: string;
  senderName: string;
  senderEmail: string;
  recipientId: string;
  recipientName: string;
  recipientEmail: string;
  message?: string;
  expiresAt?: Date;
}

/**
 * ワンタイムアクセストークンを生成してFirestoreに保存
 */
async function generateAccessToken(
  envelopeId: string,
  recipientId: string,
  recipientEmail: string
): Promise<string> {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7日後

  await getFirestore()
    .collection("signatureTokens")
    .doc(token)
    .set({
      token,
      envelopeId,
      recipientId,
      recipientEmail,
      status: "active",
      createdAt: Timestamp.now(),
      expiresAt: Timestamp.fromDate(expiresAt),
      usedAt: null,
    });

  return token;
}

/**
 * 署名依頼メールを送信
 */
export async function sendSignatureRequest(data: NotificationData): Promise<void> {
  const accessToken = await generateAccessToken(
    data.envelopeId,
    data.recipientId,
    data.recipientEmail
  );

  const signUrl = `${APP_URL}/sign/${data.envelopeId}?token=${accessToken}`;
  const expiresText = data.expiresAt
    ? `この署名依頼は${data.expiresAt.toLocaleDateString("ja-JP")}まで有効です。`
    : "";

  const htmlContent = `
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: "Helvetica Neue", Arial, "Hiragino Kaku Gothic ProN", sans-serif; margin: 0; padding: 0; background: #f5f5f5; }
    .container { max-width: 600px; margin: 40px auto; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
    .header { background: #1a56db; padding: 32px; text-align: center; }
    .header h1 { color: white; margin: 0; font-size: 24px; }
    .body { padding: 40px; }
    .sender-info { background: #f8fafc; border-left: 4px solid #1a56db; padding: 16px; margin: 24px 0; border-radius: 0 4px 4px 0; }
    .btn { display: inline-block; background: #1a56db; color: white; padding: 16px 40px; border-radius: 6px; text-decoration: none; font-size: 16px; font-weight: bold; margin: 24px 0; }
    .expires { color: #666; font-size: 14px; margin-top: 16px; }
    .footer { background: #f8fafc; padding: 24px; text-align: center; color: #666; font-size: 12px; border-top: 1px solid #e5e7eb; }
    .security-notice { background: #fffbeb; border: 1px solid #fbbf24; border-radius: 6px; padding: 16px; margin-top: 24px; font-size: 13px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>ALL Contract - 電子署名依頼</h1>
    </div>
    <div class="body">
      <p>${data.recipientName} 様</p>
      <p>以下の電子契約書への署名をお願いいたします。</p>

      <div class="sender-info">
        <strong>送信者:</strong> ${data.senderName}（${data.senderEmail}）<br>
        <strong>書類名:</strong> ${data.envelopeTitle}
      </div>

      ${data.message ? `<p><strong>メッセージ:</strong><br>${data.message.replace(/\n/g, "<br>")}</p>` : ""}

      <center>
        <a href="${signUrl}" class="btn">署名する</a>
      </center>

      <p class="expires">${expiresText}</p>

      <div class="security-notice">
        <strong>セキュリティに関するご注意:</strong><br>
        このメールに心当たりがない場合は、無視してください。リンクをクリックするまで何も起こりません。
        このリンクはあなた専用です。第三者と共有しないでください。
      </div>
    </div>
    <div class="footer">
      このメールは ALL Contract プラットフォームから自動送信されています。<br>
      © ${new Date().getFullYear()} ALL Contract. All rights reserved.
    </div>
  </div>
</body>
</html>`;

  await sgMail.send({
    to: { name: data.recipientName, email: data.recipientEmail },
    from: { name: "ALL Contract", email: FROM_EMAIL },
    subject: `【署名依頼】${data.envelopeTitle}`,
    html: htmlContent,
    text: `${data.recipientName} 様\n\n${data.senderName}様より署名依頼が届きました。\n\n書類名: ${data.envelopeTitle}\n\n以下のURLから署名してください:\n${signUrl}\n\n${expiresText}`,
  });

  console.log(`[Notification] 署名依頼メール送信: ${data.recipientEmail}`);
}

/**
 * 署名完了通知メールを送信
 */
export async function sendSignatureCompletedNotification(
  senderEmail: string,
  senderName: string,
  envelopeTitle: string,
  envelopeId: string,
  signers: Array<{ name: string; email: string; signedAt: Date }>
): Promise<void> {
  const downloadUrl = `${APP_URL}/contracts/${envelopeId}`;

  const signersList = signers
    .map((s) => `<li>${s.name}（${s.email}）- ${s.signedAt.toLocaleString("ja-JP")}</li>`)
    .join("");

  const htmlContent = `
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: "Helvetica Neue", Arial, "Hiragino Kaku Gothic ProN", sans-serif; margin: 0; padding: 0; background: #f5f5f5; }
    .container { max-width: 600px; margin: 40px auto; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
    .header { background: #059669; padding: 32px; text-align: center; }
    .header h1 { color: white; margin: 0; font-size: 24px; }
    .body { padding: 40px; }
    .success-badge { background: #d1fae5; border: 1px solid #6ee7b7; border-radius: 6px; padding: 16px; margin: 24px 0; text-align: center; }
    .btn { display: inline-block; background: #059669; color: white; padding: 16px 40px; border-radius: 6px; text-decoration: none; font-size: 16px; font-weight: bold; margin: 24px 0; }
    .footer { background: #f8fafc; padding: 24px; text-align: center; color: #666; font-size: 12px; border-top: 1px solid #e5e7eb; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>✓ 電子署名 完了</h1>
    </div>
    <div class="body">
      <p>${senderName} 様</p>
      <div class="success-badge">
        <strong>「${envelopeTitle}」の署名がすべて完了しました</strong>
      </div>
      <p>署名者一覧:</p>
      <ul>${signersList}</ul>
      <center>
        <a href="${downloadUrl}" class="btn">署名済み書類を確認する</a>
      </center>
    </div>
    <div class="footer">
      このメールは ALL Contract プラットフォームから自動送信されています。<br>
      © ${new Date().getFullYear()} ALL Contract. All rights reserved.
    </div>
  </div>
</body>
</html>`;

  await sgMail.send({
    to: { name: senderName, email: senderEmail },
    from: { name: "ALL Contract", email: FROM_EMAIL },
    subject: `【署名完了】${envelopeTitle}`,
    html: htmlContent,
  });

  console.log(`[Notification] 署名完了通知送信: ${senderEmail}`);
}

/**
 * アクセストークンを検証する
 */
export async function validateAccessToken(
  token: string,
  envelopeId: string
): Promise<{ valid: boolean; recipientId?: string; recipientEmail?: string; reason?: string }> {
  const tokenDoc = await getFirestore()
    .collection("signatureTokens")
    .doc(token)
    .get();

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
