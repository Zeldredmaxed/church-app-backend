# Phase 4, Week 10: API Rate Limiting & Security Audits — Verification Directive

> **Status:** Implementation Complete  
> **Prerequisite:** Phase 3, Week 8 (Stripe Connect & Giving) verified and approved  
> **Deliverables:** ThrottlerModule (Redis-backed), CustomThrottlerGuard, auth rate limits, webhook exclusions, security audit scenarios

---

## Architecture Decisions

### 1. Redis-Backed Rate Limiting (Not In-Memory)
We use `@nestjs/throttler` with `ThrottlerStorageRedisService` for distributed rate-limit state:
- State is shared across all backend instances (horizontal scaling safe)
- Survives server restarts (no rate-limit reset on deploy)
- Reuses the existing Redis instance (same as BullMQ job queue)
- No additional infrastructure required

### 2. Dual Throttler Strategy
Two named throttlers with different limits:

| Throttler | TTL | Limit | Applied To |
|-----------|-----|-------|------------|
| `default` | 60s | 100 req/min | All endpoints (global) |
| `auth` | 60s | 5 req/min | `/auth/signup`, `/auth/login`, `/auth/refresh` |

The `auth` throttler is applied via `@Throttle()` decorator on specific routes. The `default` throttler is applied globally via `APP_GUARD`.

### 3. Custom ThrottlerGuard (IP + Tenant)
The `CustomThrottlerGuard` extends the default `ThrottlerGuard` to include tenant context:
- **Unauthenticated requests:** Tracked by IP address only
- **Authenticated requests:** Tracked by `<tenant_id>:<ip>` — creates separate rate-limit buckets per tenant

This prevents a single tenant from monopolizing system resources while maintaining per-IP protection.

### 4. Webhook Endpoints Excluded
Both webhook controllers (`WebhooksController` for Mux, `StripeWebhookController` for Stripe) are decorated with `@SkipThrottle()`:
- Webhook traffic volume is controlled by the external service
- Rate-limiting webhooks would cause missed events (payment confirmations, video processing updates)
- Authentication is handled via signature verification, not rate limits

### 5. Throttle Response Headers
`@nestjs/throttler` automatically adds standard rate-limit headers to responses:
- `X-RateLimit-Limit` — max requests allowed in the window
- `X-RateLimit-Remaining` — requests remaining in the current window
- `X-RateLimit-Reset` — seconds until the window resets
- Returns `429 Too Many Requests` when the limit is exceeded

---

## Files Created / Modified

### New Files
| File | Purpose |
|------|---------|
| `backend/src/common/guards/custom-throttler.guard.ts` | ThrottlerGuard with IP + tenant-based tracking |

### Modified Files
| File | Change |
|------|--------|
| `backend/src/app.module.ts` | Added ThrottlerModule (Redis), APP_GUARD provider |
| `backend/src/auth/auth.controller.ts` | Added `@Throttle({ auth })` on signup/login/refresh |
| `backend/src/webhooks/webhooks.controller.ts` | Added `@SkipThrottle()` class decorator |
| `backend/src/stripe/stripe-webhook.controller.ts` | Added `@SkipThrottle()` class decorator |

---

## Dependencies Required

```bash
npm install @nestjs/throttler ioredis
```

`@nestjs/throttler` v5+ includes `ThrottlerStorageRedisService` and uses `ioredis` as the Redis client.

---

## Verification Tests

### Rate Limiting Tests

#### Test 1: Global Rate Limit — Normal Traffic Allowed
```bash
# Send 5 requests to any authenticated endpoint
for i in {1..5}; do
  curl -s -o /dev/null -w "%{http_code}" \
    -H "Authorization: Bearer <jwt>" \
    http://localhost:3000/api/giving/transactions
done
```
**Expected:** All 5 return `200 OK`. Response includes `X-RateLimit-Remaining` header decreasing from 95 to 91.

#### Test 2: Global Rate Limit — Exceeded
```bash
# Send 101 requests in rapid succession to a protected endpoint
for i in {1..101}; do
  curl -s -o /dev/null -w "%{http_code}\n" \
    -H "Authorization: Bearer <jwt>" \
    http://localhost:3000/api/giving/transactions
done
```
**Expected:** First 100 return `200 OK`. Request 101 returns `429 Too Many Requests` with body `{ "statusCode": 429, "message": "ThrottlerException: Too Many Requests" }`.

