# Phase 4, Week 11: GDPR Compliance & Data Hygiene — Verification Directive

> **Status:** Implementation Complete  
> **Prerequisite:** Phase 4, Week 10 (Rate Limiting & Security) verified and approved  
> **Deliverables:** Migration 011, account deletion endpoint, data export endpoint, S3 cleanup

---

## Architecture Decisions

### 1. ON DELETE SET NULL for Transactions (Not CASCADE)
Financial records are exempt from GDPR's Right to Erasure under Recital 65 — data may be retained when "necessary for compliance with a legal obligation." Stripe requires transaction records for dispute resolution, and tax/accounting laws require retention.

When a user is deleted:
- `transactions.user_id` is set to `NULL` (anonymized)
- The transaction amount, currency, status, and Stripe PaymentIntent ID are preserved
- The record is no longer linkable to a specific individual

All other user-referencing foreign keys remain ON DELETE CASCADE (13 FKs across 9 tables).

### 2. Service-Role Deletion (Not RLS-Scoped)
Account deletion uses `DataSource.manager` (service role) instead of the RLS-scoped QueryRunner because:
- The deletion must cascade across **all tenants** the user belongs to
- RLS would restrict the operation to the user's current tenant context only
- Service-role access is safe here because the user can only delete themselves (identity verified via JWT `sub`)

### 3. S3 Cleanup is Best-Effort
S3 object deletion is attempted before the database deletion but failures are logged and swallowed:
- Orphaned S3 objects are harmless (no DB reference = no access path)
- S3 lifecycle rules can clean up orphans periodically
- Blocking account deletion on S3 failures would be a poor UX

### 4. Auth Deletion Order: PG First, Then Supabase
The deletion order is:
1. `public.users` DELETE (cascades through all PG tables)
2. `auth.users` DELETE via Supabase Admin API (revokes sessions)

This order ensures that even if the Supabase API call fails, the user's personal data is already erased from the application database. An orphaned `auth.users` row with no corresponding `public.users` row is harmless.

### 5. Data Export Uses Service Role
The export endpoint uses service-role access (not RLS) to ensure completeness:
- RLS would only export data from the user's **current** tenant
- A user who belongs to 3 churches should see data from all 3 in their export
- The endpoint still requires JWT authentication — the user can only export their own data

### 6. No RLS Interceptor on GDPR Endpoints
`DELETE /users/me` and `GET /users/me/export` do NOT use `RlsContextInterceptor`:
- They operate across tenant boundaries via service-role
- Authentication alone is sufficient — `user.sub` from JWT ensures self-only access
- The existing `GET /users/me` and `PATCH /users/me` retain RLS for tenant-scoped profile access

---

## Files Created / Modified

### New Files
| File | Purpose |
|------|---------|
| `migrations/011_gdpr_compliance.sql` | ALTER transactions.user_id to nullable + ON DELETE SET NULL |

### Modified Files
| File | Change |
|------|--------|
| `backend/src/users/users.service.ts` | Added `deleteMe()`, `exportData()`, Supabase admin client, MediaService injection |
| `backend/src/users/users.controller.ts` | Added `DELETE /users/me`, `GET /users/me/export`; moved RLS interceptor to per-method |
| `backend/src/users/users.module.ts` | Added `MediaModule` import for S3 cleanup dependency |
| `backend/src/giving/entities/transaction.entity.ts` | Made `userId` nullable (`string \| null`) |
| `backend/src/media/media.service.ts` | Added `deleteUserObjects()` for S3 bulk cleanup |

---

## API Endpoints

### GDPR Endpoints
| Method | Path | Auth | RLS | Description |
|--------|------|------|-----|-------------|
| `DELETE` | `/users/me` | JWT | No (service-role) | Permanently delete account + all data |
| `GET` | `/users/me/export` | JWT | No (service-role) | Export all personal data as JSON |

