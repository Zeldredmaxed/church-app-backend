# Directive: Phase 1, Week 2 — Backend Skeleton & Core API

**Status:** `[ ] In Progress`  
**Owner:** Backend Team  
**Prerequisite:** `directives/phase1_week1_verification.md` signed off  
**Blocking:** Frontend Auth integration, UsersModule / MembershipsModule implementation

---

## Prerequisites

- [ ] Week 1 verification sign-off is complete and on record
- [ ] Supabase development project is provisioned and accessible
- [ ] Node.js ≥ 20 and npm ≥ 10 installed locally

---

## Step 1: Project Initialization

```bash
npm install -g @nestjs/cli

# Scaffold the project with strict TypeScript
nest new backend --strict --package-manager npm

cd backend

# Core dependencies
npm install \
  @nestjs/config \
  @nestjs/typeorm typeorm pg \
  @supabase/supabase-js \
  class-validator class-transformer \
  jsonwebtoken

# Type declarations
npm install -D \
  @types/pg \
  @types/jsonwebtoken
```

Copy the environment template and fill in values from your Supabase dashboard:

```bash
cp .env.example .env
```

| Variable | Where to find it |
| :--- | :--- |
| `SUPABASE_URL` | Dashboard → Settings → API → Project URL |
| `SUPABASE_ANON_KEY` | Dashboard → Settings → API → anon public |
| `SUPABASE_SERVICE_ROLE_KEY` | Dashboard → Settings → API → service_role secret |
| `SUPABASE_JWT_SECRET` | Dashboard → Settings → API → JWT Secret |
| `DATABASE_URL` | Dashboard → Settings → Database → Connection string (URI, port 5432) |

---

## Step 2: Module Structure

```
backend/src/
├── main.ts                                   ← Bootstrap, ValidationPipe
├── app.module.ts                             ← TypeORM config, module registry
│
├── common/
│   ├── types/
│   │   └── jwt-payload.type.ts               ← SupabaseJwtPayload interface
│   ├── storage/
│   │   └── rls.storage.ts                    ← AsyncLocalStorage for RLS context
│   ├── guards/
│   │   ├── jwt-auth.guard.ts                 ← Verifies Supabase JWT
│   │   └── super-admin.guard.ts              ← Restricts to SUPER_ADMIN_EMAILS
│   ├── decorators/
│   │   └── current-user.decorator.ts         ← @CurrentUser() param decorator
│   └── interceptors/
│       └── rls-context.interceptor.ts        ← THE CRITICAL FILE (see Section 3)
│
├── auth/
│   ├── dto/  signup | login | refresh | switch-tenant
│   ├── auth.controller.ts
│   ├── auth.service.ts
│   └── auth.module.ts
│
├── tenants/
│   ├── dto/  create-tenant
│   ├── entities/  tenant.entity.ts
│   ├── tenants.controller.ts
│   ├── tenants.service.ts
│   └── tenants.module.ts
│
├── users/
│   ├── entities/  user.entity.ts             ← Entity only; controller in next directive
│   └── users.module.ts
│
└── memberships/
    ├── entities/  tenant-membership.entity.ts
    └── memberships.module.ts
```

All files are generated and ready at `backend/src/`.

---

## Step 3: Critical Design Decision — The RLS Context Interceptor

> [!IMPORTANT]
> This is the most security-critical component in the entire backend. Read this before touching `rls-context.interceptor.ts`.

### The Problem

TypeORM connects to PostgreSQL using the **service role** credentials. The service role bypasses RLS by default. If we just run `manager.find(Post)`, Postgres returns ALL posts from ALL tenants.

### The Solution

For every authenticated HTTP request, `RlsContextInterceptor` does the following **inside a single transaction**:

```sql
BEGIN;
SET LOCAL role = 'authenticated';
SET LOCAL "request.jwt.claims" = '{ "sub": "...", "app_metadata": { "current_tenant_id": "..." } }';
-- Handler queries execute here — RLS is now fully active
COMMIT;
```

`SET LOCAL` scopes both settings to the current transaction. When the connection returns to the pool, these settings are gone. This is the only safe way to use a service-role connection pool with row-level security.

### The Data Flow

```
HTTP Request (with Bearer token)
        │
        ▼
  JwtAuthGuard              → verifies JWT, attaches payload to request.user
        │
        ▼
  RlsContextInterceptor     → creates QueryRunner, opens txn, SET LOCAL role + jwt.claims
        │                   → stores QueryRunner in AsyncLocalStorage (rlsStorage)
        ▼
  Controller Handler        → calls service method
        │
        ▼
  Service Method            → retrieves QueryRunner from rlsStorage.getStore()
        │                   → runs: queryRunner.manager.findOne(Tenant, { where: { id } })
        │                   → PostgreSQL applies RLS: only returns rows for current_tenant_id
        ▼
  RlsContextInterceptor     → on success: COMMIT
  (cleanup)                 → on error: ROLLBACK
                            → always: queryRunner.release()
```

