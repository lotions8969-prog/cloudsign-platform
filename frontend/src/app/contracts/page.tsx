"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import Link from "next/link";
import { auth, db } from "../../lib/firebase";
import { searchEnvelopes, getStatusLabel, getStatusColor, formatTimestamp } from "../../lib/firestore";
import { getDemoSession, getAllDemoEnvelopes, isDemoConfigured, deleteDemoEnvelope } from "../../lib/demoAuth";
import type { Envelope, EnvelopeStatus } from "../../types/schemas";

export default function ContractsPage() {
  const router = useRouter();
  const [envelopes, setEnvelopes] = useState<Envelope[]>([]);
  const [orgId, setOrgId] = useState("");
  const [loading, setLoading] = useState(true);
  const [isDemo, setIsDemo] = useState(false);
  const [filterStatus, setFilterStatus] = useState<EnvelopeStatus | "">("");
  const [searchCounterparty, setSearchCounterparty] = useState("");
  const [searchDateFrom, setSearchDateFrom] = useState("");
  const [searchDateTo, setSearchDateTo] = useState("");

  useEffect(() => {
    const demoSession = getDemoSession();
    if (demoSession) {
      setIsDemo(true);
      setEnvelopes(getAllDemoEnvelopes() as unknown as Envelope[]);
      setLoading(false);
      return;
    }
    if (isDemoConfigured()) { router.replace("/login"); return; }

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) { router.replace("/login"); return; }
      const userDoc = await getDoc(doc(db, "users", user.uid));
      const oid = userDoc.data()?.organizationId as string;
      setOrgId(oid);
      await loadEnvelopes(oid, "", "", "", "");
      setLoading(false);
    });
    return unsubscribe;
  }, [router]);

  const loadEnvelopes = async (oid: string, status: string, counterparty: string, dateFrom: string, dateTo: string) => {
    const result = await searchEnvelopes({
      organizationId: oid,
      status: status as EnvelopeStatus || undefined,
      counterpartyName: counterparty || undefined,
      transactionDateFrom: dateFrom || undefined,
      transactionDateTo: dateTo || undefined,
      limit: 50,
    });
    setEnvelopes(result.envelopes);
  };

  const handleDelete = async (e: React.MouseEvent, envelopeId: string, status: string) => {
    e.preventDefault();
    if (!confirm("この書類を削除しますか？")) return;
    if (isDemo || isDemoConfigured()) {
      deleteDemoEnvelope(envelopeId);
      setEnvelopes((prev) => prev.filter((env) => env.id !== envelopeId));
      return;
    }
    try {
      const { getAuth } = await import("firebase/auth");
      const currentUser = getAuth().currentUser;
      if (!currentUser) return;
      const idToken = await currentUser.getIdToken();
      const res = await fetch(`/api/contracts/${envelopeId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (res.ok) {
        setEnvelopes((prev) => prev.filter((env) => env.id !== envelopeId));
      } else {
        const err = await res.json();
        alert(err.error ?? "削除に失敗しました");
      }
    } catch {
      alert("削除に失敗しました");
    }
  };

  const handleSearch = () => {
    if (isDemo) {
      // デモ: クライアント側フィルター
      let filtered = getAllDemoEnvelopes() as unknown as Envelope[];
      if (filterStatus) filtered = filtered.filter((e) => e.status === filterStatus);
      if (searchCounterparty) filtered = filtered.filter((e) => e.ebookkeepingIndex?.counterpartyName?.includes(searchCounterparty));
      setEnvelopes(filtered);
      return;
    }
    if (!orgId) return;
    loadEnvelopes(orgId, filterStatus, searchCounterparty, searchDateFrom, searchDateTo);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Link href="/dashboard" className="text-blue-600 font-bold text-xl flex items-center gap-2">
              <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zm-1 7V3.5L18.5 9H13z"/>
              </svg>
              ALL Contract
            </Link>
            <span className="text-gray-700 font-medium">書類管理</span>
          </div>
          <Link href="/contracts/new" className="btn-primary flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            新しい書類
          </Link>
        </div>
      </nav>

      <main className="max-w-6xl mx-auto px-4 py-8 space-y-6">
        {/* 電子帳簿保存法 検索フィルター */}
        <div className="card p-5">
          <h3 className="text-sm font-medium text-gray-700 mb-4 flex items-center gap-2">
            <svg className="w-4 h-4 text-amber-500" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
            </svg>
            電子帳簿保存法対応 検索（日付・金額・取引先）
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <label className="label text-xs">ステータス</label>
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value as EnvelopeStatus | "")}
                className="input text-sm"
              >
                <option value="">すべて</option>
                <option value="draft">下書き</option>
                <option value="sent">送信済み</option>
                <option value="in_progress">署名中</option>
                <option value="completed">締結完了</option>
                <option value="voided">無効</option>
              </select>
            </div>
            <div>
              <label className="label text-xs">取引先名</label>
              <input
                type="text"
                value={searchCounterparty}
                onChange={(e) => setSearchCounterparty(e.target.value)}
                className="input text-sm"
                placeholder="株式会社..."
              />
            </div>
            <div>
              <label className="label text-xs">取引日（From）</label>
              <input
                type="date"
                value={searchDateFrom}
                onChange={(e) => setSearchDateFrom(e.target.value)}
                className="input text-sm"
              />
            </div>
            <div>
              <label className="label text-xs">取引日（To）</label>
              <input
                type="date"
                value={searchDateTo}
                onChange={(e) => setSearchDateTo(e.target.value)}
                className="input text-sm"
              />
            </div>
          </div>
          <button onClick={handleSearch} className="mt-4 btn-primary text-sm">
            検索
          </button>
        </div>

        {/* 書類一覧 */}
        <div className="card">
          <div className="p-4 border-b border-gray-100">
            <p className="text-sm text-gray-500">{envelopes.length} 件の書類</p>
          </div>

          {envelopes.length === 0 ? (
            <div className="p-12 text-center">
              <svg className="w-12 h-12 text-gray-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <p className="text-gray-500">条件に一致する書類がありません</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {envelopes.map((envelope) => (
                <div key={envelope.id} className="flex items-center gap-2 hover:bg-gray-50 transition-colors">
                  <Link
                    href={`/contracts/${envelope.id}`}
                    className="flex items-center gap-4 p-4 flex-1 min-w-0"
                  >
                    <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center flex-shrink-0">
                      <svg className="w-5 h-5 text-blue-600" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zm-1 7V3.5L18.5 9H13z"/>
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-900 truncate">{envelope.title}</p>
                      <div className="flex items-center gap-3 mt-0.5">
                        {envelope.ebookkeepingIndex?.counterpartyName && (
                          <span className="text-xs text-gray-500">
                            {envelope.ebookkeepingIndex.counterpartyName}
                          </span>
                        )}
                        {envelope.ebookkeepingIndex?.transactionDate && (
                          <span className="text-xs text-gray-400">
                            {envelope.ebookkeepingIndex.transactionDate}
                          </span>
                        )}
                        {envelope.ebookkeepingIndex?.amount && (
                          <span className="text-xs text-gray-400">
                            ¥{envelope.ebookkeepingIndex.amount.toLocaleString()}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <span className={`badge ${getStatusColor(envelope.status)}`}>
                        {getStatusLabel(envelope.status)}
                      </span>
                      <p className="text-xs text-gray-400 mt-1">
                        {formatTimestamp(envelope.createdAt)}
                      </p>
                    </div>
                  </Link>
                  {envelope.status !== "completed" && (
                    <button
                      onClick={(e) => handleDelete(e, envelope.id, envelope.status)}
                      className="mr-3 p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors flex-shrink-0"
                      title="削除"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
