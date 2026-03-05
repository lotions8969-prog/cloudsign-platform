"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useDropzone } from "react-dropzone";
import { getDemoSession, isDemoConfigured } from "../../../lib/demoAuth";

interface RecipientInput {
  name: string;
  email: string;
  order: number;
}

interface EmailResult {
  name: string;
  email: string;
  status: "sending" | "sent" | "failed" | "unconfigured";
  signUrl: string;
}

export default function NewContractPage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [recipients, setRecipients] = useState<RecipientInput[]>([
    { name: "", email: "", order: 1 },
  ]);
  const [counterpartyName, setCounterpartyName] = useState("");
  const [transactionDate, setTransactionDate] = useState("");
  const [amount, setAmount] = useState("");
  const [contractType, setContractType] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [createdEnvelopeId, setCreatedEnvelopeId] = useState("");
  const [emailResults, setEmailResults] = useState<EmailResult[]>([]);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (file && file.type === "application/pdf") {
      setPdfFile(file);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "application/pdf": [".pdf"] },
    maxFiles: 1,
    maxSize: 50 * 1024 * 1024,
  });

  const addRecipient = () => {
    setRecipients((prev) => [
      ...prev,
      { name: "", email: "", order: prev.length + 1 },
    ]);
  };

  const removeRecipient = (index: number) => {
    setRecipients((prev) =>
      prev.filter((_, i) => i !== index).map((r, i) => ({ ...r, order: i + 1 }))
    );
  };

  const updateRecipient = (index: number, field: keyof RecipientInput, value: string) => {
    setRecipients((prev) =>
      prev.map((r, i) => (i === index ? { ...r, [field]: value } : r))
    );
  };

  const buildSignUrl = (envelopeId: string, recipientName: string, senderEmail: string): string => {
    const origin = window.location.origin;
    const params = new URLSearchParams({
      token: "demo",
      title: title,
      recipient: recipientName,
      sender: senderEmail,
      desc: description || "",
    });
    return `${origin}/contracts/${envelopeId}/sign?${params.toString()}`;
  };

  const sendEmails = async (envelopeId: string, senderEmail: string): Promise<EmailResult[]> => {
    const results: EmailResult[] = recipients.map((r) => ({
      name: r.name,
      email: r.email,
      status: "sending" as const,
      signUrl: buildSignUrl(envelopeId, r.name, senderEmail),
    }));
    setEmailResults([...results]);

    for (let i = 0; i < recipients.length; i++) {
      const recipient = recipients[i];
      const signUrl = buildSignUrl(envelopeId, recipient.name, senderEmail);
      try {
        const res = await fetch("/api/send-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to: recipient.email,
            recipientName: recipient.name,
            contractTitle: title,
            senderEmail,
            description,
            signUrl,
          }),
        });
        if (res.ok) {
          results[i] = { ...results[i], status: "sent", signUrl };
        } else {
          results[i] = {
            ...results[i],
            status: res.status === 503 ? "unconfigured" : "failed",
            signUrl,
          };
        }
      } catch {
        results[i] = { ...results[i], status: "failed", signUrl };
      }
      setEmailResults([...results]);
    }
    return results;
  };

  const handleSubmit = async () => {
    if (!pdfFile || !title || recipients.some((r) => !r.name || !r.email)) {
      setError("必須項目を入力してください");
      return;
    }

    setLoading(true);
    setError("");

    try {
      // デモモード
      if (isDemoConfigured() || getDemoSession()) {
        await new Promise((r) => setTimeout(r, 400));
        const demoId = `env_demo_${Date.now()}`;

        const existing = JSON.parse(localStorage.getItem("demo_contracts") || "[]");
        existing.unshift({
          id: demoId,
          title,
          description,
          status: "sent",
          recipientEmails: recipients.map((r) => r.email),
          ebookkeepingIndex: {
            transactionDate: transactionDate || null,
            amount: amount ? Number(amount) : null,
            counterpartyName: counterpartyName || null,
            contractType: contractType || null,
            currency: "JPY",
          },
          recipients,
          pdfFileName: pdfFile.name,
          createdAt: new Date().toISOString(),
        });
        localStorage.setItem("demo_contracts", JSON.stringify(existing));
        setCreatedEnvelopeId(demoId);
        setLoading(false);

        // メール送信（結果をStep4で表示）
        await sendEmails(demoId, "demo@allcontract.com");
        setStep(4);
        return;
      }

      // 本番モード
      const { getAuth } = await import("firebase/auth");
      const currentUser = getAuth().currentUser;
      if (!currentUser) throw new Error("ログインが必要です");
      const idToken = await currentUser.getIdToken();

      const formData = new FormData();
      formData.append("pdf", pdfFile);
      const uploadRes = await fetch("/api/upload", {
        method: "POST",
        headers: { Authorization: `Bearer ${idToken}` },
        body: formData,
      });
      if (!uploadRes.ok) throw new Error("PDFのアップロードに失敗しました");
      const { url: pdfUrl, sha256: pdfSha256 } = await uploadRes.json();

      const createRes = await fetch("/api/contracts", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({
          title,
          description,
          recipients,
          pdfUrl,
          pdfSha256,
          ebookkeepingIndex: {
            transactionDate: transactionDate || undefined,
            amount: amount ? Number(amount) : undefined,
            counterpartyName: counterpartyName || undefined,
            contractType: contractType || undefined,
          },
        }),
      });
      if (!createRes.ok) {
        const errData = await createRes.json();
        throw new Error(errData.error ?? "書類の作成に失敗しました");
      }
      const { envelopeId } = await createRes.json();
      setCreatedEnvelopeId(envelopeId);
      setLoading(false);

      await sendEmails(envelopeId, currentUser.email ?? "送信者");
      setStep(4);
    } catch (err) {
      setError(err instanceof Error ? err.message : "エラーが発生しました");
      setLoading(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
  };

  const stepLabels = [
    { num: 1, label: "書類のアップロード" },
    { num: 2, label: "受信者の設定" },
    { num: 3, label: "電子帳簿保存法情報" },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white border-b border-gray-200">
        <div className="max-w-4xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/dashboard" className="text-blue-600 font-bold text-xl flex items-center gap-2">
              <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zm-1 7V3.5L18.5 9H13z"/>
              </svg>
              ALL Contract
            </Link>
            <span className="text-gray-400">/</span>
            <span className="text-gray-700">新しい書類を作成</span>
          </div>
        </div>
      </nav>

      {step < 4 && (
        <div className="bg-white border-b border-gray-200">
          <div className="max-w-4xl mx-auto px-4 py-4">
            <div className="flex items-center gap-4">
              {stepLabels.map(({ num, label }) => (
                <div key={num} className="flex items-center gap-2">
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold ${
                    step > num ? "bg-green-500 text-white" : step === num ? "bg-blue-600 text-white" : "bg-gray-200 text-gray-500"
                  }`}>
                    {step > num ? "✓" : num}
                  </div>
                  <span className={`text-sm ${step >= num ? "text-gray-900 font-medium" : "text-gray-400"}`}>
                    {label}
                  </span>
                  {num < 3 && <div className="w-8 h-px bg-gray-200 ml-2" />}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <main className="max-w-4xl mx-auto px-4 py-8">
        {/* Step 1 */}
        {step === 1 && (
          <div className="card p-8 space-y-6">
            <h2 className="text-xl font-semibold">書類のアップロード</h2>
            <div>
              <label className="label">書類タイトル <span className="text-red-500">*</span></label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="input"
                placeholder="例: 業務委託契約書_2024年度"
              />
            </div>
            <div>
              <label className="label">説明・メッセージ（受信者に表示）</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="input h-24 resize-none"
                placeholder="契約内容についてのメッセージ..."
              />
            </div>
            <div>
              <label className="label">PDFファイル <span className="text-red-500">*</span></label>
              <div
                {...getRootProps()}
                className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors ${
                  isDragActive ? "border-blue-500 bg-blue-50" : pdfFile ? "border-green-500 bg-green-50" : "border-gray-300 hover:border-blue-400 hover:bg-gray-50"
                }`}
              >
                <input {...getInputProps()} />
                {pdfFile ? (
                  <div className="flex items-center justify-center gap-3">
                    <svg className="w-8 h-8 text-green-600" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zm-1 7V3.5L18.5 9H13z"/>
                    </svg>
                    <div className="text-left">
                      <p className="font-medium text-green-700">{pdfFile.name}</p>
                      <p className="text-sm text-green-600">{(pdfFile.size / 1024 / 1024).toFixed(2)} MB</p>
                    </div>
                    <button type="button" onClick={(e) => { e.stopPropagation(); setPdfFile(null); }} className="ml-4 text-gray-400 hover:text-red-500">✕</button>
                  </div>
                ) : (
                  <>
                    <svg className="w-10 h-10 text-gray-400 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                    <p className="text-gray-600 font-medium">{isDragActive ? "ここにドロップ" : "クリックまたはドラッグ＆ドロップ"}</p>
                    <p className="text-sm text-gray-400 mt-1">PDF形式 / 最大50MB</p>
                  </>
                )}
              </div>
            </div>
            <div className="flex justify-end">
              <button onClick={() => setStep(2)} disabled={!title || !pdfFile} className="btn-primary">
                次へ：受信者の設定
              </button>
            </div>
          </div>
        )}

        {/* Step 2 */}
        {step === 2 && (
          <div className="card p-8 space-y-6">
            <h2 className="text-xl font-semibold">受信者の設定</h2>
            <p className="text-sm text-gray-500">設定した順番に署名依頼メールが送信されます（順次署名）</p>
            <div className="space-y-4">
              {recipients.map((recipient, index) => (
                <div key={index} className="flex gap-3 items-start">
                  <div className="w-7 h-7 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-sm font-bold flex-shrink-0 mt-2">{index + 1}</div>
                  <div className="flex-1 grid grid-cols-2 gap-3">
                    <div>
                      <label className="label">氏名 *</label>
                      <input type="text" value={recipient.name} onChange={(e) => updateRecipient(index, "name", e.target.value)} className="input" placeholder="山田 太郎" />
                    </div>
                    <div>
                      <label className="label">メールアドレス *</label>
                      <input type="email" value={recipient.email} onChange={(e) => updateRecipient(index, "email", e.target.value)} className="input" placeholder="yamada@example.com" />
                    </div>
                  </div>
                  {recipients.length > 1 && (
                    <button type="button" onClick={() => removeRecipient(index)} className="mt-7 text-gray-400 hover:text-red-500 transition-colors">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button type="button" onClick={addRecipient} disabled={recipients.length >= 20} className="btn-secondary flex items-center gap-2 text-sm">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              受信者を追加
            </button>
            <div className="flex justify-between">
              <button onClick={() => setStep(1)} className="btn-secondary">戻る</button>
              <button onClick={() => setStep(3)} disabled={recipients.some((r) => !r.name || !r.email)} className="btn-primary">
                次へ：書類情報の入力
              </button>
            </div>
          </div>
        )}

        {/* Step 3 */}
        {step === 3 && (
          <div className="card p-8 space-y-6">
            <div>
              <h2 className="text-xl font-semibold">電子帳簿保存法対応情報</h2>
              <p className="text-sm text-gray-500 mt-1">電子帳簿保存法第7条に基づき、検索に必要な情報を入力してください</p>
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800">
              <strong>法令対応:</strong> 以下の3項目（日付・金額・取引先）は電子帳簿保存法が定める必須検索キーです。可能な限り入力してください。
            </div>
            <div className="grid grid-cols-2 gap-6">
              <div>
                <label className="label">取引年月日 <span className="text-amber-600 text-xs">（推奨）</span></label>
                <input type="date" value={transactionDate} onChange={(e) => setTransactionDate(e.target.value)} className="input" />
              </div>
              <div>
                <label className="label">金額（円） <span className="text-amber-600 text-xs">（推奨）</span></label>
                <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className="input" placeholder="1000000" min="0" />
              </div>
              <div>
                <label className="label">取引先名 <span className="text-amber-600 text-xs">（推奨）</span></label>
                <input type="text" value={counterpartyName} onChange={(e) => setCounterpartyName(e.target.value)} className="input" placeholder="株式会社サンプル" />
              </div>
              <div>
                <label className="label">契約種別</label>
                <select value={contractType} onChange={(e) => setContractType(e.target.value)} className="input">
                  <option value="">選択してください</option>
                  <option value="売買契約">売買契約</option>
                  <option value="業務委託契約">業務委託契約</option>
                  <option value="秘密保持契約">秘密保持契約（NDA）</option>
                  <option value="雇用契約">雇用契約</option>
                  <option value="賃貸借契約">賃貸借契約</option>
                  <option value="請負契約">請負契約</option>
                  <option value="その他">その他</option>
                </select>
              </div>
            </div>
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>
            )}
            <div className="flex justify-between">
              <button onClick={() => setStep(2)} className="btn-secondary">戻る</button>
              <button onClick={handleSubmit} disabled={loading} className="btn-primary flex items-center gap-2">
                {loading ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    作成中...
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                    </svg>
                    署名依頼を送信する
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* Step 4: 送信結果 */}
        {step === 4 && (
          <div className="space-y-6">
            {/* 完了ヘッダー */}
            <div className="card p-6 flex items-center gap-4">
              <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0">
                <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div>
                <h2 className="text-xl font-semibold text-gray-900">書類を作成しました</h2>
                <p className="text-sm text-gray-500 mt-0.5">{title}</p>
              </div>
            </div>

            {/* メール送信結果 */}
            <div className="card p-6">
              <h3 className="font-semibold text-gray-900 mb-4">署名依頼の送信状況</h3>
              <div className="space-y-3">
                {emailResults.map((result, i) => (
                  <div key={i} className="border border-gray-100 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-3">
                        {result.status === "sending" && (
                          <span className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin inline-block" />
                        )}
                        {result.status === "sent" && (
                          <span className="w-5 h-5 bg-green-500 rounded-full flex items-center justify-center">
                            <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                            </svg>
                          </span>
                        )}
                        {(result.status === "failed" || result.status === "unconfigured") && (
                          <span className="w-5 h-5 bg-orange-400 rounded-full flex items-center justify-center">
                            <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </span>
                        )}
                        <div>
                          <p className="font-medium text-gray-900 text-sm">{result.name}</p>
                          <p className="text-xs text-gray-500">{result.email}</p>
                        </div>
                      </div>
                      <span className={`text-xs font-medium px-2 py-1 rounded-full ${
                        result.status === "sent" ? "bg-green-100 text-green-700" :
                        result.status === "sending" ? "bg-blue-100 text-blue-700" :
                        "bg-orange-100 text-orange-700"
                      }`}>
                        {result.status === "sent" ? "メール送信済み" :
                         result.status === "sending" ? "送信中..." :
                         result.status === "unconfigured" ? "メール未設定" : "送信失敗"}
                      </span>
                    </div>

                    {/* メール未設定 or 失敗の場合は署名URLを表示 */}
                    {(result.status === "failed" || result.status === "unconfigured") && (
                      <div className="mt-3 bg-gray-50 rounded-lg p-3">
                        <p className="text-xs text-gray-500 mb-1">
                          {result.status === "unconfigured"
                            ? "メールサービスが未設定のため、以下のURLを受信者に直接共有してください："
                            : "メール送信に失敗しました。以下のURLを受信者に直接共有してください："}
                        </p>
                        <div className="flex items-center gap-2">
                          <input
                            readOnly
                            value={result.signUrl}
                            className="flex-1 text-xs bg-white border border-gray-200 rounded px-2 py-1.5 text-gray-700 font-mono"
                          />
                          <button
                            onClick={() => copyToClipboard(result.signUrl)}
                            className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors flex-shrink-0"
                          >
                            コピー
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Resend未設定の場合の設定案内 */}
              {emailResults.some((r) => r.status === "unconfigured") && (
                <div className="mt-4 bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm">
                  <p className="font-semibold text-blue-800 mb-1">メール送信を有効にする方法</p>
                  <ol className="text-blue-700 space-y-1 list-decimal list-inside text-xs">
                    <li><a href="https://resend.com" target="_blank" rel="noopener noreferrer" className="underline">resend.com</a> で無料アカウントを作成</li>
                    <li>API Keys ページでAPIキーを発行</li>
                    <li>Vercelダッシュボード → Settings → Environment Variables</li>
                    <li><code className="bg-blue-100 px-1 rounded">RESEND_API_KEY</code> = <code className="bg-blue-100 px-1 rounded">re_xxxxxxxx</code> を追加して Redeploy</li>
                  </ol>
                </div>
              )}
            </div>

            <div className="flex gap-3 justify-end">
              <Link href="/contracts" className="btn-secondary">
                書類一覧へ
              </Link>
              <Link href={`/contracts/${createdEnvelopeId}`} className="btn-primary">
                書類の詳細を確認
              </Link>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
