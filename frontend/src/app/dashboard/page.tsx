"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, signOut, User } from "firebase/auth";
import { doc, getDoc, collection, query, where, orderBy, limit, getDocs } from "firebase/firestore";
import { auth, db } from "../../lib/firebase";
import { getStatusLabel, getStatusColor, formatTimestamp } from "../../lib/firestore";
import type { Envelope } from "../../types/schemas";
import Link from "next/link";

interface DashboardStats {
  total: number;
  draft: number;
  inProgress: number;
  completed: number;
  voided: number;
}

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [orgName, setOrgName] = useState("");
  const [recentEnvelopes, setRecentEnvelopes] = useState<Envelope[]>([]);
  const [stats, setStats] = useState<DashboardStats>({
    total: 0, draft: 0, inProgress: 0, completed: 0, voided: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      if (!u) {
        router.replace("/login");
        return;
      }
      setUser(u);
      await loadDashboardData(u.uid);
      setLoading(false);
    });
    return unsubscribe;
  }, [router]);

  const loadDashboardData = async (uid: string) => {
    const userDoc = await getDoc(doc(db, "users", uid));
    const userData = userDoc.data();
    if (!userData) return;

    const orgId = userData.organizationId as string;

    // 組織名取得
    const orgDoc = await getDoc(doc(db, "organizations", orgId));
    setOrgName(orgDoc.data()?.displayName ?? "");

    // 最近の書類取得
    const envelopesQuery = query(
      collection(db, "envelopes"),
      where("organizationId", "==", orgId),
      orderBy("createdAt", "desc"),
      limit(10)
    );
    const snapshot = await getDocs(envelopesQuery);
    const envelopes = snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as Envelope));
    setRecentEnvelopes(envelopes);

    // 統計計算
    const s = { total: envelopes.length, draft: 0, inProgress: 0, completed: 0, voided: 0 };
    envelopes.forEach((e) => {
      if (e.status === "draft") s.draft++;
      else if (e.status === "sent" || e.status === "in_progress") s.inProgress++;
      else if (e.status === "completed") s.completed++;
      else if (e.status === "voided") s.voided++;
    });
    setStats(s);
  };

  const handleSignOut = async () => {
    await signOut(auth);
    router.replace("/login");
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
      {/* ナビゲーション */}
      <nav className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            <div className="flex items-center gap-6">
              <Link href="/dashboard" className="flex items-center gap-2 text-blue-600 font-bold text-xl">
                <svg className="w-7 h-7" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zm-1 7V3.5L18.5 9H13z"/>
                </svg>
                CloudSign
              </Link>
              <Link href="/contracts" className="text-gray-600 hover:text-gray-900 text-sm font-medium">
                書類管理
              </Link>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-sm text-gray-500">{orgName}</span>
              <span className="text-sm text-gray-700">{user?.email}</span>
              <button onClick={handleSignOut} className="text-sm text-gray-500 hover:text-gray-700">
                ログアウト
              </button>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-2xl font-bold text-gray-900">ダッシュボード</h1>
          <Link href="/contracts/new" className="btn-primary flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            新しい書類を作成
          </Link>
        </div>

        {/* 統計カード */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <StatCard label="総書類数" value={stats.total} color="text-blue-600" icon="📄" />
          <StatCard label="署名待ち" value={stats.inProgress} color="text-yellow-600" icon="✏️" />
          <StatCard label="締結完了" value={stats.completed} color="text-green-600" icon="✅" />
          <StatCard label="下書き" value={stats.draft} color="text-gray-600" icon="📝" />
        </div>

        {/* 最近の書類 */}
        <div className="card">
          <div className="flex justify-between items-center p-6 border-b border-gray-100">
            <h2 className="text-lg font-semibold text-gray-900">最近の書類</h2>
            <Link href="/contracts" className="text-sm text-blue-600 hover:underline">
              すべて表示
            </Link>
          </div>

          {recentEnvelopes.length === 0 ? (
            <div className="p-12 text-center">
              <svg className="w-12 h-12 text-gray-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <p className="text-gray-500 mb-4">書類がありません</p>
              <Link href="/contracts/new" className="btn-primary inline-flex">
                最初の書類を作成する
              </Link>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {recentEnvelopes.map((envelope) => (
                <Link
                  key={envelope.id}
                  href={`/contracts/${envelope.id}`}
                  className="flex items-center gap-4 p-4 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900 truncate">{envelope.title}</p>
                    <p className="text-sm text-gray-500 mt-0.5">
                      {envelope.ebookkeepingIndex?.counterpartyName && (
                        <span>{envelope.ebookkeepingIndex.counterpartyName} • </span>
                      )}
                      {formatTimestamp(envelope.createdAt)}
                    </p>
                  </div>
                  <span className={`badge ${getStatusColor(envelope.status)}`}>
                    {getStatusLabel(envelope.status)}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* 電子帳簿保存法コンプライアンスバナー */}
        <div className="mt-6 bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-start gap-3">
          <svg className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
          </svg>
          <div>
            <p className="text-sm font-medium text-blue-800">電子帳簿保存法 準拠</p>
            <p className="text-xs text-blue-600 mt-0.5">
              すべての締結済み書類は日付・金額・取引先のインデックスで検索可能です。監査ログは不変保存され、Cloud KMSによる改ざん検知が有効です。
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}

function StatCard({
  label, value, color, icon,
}: {
  label: string; value: number; color: string; icon: string;
}) {
  return (
    <div className="card p-5">
      <div className="text-2xl mb-1">{icon}</div>
      <div className={`text-3xl font-bold ${color}`}>{value}</div>
      <div className="text-sm text-gray-500 mt-1">{label}</div>
    </div>
  );
}
