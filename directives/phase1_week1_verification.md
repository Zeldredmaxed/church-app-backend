# Directive: Phase 1, Week 1 — Database & RLS Verification

**Status:** `[ ] In Progress`  
**Owner:** Database Team  
**Blocking:** Backend NestJS initialization, Frontend Auth integration  
**Migration file:** `migrations/001_initial_schema_and_rls.sql`

> This document is a step-by-step execution checklist. Each test must be run, the result recorded, and the checkbox ticked before the team signs off on Week 1. Do not proceed to Week 2 with any failing test.

---

## Step 1: Apply the Migration

Run the migration script against the **development** Supabase project only.

```bash
# Option A: Supabase CLI (preferred)
supabase db push

# Option B: psql direct connection
# Retrieve the DB connection string from: Supabase Dashboard → Settings → Database
psql "postgresql://postgres:<password>@<host>:5432/postgres" \
  -f migrations/001_initial_schema_and_rls.sql
```

> [!CAUTION]
> Never run this against the production project. The development project must be a separate Supabase instance with its own API keys.

**Checklist:**
- `[ ]` Migration ran to completion with no errors
- `[ ]` No `ERROR:` lines in the psql output

---

## Step 2: Structural Verification

Run these in the **Supabase Studio SQL editor** (or any DB client connected with the **service role**). These are read-only structure checks — they do not test RLS.

### 2a — Tables and columns

```sql
SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('tenants', 'users', 'tenant_memberships')
ORDER BY table_name, ordinal_position;
```

**Expected:** 3 tables, matching exactly the columns defined in `001_initial_schema_and_rls.sql § Section 2`.

---

### 2b — RLS enabled and forced on all tables

```sql
SELECT tablename, rowsecurity AS rls_enabled, forcerowsecurity AS rls_forced
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('tenants', 'users', 'tenant_memberships');
```

**Expected:**

| tablename | rls_enabled | rls_forced |
| :--- | :--- | :--- |
| tenants | true | true |
| users | true | true |
| tenant_memberships | true | true |

---

### 2c — All policies installed

```sql
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('tenants', 'users', 'tenant_memberships')
ORDER BY tablename, policyname;
```

**Expected:** Exactly 8 policies:

| tablename | policyname | cmd |
| :--- | :--- | :--- |
| tenant_memberships | memberships: delete by admin or self-removal | DELETE |
| tenant_memberships | memberships: insert by admin or pastor | INSERT |
| tenant_memberships | memberships: select within current tenant | SELECT |
| tenant_memberships | memberships: update role by admin only | UPDATE |
| tenants | tenants: select own current context | SELECT |
| tenants | tenants: update by tenant admin only | UPDATE |
| users | users: select self or same-tenant member | SELECT |
| users | users: update self only | UPDATE |

---

### 2d — Both trigger functions installed

```sql
SELECT routine_name, security_type
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN ('handle_new_user', 'handle_tenant_context_switch');
```

**Expected:** Both functions present with `security_type = 'DEFINER'`.

---

### 2e — Both triggers active

```sql
SELECT trigger_name, event_object_schema, event_object_table, action_timing, event_manipulation
FROM information_schema.triggers
WHERE trigger_name IN ('on_auth_user_created', 'on_tenant_switch')
ORDER BY trigger_name;
```

**Expected:**

| trigger_name | event_object_schema | event_object_table | action_timing | event_manipulation |
| :--- | :--- | :--- | :--- | :--- |
| on_auth_user_created | auth | users | AFTER | INSERT |
| on_tenant_switch | public | users | AFTER | UPDATE |

---

### 2f — Performance indexes installed

```sql
SELECT indexname, tablename, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('users', 'tenant_memberships')
  AND indexname LIKE 'idx_%'
ORDER BY tablename, indexname;
```

**Expected:** 3 indexes on `tenant_memberships(tenant_id)`, `tenant_memberships(user_id)`, and `users(last_accessed_tenant_id)`.

