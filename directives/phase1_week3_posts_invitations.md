# Directive: Phase 1, Week 3 — Posts & Invitations

**Status:** `[ ] In Progress`  
**Owner:** Backend Team  
**Prerequisite:** `directives/phase1_week2_continued_users_memberships.md` signed off  
**Blocking:** Frontend post feed UI, invitation sending UI

---

## Prerequisites

- [ ] Week 2 (Continued) sign-off is complete
- [ ] Backend is running (`npm run start:dev`) with no errors
- [ ] Valid `accessToken` (admin role) available from a previous login

---

## Step 1: Apply Migration 003

```bash
# Option A: Supabase CLI
supabase db push

# Option B: psql
psql "$DATABASE_URL" -f migrations/003_posts_and_invitations.sql
```

Run all five verification queries in `§ SECTION 5` of the migration script. Confirm:
- Both tables exist
- RLS enabled + forced on both
- All 7 policies installed with correct `cmd` values
- Unique partial index `idx_invitations_pending_per_email_tenant` present

- `[ ]` Migration applied cleanly
- `[ ]` All 7 RLS policies confirmed via `pg_policies` query

---

## Step 2: Files Added / Updated

| File | Status |
| :--- | :--- |
| `migrations/003_posts_and_invitations.sql` | **New** |
| `backend/src/posts/entities/post.entity.ts` | **New** |
| `backend/src/posts/dto/create-post.dto.ts` | **New** |
| `backend/src/posts/dto/get-posts.dto.ts` | **New** |
| `backend/src/posts/posts.service.ts` | **New** |
| `backend/src/posts/posts.controller.ts` | **New** |
| `backend/src/posts/posts.module.ts` | **New** |
| `backend/src/invitations/entities/invitation.entity.ts` | **New** |
| `backend/src/invitations/dto/create-invitation.dto.ts` | **New** |
| `backend/src/invitations/invitations.service.ts` | **New** |
| `backend/src/invitations/invitations.controller.ts` | **New** |
| `backend/src/invitations/invitations.module.ts` | **New** |
| `backend/src/app.module.ts` | Updated — `PostsModule`, `InvitationsModule`, `Post`, `Invitation` entities registered |

---

## Step 3: API Contract

### Posts Endpoints _(all require Bearer token)_

#### `POST /api/posts`

```json
// Request
{ "content": "Sunday service was amazing!" }

// Response 201
{
  "id": "post-uuid",
  "tenantId": "tenant-uuid",
  "authorId": "user-uuid",
  "content": "Sunday service was amazing!",
  "videoMuxPlaybackId": null,
  "createdAt": "2024-01-01T10:00:00.000Z",
  "updatedAt": "2024-01-01T10:00:00.000Z"
}

// Response 400 — no active tenant context
{ "message": "No active tenant context. Call POST /api/auth/switch-tenant first." }
```

> [!IMPORTANT]
> `tenantId` and `authorId` are NOT accepted in the request body. `ValidationPipe` strips them. Both are derived from the verified JWT on the server. The RLS INSERT policy re-validates both at the DB level as a second line of defence.

#### `GET /api/posts?limit=20&offset=0`

```json
// Response 200
{
  "posts": [
    {
      "id": "post-uuid",
      "tenantId": "tenant-uuid",
      "authorId": "user-uuid",
      "content": "Sunday service was amazing!",
      "videoMuxPlaybackId": null,
      "createdAt": "2024-01-01T10:00:00.000Z",
      "updatedAt": "2024-01-01T10:00:00.000Z"
    }
  ],
  "total": 1,
  "limit": 20,
  "offset": 0
}
```

Query params: `limit` (1–100, default 20), `offset` (≥0, default 0).

---

### Invitations Endpoints

#### `GET /api/invitations` _(admin or pastor only)_

```json
// Response 200
[
  {
    "id": "inv-uuid",
    "tenantId": "tenant-uuid",
    "invitedBy": "admin-user-uuid",
    "email": "newperson@example.com",
    "role": "member",
    "token": "[hidden]",
    "expiresAt": "2024-01-02T10:00:00.000Z",
    "acceptedAt": null,
    "createdAt": "2024-01-01T10:00:00.000Z",
    "isExpired": false
  }
]
```