#### Test 3: Auth Rate Limit — Login Brute-Force Protection
```bash
# Send 6 login attempts in 1 minute
for i in {1..6}; do
  curl -s -o /dev/null -w "%{http_code}\n" \
    -X POST http://localhost:3000/api/auth/login \
    -H "Content-Type: application/json" \
    -d '{"email": "test@example.com", "password": "wrong"}'
done
```
**Expected:** First 5 return `401 Unauthorized` (wrong password). Request 6 returns `429 Too Many Requests`. Attacker is blocked before they can try more passwords.

#### Test 4: Auth Rate Limit — Signup Abuse Protection
```bash
# Send 6 signup attempts in 1 minute from same IP
for i in {1..6}; do
  curl -s -o /dev/null -w "%{http_code}\n" \
    -X POST http://localhost:3000/api/auth/signup \
    -H "Content-Type: application/json" \
    -d "{\"email\": \"spammer${i}@example.com\", \"password\": \"password123\"}"
done
```
**Expected:** First 5 return `201 Created` or `409 Conflict`. Request 6 returns `429 Too Many Requests`.

#### Test 5: Auth Rate Limit — Refresh Token Abuse Protection
```bash
for i in {1..6}; do
  curl -s -o /dev/null -w "%{http_code}\n" \
    -X POST http://localhost:3000/api/auth/refresh \
    -H "Content-Type: application/json" \
    -d '{"refreshToken": "expired_or_invalid_token"}'
done
```
**Expected:** First 5 return `401 Unauthorized`. Request 6 returns `429 Too Many Requests`.

#### Test 6: Webhook Endpoints Not Rate-Limited
```bash
# Send 150 requests to the Mux webhook endpoint (exceeds global limit)
for i in {1..150}; do
  curl -s -o /dev/null -w "%{http_code}\n" \
    -X POST http://localhost:3000/api/webhooks/mux \
    -H "Content-Type: application/json" \
    -d '{"type": "test"}'
done
```
**Expected:** All 150 return `401 Unauthorized` (missing signature), NOT `429`. The `@SkipThrottle()` decorator prevents rate limiting on webhook endpoints.

#### Test 7: Stripe Webhook Not Rate-Limited
```bash
for i in {1..150}; do
  curl -s -o /dev/null -w "%{http_code}\n" \
    -X POST http://localhost:3000/api/webhooks/stripe \
    -H "Content-Type: application/json" \
    -d '{"type": "test"}'
done
```
**Expected:** All 150 return `401 Unauthorized` (missing stripe-signature), NOT `429`.

#### Test 8: Tenant-Isolated Rate Limits
```bash
# User A (Tenant A) sends 100 requests — exhausts their limit
# User B (Tenant B) sends 1 request immediately after
curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer <tenant_b_jwt>" \
  http://localhost:3000/api/giving/transactions
```
**Expected:** User B receives `200 OK`. Tenant A's rate-limit exhaustion does NOT affect Tenant B. The `CustomThrottlerGuard` tracks by `<tenant_id>:<ip>`.

#### Test 9: Rate Limit Headers Present
```bash
curl -v -H "Authorization: Bearer <jwt>" \
  http://localhost:3000/api/giving/transactions 2>&1 | grep -i "x-ratelimit"
```
**Expected:** Response headers include:
- `X-RateLimit-Limit: 100`
- `X-RateLimit-Remaining: 99` (or lower)
- `X-RateLimit-Reset: <seconds>`

#### Test 10: Switch-Tenant Uses Default (Not Auth) Limit
```bash
# switch-tenant is a protected endpoint but NOT an auth-brute-force target
# It should use the default 100 req/min limit, not the 5 req/min auth limit
for i in {1..6}; do
  curl -s -o /dev/null -w "%{http_code}\n" \
    -X POST http://localhost:3000/api/auth/switch-tenant \
    -H "Authorization: Bearer <jwt>" \
    -H "Content-Type: application/json" \
    -d '{"tenantId": "<valid_tenant_id>"}'
done
```
**Expected:** All 6 return `200 OK` (not 429). The `@Throttle({ auth })` decorator is NOT applied to switch-tenant.

---

### Security Audit Tests (RLS & Authorization)

