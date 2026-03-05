import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  addDoc,
  updateDoc,
  serverTimestamp,
  DocumentSnapshot,
  QueryDocumentSnapshot,
  Timestamp,
  onSnapshot,
  Unsubscribe,
} from "firebase/firestore";
import { db } from "./firebase";
import type {
  Envelope,
  Recipient,
  AuditLog,
  CreateEnvelopeRequest,
  SearchEnvelopesRequest,
} from "../types/schemas";

// =========================================
// Envelope CRUD
// =========================================

export async function getEnvelope(envelopeId: string): Promise<Envelope | null> {
  const docRef = doc(db, "envelopes", envelopeId);
  const snapshot = await getDoc(docRef);
  if (!snapshot.exists()) return null;
  return { id: snapshot.id, ...snapshot.data() } as Envelope;
}

export async function searchEnvelopes(
  params: SearchEnvelopesRequest
): Promise<{ envelopes: Envelope[]; nextCursor: string | null }> {
  let q = query(
    collection(db, "envelopes"),
    where("organizationId", "==", params.organizationId),
    orderBy("createdAt", "desc"),
    limit(params.limit ?? 20)
  );

  if (params.status) {
    q = query(q, where("status", "==", params.status));
  }

  if (params.counterpartyName) {
    q = query(q, where("ebookkeepingIndex.counterpartyName", "==", params.counterpartyName));
  }

  if (params.transactionDateFrom) {
    q = query(q, where("ebookkeepingIndex.transactionDate", ">=", params.transactionDateFrom));
  }

  if (params.transactionDateTo) {
    q = query(q, where("ebookkeepingIndex.transactionDate", "<=", params.transactionDateTo));
  }

  if (params.cursor) {
    const cursorDoc = await getDoc(doc(db, "envelopes", params.cursor));
    if (cursorDoc.exists()) {
      q = query(q, startAfter(cursorDoc));
    }
  }

  const snapshot = await getDocs(q);
  const envelopes = snapshot.docs.map(
    (d) => ({ id: d.id, ...d.data() } as Envelope)
  );

  const nextCursor =
    snapshot.docs.length === (params.limit ?? 20)
      ? snapshot.docs[snapshot.docs.length - 1].id
      : null;

  return { envelopes, nextCursor };
}

export function subscribeToEnvelope(
  envelopeId: string,
  callback: (envelope: Envelope | null) => void
): Unsubscribe {
  return onSnapshot(doc(db, "envelopes", envelopeId), (snapshot) => {
    if (!snapshot.exists()) {
      callback(null);
      return;
    }
    callback({ id: snapshot.id, ...snapshot.data() } as Envelope);
  });
}

// =========================================
// Recipient
// =========================================

export async function getRecipients(envelopeId: string): Promise<Recipient[]> {
  const q = query(
    collection(db, "envelopes", envelopeId, "recipients"),
    orderBy("order", "asc")
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as Recipient));
}

// =========================================
// AuditLog
// =========================================

export async function getAuditTrail(
  envelopeId: string,
  organizationId: string
): Promise<AuditLog[]> {
  const q = query(
    collection(db, "auditLogs"),
    where("organizationId", "==", organizationId),
    where("envelopeId", "==", envelopeId),
    orderBy("timestamp", "asc")
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as AuditLog));
}

// =========================================
// ユーティリティ
// =========================================

export function formatTimestamp(ts: Timestamp | null | undefined): string {
  if (!ts) return "-";
  return ts.toDate().toLocaleString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Tokyo",
  });
}

export function getStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    draft: "下書き",
    sent: "送信済み",
    in_progress: "署名中",
    completed: "締結完了",
    voided: "無効",
    expired: "期限切れ",
    declined: "拒否",
  };
  return labels[status] ?? status;
}

export function getStatusColor(status: string): string {
  const colors: Record<string, string> = {
    draft: "bg-gray-100 text-gray-700",
    sent: "bg-blue-100 text-blue-700",
    in_progress: "bg-yellow-100 text-yellow-700",
    completed: "bg-green-100 text-green-700",
    voided: "bg-red-100 text-red-700",
    expired: "bg-orange-100 text-orange-700",
    declined: "bg-red-100 text-red-700",
  };
  return colors[status] ?? "bg-gray-100 text-gray-700";
}
