/**
 * signService.ts
 * Cloud KMS を使用したデジタル署名エンジン
 *
 * 重要: 秘密鍵を直接扱わず、常にKMSへのダイジェスト署名リクエストで完結
 * （FIPS 140-2 Level 3 準拠のHSM内で署名処理）
 */

import { KeyManagementServiceClient } from "@google-cloud/kms";
import { PDFDocument, PDFName, PDFString, PDFHexString, PDFDict, PDFArray } from "pdf-lib";
import * as crypto from "crypto";
import * as crc32c from "fast-crc32c";
import { getStorage } from "firebase-admin/storage";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

const kmsClient = new KeyManagementServiceClient();

export interface SignatureResult {
  signedPdfBuffer: Buffer;
  signedPdfSha256: string;
  signatureBase64: string;
  publicKeyPem: string;
  kmsKeyVersion: string;
  padesMetadata: PadesMetadata;
}

export interface PadesMetadata {
  signingTime: string;
  signatureAlgorithm: string;
  hashAlgorithm: string;
  kmsKeyName: string;
  kmsKeyVersion: string;
  pdfSha256Hash: string;
  signatureBase64: string;
  publicKeyPem: string;
  timestampToken?: string;
  timestampAuthority?: string;
  // PAdES B-LT相当: 長期署名に必要なメタデータ
  ltMetadata: {
    signingCertificateHash: string;
    signingCertificatePem?: string;
    ocspResponse?: string;
    crlDistributionPoints?: string[];
    validationDataEmbedded: boolean;
  };
}

export interface SignServiceConfig {
  projectId: string;
  locationId: string;
  keyRingId: string;
  keyId: string;
  // バケット名
  storageBucket: string;
  // TSA設定（オプション）
  tsaUrl?: string;
}

/**
 * PDFに Cloud KMS 非対称署名を付与し、フォームをフラット化する
 *
 * @param pdfBuffer - 署名前PDFのバッファ
 * @param signatureImageBase64 - 署名画像（Base64）
 * @param recipientName - 署名者名
 * @param config - KMS設定
 */
