# Directive: Phase 1, Week 2 (Continued) — Users & Memberships API

**Status:** `[ ] In Progress`  
**Owner:** Backend Team  
**Prerequisite:** `directives/phase1_week2_backend_skeleton.md` signed off  
**Blocking:** Frontend profile page, tenant membership management UI

---

## Prerequisites

- [ ] Week 2 Part 1 sign-off is complete
- [ ] NestJS backend is running locally (`npm run start:dev`)
- [ ] You have a valid `accessToken` from a previous `POST /api/auth/login` call

---

## Step 1: Apply Migration 002

The new `full_name` and `avatar_url` columns must exist before the backend starts.

```bash
# Option A: Supabase CLI
supabase db push

# Option B: psql
psql "$DATABASE_URL" -f migrations/002_add_user_profile_fields.sql
```

Verify:

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'users'
  AND column_name  IN ('full_name', 'avatar_url');
-- Expected: 2 rows, data_type = 'text', is_nullable = 'YES'
```

- `[ ]` Migration applied cleanly
- `[ ]` Both columns confirmed present

---

## Step 2: Files Added / Updated

| File | Status |
| :--- | :--- |
| `migrations/002_add_user_profile_fields.sql` | **New** |
| `backend/src/users/entities/user.entity.ts` | Updated — `fullName`, `avatarUrl` columns added |
| `backend/src/users/dto/update-user.dto.ts` | **New** |
| `backend/src/users/users.service.ts` | **New** |
| `backend/src/users/users.controller.ts` | **New** |
| `backend/src/users/users.module.ts` | Updated — wired controller + service |
| `backend/src/memberships/dto/create-membership.dto.ts` | **New** |
| `backend/src/memberships/memberships.service.ts` | **New** |
| `backend/src/memberships/memberships.controller.ts` | **New** |
| `backend/src/memberships/memberships.module.ts` | Updated — wired controller + service |

---

## Step 3: API Contract

### Users Endpoints _(all require Bearer token)_

#### `GET /api/users/me`
Returns the authenticated user's own profile.

```json
// Response 200
{
  "id": "user-uuid",
  "email": "alice@church.com",
  "fullName": null,
  "avatarUrl": null,
  "lastAccessedTenantId": "tenant-uuid-or-null",
  "createdAt": "2024-01-01T00:00:00.000Z"
}
```

#### `PATCH /api/users/me`
Updates `fullName` and/or `avatarUrl`. Both fields are optional. Returns the updated profile.

```json
// Request — send only the fields you want to change
{ "fullName": "Alice Johnson", "avatarUrl": "https://cdn.example.com/avatars/alice.jpg" }

// Response 200 — full updated profile
{
  "id": "user-uuid",
  "email": "alice@church.com",
  "fullName": "Alice Johnson",
  "avatarUrl": "https://cdn.example.com/avatars/alice.jpg",
  "lastAccessedTenantId": "tenant-uuid",
  "createdAt": "2024-01-01T00:00:00.000Z"
}

// Response 400 — invalid avatarUrl
{ "message": ["avatarUrl must be a valid URL"] }
```

> [!IMPORTANT]
> `email` and `lastAccessedTenantId` are NOT updatable via this endpoint. They are managed by Supabase Auth and `POST /auth/switch-tenant` respectively. The DTO strips any attempt to update them (`whitelist: true` in ValidationPipe + DTO `@IsOptional` fields).

---

### Memberships Endpoints _(all require Bearer token)_

#### `GET /api/memberships`
Returns all churches the authenticated user belongs to, with their role in each.
Powered by a service-role query — returns ALL tenants, not just the current one.

```json
// Response 200
[
  {
    "tenantId": "aaaaaaaa-0000-0000-0000-000000000001",
    "tenantName": "Church Alpha",
    "role": "admin",
    "isCurrent": true
  },
  {
    "tenantId": "bbbbbbbb-0000-0000-0000-000000000002",
    "tenantName": "Church Beta",
    "role": "member",
    "isCurrent": false
  }
]
// Empty array [] if the user has no memberships yet.
```

#### `POST /api/memberships`
Adds a user (by email) to the requesting admin's current tenant.
The requesting user must hold `admin` or `pastor` role in their current active church.
The target user must already have a platform account.

```json
// Request
{ "email": "bob@church.com", "role": "member" }

// Response 201
{
  "tenantId": "tenant-uuid",
  "tenantName": "Church Alpha",
  "role": "member",
  "isCurrent": true,
  "newMember": { "userId": "user-uuid", "email": "bob@church.com" }
}

