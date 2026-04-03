# Directive: Phase 1, Week 3 (Continued) — Comments & Post Enhancements

**Status:** `[ ] In Progress`  
**Owner:** Backend Team  
**Prerequisite:** `directives/phase1_week3_posts_invitations.md` signed off  
**Blocking:** Frontend post detail + comment thread UI

---

## Prerequisites

- [ ] Week 3 Part 1 sign-off complete
- [ ] Backend running with no errors
- [ ] Valid `accessToken` (admin role) from previous login — save as `$TOKEN`

---

## Step 1: Apply Migration 004

```bash
supabase db push
# or
psql "$DATABASE_URL" -f migrations/004_comments.sql
```

Run the four verification queries in `§ SECTION 4` of the migration file. Confirm:

```sql
-- All 4 policies present
SELECT policyname, cmd FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'comments'
ORDER BY policyname;
```

| policyname | cmd |
| :--- | :--- |
| comments: delete by author or admin | DELETE |
| comments: insert by tenant member | INSERT |
| comments: select within current tenant | SELECT |
| comments: update by author only | UPDATE |

```sql
-- Trigger installed
SELECT trigger_name FROM information_schema.triggers
WHERE trigger_name = 'validate_comment_tenant';
```

- `[ ]` Migration applied cleanly
- `[ ]` All 4 comment RLS policies confirmed
- `[ ]` `validate_comment_tenant` trigger confirmed

---

## Step 2: Files Added / Updated

| File | Status |
| :--- | :--- |
| `migrations/004_comments.sql` | **New** |
| `backend/src/comments/entities/comment.entity.ts` | **New** |
| `backend/src/comments/dto/create-comment.dto.ts` | **New** |
| `backend/src/comments/dto/get-comments.dto.ts` | **New** |
| `backend/src/comments/comments.service.ts` | **New** |
| `backend/src/comments/comments.controller.ts` | **New** |
| `backend/src/comments/comments.module.ts` | **New** |
| `backend/src/posts/dto/update-post.dto.ts` | **New** |
| `backend/src/posts/posts.service.ts` | Updated — `findOne`, `updatePost`, `deletePost` added |
| `backend/src/posts/posts.controller.ts` | Updated — `GET /:id`, `PATCH /:id`, `DELETE /:id` added |
| `backend/src/app.module.ts` | Updated — `CommentsModule`, `Comment` entity registered |

---

## Step 3: API Contract

### Post Endpoints (new/enhanced) _(all require Bearer token)_

#### `GET /api/posts/:id`
```json
// Response 200
{
  "id": "post-uuid",
  "tenantId": "tenant-uuid",
  "authorId": "user-uuid",
  "content": "Sunday service was amazing!",
  "videoMuxPlaybackId": null,
  "createdAt": "...",
  "updatedAt": "..."
}
// Response 404 — post doesn't exist OR belongs to another tenant
{ "message": "Post not found" }
```

#### `PATCH /api/posts/:id`
```json
// Request — only content is editable
{ "content": "Updated content." }

// Response 200 — updated post
{ "id": "...", "content": "Updated content.", ... }

// Response 404 — not found, wrong tenant, or caller is not the author
{ "message": "Post not found or you do not have permission to edit it" }
```

#### `DELETE /api/posts/:id`
```
// Response 204 No Content — success

// Response 404 — not found, wrong tenant, or insufficient role
{ "message": "Post not found or you do not have permission to delete it" }
```

> [!IMPORTANT]
> PATCH and DELETE return the same `404` for "not found", "wrong tenant", and "wrong author/role". This is intentional — leaking which constraint failed would allow resource enumeration across tenants.

---

### Comment Endpoints _(all require Bearer token, nested under `/posts/:postId/`)_

#### `POST /api/posts/:postId/comments`
```json
// Request
{ "content": "Amen to that!" }

// Response 201
{
  "id": "comment-uuid",
  "postId": "post-uuid",
  "tenantId": "tenant-uuid",
  "authorId": "user-uuid",
  "content": "Amen to that!",
  "createdAt": "...",
  "updatedAt": "..."
}
// Response 404 — post doesn't exist or belongs to another tenant
{ "message": "Post not found" }

// Response 400 — no active tenant context
{ "message": "No active tenant context. Call POST /api/auth/switch-tenant first." }
```

#### `GET /api/posts/:postId/comments?limit=20&offset=0`
```json
// Response 200
{
  "comments": [ { "id": "...", "postId": "...", "content": "Amen!", ... } ],
  "total": 1,
  "limit": 20,
  "offset": 0
}
// Response 404 — post doesn't exist in current tenant
{ "message": "Post not found" }
```

