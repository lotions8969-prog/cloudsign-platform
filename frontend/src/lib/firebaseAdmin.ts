import { initializeApp, getApps, App, cert } from "firebase-admin/app";

let adminApp: App | undefined;

export function initAdminApp(): App {
  if (adminApp) return adminApp;
  if (getApps().length > 0) {
    adminApp = getApps()[0];
    return adminApp;
  }

  // Cloud Run / Cloud Functions では Application Default Credentials が自動使用される
  // ローカル開発時は GOOGLE_APPLICATION_CREDENTIALS 環境変数を設定
  adminApp = initializeApp({
    projectId: process.env.GCP_PROJECT_ID,
    storageBucket: process.env.STORAGE_BUCKET,
  });

  return adminApp;
}

export function getAdminAuth() {
  initAdminApp();
  const { getAuth } = require("firebase-admin/auth");
  return getAuth();
}
