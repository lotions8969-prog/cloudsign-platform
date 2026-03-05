/**
 * demoAuth.ts
 * Firebase未設定時に使用するデモ認証（localStorage使用）
 */

export const DEMO_USER = {
  uid: "demo-user-001",
  email: "demo@allcontract.com",
  displayName: "デモユーザー",
  organizationId: "org_demo",
  isDemo: true,
};

export const DEMO_ORG = {
  id: "org_demo",
  name: "デモ株式会社",
  displayName: "デモ株式会社",
  email: "demo@allcontract.com",
  plan: "standard",
};

export const DEMO_ENVELOPES = [
  {
    id: "env_001",
    organizationId: "org_demo",
    createdBy: "demo-user-001",
    title: "業務委託基本契約書_2024年度",
    description: "2024年度の業務委託に関する基本契約書です。",
    status: "completed",
    recipientEmails: ["yamada@example.com"],
    originalPdfUrl: "#",
    originalPdfSha256: "abc123",
    signedPdfUrl: "#",
    ebookkeepingIndex: {
      transactionDate: "2024-04-01",
      amount: 1200000,
      counterpartyName: "株式会社テックソリューション",
      contractType: "業務委託契約",
      currency: "JPY",
    },
    tags: [],
    createdAt: { toDate: () => new Date("2024-04-01"), toMillis: () => 1711929600000 },
    updatedAt: { toDate: () => new Date("2024-04-10"), toMillis: () => 1712707200000 },
    completedAt: { toDate: () => new Date("2024-04-10"), toMillis: () => 1712707200000 },
  },
  {
    id: "env_002",
    organizationId: "org_demo",
    createdBy: "demo-user-001",
    title: "秘密保持契約書（NDA）_山田商事",
    description: "新規プロジェクト開始に伴うNDA締結をお願いします。",
    status: "in_progress",
    recipientEmails: ["sato@yamada-shoji.co.jp"],
    originalPdfUrl: "#",
    originalPdfSha256: "def456",
    ebookkeepingIndex: {
      transactionDate: "2024-05-15",
      amount: 0,
      counterpartyName: "山田商事株式会社",
      contractType: "秘密保持契約",
      currency: "JPY",
    },
    tags: ["NDA"],
    createdAt: { toDate: () => new Date("2024-05-15"), toMillis: () => 1715731200000 },
    updatedAt: { toDate: () => new Date("2024-05-15"), toMillis: () => 1715731200000 },
  },
  {
    id: "env_003",
    organizationId: "org_demo",
    createdBy: "demo-user-001",
    title: "売買契約書_サーバー機器購入",
    status: "sent",
    recipientEmails: ["tanaka@hardware-pro.jp"],
    originalPdfUrl: "#",
    originalPdfSha256: "ghi789",
    ebookkeepingIndex: {
      transactionDate: "2024-06-01",
      amount: 850000,
      counterpartyName: "ハードウェアプロ株式会社",
      contractType: "売買契約",
      currency: "JPY",
    },
    tags: [],
    createdAt: { toDate: () => new Date("2024-06-01"), toMillis: () => 1717200000000 },
    updatedAt: { toDate: () => new Date("2024-06-01"), toMillis: () => 1717200000000 },
  },
  {
    id: "env_004",
    organizationId: "org_demo",
    createdBy: "demo-user-001",
    title: "雇用契約書_2024年6月入社",
    status: "draft",
    recipientEmails: [],
    originalPdfUrl: "#",
    originalPdfSha256: "jkl012",
    ebookkeepingIndex: {
      transactionDate: "2024-06-01",
      counterpartyName: "新入社員",
      contractType: "雇用契約",
      currency: "JPY",
    },
    tags: ["HR"],
    createdAt: { toDate: () => new Date("2024-05-28"), toMillis: () => 1716854400000 },
    updatedAt: { toDate: () => new Date("2024-05-28"), toMillis: () => 1716854400000 },
  },
];

const STORAGE_KEY = "allcontract_demo_session";
const CONTRACTS_KEY = "demo_contracts";

/** localStorageに保存された新規書類 + 固定デモデータを統合して返す */
export function getAllDemoEnvelopes(): typeof DEMO_ENVELOPES {
  if (typeof window === "undefined") return DEMO_ENVELOPES;
  try {
    const stored: any[] = JSON.parse(localStorage.getItem(CONTRACTS_KEY) || "[]");
    // localStorageの書類をFirestoreライクな形式に変換
    const converted = stored.map((e) => ({
      ...e,
      organizationId: "org_demo",
      createdBy: "demo-user-001",
      originalPdfUrl: "#",
      originalPdfSha256: "demo-" + e.id,
      createdAt: { toDate: () => new Date(e.createdAt), toMillis: () => new Date(e.createdAt).getTime() },
      updatedAt: { toDate: () => new Date(e.createdAt), toMillis: () => new Date(e.createdAt).getTime() },
    }));
    // 新規作成分を先頭、固定デモデータを後ろに結合
    return [...converted, ...DEMO_ENVELOPES] as typeof DEMO_ENVELOPES;
  } catch {
    return DEMO_ENVELOPES;
  }
}

export function isDemoConfigured(): boolean {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  return !apiKey || apiKey === "placeholder-key" || apiKey.startsWith("placeholder");
}

export function signInDemo(): typeof DEMO_USER {
  if (typeof window !== "undefined") {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(DEMO_USER));
  }
  return DEMO_USER;
}

export function getDemoSession(): typeof DEMO_USER | null {
  if (typeof window === "undefined") return null;
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) return null;
  try {
    return JSON.parse(stored);
  } catch {
    return null;
  }
}

export function signOutDemo(): void {
  if (typeof window !== "undefined") {
    localStorage.removeItem(STORAGE_KEY);
  }
}

/** デモ: localStorage から書類を削除する */
export function deleteDemoEnvelope(id: string): void {
  if (typeof window === "undefined") return;
  try {
    const stored: any[] = JSON.parse(localStorage.getItem(CONTRACTS_KEY) || "[]");
    const filtered = stored.filter((e) => e.id !== id);
    localStorage.setItem(CONTRACTS_KEY, JSON.stringify(filtered));
  } catch {
    // ignore
  }
}
