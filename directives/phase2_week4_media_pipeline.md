# Directive: Phase 2, Week 4 — Media Pipeline: S3 Uploads & Mux Webhooks

**Status:** `[ ] In Progress`  
**Owner:** Backend Team  
**Prerequisite:** Phase 1 complete and signed off  
**Blocking:** Frontend file picker + upload UI, video player integration

---

## Prerequisites

- [ ] Phase 1 all sign-offs complete
- [ ] Backend running with no errors
- [ ] AWS S3 bucket configured with CORS for PUT from `localhost` + staging domain
- [ ] IAM credentials with `s3:PutObject` and `s3:GetObject` on the target bucket
- [ ] Mux account with Access Token ID, Secret Key, and Webhook Signing Secret
- [ ] Mux webhook URL configured to `https://<your-api>/api/webhooks/mux`
- [ ] Redis running (from Week 3 notifications setup)
- [ ] Valid `accessToken` (admin role) — save as `$TOKEN`

---

## Step 1: Environment Configuration

Add to `.env`:

```env
# AWS S3 — Media uploads
S3_BUCKET=your-church-app-media
S3_REGION=us-east-1
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...

# Mux — Video transcoding
MUX_TOKEN_ID=...
MUX_TOKEN_SECRET=...
MUX_WEBHOOK_SECRET=...
```

Install new dependencies:

```bash
cd backend
npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
```

> **Note:** NestJS must be bootstrapped with `rawBody: true` for webhook signature verification to work:
> ```typescript
> // main.ts
> const app = await NestFactory.create(AppModule, { rawBody: true });
> ```

---

## Step 2: Apply Migration 006

```bash
supabase db push
# or
psql "$DATABASE_URL" -f migrations/006_media_columns.sql
```

Run the verification queries in `§ SECTION 3` of the migration file. Confirm:

```sql
-- New columns exist
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'posts'
  AND column_name IN ('media_type', 'media_url')
ORDER BY column_name;
```

| column_name | data_type | is_nullable | column_default |
| :--- | :--- | :--- | :--- |
| media_type | text | NO | 'text'::text |
| media_url | text | YES | NULL |

```sql
-- CHECK constraint present
SELECT conname FROM pg_constraint
WHERE conrelid = 'public.posts'::regclass
  AND contype = 'c';
```

- `[ ]` Migration applied cleanly
- `[ ]` `media_type` column confirmed with CHECK constraint
- `[ ]` `media_url` column confirmed (nullable)
- `[ ]` Existing posts unchanged (`media_type = 'text'`)

---

## Step 3: Files Added / Updated

| File | Status |
| :--- | :--- |
| `migrations/006_media_columns.sql` | **New** |
| `backend/src/media/dto/presigned-url.dto.ts` | **New** |
| `backend/src/media/media.service.ts` | **New** |
| `backend/src/media/media.controller.ts` | **New** |
| `backend/src/media/media.module.ts` | **New** |
| `backend/src/webhooks/webhooks.controller.ts` | **New** |
| `backend/src/webhooks/webhooks.module.ts` | **New** |
| `backend/src/posts/entities/post.entity.ts` | Updated — `mediaType`, `mediaUrl` columns added |
| `backend/src/app.module.ts` | Updated — `MediaModule`, `WebhooksModule` registered |

---

## Step 4: API Contract

### Media Endpoints _(require Bearer token, no RLS interceptor)_

#### `POST /api/media/presigned-url`
```json
// Request
{
  "filename": "sunday_worship.jpg",
  "contentType": "image/jpeg"
}

// Response 200
{
  "uploadUrl": "https://your-church-app-media.s3.us-east-1.amazonaws.com/tenants/<tenant-uuid>/users/<user-uuid>/1712150400000_sunday_worship.jpg?X-Amz-...",
  "fileKey": "tenants/<tenant-uuid>/users/<user-uuid>/1712150400000_sunday_worship.jpg"
}

// Response 400 — unsupported content type
{ "message": "contentType must be a supported image or video MIME type ..." }

// Response 400 — no tenant context
{ "message": "No active tenant context. Call POST /api/auth/switch-tenant first." }

// Response 401 — unauthenticated
{ "message": "Unauthorized" }
```

