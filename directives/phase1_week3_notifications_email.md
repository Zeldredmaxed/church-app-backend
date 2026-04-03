# Directive: Phase 1, Week 3 (Final) — Notifications & Email

**Status:** `[ ] In Progress`  
**Owner:** Backend Team  
**Prerequisite:** `directives/phase1_week3_continued_comments_posts.md` signed off  
**Blocking:** Frontend notification bell UI, invitation email flow

---

## Prerequisites

- [ ] Week 3 Part 2 sign-off complete
- [ ] Backend running with no errors
- [ ] Redis running locally (default `localhost:6379`) or Upstash Redis URL configured
- [ ] Valid `accessToken` (admin role) from previous login — save as `$TOKEN`
- [ ] `.env` updated with Redis connection variables

---

## Step 1: Environment Configuration

Add to `.env`:

```env
# Redis — BullMQ job queue backend
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# Phase 2: Uncomment when email service is active
# RESEND_API_KEY=re_xxxxxxxxxxxx
```

Install new dependencies:

```bash
cd backend
npm install @nestjs/bullmq bullmq ioredis
```

---

## Step 2: Apply Migration 005

```bash
supabase db push
# or
psql "$DATABASE_URL" -f migrations/005_notifications.sql
```

Run the verification queries in `§ SECTION 4` of the migration file. Confirm:

```sql
-- 2 RLS policies present
SELECT policyname, cmd FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'notifications'
ORDER BY policyname;
```

| policyname | cmd |
| :--- | :--- |
| notifications: select own within tenant | SELECT |
| notifications: update own within tenant | UPDATE |

```sql
-- Trigger installed
SELECT trigger_name FROM information_schema.triggers
WHERE event_object_table = 'notifications'
  AND trigger_name = 'set_notifications_updated_at';
```

- `[ ]` Migration applied cleanly
- `[ ]` Both notification RLS policies confirmed
- `[ ]` `set_notifications_updated_at` trigger confirmed

---

## Step 3: Files Added / Updated

| File | Status |
| :--- | :--- |
| `migrations/005_notifications.sql` | **New** |
| `backend/src/notifications/entities/notification.entity.ts` | **New** |
| `backend/src/notifications/dto/get-notifications.dto.ts` | **New** |
| `backend/src/notifications/notifications.types.ts` | **New** — shared job type definitions |
| `backend/src/notifications/notifications.service.ts` | **New** |
| `backend/src/notifications/notifications.controller.ts` | **New** |
| `backend/src/notifications/notifications.processor.ts` | **New** — BullMQ worker |
| `backend/src/notifications/notifications.module.ts` | **New** |
| `backend/src/posts/dto/create-post.dto.ts` | Updated — `mentions?: string[]` field added |
| `backend/src/posts/posts.service.ts` | Updated — dispatches `POST_MENTION` jobs via BullMQ |
| `backend/src/posts/posts.module.ts` | Updated — imports `BullModule.registerQueue` |
| `backend/src/comments/comments.service.ts` | Updated — dispatches `NEW_COMMENT` jobs via BullMQ |
| `backend/src/comments/comments.module.ts` | Updated — imports `BullModule.registerQueue` |
| `backend/src/app.module.ts` | Updated — `BullModule.forRootAsync`, `NotificationsModule`, `Notification` entity |

---

## Step 4: API Contract

### Notification Endpoints _(all require Bearer token + RLS context)_

#### `GET /api/notifications?limit=20&offset=0&unreadOnly=true`
```json
// Response 200
{
  "notifications": [
    {
      "id": "notification-uuid",
      "recipientId": "user-uuid",
      "tenantId": "tenant-uuid",
      "type": "NEW_COMMENT",
      "payload": {
        "postId": "post-uuid",
        "commentId": "comment-uuid",
        "actorUserId": "commenter-uuid",
        "preview": "Amen to that!"
      },
      "readAt": null,
      "createdAt": "...",
      "updatedAt": "..."
    }
  ],
  "total": 1,
  "limit": 20,
  "offset": 0
}
```

#### `PATCH /api/notifications/:id/read`
```json
// Response 200 — notification with readAt set
{
  "id": "notification-uuid",
  "recipientId": "user-uuid",
  "tenantId": "tenant-uuid",
  "type": "NEW_COMMENT",
  "payload": { ... },
  "readAt": "2026-04-03T12:00:00.000Z",
  "createdAt": "...",
  "updatedAt": "..."
}
// Response 404 — not found, wrong user, or wrong tenant
{ "message": "Notification not found" }
```

### Post Endpoint (enhanced) _(requires Bearer token)_

#### `POST /api/posts` (updated)
```json
// Request — now accepts optional mentions array
{
  "content": "Great sermon by @pastor today!",
  "mentions": ["user-uuid-1", "user-uuid-2"]
}

// Response 201 — same as before
{ "id": "...", "content": "...", ... }
```

