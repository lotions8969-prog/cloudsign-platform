# Google Cloud IAM 権限セットアップガイド

## 必要なサービスアカウントと権限

### 1. Cloud Run フロントエンド用 SA

```bash
PROJECT_ID=your-project-id
REGION=asia-northeast1

# サービスアカウント作成
gcloud iam service-accounts create all-contract-frontend \
  --display-name="ALL Contract Frontend" \
  --project=$PROJECT_ID

SA_FRONTEND=all-contract-frontend@$PROJECT_ID.iam.gserviceaccount.com
```

#### 付与する権限
```bash
# Firestore 読み書き
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$SA_FRONTEND" \
  --role="roles/datastore.user"

# Cloud Storage 読み書き（原本PDF用バケット）
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$SA_FRONTEND" \
  --role="roles/storage.objectAdmin"

# Firebase Auth 検証
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$SA_FRONTEND" \
  --role="roles/firebase.sdkAdminServiceAgent"

# Cloud KMS 署名（フロントエンドは直接使用しないが一応）
# 実際の署名は Cloud Functions が行う
```

---

### 2. Cloud Functions 用 SA

```bash
gcloud iam service-accounts create all-contract-functions \
  --display-name="ALL Contract Functions" \
  --project=$PROJECT_ID

SA_FUNCTIONS=all-contract-functions@$PROJECT_ID.iam.gserviceaccount.com
```

#### 付与する権限（最小権限原則）

```bash
# ============================================
# Cloud KMS: 署名のみ（最重要・最小権限）
# ============================================
# 秘密鍵エクスポート不可、署名のみ許可
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$SA_FUNCTIONS" \
  --role="roles/cloudkms.cryptoKeyVersions.useToSign"
# ↑ これが電子署名の要。秘密鍵は一切ローカルに持たない

# KMS 公開鍵の取得（署名検証用）
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$SA_FUNCTIONS" \
  --role="roles/cloudkms.publicKeyViewer"

# Firestore 読み書き（監査ログ書き込み含む）
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$SA_FUNCTIONS" \
  --role="roles/datastore.user"

# Cloud Storage 読み書き（PDF取得・署名済みPDF保存）
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$SA_FUNCTIONS" \
  --role="roles/storage.objectAdmin"

# SendGrid API Key は Secret Manager で管理
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$SA_FUNCTIONS" \
  --role="roles/secretmanager.secretAccessor"

# Cloud Functions の自己実行権限
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$SA_FUNCTIONS" \
  --role="roles/cloudfunctions.invoker"
```

---

### 3. Cloud KMS キーリングとキーの作成

```bash
# キーリング作成
gcloud kms keyrings create all-contract-keyring \
  --location=$REGION \
  --project=$PROJECT_ID

# 非対称署名キー作成（RSA-PSS 4096bit SHA-256）
# ※ HSM 保護: FIPS 140-2 Level 3 準拠
gcloud kms keys create document-signing-key \
  --keyring=all-contract-keyring \
  --location=$REGION \
  --purpose=asymmetric-signing \
  --default-algorithm=rsa-sign-pss-4096-sha256 \
  --protection-level=hsm \
  --project=$PROJECT_ID

# キーバージョン名の確認
gcloud kms keys versions list \
  --key=document-signing-key \
  --keyring=all-contract-keyring \
  --location=$REGION \
  --project=$PROJECT_ID
```

#### KMS の重要セキュリティ要件

| 権限 | SA | 説明 |
|------|-----|------|
| `roles/cloudkms.cryptoKeyVersions.useToSign` | all-contract-functions | 署名のみ（秘密鍵エクスポート不可） |
| `roles/cloudkms.publicKeyViewer` | all-contract-functions | 公開鍵取得（検証用） |
| ❌ `roles/cloudkms.admin` | なし | 管理権限は付与しない |
| ❌ `roles/cloudkms.cryptoOperator` | なし | 不要な権限は付与しない |

---

### 4. Cloud Storage バケット設定