#### Test 11: Cross-Tenant Data Access — Posts
```bash
# User A is in Tenant A. Post P belongs to Tenant B.
curl -s -w "%{http_code}" \
  -H "Authorization: Bearer <user_a_jwt>" \
  http://localhost:3000/api/posts/<post_id_from_tenant_b>
```
**Expected:** `404 Not Found`. RLS policy `tenant_id = current_tenant_id` filters out Tenant B's post at the database level. The application never sees the row.

#### Test 12: Cross-Tenant Data Access — Transactions
```bash
# User A (Tenant A) tries to view Tenant B's transactions
curl -s -w "%{http_code}" \
  -H "Authorization: Bearer <user_a_jwt>" \
  http://localhost:3000/api/tenants/<tenant_b_id>/transactions
```
**Expected:** `200 OK` with `{ transactions: [], nextCursor: null }`. RLS returns zero rows — User A is neither a member nor admin of Tenant B.

#### Test 13: Cross-Tenant Data Access — Chat Channels
```bash
# User A (Tenant A) tries to access a channel from Tenant B
curl -s -w "%{http_code}" \
  -H "Authorization: Bearer <user_a_jwt>" \
  http://localhost:3000/api/channels/<channel_id_from_tenant_b>/messages
```
**Expected:** `404 Not Found` or empty result. RLS prevents cross-tenant channel access.