> The client uploads directly to S3 using the `uploadUrl` with a PUT request. The file never passes through the backend server.

### Webhook Endpoints _(public — authenticated via request signature)_

#### `POST /api/webhooks/mux`
```json
// Mux sends event payloads with a signature header:
// mux-signature: t=1712150400,v1=<hex-hmac-sha256>

// Response 200 (valid signature)
{ "received": true }

// Response 401 (invalid/missing signature)
{ "message": "Invalid webhook signature" }
```

---

## Step 5: Architecture Notes

### S3 Pre-signed URL Flow

```
┌──────────┐    POST /media/presigned-url    ┌──────────────┐
│  Client   │ ─────────────────────────────▶ │  Backend      │
│  (mobile) │ ◀───────────────────────────── │  MediaService │
│           │    { uploadUrl, fileKey }       │               │
│           │                                └──────────────┘
│           │
│           │    PUT uploadUrl (binary)       ┌──────────────┐
│           │ ─────────────────────────────▶ │  AWS S3       │
│           │ ◀───────────────────────────── │  (direct)     │
│           │    200 OK                       └──────────────┘
│           │
│           │    POST /posts                  ┌──────────────┐
│           │    { content, mediaType,        │  Backend      │
│           │      mediaUrl: fileKey }        │  PostsService │
└──────────┘ ─────────────────────────────▶ └──────────────┘
```

**Why pre-signed URLs?** The file upload bypasses the backend entirely — S3 handles the bandwidth and storage. This is critical for a mobile-first app where users upload large images and videos. The backend only generates a time-limited, content-type-locked URL.

### S3 Key Namespace Design

```
tenants/{tenantId}/users/{userId}/{timestamp}_{sanitizedFilename}
```

This structure provides:
1. **Tenant isolation** — S3 lifecycle rules or IAM policies can be scoped per-tenant
2. **User attribution** — easy to audit who uploaded what
3. **Collision prevention** — timestamp prefix ensures uniqueness even for same filenames
4. **Path traversal protection** — filename is sanitised to strip `/`, `\`, `..`, and non-alphanumeric characters

### Why No RLS Interceptor on MediaController

The `POST /media/presigned-url` endpoint does NOT use `RlsContextInterceptor` because:
1. It never queries the Postgres database — it only interacts with S3
2. The tenant context is extracted directly from `user.app_metadata.current_tenant_id` in the JWT
3. Opening a DB transaction + SET LOCAL for a non-DB operation would be wasteful

### Mux Webhook Signature Verification

Mux signs webhooks using HMAC-SHA256. The signature header format is:

```
mux-signature: t=<unix-timestamp>,v1=<hex-signature>
```

The signed payload is: `{timestamp}.{raw_body}`

Security measures:
1. **Signature verification** — HMAC-SHA256 with the Mux Webhook Signing Secret
2. **Timing-safe comparison** — `crypto.timingSafeEqual` prevents timing attacks
3. **Replay protection** — rejects signatures older than 5 minutes
4. **Raw body requirement** — NestJS must be bootstrapped with `rawBody: true` to access the unmodified request body (parsed JSON would produce a different HMAC)

### rawBody: true — Critical Configuration

The `NestFactory.create(AppModule, { rawBody: true })` option is **non-negotiable** for webhook signature verification. Without it, `req.rawBody` is `undefined` and the signature cannot be computed. This option makes the raw Buffer available alongside the parsed body — it does not affect normal JSON parsing for other routes.

---

## Step 6: Verification

```bash
export TOKEN="<admin-access-token>"
export MUX_WEBHOOK_SECRET="<your-mux-webhook-signing-secret>"
```

---

### Test 6.1 — Generate a pre-signed URL for image upload

```bash
curl -X POST http://localhost:3000/api/media/presigned-url \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"filename": "test_image.jpg", "contentType": "image/jpeg"}'
```

Expected: `200` with `uploadUrl` (long S3 URL with query params) and `fileKey` matching pattern `tenants/<uuid>/users/<uuid>/<timestamp>_test_image.jpg`.

- `[ ]` PASS — pre-signed URL generated with correct key namespace

---

### Test 6.2 — Upload a file to S3 using the pre-signed URL

```bash
# Save the uploadUrl from Test 6.1
export UPLOAD_URL="<uploadUrl-from-test-6.1>"