### Existing Endpoints (Unchanged)
| Method | Path | Auth | RLS | Description |
|--------|------|------|-----|-------------|
| `GET` | `/users/me` | JWT | Yes | Get own profile |
| `PATCH` | `/users/me` | JWT | Yes | Update own profile |

---

## Data Deletion Cascade Map

When `DELETE FROM public.users WHERE id = $1` executes:

| Table | FK Column | ON DELETE | Effect |
|-------|-----------|-----------|--------|
| `tenant_memberships` | `user_id` | CASCADE | All memberships removed |
| `posts` | `author_id` | CASCADE | All posts deleted |
| `invitations` | `invited_by` | CASCADE | All sent invitations deleted |
| `comments` | `author_id` | CASCADE | All comments deleted |
| `notifications` | `recipient_id` | CASCADE | All notifications deleted |
| `follows` | `follower_id` | CASCADE | All "following" relationships deleted |
| `follows` | `following_id` | CASCADE | All "follower" relationships deleted |
| `chat_channels` | `created_by` | CASCADE | All created channels deleted |
| `channel_members` | `user_id` | CASCADE | All channel memberships deleted |
| `chat_messages` | `user_id` | CASCADE | All messages deleted |
| **`transactions`** | **`user_id`** | **SET NULL** | **Records preserved, user_id → NULL** |

**S3 Objects:** Deleted before PG cascade (best-effort, all tenant namespaces).
**auth.users:** Deleted after PG cascade via Supabase Admin API.

---

## Data Export Schema

`GET /users/me/export` returns:

```json
{
  "exportedAt": "2026-04-03T12:00:00.000Z",
  "profile": {
    "id": "uuid",
    "email": "user@example.com",
    "full_name": "John Doe",
    "avatar_url": "https://...",
    "created_at": "2026-01-15T..."
  },
  "posts": [
    { "id": "uuid", "tenant_id": "uuid", "content": "...", "media_url": "...", "media_type": "...", "created_at": "..." }
  ],
  "comments": [
    { "id": "uuid", "post_id": "uuid", "content": "...", "created_at": "..." }
  ],
  "chatMessages": [
    { "id": "uuid", "channel_id": "uuid", "content": "...", "created_at": "..." }
  ],
  "transactions": [
    { "id": "uuid", "tenant_id": "uuid", "amount": "100.00", "currency": "usd", "status": "succeeded", "created_at": "..." }
  ],
  "memberships": [
    { "tenant_id": "uuid", "tenant_name": "First Baptist", "role": "member", "created_at": "..." }
  ],
  "follows": {
    "following": [{ "userId": "uuid", "since": "..." }],
    "followers": [{ "userId": "uuid", "since": "..." }]
  }
}
```

---

## Verification Tests

### Migration Tests

#### Test 1: transactions.user_id Is Nullable
```sql
SELECT column_name, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'transactions'
  AND column_name = 'user_id';
```
**Expected:** `is_nullable = 'YES'`

#### Test 2: FK Constraint Is ON DELETE SET NULL
```sql
SELECT
  tc.constraint_name,
  rc.delete_rule
FROM information_schema.table_constraints tc
JOIN information_schema.referential_constraints rc
  ON tc.constraint_name = rc.constraint_name
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name
WHERE tc.table_schema = 'public'
  AND tc.table_name = 'transactions'
  AND kcu.column_name = 'user_id';
```
**Expected:** `delete_rule = 'SET NULL'`

#### Test 3: All Other FKs Remain CASCADE
```sql
SELECT
  tc.table_name, kcu.column_name, rc.delete_rule
FROM information_schema.table_constraints tc
JOIN information_schema.referential_constraints rc
  ON tc.constraint_name = rc.constraint_name
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name
WHERE tc.table_schema = 'public'
  AND tc.constraint_type = 'FOREIGN KEY'
  AND kcu.column_name = 'user_id'
  AND tc.table_name != 'transactions'
ORDER BY tc.table_name;
```
**Expected:** All rows show `delete_rule = 'CASCADE'`