// Response 404 — target user has no account
{ "message": "No account found for bob@church.com. They must sign up for the platform first." }

// Response 409 — already a member
{ "message": "bob@church.com is already a member of this tenant with role 'member'" }

// Response 403 — caller is a 'member', not admin/pastor (raised by Postgres RLS)
{ "message": "Forbidden resource" }

// Response 400 — no active tenant context in JWT
{ "message": "No active tenant context. Call POST /api/auth/switch-tenant first." }
```

---

## Step 4: RLS Design Notes

### Why `GET /memberships` bypasses RLS

The `tenant_memberships` SELECT policy filters by `current_tenant_id` from the JWT:

```sql
USING (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid)
```

If Alice belongs to Church Alpha (current context) and Church Beta, an RLS-scoped query would only return her Church Alpha membership. The "switch church" UI needs to display **all** her churches. Using the service role with `WHERE user_id = alice_uuid` is the correct, documented exception.

**The security guarantee is application-layer**, not RLS: the controller passes `user.sub` from the verified JWT directly — the user ID cannot be spoofed by a client.

### Why `POST /memberships` uses the RLS QueryRunner

The INSERT policy is the final arbiter of authority:

```sql
WITH CHECK (
  tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
  AND EXISTS (
    SELECT 1 FROM public.tenant_memberships tm
    WHERE tm.tenant_id = current_tenant_id_from_jwt
      AND tm.user_id   = auth.uid()
      AND tm.role      IN ('admin', 'pastor')
  )
)
```

A `member`-role user calling this endpoint will receive a Postgres policy violation, which NestJS translates to `403 Forbidden`. The check is in the database — no application code can accidentally bypass it.

---

## Step 5: Verification Checklist

Save the token from a previous login call as an environment variable for cleaner commands:

```bash
export TOKEN="<your-access-token>"
export TENANT_ID="<your-current-tenant-id>"
```

---

### Test 5.1 — `GET /users/me` returns own profile

```bash
curl http://localhost:3000/api/users/me \
  -H "Authorization: Bearer $TOKEN"
```

Expected: `200` with your user's `id`, `email`, `fullName: null`, `avatarUrl: null`.

- `[ ]` PASS

---

### Test 5.2 — `PATCH /users/me` updates profile fields

```bash
curl -X PATCH http://localhost:3000/api/users/me \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"fullName": "Test User"}'
```

Expected: `200` with `fullName: "Test User"`, all other fields unchanged.

- `[ ]` PASS

---

### Test 5.3 — `PATCH /users/me` rejects invalid `avatarUrl`

```bash
curl -X PATCH http://localhost:3000/api/users/me \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"avatarUrl": "not-a-url"}'
```

Expected: `400` with `message: ["avatarUrl must be a valid URL"]`.

- `[ ]` PASS

---

### Test 5.4 — CRITICAL: User cannot read another user's profile

```bash
# Use the Supabase Studio (service role) to get a second user's UUID
export OTHER_USER_ID="<another-user-uuid>"

# The only endpoint a user has for reading user data is GET /users/me
# There is no GET /users/:id endpoint — by design.
# Verify no such route exists:
curl http://localhost:3000/api/users/$OTHER_USER_ID \
  -H "Authorization: Bearer $TOKEN"
```

Expected: `404 Cannot GET /api/users/<uuid>` — the route does not exist.

- `[ ]` PASS — no `GET /users/:id` route is exposed

---

### Test 5.5 — `GET /memberships` returns all user tenants

```bash
curl http://localhost:3000/api/memberships \
  -H "Authorization: Bearer $TOKEN"
```

Expected: `200` with an array of your tenants. The entry matching `$TENANT_ID` should have `isCurrent: true`.

- `[ ]` PASS

---

### Test 5.6 — `GET /memberships` only returns own memberships

```bash
# Create a second test user in Supabase Studio, add them to a DIFFERENT tenant.
# Log in as the second user and get their token.
export TOKEN_B="<second-user-token>"

curl http://localhost:3000/api/memberships \
  -H "Authorization: Bearer $TOKEN_B"
```

Expected: Response contains ONLY the second user's memberships — not your original user's tenants.

- `[ ]` PASS — membership lists are user-scoped

---

### Test 5.7 — `POST /memberships` adds a user (admin flow)

```bash
# Your current token must be for a user with admin/pastor role in $TENANT_ID.
# Create a second account first if needed.
export NEW_MEMBER_EMAIL="newmember@example.com"