**Checklist:**
- `[ ]` All 3 tables present with correct columns
- `[ ]` RLS enabled AND forced on all 3 tables
- `[ ]` All 8 policies installed with correct `cmd` values
- `[ ]` Both trigger functions present as `SECURITY DEFINER`
- `[ ]` Both triggers active on correct tables and schemas
- `[ ]` All 3 performance indexes present

---

## Step 3: RLS Behaviour Verification

> [!IMPORTANT]
> All tests in this section MUST be run using the **`anon` or `authenticated` role**, NOT the service role. The service role bypasses RLS entirely and will give false positives.
>
> In Supabase Studio, switch to the **"Table Editor"** or use the SQL editor with the role override blocks below.

### Setup: Seed test data (run as service role)

Run this once before the tests below. It creates two isolated churches and two users — one who is an admin of Church A, and one who is a member of Church B.

```sql
-- ============================================================
-- TEST SEED DATA — run as service role, development DB only
-- ============================================================

-- 1. Create two tenant (church) records
INSERT INTO public.tenants (id, name) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Church Alpha'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'Church Beta');

-- 2. Create two auth users (simulated — Supabase normally does this on signup)
-- NOTE: In a real environment these rows are created by Supabase Auth.
-- For testing, insert directly into auth.users as service role.
INSERT INTO auth.users (id, email, raw_app_meta_data, aud, role)
VALUES
  (
    'user-aaaa-0000-0000-000000000001',
    'alice@churchalpha.com',
    '{"current_tenant_id": "aaaaaaaa-0000-0000-0000-000000000001"}',
    'authenticated',
    'authenticated'
  ),
  (
    'user-bbbb-0000-0000-000000000002',
    'bob@churchbeta.com',
    '{"current_tenant_id": "bbbbbbbb-0000-0000-0000-000000000002"}',
    'authenticated',
    'authenticated'
  );
-- The handle_new_user trigger should auto-insert into public.users.
-- Verify it fired:
SELECT id, email, last_accessed_tenant_id FROM public.users;

-- 3. Set context and memberships
UPDATE public.users
  SET last_accessed_tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
  WHERE id = 'user-aaaa-0000-0000-000000000001';

UPDATE public.users
  SET last_accessed_tenant_id = 'bbbbbbbb-0000-0000-0000-000000000002'
  WHERE id = 'user-bbbb-0000-0000-000000000002';

INSERT INTO public.tenant_memberships (user_id, tenant_id, role) VALUES
  ('user-aaaa-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'admin'),
  ('user-bbbb-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000002', 'member');
```

---

### Test 3.1 — Tenant isolation: user cannot see another tenant's data

**Scenario:** Alice (Church Alpha admin) must not be able to see Church Beta in the `tenants` table.

```sql
-- Simulate Alice's authenticated session
SET LOCAL role = 'authenticated';
SET LOCAL request.jwt.claims = '{
  "sub":          "user-aaaa-0000-0000-000000000001",
  "role":         "authenticated",
  "app_metadata": { "current_tenant_id": "aaaaaaaa-0000-0000-0000-000000000001" }
}';

SELECT id, name FROM public.tenants;

RESET role;
```

**Expected:** Exactly **1 row** — Church Alpha only. Church Beta must not appear.  
**Failure mode:** If 0 rows appear, the JSONB extraction syntax is wrong. If 2 rows appear, RLS is not applied.

- `[ ]` PASS — only Church Alpha returned

---

### Test 3.2 — Membership isolation: user cannot see another tenant's members

**Scenario:** Alice must not be able to see Bob's Church Beta membership record.

```sql
SET LOCAL role = 'authenticated';
SET LOCAL request.jwt.claims = '{
  "sub":          "user-aaaa-0000-0000-000000000001",
  "role":         "authenticated",
  "app_metadata": { "current_tenant_id": "aaaaaaaa-0000-0000-0000-000000000001" }
}';

SELECT user_id, tenant_id, role FROM public.tenant_memberships;

RESET role;
```

**Expected:** Exactly **1 row** — Alice's membership in Church Alpha. Bob's Church Beta membership must not appear.

- `[ ]` PASS — only Alice's membership returned