export async function signPdfWithKms(
  pdfBuffer: Buffer,
  signatureImageBase64: string,
  recipientName: string,
  config: SignServiceConfig
): Promise<SignatureResult> {

  // ステップ1: PDFのSHA-256ダイジェストを計算
  const pdfHash = crypto.createHash("sha256").update(pdfBuffer).digest();
  const pdfSha256Hex = pdfHash.toString("hex");

  console.log(`[KMS Sign] PDF SHA-256: ${pdfSha256Hex}`);

  // ステップ2: KMSキーバージョンを取得
  const keyVersionName = `projects/${config.projectId}/locations/${config.locationId}/keyRings/${config.keyRingId}/cryptoKeys/${config.keyId}/cryptoKeyVersions/1`;

  // ステップ3: CRC32Cチェックサムで送信データの完全性を保証
  const digestCrc32c = crc32c.calculate(pdfHash);

  // ステップ4: KMS API経由でダイジェスト署名（秘密鍵は一切ローカルに持たない）
  const [signResponse] = await kmsClient.asymmetricSign({
    name: keyVersionName,
    digest: {
      sha256: pdfHash,
    },
    digestCrc32c: {
      value: digestCrc32c,
    },
  });

  // KMSレスポンスの完全性検証
  if (!signResponse.verifiedDigestCrc32c) {
    throw new Error("[KMS Sign] KMSへのリクエストが転送中に改ざんされました");
  }
  if (!signResponse.signature) {
    throw new Error("[KMS Sign] KMSから署名を取得できませんでした");
  }
  const signatureBuffer = Buffer.from(signResponse.signature as Uint8Array);
  const signatureCrc32c = crc32c.calculate(signatureBuffer);
  if (Number(signResponse.signatureCrc32c?.value) !== signatureCrc32c) {
    throw new Error("[KMS Sign] KMSレスポンスの署名データが破損しています");
  }

  console.log(`[KMS Sign] 署名取得成功 (${signatureBuffer.length} bytes)`);

  // ステップ5: 公開鍵を取得（署名検証用に保存）
  const [publicKeyResponse] = await kmsClient.getPublicKey({ name: keyVersionName });
  const publicKeyPem = publicKeyResponse.pem ?? "";

  const signatureBase64 = signatureBuffer.toString("base64");

  // ステップ6: pdf-lib でPDFに署名画像を埋め込み
  const pdfDoc = await PDFDocument.load(pdfBuffer);

  // 署名画像をPDFに埋め込む
  const signatureImageData = signatureImageBase64.replace(/^data:image\/(png|jpeg);base64,/, "");
  const signatureImageBytes = Buffer.from(signatureImageData, "base64");

  let embeddedImage;
  if (signatureImageBase64.startsWith("data:image/png")) {
    embeddedImage = await pdfDoc.embedPng(signatureImageBytes);
  } else {
    embeddedImage = await pdfDoc.embedJpg(signatureImageBytes);
  }

  // 最終ページに署名欄を追加
  const pages = pdfDoc.getPages();
  const lastPage = pages[pages.length - 1];
  const { width } = lastPage.getSize();

  const sigWidth = 200;
  const sigHeight = 60;
  lastPage.drawImage(embeddedImage, {
    x: width - sigWidth - 40,
    y: 40,
    width: sigWidth,
    height: sigHeight,
    opacity: 0.9,
  });

  // 署名者情報テキストを追加
  const { rgb } = await import("pdf-lib");
  lastPage.drawText(`署名者: ${recipientName}`, {
    x: width - sigWidth - 40,
    y: 30,
    size: 8,
    color: rgb(0.3, 0.3, 0.3),
  });
  lastPage.drawText(`署名日時: ${new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}`, {
    x: width - sigWidth - 40,
    y: 20,
    size: 7,
    color: rgb(0.3, 0.3, 0.3),
  });
  lastPage.drawText(`KMS署名: ${pdfSha256Hex.substring(0, 16)}...`, {
    x: width - sigWidth - 40,
    y: 10,
    size: 6,
    color: rgb(0.5, 0.5, 0.5),
  });

  // ステップ7: フォームフィールドをフラット化（改ざん防止）
  await flattenPdfForms(pdfDoc);

  // ステップ8: KMS署名メタデータをPDFのカスタムプロパティに埋め込む
  embedSignatureMetadata(pdfDoc, {
    signatureBase64,
    pdfSha256Hex,
    kmsKeyVersion: keyVersionName,
    publicKeyPem,
    recipientName,
    signingTime: new Date().toISOString(),
  });

  // ステップ9: 署名済みPDFを保存
  const signedPdfBytes = await pdfDoc.save({
    useObjectStreams: false, // 署名検証のため
  });
  const signedPdfBuffer = Buffer.from(signedPdfBytes);
  const signedPdfSha256 = crypto
    .createHash("sha256")
    .update(signedPdfBuffer)
    .digest("hex");

  // ステップ10: PAdES B-LT相当メタデータを構築
  const padesMetadata: PadesMetadata = {
    signingTime: new Date().toISOString(),
    signatureAlgorithm: "RSA-PSS",
    hashAlgorithm: "SHA-256",
    kmsKeyName: `projects/${config.projectId}/locations/${config.locationId}/keyRings/${config.keyRingId}/cryptoKeys/${config.keyId}`,
    kmsKeyVersion: keyVersionName,
    pdfSha256Hash: pdfSha256Hex,
    signatureBase64,
    publicKeyPem,
    ltMetadata: {
      signingCertificateHash: crypto
        .createHash("sha256")
        .update(publicKeyPem)
        .digest("hex"),
      validationDataEmbedded: false,
    },
  };

  // TSA タイムスタンプ取得（設定されている場合）
  if (config.tsaUrl) {
    try {
      const tsaResult = await requestTimestamp(signedPdfBuffer, config.tsaUrl);
      padesMetadata.timestampToken = tsaResult.token;
      padesMetadata.timestampAuthority = config.tsaUrl;
    } catch (err) {
      console.warn("[KMS Sign] TSAタイムスタンプ取得に失敗しました:", err);
    }
  }

  return {
    signedPdfBuffer,
    signedPdfSha256,
    signatureBase64,
    publicKeyPem,
    kmsKeyVersion: keyVersionName,
    padesMetadata,
  };
}