# Create a small test file
echo "test image content" > /tmp/test_image.jpg

# Upload directly to S3
curl -X PUT "$UPLOAD_URL" \
  -H "Content-Type: image/jpeg" \
  --upload-file /tmp/test_image.jpg
```

Expected: `200 OK` from S3. The file should be visible in the S3 console at the `fileKey` path.

- `[ ]` PASS — file uploaded successfully to S3 via pre-signed URL

---

### Test 6.3 — Reject unsupported content type

```bash
curl -X POST http://localhost:3000/api/media/presigned-url \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"filename": "malicious.exe", "contentType": "application/x-executable"}'
```

Expected: `400` — validation error about unsupported content type.

- `[ ]` PASS — unsupported MIME type rejected

---

### Test 6.4 — Reject unauthenticated pre-signed URL request

```bash
curl -X POST http://localhost:3000/api/media/presigned-url \
  -H "Content-Type: application/json" \
  -d '{"filename": "test.jpg", "contentType": "image/jpeg"}'
```

Expected: `401 Unauthorized`.

- `[ ]` PASS — unauthenticated request rejected

---

### Test 6.5 — Reject pre-signed URL without tenant context

```bash
# Use a token for a user who has NOT called switch-tenant
export NO_TENANT_TOKEN="<token-without-current_tenant_id>"

curl -X POST http://localhost:3000/api/media/presigned-url \
  -H "Authorization: Bearer $NO_TENANT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"filename": "test.jpg", "contentType": "image/jpeg"}'
```

Expected: `400` — "No active tenant context."

- `[ ]` PASS — missing tenant context rejected

---

### Test 6.6 — Filename sanitisation strips path traversal

```bash
curl -X POST http://localhost:3000/api/media/presigned-url \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"filename": "../../etc/passwd.jpg", "contentType": "image/jpeg"}'
```

Expected: `200` — the `fileKey` should contain a sanitised filename like `_____etc_passwd.jpg` or `passwd.jpg`, NOT `../../etc/passwd.jpg`.

- `[ ]` PASS — path traversal characters stripped from S3 key

---

### Test 6.7 — CRITICAL: Mux webhook with valid signature returns 200

```bash
# Generate a valid Mux webhook signature
TIMESTAMP=$(date +%s)
BODY='{"type":"video.asset.ready","data":{"id":"test-asset-id","playback_ids":[{"id":"test-playback-id","policy":"public"}]}}'
SIGNATURE=$(echo -n "${TIMESTAMP}.${BODY}" | openssl dgst -sha256 -hmac "$MUX_WEBHOOK_SECRET" | awk '{print $2}')

curl -X POST http://localhost:3000/api/webhooks/mux \
  -H "Content-Type: application/json" \
  -H "mux-signature: t=${TIMESTAMP},v1=${SIGNATURE}" \
  -d "$BODY"
```

Expected: `200` with `{ "received": true }`. Check backend logs for:
```
Mux webhook received: video.asset.ready
```

- `[ ]` PASS — valid Mux webhook accepted and logged

---

### Test 6.8 — CRITICAL: Mux webhook with invalid signature returns 401

```bash
TIMESTAMP=$(date +%s)
BODY='{"type":"video.asset.ready","data":{"id":"fake"}}'

curl -X POST http://localhost:3000/api/webhooks/mux \
  -H "Content-Type: application/json" \
  -H "mux-signature: t=${TIMESTAMP},v1=deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef" \
  -d "$BODY"
```

Expected: `401 Unauthorized` — "Invalid webhook signature".

- `[ ]` PASS — forged signature rejected

---

### Test 6.9 — CRITICAL: Mux webhook with missing signature returns 401

```bash
curl -X POST http://localhost:3000/api/webhooks/mux \
  -H "Content-Type: application/json" \
  -d '{"type":"video.asset.ready","data":{}}'