> Mentions are user UUIDs, not @usernames. The frontend resolves users via a mention picker and sends UUIDs. Each mentioned user receives an async in-app notification.

---

## Step 5: Architecture Notes

### BullMQ Integration Pattern

```
┌─────────────────────┐        ┌──────────────────┐        ┌─────────────────────┐
│  PostsService       │        │  Redis            │        │  Notifications      │
│  CommentsService    │──add──▶│  'notifications'  │──poll──▶│  Processor          │
│  (HTTP context)     │  job   │   queue           │  job   │  (service role)     │
└─────────────────────┘        └──────────────────┘        └─────────────────────┘
                                                                   │
                                                          ┌────────┴────────┐
                                                          │  INSERT into    │
                                                          │  notifications  │
                                                          │  (service role) │
                                                          └─────────────────┘
```

**Why async?** Notification creation must not block the HTTP response. If Redis is temporarily down, BullMQ retries with exponential backoff. The user who created the post/comment gets a fast response; the recipient's notification appears shortly after.

**Why service role for INSERTs?** There is no RLS INSERT policy on `notifications` for the `authenticated` role. This is deliberate:
- Notifications are system-generated events, not user actions
- Allowing user-role INSERTs would enable notification fabrication
- The processor runs outside the HTTP request lifecycle (no JWT context)

### Notification Types

| Type | Trigger | Recipient | Payload |
| :--- | :--- | :--- | :--- |
| `NEW_COMMENT` | Comment created on a post | Post author | `{ postId, commentId, actorUserId, preview }` |
| `POST_MENTION` | User mentioned in a post | Mentioned user | `{ postId, actorUserId, preview }` |
| `INVITATION_EMAIL` | Invitation created | Invitee (email) | `{ recipientEmail, invitationToken, role, expiresAt }` |

### Self-Notification Suppression

The processor skips notifications where `recipientUserId === actorUserId`. This prevents:
- A user commenting on their own post from getting a "new comment" notification
- A user mentioning themselves from getting a "you were mentioned" notification

### Mention Design: UUIDs, Not @Usernames

The `mentions` field accepts user UUIDs rather than parsing `@username` strings because:
1. There is no `username` column on the `users` table
2. UUID-based mentions are unambiguous — no collision or spoofing risk
3. The frontend can use a mention picker that resolves to UUIDs before submission
4. Validation is trivial (`@IsUUID('4', { each: true })`)

---

## Step 6: Verification

```bash
export TOKEN="<admin-access-token>"
export MEMBER_TOKEN="<member-role-access-token>"
export POST_ID="<id-of-an-existing-post>"
export OTHER_USER_ID="<uuid-of-another-user-in-the-same-tenant>"
```

---

### Test 6.1 — Create a post with mentions

```bash
curl -X POST http://localhost:3000/api/posts \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"content\": \"Shoutout to our worship team!\", \"mentions\": [\"$OTHER_USER_ID\"]}"
```

Expected: `201` with the post object. Check backend logs for:
```
Enqueued 1 mention notification(s) for post <post-id>
```

- `[ ]` PASS — post created, mention job enqueued

---

### Test 6.2 — BullMQ processor creates in-app notification for mention

Wait 1–2 seconds for the async job to process, then:

```bash
# Switch to the mentioned user's token and fetch their notifications
curl http://localhost:3000/api/notifications \
  -H "Authorization: Bearer $MEMBER_TOKEN"
```

Expected: `200` with a notification of type `POST_MENTION` in the array.

- `[ ]` PASS — mentioned user sees the notification

---

### Test 6.3 — Create a comment and verify NEW_COMMENT notification

```bash
# Comment on a post as the MEMBER (post was created by ADMIN)
curl -X POST http://localhost:3000/api/posts/$POST_ID/comments \
  -H "Authorization: Bearer $MEMBER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"content": "This is so inspiring!"}'
```

Expected: `201`. Check backend logs for:
```
Processing job <id>: NEW_COMMENT
In-app notification created for user <admin-user-id>
```

Then fetch the admin's notifications:

```bash
curl http://localhost:3000/api/notifications \
  -H "Authorization: Bearer $TOKEN"
```

Expected: `200` with a notification of type `NEW_COMMENT`.

- `[ ]` PASS — post author receives new comment notification

---

### Test 6.4 — Self-comment does NOT generate a notification

```bash
# ADMIN comments on their own post
curl -X POST http://localhost:3000/api/posts/$POST_ID/comments \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"content": "Thanks everyone!"}'
```

Expected: `201`. Check backend logs for:
```
Skipping self-notification for comment on own post
```

- `[ ]` PASS — no self-notification created

---

### Test 6.5 — Mark a notification as read

```bash
# Get the notification ID from Test 6.3
export NOTIF_ID="<notification-uuid-from-test-6.3>"

curl -X PATCH http://localhost:3000/api/notifications/$NOTIF_ID/read \
  -H "Authorization: Bearer $TOKEN"
```