---

## Step 4: RLS Design Notes

### Why `tenant_id` is denormalised onto comments

A "pure" design would derive `comments.tenant_id` via `JOIN comments → posts → tenant_id`. But every SELECT, INSERT, UPDATE, and DELETE RLS policy on comments would need that JOIN to verify the tenant:

```sql
-- WITHOUT denormalisation — expensive and risks RLS recursion
USING (
  EXISTS (
    SELECT 1 FROM public.posts p
    WHERE p.id = comments.post_id
      AND p.tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
  )
)
```

With `tenant_id` directly on the row, every policy reduces to a single column equality check — the same pattern used throughout the codebase. The `validate_comment_tenant` DB trigger ensures this denormalisation never drifts out of sync.

### The `validate_comment_tenant` trigger

Runs `BEFORE INSERT OR UPDATE OF post_id, tenant_id` as `SECURITY DEFINER`. It bypasses RLS to read `public.posts` directly (by design — it needs to validate the cross-reference authoritatively). This means even a service-role data migration that sets the wrong `tenant_id` on a comment will be rejected at the DB level.

### `affected === 0` ambiguity on PATCH and DELETE

TypeORM's `manager.update` and `manager.delete` return the number of rows affected. With RLS active, an update or delete on a post that exists but fails an RLS check silently affects 0 rows — indistinguishable from a "not found". This is by design: it prevents callers from using the 403 vs 404 distinction to probe whether a resource exists in another tenant.

---

## Step 5: Verification

```bash
export TOKEN="<admin-access-token>"
export POST_ID="<id-of-an-existing-post>"
export MEMBER_TOKEN="<member-role-access-token>"
export OTHER_AUTHOR_TOKEN="<token-for-a-different-user-who-is-also-a-member>"
```

---

### Test 5.1 — `GET /posts/:id` returns a post

```bash
curl http://localhost:3000/api/posts/$POST_ID \
  -H "Authorization: Bearer $TOKEN"
```

Expected: `200` with the post's fields.

- `[ ]` PASS

---

### Test 5.2 — `PATCH /posts/:id` updates content (author)

```bash
curl -X PATCH http://localhost:3000/api/posts/$POST_ID \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"content": "Updated content."}'
```

Expected: `200` with `content: "Updated content."`.

- `[ ]` PASS

---

### Test 5.3 — CRITICAL: non-author member cannot update a post

```bash
# OTHER_AUTHOR_TOKEN = a member-role user who did NOT create POST_ID
curl -X PATCH http://localhost:3000/api/posts/$POST_ID \
  -H "Authorization: Bearer $OTHER_AUTHOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"content": "Hijacked content."}'
```

Expected: `404` — "Post not found or you do not have permission to edit it"  
(RLS UPDATE USING clause filters out posts where `author_id ≠ auth.uid()`)

- `[ ]` PASS — non-author gets 404

---

### Test 5.4 — Admin can delete another user's post

```bash
# Create a post as MEMBER, then delete it as ADMIN
export MEMBER_POST_ID=$(curl -X POST http://localhost:3000/api/posts \
  -H "Authorization: Bearer $MEMBER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"content": "Member post"}' | jq -r '.id')

curl -X DELETE http://localhost:3000/api/posts/$MEMBER_POST_ID \
  -H "Authorization: Bearer $TOKEN"
```

Expected: `204 No Content`.

- `[ ]` PASS — admin can delete any post in the tenant

---

### Test 5.5 — CRITICAL: member cannot delete another member's post

```bash
# Create post as ADMIN, try to delete as a different MEMBER
curl -X DELETE http://localhost:3000/api/posts/$POST_ID \
  -H "Authorization: Bearer $MEMBER_TOKEN"
```

Expected: `404` — member role fails the RLS DELETE admin check AND is not the author.

- `[ ]` PASS

---

### Test 5.6 — Create a comment

```bash
curl -X POST http://localhost:3000/api/posts/$POST_ID/comments \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"content": "Amen to that!"}'

export COMMENT_POST_ID=$POST_ID
```

Expected: `201` — `postId` matches `$POST_ID`, `tenantId` matches current tenant UUID.

- `[ ]` PASS

---

### Test 5.7 — Get comments for a post

```bash
curl http://localhost:3000/api/posts/$POST_ID/comments \
  -H "Authorization: Bearer $TOKEN"
```