### Rules for Service Code

| Scenario | What to use | Why |
| :--- | :--- | :--- |
| User-facing query (needs RLS) | `rlsStorage.getStore()!.queryRunner.manager` | RLS enforced |
| Admin operation (tenant creation, user seeding) | `this.dataSource.manager` or `this.dataSource.transaction(...)` | Service role, bypasses RLS intentionally |
| Any route using RLS | Must use `@UseInterceptors(RlsContextInterceptor)` | Populates rlsStorage |

> [!CAUTION]
> Never use `this.dataSource.manager` for user-facing queries. It uses the service role and bypasses RLS — your tenants will see each other's data.

---

## Step 4: API Contract

### Auth Endpoints (no authentication required)

#### `POST /api/auth/signup`
```json
// Request
{ "email": "alice@church.com", "password": "securepassword123" }

// Response 201
{ "userId": "uuid", "email": "alice@church.com", "message": "Account created. Check your email to confirm before logging in." }
```

#### `POST /api/auth/login`
```json
// Request
{ "email": "alice@church.com", "password": "securepassword123" }

// Response 200
{
  "accessToken": "<supabase-jwt>",
  "refreshToken": "<refresh-token>",
  "expiresAt": 1234567890,
  "user": { "id": "uuid", "email": "alice@church.com", "currentTenantId": "uuid-or-null" }
}
```

#### `POST /api/auth/refresh`
```json
// Request
{ "refreshToken": "<refresh-token>" }

// Response 200
{ "accessToken": "<new-jwt>", "refreshToken": "<new-refresh-token>", "expiresAt": 1234567890 }
```

#### `POST /api/auth/switch-tenant` _(requires Bearer token)_
```json
// Request
{ "tenantId": "uuid-of-target-church" }

// Response 200
{
  "message": "Context switched. Call POST /api/auth/refresh to receive your updated JWT.",
  "currentTenantId": "uuid-of-target-church",
  "yourRole": "admin"
}

// Error 403 — user has no membership in the requested tenant
{ "message": "You are not a member of this tenant" }
```

> [!IMPORTANT]
> The client MUST call `POST /api/auth/refresh` immediately after a successful switch-tenant response. The old JWT still carries the previous `current_tenant_id`. All RLS policies will enforce the old tenant until the token is refreshed.

---

### Tenant Endpoints

#### `POST /api/tenants` _(requires Bearer token + super admin email)_
```json
// Request
{ "name": "Grace Baptist Church" }

// Response 201
{ "id": "uuid", "name": "Grace Baptist Church", "stripeAccountId": null, "createdAt": "..." }

// Error 403 — caller email not in SUPER_ADMIN_EMAILS
{ "message": "Super admin access required" }
```

#### `GET /api/tenants/:id` _(requires Bearer token)_
```json
// Response 200 — user's current JWT tenant matches :id
{ "id": "uuid", "name": "Grace Baptist Church", "stripeAccountId": null, "createdAt": "..." }

// Response 404 — :id does not match user's current_tenant_id (RLS filtered it out)
{ "message": "Tenant not found" }
```

---

## Step 5: TypeORM Configuration Notes

> [!CAUTION]
> `synchronize: false` is set in `app.module.ts` and must never be changed. TypeORM schema sync would conflict with our migration scripts and could drop columns or alter constraints without warning.

The TypeORM connection uses the **service role** Postgres URL (port 5432 direct connection, not the pooler). In production (Phase 2), switch to the PgBouncer pooler URL and set `extra.max` to a lower value.

**Entity registration:** All three entities (`Tenant`, `User`, `TenantMembership`) are registered in `app.module.ts`. When new entities are added (e.g., `Post`, `Message`), add them to the `entities` array there.

---

## Step 6: Verification Checklist

### 6a — Application starts

```bash
cd backend
npm run start:dev
```

Expected output:
```
[Bootstrap] Application running on port 3000
[TypeOrmModule] TypeORM connected to postgres...
```

- `[ ]` Application starts with no errors
- `[ ]` No `TypeOrmModule` connection errors (check DATABASE_URL)

---

### 6b — Input validation rejects bad requests

```bash
# Should return 400 Bad Request
curl -X POST http://localhost:3000/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email": "not-an-email", "password": "short"}'
```

Expected: `400` with `message` array listing validation errors.

- `[ ]` 400 returned with field-level validation errors

---

### 6c — Auth flow (end-to-end)

```bash
# 1. Sign up
curl -X POST http://localhost:3000/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com", "password": "password123"}'

# Confirm email in Supabase dashboard (or disable email confirmation for dev)

# 2. Log in
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com", "password": "password123"}'
# Save the returned accessToken and refreshToken

# 3. Refresh tokens
curl -X POST http://localhost:3000/api/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{"refreshToken": "<saved-refresh-token>"}'
```