#### Test 14: Cross-Tenant Data Creation — Post with Spoofed tenant_id
```bash
# User A (Tenant A) tries to create a post in Tenant B by spoofing tenantId
curl -s -w "%{http_code}" \
  -X POST http://localhost:3000/api/posts \
  -H "Authorization: Bearer <user_a_jwt>" \
  -H "Content-Type: application/json" \
  -d '{"content": "Injected post", "tenantId": "<tenant_b_id>"}'
```
**Expected:** Either:
- `400 Bad Request` — `forbidNonWhitelisted: true` in ValidationPipe rejects the unknown `tenantId` field
- OR the post is created in **Tenant A** (the JWT's `current_tenant_id`) — the spoofed `tenantId` is ignored because the RLS INSERT policy uses `current_tenant_id` from the JWT, not the request body.

#### Test 15: Cross-Tenant Data Creation — Donation with Spoofed tenant
```bash
# User A tries to donate to Tenant B (not their current tenant)
curl -s -w "%{http_code}" \
  -X POST http://localhost:3000/api/giving/donate \
  -H "Authorization: Bearer <user_a_jwt>" \
  -H "Content-Type: application/json" \
  -d '{"amount": 100, "currency": "usd", "tenantId": "<tenant_b_id>"}'
```
**Expected:** `400 Bad Request` (forbidNonWhitelisted rejects `tenantId`) OR donation is created under Tenant A. The GivingService reads the tenant from the RLS context, not the request body.

#### Test 16: Privilege Escalation — Member Updates Own Role
```bash
# Regular member tries to promote themselves to admin
curl -s -w "%{http_code}" \
  -X PATCH http://localhost:3000/api/tenants/<tenant_id>/members/<own_user_id>/role \
  -H "Authorization: Bearer <member_jwt>" \
  -H "Content-Type: application/json" \
  -d '{"role": "admin"}'
```
**Expected:** `404 Not Found` or `403 Forbidden`. The RLS UPDATE policy on `tenant_memberships` restricts role changes to admins only. A member cannot escalate their own privileges.

#### Test 17: Privilege Escalation — Member Initiates Stripe Onboarding
```bash
curl -s -w "%{http_code}" \
  -X POST http://localhost:3000/api/stripe/connect/onboard \
  -H "Authorization: Bearer <member_jwt>" \
  -H "Content-Type: application/json" \
  -d '{"refreshUrl": "http://localhost:3000/onboard", "returnUrl": "http://localhost:3000/dashboard"}'
```
**Expected:** `400 Bad Request` — "Only tenant admins can manage Stripe Connect". Application-layer role check in `StripeConnectController.requireAdmin()` rejects non-admin users.

#### Test 18: Privilege Escalation — Member Removes Another Member
```bash
curl -s -w "%{http_code}" \
  -X DELETE http://localhost:3000/api/tenants/<tenant_id>/members/<other_user_id> \
  -H "Authorization: Bearer <member_jwt>"
```
**Expected:** `404 Not Found`. The RLS DELETE policy on `tenant_memberships` only allows admins to remove members. The row is invisible to the non-admin user.

#### Test 19: SQL Injection — Search Query
```bash
# Attempt SQL injection via the search endpoint
curl -s -w "%{http_code}" \
  -H "Authorization: Bearer <jwt>" \
  "http://localhost:3000/api/search/posts?q='; DROP TABLE posts; --"
```
**Expected:** `200 OK` with `{ posts: [], nextCursor: null }`. The `websearch_to_tsquery()` function safely parses the input as a text search query, not SQL. The semicolons and SQL keywords are treated as search terms. No SQL injection occurs.

#### Test 20: SQL Injection — UUID Parameter
```bash
# Attempt SQL injection via a UUID path parameter
curl -s -w "%{http_code}" \
  -H "Authorization: Bearer <jwt>" \
  "http://localhost:3000/api/posts/1'; DROP TABLE posts; --"
```
**Expected:** `400 Bad Request` — "Validation failed (uuid is expected)". The `ParseUUIDPipe` rejects any non-UUID string before it reaches the database layer.

#### Test 21: SQL Injection — Cursor Parameter
```bash
# Attempt SQL injection via cursor pagination parameter
curl -s -w "%{http_code}" \
  -H "Authorization: Bearer <jwt>" \
  "http://localhost:3000/api/giving/transactions?cursor=1' OR '1'='1"
```
**Expected:** `400 Bad Request` or `200 OK` with normal results. Cursor values are UUIDs validated by the service layer. Non-UUID cursors are rejected or ignored.

#### Test 22: Cross-Tenant Member Listing
```bash
# User A (Tenant A) tries to list members of Tenant B
curl -s -w "%{http_code}" \
  -H "Authorization: Bearer <user_a_jwt>" \
  http://localhost:3000/api/tenants/<tenant_b_id>/members
```
**Expected:** `200 OK` with `{ members: [], nextCursor: null }`. RLS prevents User A from seeing Tenant B's membership data.

---

## Security Architecture Summary

### Defense-in-Depth Layers

| Layer | Mechanism | Protects Against |
|-------|-----------|-----------------|
| **L1: Rate Limiting** | `@nestjs/throttler` + Redis | DDoS, brute-force, credential stuffing |
| **L2: Input Validation** | `ValidationPipe` (whitelist + forbidNonWhitelisted) | Parameter injection, unknown field injection |
| **L3: UUID Validation** | `ParseUUIDPipe` on path params | SQL injection via ID parameters |
| **L4: Authentication** | `JwtAuthGuard` with Supabase JWT | Unauthenticated access |
| **L5: Row-Level Security** | PostgreSQL RLS with `SET LOCAL` | Cross-tenant data access, privilege escalation |
| **L6: Application Guards** | Role checks in service layer | Admin-only action bypass |
| **L7: Webhook Auth** | Stripe SDK / HMAC signature verification | Webhook forgery, replay attacks |
| **L8: SQL Parameterization** | TypeORM parameterized queries + `websearch_to_tsquery` | SQL injection |

### Key Security Properties

1. **Tenant Isolation**: Every data query passes through PostgreSQL RLS. The `current_tenant_id` is set from the JWT (server-side), never from the request body. Even if the application layer has a bug, the database layer prevents cross-tenant data access.

2. **Financial Record Integrity**: The `transactions` table has no UPDATE/DELETE RLS policies for the `authenticated` role. Transaction status can only be modified by the service role (webhook processor). Users cannot tamper with payment records.

3. **Brute-Force Resistance**: Auth endpoints are limited to 5 requests/minute per IP. After 5 failed login attempts, the attacker must wait 60 seconds. Combined with Supabase's built-in rate limiting, this provides robust protection against credential stuffing.

4. **No Card Data Exposure**: Card details are collected by Stripe.js in an iframe on the client side. The backend only receives a `client_secret` (PaymentIntent ID). PCI DSS compliance is implicitly maintained.

5. **Webhook Availability**: Rate limiting is skipped on webhook endpoints to ensure payment confirmations and video processing events are never dropped due to throttling.

---

## Next Steps (Phase 4 continued)
1. **GDPR Compliance** — Right-to-erasure flow, data export endpoint, audit log table
2. **Production Infrastructure** — AWS deployment, database replicas, CDN, PgBouncer
3. **Load Testing** — k6/Artillery scripts to validate rate limits and RLS under concurrent load
4. **Observability** — Sentry error tracking, OpenTelemetry tracing, structured logging
5. **Frontend Hardening** — Cross-browser testing, CSP headers, CORS configuration
