/**
 * Cloud Functions エントリーポイント
 * Firebase Admin SDK 初期化
 */

import { initializeApp } from "firebase-admin/app";

// Firebase Admin SDK を初期化（Cloud Functionsでは自動認証）
initializeApp();

// トリガー関数のエクスポート
export { onEnvelopeCreatedTrigger as onEnvelopeCreated } from "./triggers/onEnvelopeCreated";
export { onSignatureCompletedTrigger as onSignatureCompleted } from "./triggers/onSignatureCompleted";