### Account Deletion Tests

#### Test 4: Full Account Deletion — Cascade Verified
```bash
# Setup: Create user, post, comment, chat message, follow, donation
# Then delete account:
curl -X DELETE http://localhost:3000/api/users/me \
  -H "Authorization: Bearer <jwt>"
```
**Expected:** `200 OK` with `{ "deleted": true }`

Post-deletion verification:
```sql
-- User row gone
SELECT count(*) FROM public.users WHERE id = '<user_id>';
-- Expected: 0

-- Posts cascade deleted
SELECT count(*) FROM public.posts WHERE author_id = '<user_id>';
-- Expected: 0

-- Comments cascade deleted
SELECT count(*) FROM public.comments WHERE author_id = '<user_id>';
-- Expected: 0

-- Chat messages cascade deleted
SELECT count(*) FROM public.chat_messages WHERE user_id = '<user_id>';
-- Expected: 0

-- Notifications cascade deleted
SELECT count(*) FROM public.notifications WHERE recipient_id = '<user_id>';
-- Expected: 0

-- Follows cascade deleted (both directions)
SELECT count(*) FROM public.follows
WHERE follower_id = '<user_id>' OR following_id = '<user_id>';
-- Expected: 0

-- Memberships cascade deleted
SELECT count(*) FROM public.tenant_memberships WHERE user_id = '<user_id>';
-- Expected: 0
```

#### Test 5: Transactions Preserved with NULL user_id
```sql
-- After user deletion, their transactions remain but are anonymized
SELECT id, user_id, amount, status FROM public.transactions
WHERE stripe_payment_intent_id = '<known_pi_id>';
```
**Expected:** Row exists. `user_id = NULL`. Amount, status, and all other financial fields are intact.

#### Test 6: Auth.users Revoked After Deletion
```bash
# After deletion, try to use the old JWT
curl -H "Authorization: Bearer <old_jwt>" http://localhost:3000/api/users/me
```
**Expected:** `401 Unauthorized` — the JWT is still technically valid (not expired), but the `public.users` row no longer exists, so `getMe()` returns 404. Additionally, `POST /auth/refresh` with the old refresh token will fail because the `auth.users` row has been deleted.

#### Test 7: Deletion Is Self-Only
```bash
# User A cannot delete User B's account
# There is no endpoint to delete another user — DELETE /users/me only
# accepts the JWT's own sub. No user_id parameter is exposed.
```
**Expected:** By design, there is no way to specify another user's ID. The `user.sub` from the JWT is the only input to `deleteMe()`.

#### Test 8: Deletion Without Tenant Context
```bash
# A user who has never joined a tenant can still delete their account
curl -X DELETE http://localhost:3000/api/users/me \
  -H "Authorization: Bearer <jwt_no_tenant>"
```
**Expected:** `200 OK` with `{ "deleted": true }`. The S3 cleanup step is skipped (empty tenant list), the public.users row is deleted, and auth.users is removed.

#### Test 9: Deleted User Cannot Re-Authenticate
```bash
# After deletion, try to log in again
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "deleted@example.com", "password": "password123"}'
```
**Expected:** `401 Unauthorized` — "Invalid email or password". The `auth.users` row no longer exists.

### Data Export Tests

#### Test 10: Export Returns Complete Data Structure
```bash
curl http://localhost:3000/api/users/me/export \
  -H "Authorization: Bearer <jwt>"
```
**Expected:** `200 OK` with JSON containing all 7 top-level keys: `exportedAt`, `profile`, `posts`, `comments`, `chatMessages`, `transactions`, `memberships`, `follows`.

#### Test 11: Export Includes Data from All Tenants
```bash
# User belongs to Tenant A and Tenant B
# User has posts in Tenant A and messages in Tenant B
curl http://localhost:3000/api/users/me/export \
  -H "Authorization: Bearer <jwt_tenant_a>"
```
**Expected:** Export includes posts from Tenant A AND messages from Tenant B. The service-role query is not limited by the current tenant context.