```

Expected: `401 Unauthorized` — "Missing mux-signature header".

- `[ ]` PASS — missing signature header rejected

---

### Test 6.10 — CRITICAL: Mux webhook with expired timestamp returns 401

```bash
# Use a timestamp from 10 minutes ago
OLD_TIMESTAMP=$(($(date +%s) - 600))
BODY='{"type":"video.asset.ready","data":{"id":"replay-attack"}}'
SIGNATURE=$(echo -n "${OLD_TIMESTAMP}.${BODY}" | openssl dgst -sha256 -hmac "$MUX_WEBHOOK_SECRET" | awk '{print $2}')

curl -X POST http://localhost:3000/api/webhooks/mux \
  -H "Content-Type: application/json" \
  -H "mux-signature: t=${OLD_TIMESTAMP},v1=${SIGNATURE}" \
  -d "$BODY"
```

Expected: `401 Unauthorized` — "Webhook timestamp outside tolerance window".

- `[ ]` PASS — replay attack with old timestamp rejected

---

### Test 6.11 — Phase 1 regression check

Re-run the following Phase 1 tests to confirm no regressions:

```bash
# Auth still works
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "admin@example.com", "password": "password"}'

# Posts still work
curl http://localhost:3000/api/posts \
  -H "Authorization: Bearer $TOKEN"

# Comments still work
curl http://localhost:3000/api/posts/$POST_ID/comments \
  -H "Authorization: Bearer $TOKEN"

# Notifications still work
curl http://localhost:3000/api/notifications \
  -H "Authorization: Bearer $TOKEN"
```

Expected: All return `200` with valid data.

- `[ ]` PASS — Phase 1 endpoints unaffected

---

## Step 7: Sign-Off

| Test | Owner | Result | Date |
| :--- | :--- | :--- | :--- |
| Migration 006 + CHECK constraint confirmed | DB Team | `[ ] PASS / [ ] FAIL` | |
| 6.1 Pre-signed URL generation | Backend | `[ ] PASS / [ ] FAIL` | |
| 6.2 S3 upload via pre-signed URL | Backend | `[ ] PASS / [ ] FAIL` | |
| 6.3 Unsupported content type rejected | Backend | `[ ] PASS / [ ] FAIL` | |
| 6.4 Unauthenticated request rejected | Backend | `[ ] PASS / [ ] FAIL` | |
| 6.5 Missing tenant context rejected | Backend | `[ ] PASS / [ ] FAIL` | |
| 6.6 Filename sanitisation (path traversal) | Backend | `[ ] PASS / [ ] FAIL` | |
| 6.7 Valid Mux webhook accepted (200) | Backend | `[ ] PASS / [ ] FAIL` | |
| 6.8 Forged Mux signature rejected (401) | Backend | `[ ] PASS / [ ] FAIL` | |
| 6.9 Missing Mux signature rejected (401) | Backend | `[ ] PASS / [ ] FAIL` | |
| 6.10 Expired Mux timestamp rejected (401) | Backend | `[ ] PASS / [ ] FAIL` | |
| 6.11 Phase 1 regression check | Backend | `[ ] PASS / [ ] FAIL` | |

**Signed off by:** ___________________________  **Date:** ___________

---

## Step 8: Next Steps (unlocked after sign-off)

### Backend Team — Week 5

1. **Update `PostsService.createPost`** to accept `mediaType`, `mediaUrl` fields and validate consistency:
   - `media_type: 'image'` → `media_url` required, `video_mux_playback_id` must be null
   - `media_type: 'video'` → trigger Mux upload via API, set `video_mux_playback_id` when `video.asset.ready` arrives
   - `media_type: 'text'` → both `media_url` and `video_mux_playback_id` must be null

2. **Wire Mux webhook handler** to update posts:
   - `video.asset.ready` → set `video_mux_playback_id` on the corresponding post
   - `video.asset.errored` → log error, optionally notify post author

3. **Mux Direct Upload** — generate Mux upload URLs for video (similar to S3 pre-signed pattern)

### Frontend Team

1. **File picker** — image/video selection with client-side validation (file type, max size)
2. **Upload flow** — `POST /media/presigned-url` → PUT to S3 → `POST /posts` with `mediaType` + `mediaUrl`/`fileKey`
3. **Image display** — render `media_url` in post cards (consider CloudFront CDN for production)
4. **Video player** — integrate Mux Player SDK with `video_mux_playback_id`
