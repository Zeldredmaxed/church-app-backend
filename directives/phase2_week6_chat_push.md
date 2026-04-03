# Phase 2, Week 6: Real-time Chat & Push Notifications — Verification Directive

> **Status:** Implementation Complete  
> **Prerequisite:** Phase 2, Week 5 (Feeds & Fan-Out) verified and approved  
> **Deliverables:** Migration 008, ChatModule (REST API), OneSignal push integration, NEW_MESSAGE notification type

---

## Architecture Decisions

### 1. Chat is Tenant-Scoped
Unlike follows (platform-wide), chat channels exist **within** a church tenant. A user can only see channels in their `current_tenant_id`. RLS policies on all three tables (`chat_channels`, `channel_members`, `chat_messages`) enforce this by checking `ch.tenant_id = JWT.app_metadata.current_tenant_id`.

### 2. Three Channel Types with Distinct Access Control
| Type     | Visibility                 | Who Can Create        | Push Notifications |
|----------|----------------------------|-----------------------|--------------------|
| `public` | All tenant members         | Admin / Pastor        | No (too noisy)     |
| `private`| Channel members only       | Admin / Pastor        | Yes                |
| `direct` | The two participants only  | Any tenant member     | Yes                |

### 3. Cursor-Based Pagination for Messages
Offset-based pagination breaks for chat because new messages shift the entire result set. Cursor-based pagination (keyed on `created_at` via the cursor message's UUID) provides:
- **Consistency:** No skipped or duplicated messages during scrolling
- **Performance:** Index-backed `WHERE created_at < cursor_date` is O(log n)
- **UX fit:** "Load older messages" maps naturally to cursor pagination

### 4. OneSignal Integration via Service Layer
`OneSignalService` wraps the `@onesignal/node-onesignal` SDK. Users are identified by `external_id` = Supabase user UUID. The mobile app registers the device token with OneSignal using this same UUID on login. Push failures are logged but **never throw** — push is best-effort and must not block notification processing.

### 5. Supabase Realtime for Live Messages
The backend does NOT implement WebSocket handling. Supabase Realtime handles real-time message delivery directly to the frontend:
- Frontend subscribes to `chat_messages` table changes filtered by `channel_id`
- Supabase applies the same RLS policies to Realtime subscriptions
- This eliminates the need for a custom WebSocket server

---

## Files Created / Modified

### New Files
| File | Purpose |
|------|---------|
| `migrations/008_chat.sql` | chat_channels, channel_members, chat_messages tables with full RLS |
| `backend/src/chat/entities/chat-channel.entity.ts` | ChatChannel TypeORM entity |
| `backend/src/chat/entities/channel-member.entity.ts` | ChannelMember TypeORM entity (composite PK) |
| `backend/src/chat/entities/chat-message.entity.ts` | ChatMessage TypeORM entity |
| `backend/src/chat/dto/create-channel.dto.ts` | CreateChannelDto with type validation |
| `backend/src/chat/dto/add-member.dto.ts` | AddMemberDto (userId) |
| `backend/src/chat/dto/send-message.dto.ts` | SendMessageDto (content, 1-5000 chars) |
| `backend/src/chat/dto/get-messages.dto.ts` | GetMessagesDto (cursor UUID + limit) |
| `backend/src/chat/chat.service.ts` | Channel CRUD, messaging, notification dispatch |
| `backend/src/chat/chat.controller.ts` | REST API — all routes RLS-protected |
| `backend/src/chat/chat.module.ts` | Module registration |
| `backend/src/notifications/onesignal.service.ts` | OneSignal push notification client wrapper |

### Modified Files
| File | Change |
|------|--------|
| `backend/src/notifications/notifications.types.ts` | Added `NEW_MESSAGE` enum + `NewMessageJob` interface |
| `backend/src/notifications/notifications.processor.ts` | Added `handleNewMessage`, integrated OneSignal push for all types |
| `backend/src/notifications/notifications.module.ts` | Registered `OneSignalService` |
| `backend/src/app.module.ts` | Added `ChatModule`, `ChatChannel`, `ChannelMember`, `ChatMessage` entities |

---

## Environment Variables Required

```env
# OneSignal Push Notifications
ONESIGNAL_APP_ID=your-onesignal-app-id
ONESIGNAL_REST_API_KEY=your-onesignal-rest-api-key
```

---

## API Endpoints

| Method | Path | Auth | RLS | Description |
|--------|------|------|-----|-------------|
| `POST` | `/channels` | JWT | Yes | Create a channel in current tenant |
| `GET` | `/channels` | JWT | Yes | List accessible channels |
| `POST` | `/channels/:id/members` | JWT | Yes | Add a member to a channel |
| `POST` | `/channels/:id/messages` | JWT | Yes | Send a message |
| `GET` | `/channels/:id/messages?cursor=UUID&limit=50` | JWT | Yes | Get messages (cursor-based) |

---

## Verification Tests

### Test 1: Migration 008 — Tables Exist
```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name IN ('chat_channels', 'channel_members', 'chat_messages')
ORDER BY table_name;
```
**Expected:** 3 rows — `channel_members`, `chat_channels`, `chat_messages`

### Test 2: RLS Enabled on All Chat Tables
```sql
SELECT tablename, rowsecurity FROM pg_tables
WHERE schemaname = 'public' AND tablename IN ('chat_channels', 'channel_members', 'chat_messages');
```
**Expected:** All three have `rowsecurity = true`

### Test 3: RLS Policy Count
```sql
SELECT tablename, COUNT(*) AS policy_count FROM pg_policies
WHERE schemaname = 'public' AND tablename IN ('chat_channels', 'channel_members', 'chat_messages')
GROUP BY tablename ORDER BY tablename;
```
**Expected:**
- `channel_members`: 3 (SELECT, INSERT, DELETE)
- `chat_channels`: 4 (SELECT, INSERT, UPDATE, DELETE)
- `chat_messages`: 2 (SELECT, INSERT)

### Test 4: Channel Type Constraint
```sql
INSERT INTO public.chat_channels (tenant_id, name, type, created_by)
VALUES ('00000000-0000-0000-0000-000000000001', 'test', 'group', '00000000-0000-0000-0000-000000000001');
```
**Expected:** `ERROR: new row violates check constraint` — only `public`, `private`, `direct` allowed

### Test 5: Create Public Channel (Admin Only)
```bash
# As admin user with valid JWT
curl -X POST /channels \
  -H "Authorization: Bearer <admin_jwt>" \
  -d '{"name": "General", "type": "public"}'
```
**Expected:** `201 Created` with channel object. Creator is auto-added as channel member.

### Test 6: Create Public Channel (Regular Member — Rejected)
```bash
# As regular member with valid JWT
curl -X POST /channels \
  -H "Authorization: Bearer <member_jwt>" \
  -d '{"name": "My Channel", "type": "public"}'
```
**Expected:** RLS INSERT policy blocks — regular members cannot create public/private channels.

### Test 7: Create Direct Channel (Any Member)
```bash
curl -X POST /channels \
  -H "Authorization: Bearer <member_jwt>" \
  -d '{"type": "direct"}'
```
**Expected:** `201 Created` — any tenant member can create direct channels.

### Test 8: Send Message + Notification Dispatch
```bash
# Send message to a direct channel
curl -X POST /channels/<channel_id>/messages \
  -H "Authorization: Bearer <user_a_jwt>" \
  -d '{"content": "Hello!"}'
```
**Expected:**
1. `201 Created` with message object
2. A `NEW_MESSAGE` job is enqueued in the `notifications` BullMQ queue
3. The job targets User B (the other participant), NOT User A (sender)

### Test 9: Public Channel Messages — No Push Notifications
Send a message to a public channel. Verify that **no** `NEW_MESSAGE` jobs are enqueued.
Public channels are too noisy for push — in-app notifications only via Supabase Realtime.

### Test 10: Cursor-Based Message Pagination
```bash
# Get most recent messages
curl /channels/<channel_id>/messages?limit=2

# Response: { messages: [msg3, msg2], nextCursor: "msg2-uuid" }

# Get older messages using cursor
curl /channels/<channel_id>/messages?limit=2&cursor=msg2-uuid

# Response: { messages: [msg1], nextCursor: null }
```
**Expected:** Messages returned newest-first. `nextCursor` is null when no more messages exist. No duplicates or gaps between pages.

### Test 11: Cross-Tenant Channel Isolation
```bash
# User in Tenant A creates a channel
# User in Tenant B tries to list channels
curl /channels -H "Authorization: Bearer <tenant_b_jwt>"
```
**Expected:** Tenant B user sees 0 channels from Tenant A. RLS policy filters by `tenant_id = JWT.current_tenant_id`.

### Test 12: OneSignal Push Integration
```bash
# Trigger a NEW_COMMENT notification
# The NotificationsProcessor should call OneSignal.createNotification with:
#   - include_aliases.external_id = [recipientUserId]
#   - headings.en = "New Comment"
#   - contents.en = previewText
#   - data = { type: "NEW_COMMENT", postId: "..." }
```
**Expected:** OneSignal API receives the request. If OneSignal call fails, the error is logged but the in-app notification is still created (push is best-effort).

### Test 13: Idempotent Channel Member Add
```bash
# Add the same user to a channel twice
curl -X POST /channels/<id>/members -d '{"userId": "user-a-uuid"}'
curl -X POST /channels/<id>/members -d '{"userId": "user-a-uuid"}'
```
**Expected:** Both requests return `201`. The second catches the PG unique violation (23505) and returns the existing membership. No duplicate rows.

### Test 14: Private Channel Visibility
1. Admin creates a private channel
2. Admin adds User A as member
3. User A can see the channel in `GET /channels`
4. User B (not a member) cannot see it — RLS SELECT filters it out

### Test 15: Supabase Realtime RLS Enforcement
1. User A and User B are in the same direct channel
2. User C is in the same tenant but NOT in the channel
3. User A sends a message
4. User B receives the message via Supabase Realtime subscription
5. User C does NOT receive the message — RLS SELECT policy on `chat_messages` blocks it

> **Note:** This test requires a Supabase Realtime connection (frontend or WebSocket tool like `wscat`).

---

## Next Steps (Phase 3: Church Management & Monetization)
1. **Admin APIs for Member Roles** — CRUD for managing `tenant_memberships.role` (admin/pastor/member)
2. **Full-Text Search** — Postgres `tsvector` on posts, messages, and user profiles
3. **Stripe Connect Integration** — Church onboarding, tithing/giving payments
4. **Mux Webhook Wiring** — Update `posts.video_mux_playback_id` on `video.asset.ready` event
5. **Church Feed API** — Tenant-scoped feed with cursor-based pagination
6. **Post Reactions/Likes** — Lightweight engagement layer