#### `POST /api/invitations` _(admin or pastor only)_

```json
// Request
{ "email": "newperson@example.com", "role": "member" }

// Response 201
{
  "id": "inv-uuid",
  "tenantId": "tenant-uuid",
  "invitedBy": "admin-user-uuid",
  "email": "newperson@example.com",
  "role": "member",
  "token": "a3f9bc...64hexchars",
  "expiresAt": "2024-01-02T10:00:00.000Z",
  "acceptedAt": null,
  "createdAt": "2024-01-01T10:00:00.000Z"
}

// Response 409 — already a member
{ "message": "newperson@example.com is already a member of this tenant with role 'member'" }

// Response 409 — pending invite exists
{ "message": "A pending invitation for newperson@example.com already exists. Cancel it before re-inviting." }

// Response 403 — caller is a 'member' (RLS policy violation)
{ "message": "Forbidden resource" }
```

> [!CAUTION]
> **DEV ONLY:** The `token` field appears in the `POST /api/invitations` response only because the email service has not been integrated yet. Before go-live, remove `token` from the response and add it to the BullMQ `notifications` queue payload only. The token must travel exclusively via email.

#### `POST /api/invitations/:token/accept` _(requires Bearer token — no RlsContextInterceptor)_

```json
// Response 200
{
  "message": "Invitation accepted. Call POST /api/auth/switch-tenant then POST /api/auth/refresh to activate your new church context.",
  "tenantId": "tenant-uuid",
  "role": "member"
}

// Response 404 — token not found or already used
{ "message": "Invitation not found or already used" }

// Response 410 Gone — expired
{ "message": "This invitation expired at 2024-01-02T10:00:00.000Z. Ask a tenant admin to send a new invitation." }

// Response 409 — already accepted
{ "message": "This invitation has already been accepted" }

// Response 403 — caller's email doesn't match invitation email
{ "message": "This invitation was not sent to your email address" }
```

> [!IMPORTANT]
> After a `200` response from `:token/accept`, the client must immediately call:
> 1. `POST /api/auth/switch-tenant { tenantId: <returned tenantId> }`
> 2. `POST /api/auth/refresh`
>
> The new membership exists in the DB, but the JWT still carries the old (or null) `current_tenant_id` until refreshed.

---

## Step 4: RLS Design Notes

### Posts: dual server-side enforcement

The `tenantId` and `authorId` on a post are set by the server, not the client. But we enforce this twice:

| Layer | Mechanism |
| :--- | :--- |
| Application | `tenantId = context.currentTenantId` (from JWT via AsyncLocalStorage) |
| Application | `authorId = user.sub` (from verified JWT) |
| Database | `WITH CHECK (tenant_id = jwt.current_tenant_id AND author_id = auth.uid())` |

If a bug in the service passed the wrong values, Postgres would reject the `INSERT` before it reaches the disk.

### Invitations: why `:token/accept` skips `RlsContextInterceptor`

The invitee's JWT has no `current_tenant_id` for the target church yet (that's what they're trying to join). If `RlsContextInterceptor` ran, it would set `SET LOCAL role = 'authenticated'` and all tenant-scoped queries inside the handler would return empty results.

The acceptance flow uses `dataSource.manager` (service role) for all queries, with application-level guards replacing RLS:
- token existence check
- expiry check
- email ownership check (`user.email === invitation.email`)

### Invitations: why there is no UPDATE policy

Marking `accepted_at` as accepted is done via service-role in the acceptance handler. If an UPDATE RLS policy existed on `invitations`, an invitee could potentially craft a request to set `accepted_at = NULL`, recycling a used invitation token. No UPDATE policy = all UPDATEs from authenticated users are blocked by default.

---

## Step 5: Verification

```bash
export TOKEN="<admin-access-token>"         # Must have admin role in current tenant
export TENANT_ID="<your-current-tenant-id>"
export INVITE_EMAIL="invitee@example.com"   # A second test account's email
export INVITEE_TOKEN="<invitee-access-token>" # Token for the above account
```

