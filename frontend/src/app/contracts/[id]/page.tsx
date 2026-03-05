"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import Link from "next/link";
import { auth } from "../../../lib/firebase";
import {
  subscribeToEnvelope,
  getRecipients,
  getAuditTrail,
  getStatusLabel,
  getStatusColor,
  formatTimestamp,
} from "../../../lib/firestore";
import type { Envelope, Recipient, AuditLog } from "../../../types/schemas";

export default function ContractDetailPage() {
  const { id: envelopeId } = useParams<{ id: string }>();
  const router = useRouter();
  const [envelope, setEnvelope] = useState<Envelope | null>(null);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [activeTab, setActiveTab] = useState<"overview" | "recipients" | "audit">("overview");
  const [loading, setLoading] = useState(true);
  const [orgId, setOrgId] = useState("");

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) { router.replace("/login"); return; }

      // ユーザーの組織ID取得
      const { doc, getDoc } = await import("firebase/firestore");
      const { db } = await import("../../../lib/firebase");
      const userDoc = await getDoc(doc(db, "users", user.uid));
      const oid = userDoc.data()?.organizationId as string;
      setOrgId(oid);

      // 受信者・監査ログ取得
      const [r, logs] = await Promise.all([
        getRecipients(envelopeId),
        getAuditTrail(envelopeId, oid),
      ]);
      setRecipients(r);
      setAuditLogs(logs);
      setLoading(false);
    });

    // エンベロープをリアルタイム監視
    const unsubEnvelope = subscribeToEnvelope(envelopeId, (e) => setEnvelope(e));

    return () => { unsubscribe(); unsubEnvelope(); };
  }, [envelopeId, router]);

  if (loading || !envelope) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const signedCount = recipients.filter((r) => r.status === "signed").length;
  const progress = recipients.length > 0 ? (signedCount / recipients.length) * 100 : 0;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ナビゲーション */}
      <nav className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center gap-4">
          <Link href="/dashboard" className="text-blue-600 font-bold text-xl flex items-center gap-2">
            <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zm-1 7V3.5L18.5 9H13z"/>
            </svg>
            CloudSign
          </Link>
          <span className="text-gray-400">/</span>
          <Link href="/contracts" className="text-gray-500 hover:text-gray-700 text-sm">書類管理</Link>
          <span className="text-gray-400">/</span>
          <span className="text-gray-700 text-sm truncate max-w-xs">{envelope.title}</span>
        </div>
      </nav>

      <main className="max-w-5xl mx-auto px-4 py-8 space-y-6">
        {/* ヘッダー */}
        <div className="card p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-2">
                <h1 className="text-2xl font-bold text-gray-900">{envelope.title}</h1>
                <span className={`badge ${getStatusColor(envelope.status)}`}>
                  {getStatusLabel(envelope.status)}
                </span>
              </div>
              {envelope.description && (
                <p className="text-gray-500 text-sm">{envelope.description}</p>
              )}
              <p className="text-xs text-gray-400 mt-2">
                作成日時: {formatTimestamp(envelope.createdAt)}
              </p>
            </div>

            {/* アクションボタン */}
            <div className="flex gap-2 flex-shrink-0">
              {envelope.status === "completed" && envelope.signedPdfUrl && (
                <a
                  href={envelope.signedPdfUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-primary flex items-center gap-2 text-sm"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  署名済みPDFをダウンロード
                </a>
              )}
            </div>
          </div>

          {/* 署名進捗 */}
          <div className="mt-6">
            <div className="flex justify-between text-sm text-gray-600 mb-2">
              <span>署名進捗</span>
              <span>{signedCount} / {recipients.length} 名 完了</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className={`h-2 rounded-full transition-all duration-500 ${
                  progress === 100 ? "bg-green-500" : "bg-blue-500"
                }`}
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        </div>

        {/* タブ */}
        <div className="border-b border-gray-200">
          <div className="flex gap-6">
            {([
              { key: "overview", label: "概要" },
              { key: "recipients", label: `受信者 (${recipients.length})` },
              { key: "audit", label: `監査ログ (${auditLogs.length})` },
            ] as const).map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === key
                    ? "border-blue-600 text-blue-600"
                    : "border-transparent text-gray-500 hover:text-gray-700"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* 概要タブ */}
        {activeTab === "overview" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* 電子帳簿保存法情報 */}
            <div className="card p-6">
              <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <span className="w-2 h-2 bg-amber-400 rounded-full" />
                電子帳簿保存法 検索インデックス
              </h3>
              <dl className="space-y-3">
                <InfoRow label="取引年月日" value={envelope.ebookkeepingIndex?.transactionDate} />
                <InfoRow
                  label="金額"
                  value={envelope.ebookkeepingIndex?.amount?.toLocaleString("ja-JP", {
                    style: "currency",
                    currency: "JPY",
                  })}
                />
                <InfoRow label="取引先" value={envelope.ebookkeepingIndex?.counterpartyName} />
                <InfoRow label="契約種別" value={envelope.ebookkeepingIndex?.contractType} />
              </dl>
            </div>

            {/* 署名情報 */}
            <div className="card p-6">
              <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <span className="w-2 h-2 bg-blue-500 rounded-full" />
                デジタル署名情報
              </h3>
              {envelope.signatureInfo ? (
                <dl className="space-y-3">
                  <InfoRow label="署名アルゴリズム" value={envelope.signatureInfo.signatureAlgorithm} />
                  <InfoRow label="署名日時 (PAdES)" value={envelope.signatureInfo.padesSigningTime} />
                  <InfoRow
                    label="PDFハッシュ (SHA-256)"
                    value={`${envelope.signatureInfo.pdfSha256Hash?.substring(0, 16)}...`}
                  />
                  <InfoRow
                    label="TSAタイムスタンプ"
                    value={envelope.signatureInfo.timestampAuthority ?? "なし"}
                  />
                </dl>
              ) : (
                <p className="text-sm text-gray-400">署名完了後に表示されます</p>
              )}
            </div>

            {/* ハッシュ情報 */}
            <div className="card p-6 md:col-span-2">
              <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <span className="w-2 h-2 bg-green-500 rounded-full" />
                改ざん検知情報
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-gray-50 rounded-lg p-3">
                  <p className="text-xs text-gray-500 mb-1">原本PDF SHA-256</p>
                  <p className="font-mono text-xs text-gray-700 break-all">
                    {envelope.originalPdfSha256}
                  </p>
                </div>
                {envelope.signedPdfSha256 && (
                  <div className="bg-green-50 rounded-lg p-3">
                    <p className="text-xs text-gray-500 mb-1">署名済みPDF SHA-256</p>
                    <p className="font-mono text-xs text-gray-700 break-all">
                      {envelope.signedPdfSha256}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* 受信者タブ */}
        {activeTab === "recipients" && (
          <div className="card divide-y divide-gray-100">
            {recipients.map((recipient, index) => (
              <div key={recipient.id} className="flex items-center gap-4 p-4">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                  recipient.status === "signed" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"
                }`}>
                  {recipient.status === "signed" ? "✓" : index + 1}
                </div>
                <div className="flex-1">
                  <p className="font-medium text-gray-900">{recipient.name}</p>
                  <p className="text-sm text-gray-500">{recipient.email}</p>
                </div>
                <div className="text-right">
                  <span className={`badge ${getStatusColor(recipient.status)}`}>
                    {getStatusLabel(recipient.status)}
                  </span>
                  {recipient.signedAt && (
                    <p className="text-xs text-gray-400 mt-1">
                      {formatTimestamp(recipient.signedAt)}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 監査ログタブ */}
        {activeTab === "audit" && (
          <div className="card divide-y divide-gray-100">
            <div className="p-4 bg-blue-50 flex items-center gap-2 text-sm text-blue-700">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
              </svg>
              監査ログはハッシュチェーンで保護されており、電子帳簿保存法の真実性確保要件を満たします
            </div>
            {auditLogs.length === 0 ? (
              <div className="p-8 text-center text-gray-400">ログがありません</div>
            ) : (
              auditLogs.map((log) => (
                <div key={log.id} className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <span className="font-medium text-gray-800 text-sm">
                        {getActionLabel(log.action)}
                      </span>
                      {log.actorEmail && (
                        <span className="text-gray-500 text-xs ml-2">by {log.actorEmail}</span>
                      )}
                      {log.details && Object.keys(log.details).length > 0 && (
                        <details className="mt-2">
                          <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-600">
                            詳細を表示
                          </summary>
                          <pre className="text-xs text-gray-500 mt-1 bg-gray-50 p-2 rounded overflow-x-auto">
                            {JSON.stringify(log.details, null, 2)}
                          </pre>
                        </details>
                      )}
                    </div>
                    <p className="text-xs text-gray-400 flex-shrink-0">
                      {formatTimestamp(log.timestamp)}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </main>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string | undefined | null }) {
  return (
    <div className="flex justify-between">
      <dt className="text-sm text-gray-500">{label}</dt>
      <dd className="text-sm font-medium text-gray-900">{value ?? <span className="text-gray-300">未設定</span>}</dd>
    </div>
  );
}

function getActionLabel(action: string): string {
  const labels: Record<string, string> = {
    "envelope.created": "書類が作成されました",
    "envelope.sent": "署名依頼が送信されました",
    "envelope.viewed": "書類が閲覧されました",
    "envelope.signed": "署名が実行されました",
    "envelope.completed": "すべての署名が完了しました",
    "envelope.voided": "書類が無効化されました",
    "security.kms_sign_requested": "Cloud KMS署名が付与されました",
    "security.signature_verified": "署名が検証されました",
  };
  return labels[action] ?? action;
}
