# Go-To-Cloud Deployment Runbook

## Overview

Four-stage deployment strategy for the ChurchApp Platform backend.

| Stage | Goal | Owner |
|-------|------|-------|
| 1 | Supabase Production Setup | You (dashboard) |
| 2 | Data Migration (Schema + RLS) | You (CLI) |
| 3 | Backend Deployment (NestJS on Render) | You (dashboard + git push) |
| 4 | Final Configuration & Verification | You (manual) |

---

## Stage 1: Supabase Production Setup

**Goal:** Create the live production database and authentication service.

### Steps

1. **Create Project**
   - Go to [supabase.com/dashboard](https://supabase.com/dashboard)
   - Click "New Project" → name it `church-app-prod`
   - Choose region closest to your users (e.g., `us-east-1`)
   - Set a strong database password — **save it immediately**

2. **Collect Credentials** (Project Settings → API)
   - `SUPABASE_URL` — Project URL (e.g., `https://xyzcompany.supabase.co`)
   - `SUPABASE_ANON_KEY` — anon / public key
   - `SUPABASE_SERVICE_ROLE_KEY` — service_role secret key
   - `SUPABASE_JWT_SECRET` — JWT secret

3. **Get Database Connection String** (Project Settings → Database → Connection Pooling)
   - Copy the Transaction mode URI
   - Format: `postgres://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres`
   - Append `?pgbouncer=true` to the connection string

4. **Configure Auth** (Authentication → Settings)
   - **Disable** "Enable Email Confirmations" (simplifies initial testing; re-enable before public launch)
   - Under URL Configuration, leave defaults for now (updated in Stage 4)

5. **Enable Extensions** (SQL Editor → run these):
   ```sql
   CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
   CREATE EXTENSION IF NOT EXISTS "pg_trgm";
   ```

6. **Populate .env.production**
   - Open `backend/.env.production` (already created)
   - Fill in all 4 Supabase credentials + DATABASE_URL

### Verification
- [ ] Supabase dashboard shows project status: "Active"
- [ ] `.env.production` has all Supabase values filled in

---

## Stage 2: Data Migration (Local → Cloud)

**Goal:** Apply all 11 migration files and RLS policies to the production database.

### Option A: Using psql (Recommended)

Run each migration in order against the **direct connection** (not pooler):

```bash
# Get the DIRECT connection string from Supabase Dashboard > Settings > Database
# (port 5432, NOT the pooler on 6543)
export DIRECT_DB_URL="postgres://postgres.<ref>:<password>@db.<ref>.supabase.co:5432/postgres"

# Apply all migrations in order
for f in migrations/001_initial_schema_and_rls.sql \
         migrations/002_add_user_profile_fields.sql \
         migrations/003_posts_and_invitations.sql \
         migrations/004_comments.sql \
         migrations/005_notifications.sql \
         migrations/006_media_columns.sql \
         migrations/007_follows_and_global_posts.sql \
         migrations/008_chat.sql \
         migrations/009_full_text_search.sql \
         migrations/010_stripe_giving.sql \
         migrations/011_gdpr_compliance.sql; do
  echo "Applying $f..."
  psql "$DIRECT_DB_URL" -f "$f"
done
```

### Option B: Using Supabase CLI

```bash
# Link to your remote project
supabase link --project-ref <your-project-ref>

# Push migrations
supabase db push --db-url "$DIRECT_DB_URL"
```

### Option C: Supabase SQL Editor (Manual)

Copy-paste each migration file into the SQL Editor and execute in order (001 → 011).

### Post-Migration Verification

Run in SQL Editor:
```sql
-- Verify all tables exist
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;

-- Verify RLS is enabled
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public' AND rowsecurity = true
ORDER BY tablename;

-- Verify extensions
SELECT extname FROM pg_extension
WHERE extname IN ('uuid-ossp', 'pg_trgm');
```

Expected tables: `channel_members`, `channels`, `comments`, `follows`, `invitations`, `memberships`, `messages`, `notifications`, `posts`, `stripe_accounts`, `tenants`, `transactions`, `users`

### Seed Super Admin (Optional)

```sql
-- Create the platform tenant
INSERT INTO public.tenants (id, name, slug, plan)
VALUES (
  gen_random_uuid(),
  'Platform Admin',
  'platform-admin',
  'enterprise'
);

-- After signing up via the API, promote a user to super admin
-- (handled by SUPER_ADMIN_EMAILS env var in the app)
```

### Verification
- [ ] All 13 tables visible in Supabase Table Editor
- [ ] RLS enabled on all tenant-scoped tables
- [ ] Extensions uuid-ossp and pg_trgm active
- [ ] No migration errors in output

---

## Stage 3: Backend Deployment (NestJS on Render)

**Goal:** Deploy the NestJS API to Render.

### Pre-Deployment: Git Setup

```bash
cd "backend"

# Initialize git repo if not already done
git init
git add .
git commit -m "Initial backend deployment"

# Push to GitHub (create repo first on github.com)
git remote add origin https://github.com/<your-org>/church-app-backend.git
git branch -M main
git push -u origin main
```

### Deploy to Render

1. **Connect Repository**
   - Go to [render.com/dashboard](https://render.com/dashboard)
   - Click "New" → "Web Service"
   - Connect your GitHub account and select the `church-app-backend` repo
   - Render auto-detects `render.yaml` in the project root

2. **Configure Environment Variables**
   - Go to your service → "Environment" tab
   - Add **every** variable from `.env.production`:

   | Variable | Source |
   |----------|--------|
   | `SUPABASE_URL` | Stage 1 |
   | `SUPABASE_ANON_KEY` | Stage 1 |
   | `SUPABASE_SERVICE_ROLE_KEY` | Stage 1 |
   | `SUPABASE_JWT_SECRET` | Stage 1 |
   | `DATABASE_URL` | Stage 1 (pooler URL with `?pgbouncer=true`) |
   | `REDIS_HOST` | Upstash dashboard |
   | `REDIS_PORT` | `6379` |
   | `REDIS_PASSWORD` | Upstash dashboard |
   | `AWS_ACCESS_KEY_ID` | AWS IAM |
   | `AWS_SECRET_ACCESS_KEY` | AWS IAM |
   | `S3_BUCKET` | Your S3 bucket name |
   | `S3_REGION` | `us-east-1` |
   | `STRIPE_SECRET_KEY` | Stripe dashboard (live key) |
   | `STRIPE_WEBHOOK_SECRET` | Stripe dashboard (created in step 4) |
   | `MUX_WEBHOOK_SECRET` | Mux dashboard |
   | `ONESIGNAL_APP_ID` | OneSignal dashboard |
   | `ONESIGNAL_REST_API_KEY` | OneSignal dashboard |
   | `SUPER_ADMIN_EMAILS` | Your admin email(s) |

3. **Deploy**
   - Click "Create Web Service" or "Manual Deploy"
   - Watch build logs: `npm install` → `npm run build` → `npm run start:prod`
   - Render assigns a URL: `https://church-app-backend.onrender.com`

### Verification
- [ ] Build logs show no errors
- [ ] Service status: "Live"
- [ ] Note the deployed URL for Stage 4

---

## Stage 4: Final Configuration & Verification

**Goal:** Wire up external services to the deployed backend and smoke test.

### 4.1 — Update Supabase Auth Redirects

- Dashboard → Authentication → URL Configuration
- **Site URL:** `https://church-app-backend.onrender.com`
- **Redirect URLs:** add `https://church-app-backend.onrender.com/**`

### 4.2 — Set Up Production Redis (Upstash)

1. Go to [console.upstash.com](https://console.upstash.com)
2. Create a new Redis database (choose region matching your Render deployment)
3. Copy: endpoint, port, password
4. Update `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD` in Render env vars
5. Redeploy the Render service

### 4.3 — Configure Stripe Webhooks

1. Go to Stripe Dashboard → Developers → Webhooks
2. Add endpoint: `https://church-app-backend.onrender.com/api/webhooks/stripe`
3. Select events: `account.updated`, `payment_intent.succeeded`, `payment_intent.payment_failed`
4. Copy the signing secret → update `STRIPE_WEBHOOK_SECRET` in Render
5. Redeploy

### 4.4 — Configure Mux Webhooks

1. Go to Mux Dashboard → Settings → Webhooks
2. Add endpoint: `https://church-app-backend.onrender.com/api/webhooks/mux`
3. Copy the signing secret → update `MUX_WEBHOOK_SECRET` in Render
4. Redeploy

### 4.5 — Smoke Tests

Run these from your terminal or Postman:

```bash
BACKEND_URL="https://church-app-backend.onrender.com"

# 1. Liveness probe
curl -s "$BACKEND_URL/api/health" | jq .
# Expected: { "status": "ok", "timestamp": "..." }

# 2. Readiness probe (DB connected)
curl -s "$BACKEND_URL/api/health/ready" | jq .
# Expected: { "status": "ok", "database": "connected", "timestamp": "..." }

# 3. Swagger UI loads
curl -s -o /dev/null -w "%{http_code}" "$BACKEND_URL/api/docs"
# Expected: 200

# 4. Sign up a test user
curl -s -X POST "$BACKEND_URL/api/auth/signup" \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"TestPass123!","displayName":"Test User"}' | jq .
# Expected: 201 with { accessToken, refreshToken, user }

# 5. Rate limiting active (hit auth endpoint 6 times rapidly)
for i in {1..6}; do
  curl -s -o /dev/null -w "Attempt $i: %{http_code}\n" \
    -X POST "$BACKEND_URL/api/auth/login" \
    -H "Content-Type: application/json" \
    -d '{"email":"test@example.com","password":"wrong"}'
done
# Expected: First 5 return 401, 6th returns 429 (Too Many Requests)
```

### Verification Checklist
- [ ] `GET /api/health` → `{ "status": "ok" }`
- [ ] `GET /api/health/ready` → `{ "database": "connected" }`
- [ ] Swagger UI loads at `/api/docs`
- [ ] User signup returns 201
- [ ] Rate limiting returns 429 after 5 auth attempts
- [ ] Stripe webhook test event returns 200
- [ ] Mux webhook test event returns 200

---

## Post-Launch Hardening (Do within 48 hours)

- [ ] Re-enable email confirmations in Supabase Auth settings
- [ ] Set up a custom domain for the Render service (e.g., `api.yourchurch.app`)
- [ ] Add the custom domain to Supabase Auth redirect URLs
- [ ] Enable Render auto-deploy on `main` branch pushes
- [ ] Set up Sentry for error tracking (`SENTRY_DSN` env var)
- [ ] Set up Uptime monitoring (UptimeRobot, Better Uptime) on `/api/health`
- [ ] Review Stripe webhook event types for completeness
- [ ] Back up `.env.production` in a password manager (1Password, Bitwarden)