---

### Test 5.1 — Create a post

```bash
curl -X POST http://localhost:3000/api/posts \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"content": "Hello Church!"}'
```

Expected: `201` — `tenantId` matches `$TENANT_ID`, `authorId` matches your user UUID.

- `[ ]` PASS — post created with correct tenantId and authorId

---

### Test 5.2 — Get posts (paginated)

```bash
curl "http://localhost:3000/api/posts?limit=5&offset=0" \
  -H "Authorization: Bearer $TOKEN"
```

Expected: `200` — `posts` array contains the post from 5.1, `total ≥ 1`.

- `[ ]` PASS

---

### Test 5.3 — CRITICAL: cannot create post in another tenant

```bash
# Attempt to inject a foreign tenantId — ValidationPipe should strip it
curl -X POST http://localhost:3000/api/posts \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"content\": \"Hack post\", \"tenantId\": \"00000000-0000-0000-0000-000000000000\"}"
```

Expected: `201` — but the returned `tenantId` equals `$TENANT_ID` (the JWT context), NOT the injected value. Verify in Supabase Studio.

- `[ ]` PASS — injected `tenantId` stripped; post lands in JWT context tenant

---

### Test 5.4 — CRITICAL: cannot view posts from another tenant

```bash
# Log in as a user with NO membership in $TENANT_ID (a fresh account)
export OUTSIDER_TOKEN="<token-for-user-with-no-membership>"

curl "http://localhost:3000/api/posts" \
  -H "Authorization: Bearer $OUTSIDER_TOKEN"
```

Expected: `400` — "No active tenant context" (user has no `current_tenant_id` in JWT).  
Or if they have a different tenant context: `200` with `posts: []` — RLS returns zero rows for their tenant.

- `[ ]` PASS — outsider cannot see Church Alpha's posts

---

### Test 5.5 — Send an invitation

```bash
curl -X POST http://localhost:3000/api/invitations \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"email\": \"$INVITE_EMAIL\", \"role\": \"member\"}"

# Save the token from the response
export INVITE_TOKEN="<token-from-response>"
```

Expected: `201` — response includes the invitation `token` (DEV only).

- `[ ]` PASS

---

### Test 5.6 — CRITICAL: member cannot send invitations

```bash
# Use a member-role token (not admin/pastor)
export MEMBER_TOKEN="<member-role-access-token>"

curl -X POST http://localhost:3000/api/invitations \
  -H "Authorization: Bearer $MEMBER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"email": "someone@example.com", "role": "member"}'
```

Expected: `403 Forbidden` — raised by the RLS INSERT policy.

- `[ ]` PASS

---

### Test 5.7 — CRITICAL: cannot invite to a different tenant

```bash
# Attempt to inject a tenantId into the invitation body
curl -X POST http://localhost:3000/api/invitations \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"email\": \"victim@example.com\", \"role\": \"admin\", \"tenantId\": \"00000000-0000-0000-0000-000000000000\"}"
```

Expected: `201` — but the invitation's `tenantId` in Supabase Studio equals `$TENANT_ID` (JWT context). The injected `tenantId` was stripped by `ValidationPipe`.

- `[ ]` PASS

---

### Test 5.8 — Accept a valid invitation

```bash
# Log in as the invitee (whose email matches $INVITE_EMAIL)
curl -X POST http://localhost:3000/api/invitations/$INVITE_TOKEN/accept \
  -H "Authorization: Bearer $INVITEE_TOKEN"
```

Expected: `200` — `{ message: "Invitation accepted...", tenantId: "...", role: "member" }`.  
Verify in Supabase Studio: `tenant_memberships` has a new row, `invitations.accepted_at` is set.

- `[ ]` PASS

---

### Test 5.9 — CRITICAL: expired invitation cannot be accepted

```sql
-- In Supabase Studio (service role), manually expire an invitation:
UPDATE public.invitations
  SET expires_at = NOW() - INTERVAL '1 hour'
  WHERE id = '<invitation-id>';
```

```bash
curl -X POST http://localhost:3000/api/invitations/$INVITE_TOKEN/accept \
  -H "Authorization: Bearer $INVITEE_TOKEN"
```

