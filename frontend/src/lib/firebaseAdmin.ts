import { initializeApp, getApps, App, cert } from "firebase-admin/app";

let adminApp: App | undefined;

export function initAdminApp(): App {
  if (adminApp) return adminApp;
  if (getApps().length > 0) {
    adminApp = getApps()[0];
    return adminApp;
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!projectId || !clientEmail || !privateKey) {
    // ビルド時など認証情報未設定の場合は projectId のみで初期化
    adminApp = initializeApp({ projectId: projectId ?? "placeholder" });
    return adminApp;
  }

  adminApp = initializeApp({
    credential: cert({ projectId, clientEmail, privateKey }),
    projectId,
    storageBucket: process.env.STORAGE_BUCKET,
  });

  return adminApp;
}

export function getAdminAuth() {
  initAdminApp();
  const { getAuth } = require("firebase-admin/auth");
  return getAuth();
}