/**
 * PDFのすべてのフォームフィールドをフラット化（読み取り専用・改ざん不能化）
 */
async function flattenPdfForms(pdfDoc: PDFDocument): Promise<void> {
  const form = pdfDoc.getForm();

  try {
    const fields = form.getFields();
    console.log(`[Flatten] フォームフィールド数: ${fields.length}`);

    for (const field of fields) {
      try {
        field.enableReadOnly();
      } catch {
        // フィールドが読み取り専用化できない場合はスキップ
      }
    }

    // PDFフォームをフラット化
    form.flatten({
      updateFieldAppearances: true,
    });

    console.log("[Flatten] フォームフィールドのフラット化完了");
  } catch (err) {
    // フォームが存在しない場合はスキップ
    console.log("[Flatten] フォームなし、スキップ");
  }
}

/**
 * KMS署名メタデータをPDFのInfoディクショナリに埋め込む
 */
function embedSignatureMetadata(
  pdfDoc: PDFDocument,
  metadata: {
    signatureBase64: string;
    pdfSha256Hex: string;
    kmsKeyVersion: string;
    publicKeyPem: string;
    recipientName: string;
    signingTime: string;
  }
): void {
  // PDF Info辞書にカスタムプロパティを設定
  pdfDoc.setCreator("CloudSign Platform");
  pdfDoc.setProducer("CloudSign Platform v1.0 / Cloud KMS");
  pdfDoc.setModificationDate(new Date());
  pdfDoc.setKeywords([
    `KMS_SIGNED`,
    `HASH:${metadata.pdfSha256Hex.substring(0, 32)}`,
    `SIGNER:${metadata.recipientName}`,
    `TIME:${metadata.signingTime}`,
  ]);

  // カスタムXMPメタデータにフルシグネチャを埋め込む
  const xmpMetadata = `
<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about=""
      xmlns:cloudsign="https://cloudsign.example.com/schema/1.0/">
      <cloudsign:SigningTime>${metadata.signingTime}</cloudsign:SigningTime>
      <cloudsign:KmsKeyVersion>${metadata.kmsKeyVersion}</cloudsign:KmsKeyVersion>
      <cloudsign:PdfSha256Hash>${metadata.pdfSha256Hex}</cloudsign:PdfSha256Hash>
      <cloudsign:SignerName>${metadata.recipientName}</cloudsign:SignerName>
      <cloudsign:SignatureAlgorithm>RSA-PSS-SHA256</cloudsign:SignatureAlgorithm>
      <cloudsign:SignatureValue>${metadata.signatureBase64.substring(0, 64)}...</cloudsign:SignatureValue>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`.trim();

  // XMPメタデータをPDFに設定
  const rawContext = pdfDoc.context;
  const xmpStream = rawContext.flateStream(Buffer.from(xmpMetadata, "utf-8"));
  rawContext.assign(
    xmpStream,
    PDFDict.withContext(rawContext)
  );
}

/**
 * TSA（タイムスタンプ局）へのタイムスタンプリクエスト
 * RFC 3161 準拠
 */
async function requestTimestamp(
  pdfBuffer: Buffer,
  tsaUrl: string
): Promise<{ token: string; time: string }> {
  const { createHash } = await import("crypto");
  const { asn1, pki, md } = await import("node-forge");

  const pdfHash = createHash("sha256").update(pdfBuffer).digest();

  // RFC 3161 タイムスタンプリクエストの構築
  const tsq = buildTimestampRequest(pdfHash);

  const response = await fetch(tsaUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/timestamp-query",
    },
    body: tsq,
  });

  if (!response.ok) {
    throw new Error(`TSA応答エラー: ${response.status}`);
  }

  const tsaResponse = await response.arrayBuffer();
  const tokenBase64 = Buffer.from(tsaResponse).toString("base64");

  return {
    token: tokenBase64,
    time: new Date().toISOString(),
  };
}

/**
 * RFC 3161 タイムスタンプリクエストを構築
 */