#### Test 12: Export Is Self-Only
```bash
# Like deletion, export only returns the authenticated user's data.
# No user_id parameter is exposed.
```
**Expected:** The export contains only data where `user_id/author_id = JWT.sub`.

#### Test 13: Export for New User (Empty Data)
```bash
# Newly created user with no content
curl http://localhost:3000/api/users/me/export \
  -H "Authorization: Bearer <new_user_jwt>"
```
**Expected:** `200 OK` with `profile` populated, all arrays empty (`posts: []`, `comments: []`, etc.).

#### Test 14: Export Does Not Include Other Users' Data
```bash
# User A exports data
# Verify that User B's posts/comments/messages do NOT appear
```
**Expected:** All returned records have `author_id` or `user_id` matching the authenticated user. No cross-user data leakage.

### Edge Case Tests

#### Test 15: Double Deletion Attempt
```bash
# User deletes account, then somehow sends another DELETE request
# (e.g., cached JWT before expiry)
curl -X DELETE http://localhost:3000/api/users/me \
  -H "Authorization: Bearer <old_jwt>"
```
**Expected:** `404 Not Found` — "User not found". The first deletion already removed the row; the second attempt is a no-op.

#### Test 16: Rate Limiting Applies to GDPR Endpoints
```bash
# GDPR endpoints are NOT excluded from rate limiting
# They use the default 100 req/min limit
for i in {1..101}; do
  curl -s -o /dev/null -w "%{http_code}\n" \
    -H "Authorization: Bearer <jwt>" \
    http://localhost:3000/api/users/me/export
done
```
**Expected:** Request 101 returns `429 Too Many Requests`. GDPR endpoints are protected against abuse.

---

## Compliance Summary

### GDPR Articles Addressed

| Article | Right | Implementation |
|---------|-------|----------------|
| Article 15 | Right of Access | `GET /users/me/export` — full data dump |
| Article 17 | Right to Erasure | `DELETE /users/me` — permanent deletion |
| Article 20 | Data Portability | `GET /users/me/export` — structured JSON |
| Recital 65 | Legal Retention Exception | `transactions.user_id ON DELETE SET NULL` |

### What Is Deleted vs. Retained

| Data Category | Action | Reason |
|---------------|--------|--------|
| User profile | **DELETED** | Personal data — no retention need |
| Posts, comments | **DELETED** | User-generated content — cascade |
| Chat messages | **DELETED** | Personal communication — cascade |
| Notifications | **DELETED** | Derivative of personal data |
| Follow relationships | **DELETED** | Social graph data |
| Tenant memberships | **DELETED** | Association data |
| Invitations | **DELETED** | Sent invitations — cascade |
| Chat channels (created by) | **DELETED** | Cascade from creator FK |
| S3 media objects | **DELETED** | Best-effort bulk delete |
| Auth session | **REVOKED** | Supabase admin.deleteUser() |
| **Transactions** | **ANONYMIZED** | `user_id → NULL`; financial data retained |

### Legal Review Flag
> The `ON DELETE SET NULL` approach for transactions is flagged for legal review. The current implementation preserves the financial record while removing the link to the individual. If legal counsel requires a different approach (e.g., pseudonymization with a hash, or a longer retention period before full deletion), the migration can be adjusted.

---

## Next Steps (Phase 4 continued)
1. **Week 12: Load Testing** — k6/Artillery scripts to validate RLS, rate limits, and cascading deletes under concurrent load
2. **Production Infrastructure** — AWS RDS read replicas, PgBouncer, auto-scaling NestJS containers
3. **Async Data Export** — For users with large datasets, queue export as BullMQ job → S3 → secure email link
4. **Audit Log Table** — Track who accessed/deleted what, when (regulatory trail)
5. **Cookie Consent & Privacy Policy** — Frontend banners + legal pages