Expected: `410 Gone` — "This invitation expired at...".

- `[ ]` PASS — expired token correctly rejected with 410

---

### Test 5.10 — CRITICAL: wrong-email user cannot accept another's invitation

```bash
# Use a token for a DIFFERENT account (not the invitee's email)
export WRONG_USER_TOKEN="<token-for-different-email>"

# Create a fresh invitation first, then try to accept with wrong user
curl -X POST http://localhost:3000/api/invitations/<fresh-token>/accept \
  -H "Authorization: Bearer $WRONG_USER_TOKEN"
```

Expected: `403 Forbidden` — "This invitation was not sent to your email address".

- `[ ]` PASS

---

### Test 5.11 — Duplicate invitation rejected

```bash
# Try to create a second invitation for the same email (Test 5.5's email)
curl -X POST http://localhost:3000/api/invitations \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"email\": \"$INVITE_EMAIL\", \"role\": \"admin\"}"
```

Expected: `409 Conflict` — "A pending invitation for ... already exists."

- `[ ]` PASS

---

## Step 6: Sign-Off

| Test | Owner | Result | Date |
| :--- | :--- | :--- | :--- |
| Migration 003 applied + 7 policies verified | DB Team | `[ ] PASS / [ ] FAIL` | |
| 5.1 Create post | Backend | `[ ] PASS / [ ] FAIL` | |
| 5.2 Get posts paginated | Backend | `[ ] PASS / [ ] FAIL` | |
| 5.3 tenantId injection stripped | Backend | `[ ] PASS / [ ] FAIL` | |
| 5.4 Outsider cannot view posts | Backend | `[ ] PASS / [ ] FAIL` | |
| 5.5 Send invitation | Backend | `[ ] PASS / [ ] FAIL` | |
| 5.6 Member cannot send invitations | Backend | `[ ] PASS / [ ] FAIL` | |
| 5.7 tenantId injection on invitation stripped | Backend | `[ ] PASS / [ ] FAIL` | |
| 5.8 Accept valid invitation | Backend | `[ ] PASS / [ ] FAIL` | |
| 5.9 Expired invitation returns 410 | Backend | `[ ] PASS / [ ] FAIL` | |
| 5.10 Wrong email returns 403 | Backend | `[ ] PASS / [ ] FAIL` | |
| 5.11 Duplicate invitation returns 409 | Backend | `[ ] PASS / [ ] FAIL` | |

**Signed off by:** ___________________________  **Date:** ___________

---

## Step 7: Next Steps (unlocked after sign-off)

### Frontend Team

1. **Post feed** — `GET /api/posts` with infinite scroll (`offset` cursor), `POST /api/posts` for creation
2. **Invitation UI** (admin) — form calling `POST /api/invitations`, list from `GET /api/invitations`
3. **Accept invitation** — deep link `https://app.com/invite/:token` → calls `POST /api/invitations/:token/accept` → switch-tenant → refresh

### Backend Team — Email Service Integration

Wire the Phase 2 `TODO` comment in `invitations.service.ts:createInvitation`:

1. Install `@nestjs/bullmq` queue (already configured in `app.module.ts` from Week 2)
2. Inject the `notifications` queue into `InvitationsService`
3. Replace the `TODO` with:
   ```typescript
   await this.notificationsQueue.add('INVITATION_EMAIL', {
     recipientEmail: dto.email,
     token: saved.token,
     tenantName: '<lookup from tenant record>',
     role: dto.role,
     expiresAt: saved.expiresAt.toISOString(),
   });
   ```
4. Remove `token` from the `createInvitation` return value
5. Implement the notification worker using Resend or SendGrid

### Backend Team — CommentsModule

Begin scaffolding for Phase 2, Week 4:
- `comments` table: `id`, `post_id` (FK → posts), `author_id` (FK → users), `content`, `created_at`
- RLS policy: same tenant context as the parent post (`JOIN posts ON post_id = posts.id WHERE posts.tenant_id = current_tenant_id`)
- `GET /api/posts/:postId/comments` — nested under posts route
- `POST /api/posts/:postId/comments`
