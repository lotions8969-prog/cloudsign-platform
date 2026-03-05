import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json({ error: "メール送信が設定されていません" }, { status: 503 });
  }
  const resend = new Resend(process.env.RESEND_API_KEY);

  try {
    const { to, recipientName, contractTitle, senderEmail, description, signUrl } = await req.json();

    if (!to || !recipientName || !contractTitle) {
      return NextResponse.json({ error: "必須パラメータが不足しています" }, { status: 400 });
    }

    const html = `
<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>署名依頼 - ALL Contract</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:'Hiragino Kaku Gothic Pro',Meiryo,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:40px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.1);">
        <!-- Header -->
        <tr>
          <td style="background:#2563eb;padding:28px 32px;">
            <table cellpadding="0" cellspacing="0">
              <tr>
                <td>
                  <span style="color:#ffffff;font-size:20px;font-weight:bold;">ALL Contract</span>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:36px 32px;">
            <p style="margin:0 0 8px;font-size:16px;color:#374151;">${recipientName} 様</p>
            <p style="margin:0 0 24px;font-size:15px;color:#6b7280;">
              ${senderEmail} より電子署名のご依頼が届いています。
            </p>

            <div style="background:#eff6ff;border-left:4px solid #2563eb;padding:16px 20px;border-radius:4px;margin-bottom:24px;">
              <p style="margin:0 0 4px;font-size:13px;color:#6b7280;">書類名</p>
              <p style="margin:0;font-size:17px;font-weight:bold;color:#1e40af;">${contractTitle}</p>
              ${description ? `<p style="margin:8px 0 0;font-size:14px;color:#374151;">${description}</p>` : ""}
            </div>

            <p style="margin:0 0 20px;font-size:14px;color:#6b7280;line-height:1.6;">
              下記のボタンをクリックして書類の内容をご確認の上、電子署名をお願いいたします。
            </p>

            <table cellpadding="0" cellspacing="0" style="margin:0 auto 28px;">
              <tr>
                <td align="center" style="background:#2563eb;border-radius:8px;">
                  <a href="${signUrl}" style="display:inline-block;padding:14px 32px;color:#ffffff;text-decoration:none;font-size:16px;font-weight:bold;">
                    電子署名する
                  </a>
                </td>
              </tr>
            </table>

            <p style="margin:0;font-size:13px;color:#9ca3af;">
              ボタンが機能しない場合は以下のURLにアクセスしてください：<br>
              <a href="${signUrl}" style="color:#2563eb;word-break:break-all;">${signUrl}</a>
            </p>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="background:#f9fafb;padding:20px 32px;border-top:1px solid #e5e7eb;">
            <p style="margin:0;font-size:12px;color:#9ca3af;text-align:center;">
              このメールはALL Contractから自動送信されています。
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

    const { data, error } = await resend.emails.send({
      from: "ALL Contract <onboarding@resend.dev>",
      to: [to],
      subject: `【署名依頼】${contractTitle}`,
      html,
    });

    if (error) {
      console.error("[send-email] Resend error:", error);
      return NextResponse.json({ error: "メール送信に失敗しました", detail: error }, { status: 500 });
    }

    return NextResponse.json({ success: true, messageId: data?.id });
  } catch (err) {
    console.error("[send-email] Error:", err);
    return NextResponse.json({ error: "メール送信中にエラーが発生しました" }, { status: 500 });
  }
}