curl -X POST http://localhost:3000/api/memberships \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"email\": \"$NEW_MEMBER_EMAIL\", \"role\": \"member\"}"
```

Expected: `201` with `newMember.email` matching the invited address.

- `[ ]` PASS

---

### Test 5.8 — CRITICAL: `member` role cannot invite others

```bash
# Log in as the newly-added member from Test 5.7 (role: member)
export MEMBER_TOKEN="<member-user-access-token>"

curl -X POST http://localhost:3000/api/memberships \
  -H "Authorization: Bearer $MEMBER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"email": "anotherperson@example.com", "role": "member"}'
```

Expected: `403 Forbidden` — raised by the Postgres INSERT RLS policy.

- `[ ]` PASS — RLS blocks non-admin/pastor inserts at DB level

---

### Test 5.9 — CRITICAL: Admin cannot add members to another tenant

```bash
# Scenario: Admin of Church Alpha attempts to add a member to Church Beta.
# Log in as the Church Alpha admin but with Church Beta's ID in the body.
export CHURCH_BETA_ID="bbbbbbbb-0000-0000-0000-000000000002"

# First, switch to Church Alpha context (as admin)
# Then attempt to POST with a manually crafted payload that targets Church Beta.
# Since tenant_id is NOT a field in CreateMembershipDto, there is no way to
# specify a different tenant — it always uses current_tenant_id from the JWT.

# Confirm CreateMembershipDto only accepts email + role:
curl -X POST http://localhost:3000/api/memberships \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"email\": \"victim@example.com\", \"role\": \"member\", \"tenantId\": \"$CHURCH_BETA_ID\"}"
```

Expected: `201` BUT the membership is created for **Church Alpha** (the JWT context), not Church Beta. The `tenantId` field in the body is silently stripped by `ValidationPipe` (whitelist mode). Verify in Supabase Studio that the new membership row has `tenant_id = Church Alpha's UUID`.

- `[ ]` PASS — `tenantId` body field stripped; only JWT context is used

---

## Step 6: Sign-Off

| Test | Owner | Result | Date |
| :--- | :--- | :--- | :--- |
| Migration 002 applied (Step 1) | DB Team | `[ ] PASS / [ ] FAIL` | |
| 5.1 GET /users/me | Backend | `[ ] PASS / [ ] FAIL` | |
| 5.2 PATCH /users/me updates fields | Backend | `[ ] PASS / [ ] FAIL` | |
| 5.3 PATCH rejects invalid avatarUrl | Backend | `[ ] PASS / [ ] FAIL` | |
| 5.4 No GET /users/:id route exposed | Backend | `[ ] PASS / [ ] FAIL` | |
| 5.5 GET /memberships returns all user tenants | Backend | `[ ] PASS / [ ] FAIL` | |
| 5.6 Membership lists are user-scoped | Backend | `[ ] PASS / [ ] FAIL` | |
| 5.7 POST /memberships adds a user | Backend | `[ ] PASS / [ ] FAIL` | |
| 5.8 member role blocked from inviting | Backend | `[ ] PASS / [ ] FAIL` | |
| 5.9 tenantId body field stripped | Backend | `[ ] PASS / [ ] FAIL` | |

**Signed off by:** ___________________________  **Date:** ___________

---

## Step 7: Next Steps (unlocked after sign-off)

### Frontend Team

Implement using the contracts defined in Step 3:

1. **Profile page** — `GET /users/me` on load, `PATCH /users/me` on form submit
2. **Church switcher UI** — `GET /memberships` to populate the list, `POST /auth/switch-tenant` + `POST /auth/refresh` on selection
3. **Member management page** (admin only) — `POST /memberships` to invite by email

### Backend Team — Invitation Email Flow (Phase 2)

The current `POST /memberships` implementation requires the invitee to have an existing account. The full invitation flow requires:

1. A new `invitations` table (`id`, `email`, `tenant_id`, `role`, `token`, `expires_at`, `accepted_at`)
2. `POST /memberships` creates an `invitations` row and enqueues a BullMQ job on the `notifications` queue
3. The notification worker calls the email service (Resend / SendGrid) with a tokenized invite link
4. A new `POST /api/invitations/:token/accept` endpoint validates the token and creates the membership

### Backend Team — PostsModule (Phase 2, Week 4)

Begin scaffolding the `PostsModule` with:
- S3 pre-signed URL generation for media uploads (`POST /api/posts/upload-url`)
- Post creation with `tenant_id = null` (global) or `current_tenant_id` (church-internal)
- RLS policy for `posts` table following the same pattern established here