---

### Test 3.3 — Privilege escalation: member cannot add memberships to another tenant

**Scenario:** Bob (Church Beta member) attempts to insert a membership row for Church Alpha. This must be blocked by the INSERT policy.

```sql
SET LOCAL role = 'authenticated';
SET LOCAL request.jwt.claims = '{
  "sub":          "user-bbbb-0000-0000-000000000002",
  "role":         "authenticated",
  "app_metadata": { "current_tenant_id": "bbbbbbbb-0000-0000-0000-000000000002" }
}';

-- Attempt to insert a membership for Church Alpha (a tenant Bob has no role in)
INSERT INTO public.tenant_memberships (user_id, tenant_id, role)
VALUES ('user-bbbb-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'admin');

RESET role;
```

**Expected:** `ERROR: new row violates row-level security policy for table "tenant_memberships"`  
**Failure mode:** If the INSERT succeeds, the `WITH CHECK` clause on the INSERT policy is broken.

- `[ ]` PASS — INSERT blocked with RLS error

---

### Test 3.4 — Privilege escalation: `member` role cannot insert memberships even within own tenant

**Scenario:** Bob is a `member`, not an admin or pastor. He must not be able to invite others into Church Beta.

```sql
SET LOCAL role = 'authenticated';
SET LOCAL request.jwt.claims = '{
  "sub":          "user-bbbb-0000-0000-000000000002",
  "role":         "authenticated",
  "app_metadata": { "current_tenant_id": "bbbbbbbb-0000-0000-0000-000000000002" }
}';

-- Bob attempts to add a new member to his own church — he is only a 'member', not admin/pastor
INSERT INTO public.tenant_memberships (user_id, tenant_id, role)
VALUES ('user-aaaa-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002', 'member');

RESET role;
```

**Expected:** `ERROR: new row violates row-level security policy` — Bob's `member` role fails the `EXISTS (role IN ('admin', 'pastor'))` check.

- `[ ]` PASS — INSERT blocked for member role

---

### Test 3.5 — Auth sync trigger: `handle_tenant_context_switch` writes to `auth.users`

**Scenario:** Simulate an admin updating `last_accessed_tenant_id` (as the `POST /api/auth/switch-tenant` backend endpoint would do) and confirm the trigger fires and updates `auth.users.raw_app_meta_data`.

```sql
-- Run as service role for this trigger test
-- Step 1: Record the current state
SELECT id, raw_app_meta_data
FROM auth.users
WHERE id = 'user-aaaa-0000-0000-000000000001';

-- Step 2: Simulate a tenant context switch (as the backend would do)
UPDATE public.users
  SET last_accessed_tenant_id = 'bbbbbbbb-0000-0000-0000-000000000002'
  WHERE id = 'user-aaaa-0000-0000-000000000001';

-- Step 3: Verify auth.users was updated by the trigger
SELECT id, raw_app_meta_data -> 'current_tenant_id' AS current_tenant_id
FROM auth.users
WHERE id = 'user-aaaa-0000-0000-000000000001';
```

**Expected:** `current_tenant_id` in `auth.users.raw_app_meta_data` must now equal `"bbbbbbbb-0000-0000-0000-000000000002"`.  
**Failure mode:** If `raw_app_meta_data` is unchanged, the trigger did not fire. Check trigger status with the query in Step 2e above.

```sql
-- Step 4: Switch back to original context (restore test state)
UPDATE public.users
  SET last_accessed_tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
  WHERE id = 'user-aaaa-0000-0000-000000000001';
```

- `[ ]` PASS — `raw_app_meta_data.current_tenant_id` updated correctly by trigger

---

### Test 3.6 — Bootstrap trigger: `handle_new_user` creates public profile on signup

**Scenario:** Simulate a new Supabase Auth signup (direct INSERT into `auth.users`) and confirm `handle_new_user` auto-creates the `public.users` row.