- `[ ]` Signup returns 201 with userId
- `[ ]` Login returns 200 with accessToken, refreshToken, expiresAt
- `[ ]` Refresh returns 200 with new tokens

---

### 6d — Tenant creation (super admin)

```bash
# 1. Ensure your login email is in SUPER_ADMIN_EMAILS in .env

# 2. Create a tenant
curl -X POST http://localhost:3000/api/tenants \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <accessToken>" \
  -d '{"name": "Test Church"}'
# Save the returned tenant id

# 3. Call /auth/refresh to get a new JWT with the new current_tenant_id
curl -X POST http://localhost:3000/api/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{"refreshToken": "<refreshToken>"}'
# The new accessToken's app_metadata.current_tenant_id should now be set
```

- `[ ]` POST /api/tenants returns 201 with new tenant data
- `[ ]` After refresh, decoded JWT contains `app_metadata.current_tenant_id = <new-tenant-id>`
  - Decode the JWT at [jwt.io](https://jwt.io) to verify (development only)

---

### 6e — RLS enforcement on GET /api/tenants/:id

```bash
# Using the refreshed token (has correct current_tenant_id):

# Should return 200
curl http://localhost:3000/api/tenants/<correct-tenant-id> \
  -H "Authorization: Bearer <refreshed-accessToken>"

# Should return 404 (RLS filtered it out — tenant not in user's context)
curl http://localhost:3000/api/tenants/<different-tenant-id> \
  -H "Authorization: Bearer <refreshed-accessToken>"
```

- `[ ]` GET with matching tenant ID returns 200 with tenant data
- `[ ]` GET with non-matching tenant ID returns 404 (not 403, not 200 with empty data)

---

### 6f — Switch tenant flow

```bash
# Seed a second tenant via Supabase Studio (service role) for testing:
# INSERT INTO public.tenants (name) VALUES ('Second Church');
# INSERT INTO public.tenant_memberships (user_id, tenant_id, role)
#   VALUES ('<your-user-id>', '<second-tenant-id>', 'member');

# Switch context to the second tenant
curl -X POST http://localhost:3000/api/auth/switch-tenant \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <current-accessToken>" \
  -d '{"tenantId": "<second-tenant-id>"}'

# Refresh to get new JWT
curl -X POST http://localhost:3000/api/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{"refreshToken": "<refreshToken>"}'

# Verify GET /tenants/:id now works for the second tenant
curl http://localhost:3000/api/tenants/<second-tenant-id> \
  -H "Authorization: Bearer <new-accessToken>"
```

- `[ ]` switch-tenant returns 200 with confirmation message
- `[ ]` After refresh, decoded JWT shows updated `current_tenant_id`
- `[ ]` GET /tenants/:id returns the correct tenant for the new context

---

## Step 7: Sign-Off

| Test | Owner | Result | Date |
| :--- | :--- | :--- | :--- |
| Application starts cleanly | Backend | `[ ] PASS / [ ] FAIL` | |
| Input validation (6b) | Backend | `[ ] PASS / [ ] FAIL` | |
| Auth flow end-to-end (6c) | Backend | `[ ] PASS / [ ] FAIL` | |
| Tenant creation (6d) | Backend | `[ ] PASS / [ ] FAIL` | |
| RLS enforcement on GET (6e) | Backend | `[ ] PASS / [ ] FAIL` | |
| Switch tenant flow (6f) | Backend | `[ ] PASS / [ ] FAIL` | |

**Signed off by:** ___________________________  **Date:** ___________

---

## Step 8: Next Steps (unlocked after sign-off)

### Frontend Team — Auth Integration

Implement signup and login forms that call the endpoints defined in Section 4.

Critical client-side logic:
- After `POST /auth/switch-tenant`, immediately call `POST /auth/refresh` before making any other request
- Store `accessToken` in memory (not localStorage) for security; `refreshToken` in an httpOnly cookie
- Handle `401 Token expired` responses by calling refresh and retrying

### Backend Team — UsersModule & MembershipsModule

Implement the following in the next directive:

**UsersModule:**
- `GET /api/users/me` — returns the authenticated user's profile + current tenant context
- `PATCH /api/users/me` — updates display name, avatar URL

**MembershipsModule:**
- `GET /api/memberships` — lists all members of the current tenant (admin/pastor only)
- `POST /api/memberships` — adds a user to the current tenant (admin/pastor only)
- `PATCH /api/memberships/:userId` — updates a member's role (admin only)
- `DELETE /api/memberships/:userId` — removes a member or self-removes (admin or self)

### DevOps — CI/CD Pipeline

Minimum pipeline for staging:
1. `npm run build` — TypeScript compile check
2. `npm run lint` — ESLint
3. Deploy to AWS App Runner or Render on merge to `main`
4. Run `supabase db push` against the staging Supabase project on deploy
