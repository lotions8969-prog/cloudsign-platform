"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithRedirect,
  getRedirectResult,
} from "firebase/auth";
import { doc, setDoc, getDoc, serverTimestamp } from "firebase/firestore";
import { auth, db } from "../../lib/firebase";
import { isDemoConfigured, signInDemo } from "../../lib/demoAuth";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [orgName, setOrgName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [redirectChecking, setRedirectChecking] = useState(true);
  const [isDemo, setIsDemo] = useState(false);

  useEffect(() => {
    setIsDemo(isDemoConfigured());

    // Firebase設定済みの場合のみリダイレクト結果チェック
    if (!isDemoConfigured()) {
      getRedirectResult(auth)
        .then(async (result) => {
          if (result?.user) {
            const user = result.user;
            const userDoc = await getDoc(doc(db, "users", user.uid));
            if (!userDoc.exists()) {
              await setupNewUser(
                user.uid,
                user.email ?? "",
                user.displayName ?? "",
                user.displayName ? `${user.displayName}の組織` : "マイ組織"
              );
            }
            router.replace("/dashboard");
          }
        })
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : "";
          if (msg) setError(getJaErrorMessage(msg));
        })
        .finally(() => setRedirectChecking(false));
    } else {
      setRedirectChecking(false);
    }
  }, [router]);

  const handleDemoLogin = () => {
    signInDemo();
    router.replace("/dashboard");
  };

  const handleGoogleAuth = async () => {
    setError("");
    setLoading(true);
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      await signInWithRedirect(auth, provider);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "エラーが発生しました";
      setError(getJaErrorMessage(msg));
      setLoading(false);
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      if (mode === "login") {
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        const credential = await createUserWithEmailAndPassword(auth, email, password);
        await setupNewUser(credential.user.uid, email, displayName, orgName);
      }
      router.replace("/dashboard");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "エラーが発生しました";
      setError(getJaErrorMessage(msg));
    } finally {
      setLoading(false);
    }
  };

  if (redirectChecking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* ロゴ */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 text-blue-600 mb-2">
            <svg className="w-10 h-10" fill="currentColor" viewBox="0 0 24 24">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zm-1 7V3.5L18.5 9H13zm-4 9v-2h6v2H9zm0-4v-2h8v2H9zm0-4V8h3v2H9z"/>
            </svg>
            <span className="text-3xl font-bold">ALL Contract</span>
          </div>
          <p className="text-gray-600 text-sm">電子署名法・電子帳簿保存法準拠の電子契約プラットフォーム</p>
        </div>

        <div className="card p-8">
          {/* デモモードバナー */}
          {isDemo && (
            <div className="mb-6 bg-amber-50 border border-amber-200 rounded-xl p-4">
              <p className="text-sm font-semibold text-amber-800 mb-1">デモモード</p>
              <p className="text-xs text-amber-700 mb-3">
                Firebase未設定のため、サンプルデータでアプリを体験できます。
              </p>
              <button
                onClick={handleDemoLogin}
                className="w-full bg-amber-500 hover:bg-amber-600 text-white font-bold py-3 rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                デモとして体験する（ログイン不要）
              </button>
            </div>
          )}

          {/* タブ */}
          <div className="flex mb-6 border-b border-gray-200">
            <button
              onClick={() => setMode("login")}
              className={`flex-1 py-2 text-sm font-medium border-b-2 transition-colors ${
                mode === "login"
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              ログイン
            </button>
            <button
              onClick={() => setMode("register")}
              className={`flex-1 py-2 text-sm font-medium border-b-2 transition-colors ${
                mode === "register"
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              新規登録
            </button>
          </div>

          {/* Googleログイン */}
          <button
            onClick={handleGoogleAuth}
            disabled={loading || isDemo}
            title={isDemo ? "Firebaseを設定するとGoogleログインが使えます" : ""}
            className="w-full flex items-center justify-center gap-3 border border-gray-300 rounded-lg px-4 py-2.5 text-gray-700 font-medium hover:bg-gray-50 transition-colors mb-4 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {loading ? (
              <>
                <span className="w-5 h-5 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
                Googleに接続中...
              </>
            ) : (
              <>
                <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
                Googleで続ける{isDemo && "（要Firebase設定）"}
              </>
            )}
          </button>

          <div className="relative mb-4">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-300" />
            </div>
            <div className="relative flex justify-center text-xs text-gray-500 bg-white px-2">
              またはメールで
            </div>
          </div>

          {/* メールフォーム */}
          <form onSubmit={handleEmailAuth} className="space-y-4">
            {mode === "register" && (
              <>
                <div>
                  <label className="label">お名前</label>
                  <input type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} className="input" placeholder="山田 太郎" required />
                </div>
                <div>
                  <label className="label">組織名</label>
                  <input type="text" value={orgName} onChange={(e) => setOrgName(e.target.value)} className="input" placeholder="株式会社サンプル" required />
                </div>
              </>
            )}
            <div>
              <label className="label">メールアドレス</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="input" placeholder="email@example.com" required />
            </div>
            <div>
              <label className="label">パスワード</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="input" placeholder="8文字以上" minLength={8} required />
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
                {error}
              </div>
            )}

            <button type="submit" disabled={loading || isDemo} className="btn-primary w-full disabled:opacity-40">
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  処理中...
                </span>
              ) : mode === "login" ? "ログイン" : "アカウント作成"}
            </button>

            {isDemo && (
              <p className="text-xs text-center text-gray-400">
                メール/Googleログインは Firebase 設定後に利用できます
              </p>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}

async function setupNewUser(uid: string, email: string, displayName: string, orgName: string) {
  const orgId = `org_${uid}`;
  await setDoc(doc(db, "organizations", orgId), {
    id: orgId, name: orgName, displayName: orgName, email,
    plan: "free", monthlyEnvelopeCount: 0, totalEnvelopeCount: 0,
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  });
  await setDoc(doc(db, "organizations", orgId, "members", uid), {
    uid, email, displayName, role: "admin", joinedAt: serverTimestamp(),
  });
  await setDoc(doc(db, "users", uid), {
    uid, email, displayName: displayName || email.split("@")[0],
    organizationId: orgId, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  });
}

function getJaErrorMessage(msg: string): string {
  if (msg.includes("user-not-found")) return "メールアドレスが見つかりません";
  if (msg.includes("wrong-password") || msg.includes("invalid-credential")) return "メールアドレスまたはパスワードが間違っています";
  if (msg.includes("email-already-in-use")) return "このメールアドレスは既に使用されています";
  if (msg.includes("weak-password")) return "パスワードは8文字以上で設定してください";
  if (msg.includes("invalid-email")) return "有効なメールアドレスを入力してください";
  if (msg.includes("popup-closed") || msg.includes("cancelled-popup-request")) return "ログインがキャンセルされました";
  if (msg.includes("unauthorized-domain")) return "このドメインはFirebase Consoleで承認が必要です";
  if (msg.includes("api-key-not-valid") || msg.includes("invalid-api-key")) return "Firebase APIキーが未設定です（デモモードをお試しください）";
  if (msg.includes("network-request-failed")) return "ネットワークエラーが発生しました";
  return msg;
}