```sql
-- Run as service role
-- Step 1: Confirm this user does NOT yet exist in public.users
SELECT id FROM public.users WHERE id = 'user-cccc-0000-0000-000000000003';

-- Step 2: Simulate Supabase Auth signup
INSERT INTO auth.users (id, email, raw_app_meta_data, aud, role)
VALUES (
  'user-cccc-0000-0000-000000000003',
  'carol@newchurch.com',
  '{}',
  'authenticated',
  'authenticated'
);

-- Step 3: Verify public.users row was auto-created by the trigger
SELECT id, email, last_accessed_tenant_id FROM public.users
WHERE id = 'user-cccc-0000-0000-000000000003';
```

**Expected:** A row with `id = 'user-cccc-...'`, `email = 'carol@newchurch.com'`, and `last_accessed_tenant_id = NULL`.  
**Failure mode:** If no row appears, the `on_auth_user_created` trigger did not fire. This will cause all RLS policies to fail for new signups.

- `[ ]` PASS — `public.users` row created automatically on auth signup

---

### Test 3.7 — Cleanup (run after all tests pass)

```sql
-- Remove test seed data — run as service role
DELETE FROM auth.users WHERE id IN (
  'user-aaaa-0000-0000-000000000001',
  'user-bbbb-0000-0000-000000000002',
  'user-cccc-0000-0000-000000000003'
);
-- Cascade deletes will clean public.users and tenant_memberships automatically.

DELETE FROM public.tenants WHERE id IN (
  'aaaaaaaa-0000-0000-0000-000000000001',
  'bbbbbbbb-0000-0000-0000-000000000002'
);
```

- `[ ]` Test data cleaned up

---

## Step 4: Sign-Off

All boxes in Steps 1–3 must be checked before marking this directive complete.

| Test | Owner | Result | Date |
| :--- | :--- | :--- | :--- |
| Migration applies cleanly | DB Team | `[ ] PASS / [ ] FAIL` | |
| Structural verification (2a–2f) | DB Team | `[ ] PASS / [ ] FAIL` | |
| 3.1 Tenant isolation | DB Team | `[ ] PASS / [ ] FAIL` | |
| 3.2 Membership isolation | DB Team | `[ ] PASS / [ ] FAIL` | |
| 3.3 Cross-tenant INSERT blocked | DB Team | `[ ] PASS / [ ] FAIL` | |
| 3.4 Member role INSERT blocked | DB Team | `[ ] PASS / [ ] FAIL` | |
| 3.5 Auth sync trigger fires | DB Team | `[ ] PASS / [ ] FAIL` | |
| 3.6 Bootstrap trigger fires | DB Team | `[ ] PASS / [ ] FAIL` | |

**Signed off by:** ___________________________  **Date:** ___________

---

## Step 5: Next Steps (unlocked after sign-off)

### Backend Team — Initialize NestJS Monolith

```bash
npm install -g @nestjs/cli
nest new church-platform-api --strict
cd church-platform-api
npm install @nestjs/bullmq bullmq ioredis @supabase/supabase-js
```

Initial module structure to scaffold:
```
src/
  auth/          ← switch-tenant endpoint, device-token endpoint
  tenants/       ← tenant CRUD (admin only, service role)
  users/         ← user profile endpoints
  app.module.ts  ← BullMQ queue registration (3 queues + DLQ config)
```

Reference: Architecture Document § 3, Decision 2 for BullMQ queue names and DLQ config.

---

### Frontend / Mobile Team — Supabase Auth Integration

API contracts to define and document as OpenAPI specs before implementation begins:

**1. Device token registration**
```
POST /api/users/device-token
Body: { token: string, platform: "ios" | "android" | "web" }
Auth: Bearer <supabase_access_token>
```

**2. Tenant context switch**
```
POST /api/auth/switch-tenant
Body: { tenantId: string }
Auth: Bearer <supabase_access_token>
Response: { message: "context switched" }
```

> [!IMPORTANT]
> After a successful `POST /api/auth/switch-tenant`, the client **must** call `supabase.auth.refreshSession()` before making any further API requests. The old JWT still carries the previous `current_tenant_id` claim and will pass the wrong tenant filter through to RLS.