```bash
# 原本PDF バケット（組織別アクセス制御）
gsutil mb -p $PROJECT_ID -c STANDARD -l $REGION \
  gs://$PROJECT_ID-all-contract-originals

# 署名済みPDF バケット
gsutil mb -p $PROJECT_ID -c STANDARD -l $REGION \
  gs://$PROJECT_ID-all-contract-signed

# CORS設定（フロントエンドからのアップロード用）
cat > /tmp/cors.json << 'EOF'
[{
  "origin": ["https://your-frontend.run.app"],
  "method": ["GET", "PUT", "POST"],
  "responseHeader": ["Content-Type"],
  "maxAgeSeconds": 3600
}]
EOF
gsutil cors set /tmp/cors.json gs://$PROJECT_ID-all-contract-originals

# 原本PDFの公開アクセス禁止（IAMのみ）
gsutil iam ch -d allUsers:objectViewer gs://$PROJECT_ID-all-contract-originals

# 署名済みPDFも同様
gsutil iam ch -d allUsers:objectViewer gs://$PROJECT_ID-all-contract-signed
```

---

### 5. Secret Manager（機密情報の管理）

```bash
# SendGrid APIキーを Secret Manager に保存
echo -n "SG.your-sendgrid-key" | gcloud secrets create SENDGRID_API_KEY \
  --data-file=- \
  --project=$PROJECT_ID

# Cloud Functions に参照を付与
gcloud secrets add-iam-policy-binding SENDGRID_API_KEY \
  --member="serviceAccount:$SA_FUNCTIONS" \
  --role="roles/secretmanager.secretAccessor" \
  --project=$PROJECT_ID
```

---

### 6. Firestore セキュリティルール デプロイ

```bash
# Firebase CLI でデプロイ
firebase deploy --only firestore:rules --project=$PROJECT_ID
firebase deploy --only firestore:indexes --project=$PROJECT_ID
```

---

### 7. Cloud Build トリガー設定

```bash
# GitHub リポジトリと連携
gcloud builds triggers create github \
  --name=all-contract-deploy \
  --repo-name=all-contract-platform \
  --repo-owner=your-github-org \
  --branch-pattern="^main$" \
  --build-config=cloudbuild.yaml \
  --project=$PROJECT_ID

# Cloud Build SA に権限付与
CB_SA=$(gcloud projects describe $PROJECT_ID --format='value(projectNumber)')@cloudbuild.gserviceaccount.com

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$CB_SA" \
  --role="roles/run.admin"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$CB_SA" \
  --role="roles/cloudfunctions.admin"

gcloud iam service-accounts add-iam-policy-binding \
  $SA_FRONTEND \
  --member="serviceAccount:$CB_SA" \
  --role="roles/iam.serviceAccountUser" \
  --project=$PROJECT_ID
```

---

## 電子帳簿保存法 コンプライアンスチェックリスト

- [x] 真実性の確保: Firestoreセキュリティルールで締結済み書類の更新・削除を禁止
- [x] 可視性の確保: 署名済みPDFをCloud Storageに7年以上保存設定
- [x] 検索可能性の確保: 日付・金額・取引先の3項目インデックスをFirestoreに設定
- [x] 改ざん検知: SHA-256ハッシュ + KMS非対称署名 + 監査ログハッシュチェーン
- [x] タイムスタンプ: PAdES署名時刻 + TSA連携（オプション）
- [x] 組織間アクセス遮断: organizationId による Firestore ルール分離

## Always Free 枠の監視

| サービス | 無料枠 | 推奨アラート設定 |
|--------|--------|--------------|
| Cloud Run | 200万リクエスト/月 | 150万でアラート |
| Firestore | 読み取り50,000/日 | 40,000でアラート |
| Firestore | 書き込み20,000/日 | 15,000でアラート |
| Firestore | 1GB ストレージ | 800MBでアラート |
| Cloud Storage | 5GB | 4GBでアラート |
| Cloud Functions | 200万呼び出し/月 | 150万でアラート |