Expected: `200` — `comments` array contains the comment from Test 5.6.

- `[ ]` PASS

---

### Test 5.8 — CRITICAL: cannot comment on a post in another tenant

```bash
# Get a post UUID from a DIFFERENT tenant (look one up in Supabase Studio)
export FOREIGN_POST_ID="<post-uuid-from-church-beta>"

curl -X POST http://localhost:3000/api/posts/$FOREIGN_POST_ID/comments \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"content": "Cross-tenant comment attempt"}'
```

Expected: `404` — the RLS-scoped `findOne(Post)` in the service returns null for posts outside the current tenant context.

- `[ ]` PASS — cross-tenant comment attempt returns 404

---

### Test 5.9 — CRITICAL: cannot view comments on a post from another tenant

```bash
curl http://localhost:3000/api/posts/$FOREIGN_POST_ID/comments \
  -H "Authorization: Bearer $TOKEN"
```

Expected: `404` — `getComments` verifies the post exists in the current tenant via RLS-scoped `findOne` before returning comments.

- `[ ]` PASS — cross-tenant comment listing returns 404

---

### Test 5.10 — `validate_comment_tenant` trigger fires on direct DB write

In Supabase Studio SQL editor (service role — bypasses application logic):

```sql
-- Attempt to insert a comment with mismatched tenant_id
INSERT INTO public.comments (post_id, tenant_id, author_id, content)
VALUES (
  '<post-uuid-from-church-alpha>',  -- post belongs to Church Alpha
  '<church-beta-uuid>',              -- wrong tenant_id (Church Beta)
  '<any-user-uuid>',
  'Trigger test'
);
```

Expected: Postgres raises an exception:  
`cross-tenant comment rejected` — the `validate_comment_tenant` trigger fires and rejects the insert.

- `[ ]` PASS — DB-level cross-tenant comment protection confirmed

---

## Step 6: Sign-Off

| Test | Owner | Result | Date |
| :--- | :--- | :--- | :--- |
| Migration 004 + trigger confirmed | DB Team | `[ ] PASS / [ ] FAIL` | |
| 5.1 GET /posts/:id | Backend | `[ ] PASS / [ ] FAIL` | |
| 5.2 PATCH /posts/:id (author) | Backend | `[ ] PASS / [ ] FAIL` | |
| 5.3 Non-author PATCH returns 404 | Backend | `[ ] PASS / [ ] FAIL` | |
| 5.4 Admin deletes another's post (204) | Backend | `[ ] PASS / [ ] FAIL` | |
| 5.5 Non-author member DELETE returns 404 | Backend | `[ ] PASS / [ ] FAIL` | |
| 5.6 Create comment | Backend | `[ ] PASS / [ ] FAIL` | |
| 5.7 Get comments | Backend | `[ ] PASS / [ ] FAIL` | |
| 5.8 Cross-tenant comment POST returns 404 | Backend | `[ ] PASS / [ ] FAIL` | |
| 5.9 Cross-tenant comment GET returns 404 | Backend | `[ ] PASS / [ ] FAIL` | |
| 5.10 DB-level trigger rejects bad tenant_id | DB Team | `[ ] PASS / [ ] FAIL` | |

**Signed off by:** ___________________________  **Date:** ___________

---

## Step 7: Next Steps (unlocked after sign-off)

### Frontend Team

1. **Post detail page** — `GET /api/posts/:id` + `GET /api/posts/:id/comments` with infinite scroll
2. **Comment thread** — `POST /api/posts/:id/comments`, optimistic UI update before server confirms
3. **Post actions** — Edit (PATCH) and Delete only shown to the post author; Delete also shown to admins

### Backend Team — NotificationsModule (Phase 2, Week 6)

Wire the BullMQ `notifications` queue to OneSignal for:

1. **New comment** — `POST /posts/:postId/comments` enqueues a job targeting the post author:
   ```typescript
   await this.notificationsQueue.add('NEW_COMMENT', {
     type: 'NEW_COMMENT',
     recipientUserId: post.authorId,
     payload: { actorName: commenter.fullName, entityId: comment.id, previewText: dto.content.slice(0, 100) }
   });
   ```
2. **Post liked** — Phase 2 after the reactions/likes feature is added

### Backend Team — Email Service for Invitations (Phase 2, Week 6)

Replace the `TODO` comment in `invitations.service.ts:createInvitation`:
- Install Resend SDK: `npm install resend`
- Move the `token` out of the API response
- Send the invitation link: `https://<app-domain>/invite/${token}`