Expected: `200` with `readAt` set to a timestamp (non-null).

- `[ ]` PASS — notification marked as read

---

### Test 6.6 — `unreadOnly=true` filter excludes read notifications

```bash
curl "http://localhost:3000/api/notifications?unreadOnly=true" \
  -H "Authorization: Bearer $TOKEN"
```

Expected: `200` — the notification marked as read in Test 6.5 should NOT appear.

- `[ ]` PASS — read notification filtered out

---

### Test 6.7 — CRITICAL: cannot read another user's notifications

```bash
# MEMBER tries to mark ADMIN's notification as read
curl -X PATCH http://localhost:3000/api/notifications/$NOTIF_ID/read \
  -H "Authorization: Bearer $MEMBER_TOKEN"
```

Expected: `404` — RLS UPDATE policy blocks cross-user access.

- `[ ]` PASS — cross-user notification access blocked

---

### Test 6.8 — CRITICAL: cannot view notifications from another tenant

```bash
# Switch to a different tenant, then try to fetch notifications created in the first tenant
# (after calling POST /auth/switch-tenant to a different church)
curl http://localhost:3000/api/notifications \
  -H "Authorization: Bearer $TOKEN"
```

Expected: `200` with an empty `notifications` array (or only notifications from the new tenant). Notifications from the previous tenant should NOT appear because the RLS SELECT policy checks `tenant_id = current_tenant_id`.

- `[ ]` PASS — cross-tenant notification isolation confirmed

---

### Test 6.9 — Invitation email stub fires via BullMQ

> This test validates the BullMQ pipeline end-to-end. The actual email is stubbed in Phase 1 — check backend logs for the stub message.

```bash
curl -X POST http://localhost:3000/api/invitations \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"email": "newinvitee@example.com", "role": "member"}'
```

Expected: `201`. Check backend logs for:
```
[EMAIL STUB] Invitation email would be sent to newinvitee@example.com with token xxxxxxxx... (role: member, expires: ...)
```

- `[ ]` PASS — invitation email job processed by BullMQ

> **Note:** Test 6.9 requires updating `InvitationsService.createInvitation` to enqueue the `INVITATION_EMAIL` job. This is a Phase 2 enhancement — for now, verify the processor handles the job type correctly by enqueuing a test job manually via Bull Board or a script.

---

## Step 7: Sign-Off

| Test | Owner | Result | Date |
| :--- | :--- | :--- | :--- |
| Migration 005 + RLS policies confirmed | DB Team | `[ ] PASS / [ ] FAIL` | |
| 6.1 Post with mentions dispatches job | Backend | `[ ] PASS / [ ] FAIL` | |
| 6.2 Mention notification created async | Backend | `[ ] PASS / [ ] FAIL` | |
| 6.3 Comment notification created async | Backend | `[ ] PASS / [ ] FAIL` | |
| 6.4 Self-comment skips notification | Backend | `[ ] PASS / [ ] FAIL` | |
| 6.5 Mark notification as read | Backend | `[ ] PASS / [ ] FAIL` | |
| 6.6 unreadOnly filter works | Backend | `[ ] PASS / [ ] FAIL` | |
| 6.7 Cross-user notification access blocked | Backend | `[ ] PASS / [ ] FAIL` | |
| 6.8 Cross-tenant notification isolation | Backend | `[ ] PASS / [ ] FAIL` | |
| 6.9 Invitation email stub fires via BullMQ | Backend | `[ ] PASS / [ ] FAIL` | |

**Signed off by:** ___________________________  **Date:** ___________

---

## Step 8: Next Steps (unlocked after sign-off)

### Phase 2 — Email Service (Week 6)

1. Install Resend SDK: `npm install resend`
2. Create `backend/src/notifications/email.service.ts` — wraps Resend client
3. Update `NotificationsProcessor.handleInvitationEmail` to call the email service
4. Update `InvitationsService.createInvitation` to enqueue `INVITATION_EMAIL` job
5. Remove invitation token from the API response (token travels only via email)

### Phase 2 — Push Notifications (Week 6)

1. Integrate OneSignal SDK
2. Add `push_player_id` column to `users` table (migration 006)
3. Update `NotificationsProcessor` to send push notifications alongside in-app
4. Add user preference endpoint: `PATCH /api/users/me/notification-preferences`

### Phase 2 — Additional Queues

Wire the remaining BullMQ queues from the architecture document:
- `social-fanout` — fan-out on write for the global feed
- `video-processing` — Mux webhook handler for video transcoding status

### Frontend Team

1. **Notification bell** — `GET /api/notifications?unreadOnly=true` with polling or WebSocket
2. **Notification list** — paginated `GET /api/notifications` with mark-as-read on click
3. **Mention picker** — typeahead search against `GET /api/memberships` to resolve user UUIDs
4. **Toast notifications** — real-time via Supabase Realtime subscription on `notifications` table