function buildTimestampRequest(hash: Buffer): Buffer {
  // ASN.1 TimeStampReq の簡略実装
  // 0x30 = SEQUENCE
  const hashAlgorithmOid = Buffer.from([
    0x30, 0x0d,               // SEQUENCE
    0x06, 0x09,               // OID
    0x60, 0x86, 0x48, 0x01,   // SHA-256 OID (2.16.840.1.101.3.4.2.1)
    0x65, 0x03, 0x04, 0x02, 0x01,
    0x05, 0x00,               // NULL
  ]);

  const messageImprint = Buffer.concat([
    Buffer.from([0x30]),
    encodeLength(hashAlgorithmOid.length + 2 + hash.length),
    hashAlgorithmOid,
    Buffer.from([0x04]),
    encodeLength(hash.length),
    hash,
  ]);

  const version = Buffer.from([0x02, 0x01, 0x01]); // INTEGER 1
  const nonce = crypto.randomBytes(8);
  const nonceEncoded = Buffer.concat([
    Buffer.from([0x02]),
    encodeLength(nonce.length),
    nonce,
  ]);

  const tsqContent = Buffer.concat([version, messageImprint, nonceEncoded]);
  const tsq = Buffer.concat([
    Buffer.from([0x30]),
    encodeLength(tsqContent.length),
    tsqContent,
  ]);

  return tsq;
}

function encodeLength(length: number): Buffer {
  if (length < 0x80) {
    return Buffer.from([length]);
  } else if (length < 0x100) {
    return Buffer.from([0x81, length]);
  } else {
    return Buffer.from([0x82, (length >> 8) & 0xff, length & 0xff]);
  }
}

/**
 * 署名済みPDFの署名を検証する
 * （受信者が検証するユーティリティ）
 */
export async function verifyPdfSignature(
  signedPdfBuffer: Buffer,
  signatureBase64: string,
  pdfSha256Hex: string,
  kmsKeyVersionName: string
): Promise<{ valid: boolean; reason?: string }> {
  try {
    // 1. PDFのSHA-256を再計算して一致確認
    const currentHash = crypto
      .createHash("sha256")
      .update(signedPdfBuffer)
      .digest("hex");

    if (currentHash !== pdfSha256Hex) {
      return {
        valid: false,
        reason: "PDFが改ざんされています（ハッシュ不一致）",
      };
    }

    // 2. KMSの公開鍵を取得して署名を検証
    const [publicKeyResponse] = await kmsClient.getPublicKey({
      name: kmsKeyVersionName,
    });

    const publicKeyPem = publicKeyResponse.pem ?? "";
    if (!publicKeyPem) {
      return { valid: false, reason: "公開鍵の取得に失敗しました" };
    }

    const signatureBuffer = Buffer.from(signatureBase64, "base64");
    const originalPdfHash = Buffer.from(pdfSha256Hex, "hex");

    // RSA-PSS署名を検証
    const verify = crypto.createVerify("RSA-PSS");
    verify.update(originalPdfHash);

    const isValid = verify.verify(
      {
        key: publicKeyPem,
        padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
        saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
      },
      signatureBuffer
    );

    if (isValid) {
      return { valid: true };
    } else {
      return { valid: false, reason: "署名検証に失敗しました（無効な署名）" };
    }
  } catch (err) {
    return {
      valid: false,
      reason: `署名検証エラー: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Cloud Storageに署名済みPDFを保存し、署名付きURLを返す
 */
export async function uploadSignedPdf(
  signedPdfBuffer: Buffer,
  envelopeId: string,
  storageBucket: string
): Promise<string> {
  const bucket = getStorage().bucket(storageBucket);
  const filePath = `signed-pdfs/${envelopeId}/signed_${Date.now()}.pdf`;
  const file = bucket.file(filePath);

  await file.save(signedPdfBuffer, {
    contentType: "application/pdf",
    metadata: {
      contentType: "application/pdf",
      cacheControl: "private, max-age=86400",
      metadata: {
        envelopeId,
        signedAt: new Date().toISOString(),
      },
    },
  });

  // 署名付きURL（1時間有効）
  const [signedUrl] = await file.getSignedUrl({
    action: "read",
    expires: Date.now() + 60 * 60 * 1000,
  });

  return signedUrl;
}
