"use client";

import { useState, useEffect } from "react";
import { useParams, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";

const SignatureCanvas = dynamic(() => import("../../../../components/SignatureCanvas"), {
  ssr: false,
  loading: () => <div className="w-full h-48 bg-gray-100 rounded-lg animate-pulse" />,
});

interface EnvelopeInfo {
  id: string;
  title: string;
  description?: string;
  senderName: string;
  recipientName: string;
  pdfUrl: string;
  expiresAt?: string;
}

type SignStep = "loading" | "preview" | "signing" | "complete" | "error" | "expired" | "already_signed";

export default function SignPage() {
  const { id: envelopeId } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";

  const [step, setStep] = useState<SignStep>("loading");
  const [envelopeInfo, setEnvelopeInfo] = useState<EnvelopeInfo | null>(null);
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [signing, setSigning] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const isDemo = token === "demo";

  useEffect(() => {
    loadEnvelopeInfo();
  }, [envelopeId, token]);

  const loadEnvelopeInfo = async () => {
    // デモモード: URLパラメータからデータを取得（APIを呼ばない）
    if (isDemo) {
      const title = searchParams.get("title") ?? "電子署名書類";
      const recipientName = searchParams.get("recipient") ?? "受信者";
      const senderName = searchParams.get("sender") ?? "送信者";
      const description = searchParams.get("desc") ?? "";
      setEnvelopeInfo({
        id: envelopeId,
        title: decodeURIComponent(title),
        description: decodeURIComponent(description),
        senderName: decodeURIComponent(senderName),
        recipientName: decodeURIComponent(recipientName),
        pdfUrl: "",
      });
      setStep("signing");
      return;
    }

    try {
      const res = await fetch(`/api/sign?envelopeId=${envelopeId}&token=${token}`);
      if (res.status === 401) {
        setStep("error");
        setErrorMessage("このリンクは無効または期限切れです");
        return;
      }
      if (res.status === 409) {
        setStep("already_signed");
        return;
      }
      if (!res.ok) {
        throw new Error("書類情報の取得に失敗しました");
      }
      const data = await res.json();
      setEnvelopeInfo(data);
      setStep(data.status === "expired" ? "expired" : "preview");
    } catch (err) {
      setStep("error");
      setErrorMessage(err instanceof Error ? err.message : "エラーが発生しました");
    }
  };

  const handleSign = async () => {
    if (!signatureDataUrl || !agreed) return;
    setSigning(true);

    // デモモード: APIを呼ばず署名完了画面へ
    if (isDemo) {
      await new Promise((r) => setTimeout(r, 800));
      setSigning(false);
      setStep("complete");
      return;
    }

    try {
      const res = await fetch("/api/sign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          envelopeId,
          token,
          signatureImageBase64: signatureDataUrl,
        }),
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error ?? "署名処理に失敗しました");
      }
      setStep("complete");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "署名エラー");
    } finally {
      setSigning(false);
    }
  };

  // ローディング
  if (step === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-500">書類を読み込み中...</p>
        </div>
      </div>
    );
  }

  // エラー状態
  if (step === "error" || step === "expired") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="card p-8 text-center max-w-md">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">
            {step === "expired" ? "リンクの有効期限切れ" : "アクセスエラー"}
          </h2>
          <p className="text-gray-500 text-sm">
            {step === "expired"
              ? "この署名リンクの有効期限が切れています。送信者に再送を依頼してください。"
              : errorMessage}
          </p>
        </div>
      </div>
    );
  }

  // 署名済み
  if (step === "already_signed") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="card p-8 text-center max-w-md">
          <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">署名済みです</h2>
          <p className="text-gray-500 text-sm">この書類にはすでに署名済みです。</p>
        </div>
      </div>
    );
  }

  // 署名完了
  if (step === "complete") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="card p-8 text-center max-w-md">
          <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <svg className="w-10 h-10 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-3">署名が完了しました</h2>
          <p className="text-gray-600 mb-2">
            「{envelopeInfo?.title}」への電子署名が完了しました。
          </p>
          <p className="text-sm text-gray-500 mb-6">
            全員の署名が完了次第、署名済み書類がメールで送付されます。
          </p>
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-left text-xs text-gray-500 space-y-1">
            <p>✓ Cloud KMSによる電子署名が付与されました</p>
            <p>✓ 操作ログが不変保存されました</p>
            <p>✓ 電子署名法に準拠した有効な署名です</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ヘッダー */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2 text-blue-600 font-bold">
            <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zm-1 7V3.5L18.5 9H13z"/>
            </svg>
            ALL Contract
          </div>
          <div className="flex items-center gap-2">
            {isDemo && (
              <span className="bg-amber-100 text-amber-700 text-xs font-medium px-2 py-0.5 rounded-full">デモ</span>
            )}
            <span className="text-sm text-gray-500">電子署名</span>
          </div>
        </div>
      </div>

      <main className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        {/* 書類情報 */}
        <div className="card p-6">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
              <svg className="w-6 h-6 text-blue-600" fill="currentColor" viewBox="0 0 24 24">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zm-1 7V3.5L18.5 9H13z"/>
              </svg>
            </div>
            <div className="flex-1">
              <h1 className="text-xl font-bold text-gray-900">{envelopeInfo?.title}</h1>
              <p className="text-sm text-gray-500 mt-1">
                {envelopeInfo?.senderName} より署名依頼が届いています
              </p>
              {envelopeInfo?.description && (
                <p className="text-sm text-gray-700 mt-3 p-3 bg-gray-50 rounded-lg">
                  {envelopeInfo.description}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* PDFプレビュー */}
        {step === "preview" && (
          <>
            <div className="card overflow-hidden">
              <div className="bg-gray-100 border-b border-gray-200 px-4 py-2 flex items-center justify-between">
                <span className="text-sm font-medium text-gray-700">書類の内容を確認してください</span>
                <a
                  href={envelopeInfo?.pdfUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-blue-600 hover:underline flex items-center gap-1"
                >
                  新しいタブで開く
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </a>
              </div>
              <iframe
                src={envelopeInfo?.pdfUrl}
                className="w-full"
                style={{ height: "500px" }}
                title="契約書PDF"
              />
            </div>

            <div className="flex justify-end">
              <button
                onClick={() => setStep("signing")}
                className="btn-primary flex items-center gap-2"
              >
                内容を確認しました。署名へ進む
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          </>
        )}

        {/* 署名ステップ */}
        {step === "signing" && (
          <div className="card p-6 space-y-6">
            <h2 className="text-lg font-semibold">電子署名の実行</h2>
            {isDemo && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
                デモモードです。実際には署名データは保存されません。
              </div>
            )}

            <SignatureCanvas
              onConfirm={(dataUrl) => setSignatureDataUrl(dataUrl)}
              onClear={() => { setSignatureDataUrl(null); setAgreed(false); }}
              width={550}
              height={180}
            />

            {signatureDataUrl && (
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={agreed}
                  onChange={(e) => setAgreed(e.target.checked)}
                  className="w-4 h-4 mt-0.5 accent-blue-600"
                />
                <span className="text-sm text-gray-700">
                  この書類の内容を確認し、電子署名法に基づく電子署名として本署名を実行することに同意します。
                  本署名には法的効力があります。
                </span>
              </label>
            )}

            {errorMessage && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
                {errorMessage}
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => { setStep("preview"); setSignatureDataUrl(null); setAgreed(false); }}
                className="btn-secondary"
              >
                書類を再確認する
              </button>
              <button
                onClick={handleSign}
                disabled={!signatureDataUrl || !agreed || signing}
                className="btn-primary flex-1 flex items-center justify-center gap-2"
              >
                {signing ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    署名処理中（KMS署名付与中）...
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                    </svg>
                    電子署名を実行する
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
