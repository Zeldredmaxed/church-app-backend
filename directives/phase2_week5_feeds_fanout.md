# Directive: Phase 2, Week 5 — Feeds & Fan-Out Architecture

**Status:** `[ ] In Progress`  
**Owner:** Backend Team  
**Prerequisite:** `directives/phase2_week4_media_pipeline.md` signed off  
**Blocking:** Frontend global feed UI, follow/unfollow UI

---

## Prerequisites

- [ ] Phase 2, Week 4 sign-off complete
- [ ] Backend running with no errors
- [ ] Redis running and accessible (from Week 3 setup)
- [ ] Valid `accessToken` for at least 2 users — save as `$USER_A_TOKEN` and `$USER_B_TOKEN`
- [ ] User A and User B UUIDs — save as `$USER_A_ID` and `$USER_B_ID`

---

## Step 1: Install New Dependencies

```bash
cd backend
npm install @nestjs/graphql @nestjs/apollo @apollo/server graphql ioredis
```

> **Note:** `ioredis` may already be installed as a transitive dependency of `bullmq`, but adding it as a direct dependency ensures it's available for the FeedService's direct Redis operations (LPUSH, LRANGE, etc.).

---

## Step 2: Apply Migration 007

```bash
supabase db push
# or
psql "$DATABASE_URL" -f migrations/007_follows_and_global_posts.sql
```

### 2a. Verify posts.tenant_id is now nullable

```sql
SELECT column_name, is_nullable FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'posts' AND column_name = 'tenant_id';
```

| column_name | is_nullable |
| :--- | :--- |
| tenant_id | YES |

### 2b. Verify updated posts SELECT policy

```sql
SELECT policyname, cmd FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'posts' AND cmd = 'SELECT';
```

| policyname | cmd |
| :--- | :--- |
| posts: select tenant or global | SELECT |

### 2c. Verify follows table and RLS policies

```sql
SELECT policyname, cmd FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'follows'
ORDER BY policyname;
```

| policyname | cmd |
| :--- | :--- |
| follows: delete own relationships | DELETE |
| follows: insert as follower | INSERT |
| follows: select all | SELECT |

### 2d. Verify self-follow constraint

```sql
-- Should raise: violates check constraint "no_self_follow"
INSERT INTO public.follows (follower_id, following_id)
VALUES ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001');
```

- `[ ]` Migration applied cleanly
- `[ ]` `posts.tenant_id` is nullable
- `[ ]` Updated SELECT policy handles both tenant and global posts
- `[ ]` New INSERT policy for global posts confirmed
- `[ ]` `follows` table created with 3 RLS policies
- `[ ]` Self-follow constraint fires correctly

---

## Step 3: Files Added / Updated

| File | Status |
| :--- | :--- |
| `migrations/007_follows_and_global_posts.sql` | **New** |
| `backend/src/follows/entities/follow.entity.ts` | **New** |
| `backend/src/follows/dto/pagination.dto.ts` | **New** |
| `backend/src/follows/follows.service.ts` | **New** |
| `backend/src/follows/follows.controller.ts` | **New** |
| `backend/src/follows/follows.module.ts` | **New** |
| `backend/src/feed/feed.service.ts` | **New** — Redis feed reads + DataLoader-style batch resolution |
| `backend/src/feed/feed.resolver.ts` | **New** — GraphQL `globalFeed` query |
| `backend/src/feed/feed.module.ts` | **New** |
| `backend/src/feed/models/feed-post.model.ts` | **New** — GraphQL object types |
| `backend/src/feed/social-fanout.processor.ts` | **New** — BullMQ fan-out worker |
| `backend/src/posts/posts.service.ts` | Updated — `createGlobalPost` + social-fanout queue injection |
| `backend/src/posts/posts.controller.ts` | Updated — `POST /posts/global`, per-method RLS interceptor |
| `backend/src/posts/posts.module.ts` | Updated — `social-fanout` queue registered |
| `backend/src/main.ts` | Updated — `rawBody: true` added |
| `backend/src/app.module.ts` | Updated — GraphQLModule, FollowsModule, FeedModule, Follow entity |

---

## Step 4: API Contract

### Follow Endpoints _(require Bearer token, no RLS interceptor)_

#### `POST /api/users/:id/follow`
```json
// Response 201
{ "message": "Followed successfully" }

// Response 400 — self-follow attempt
{ "message": "You cannot follow yourself" }

// Response 404 — target user doesn't exist
{ "message": "User not found" }

// Response 409 — already following
{ "message": "You are already following this user" }
```

#### `DELETE /api/users/:id/follow`
```json
// Response 200
{ "message": "Unfollowed successfully" }

// Response 404 — not following this user
{ "message": "You are not following this user" }
```

#### `GET /api/users/:id/followers?limit=20&offset=0`
```json
// Response 200
{
  "users": [
    { "id": "user-uuid", "fullName": "John Doe", "avatarUrl": "https://..." }
  ],
  "total": 1,
  "limit": 20,
  "offset": 0
}
```

#### `GET /api/users/:id/following?limit=20&offset=0`
```json
// Response 200 — same shape as followers
```

### Global Post Endpoint _(requires Bearer token, no RLS interceptor)_

#### `POST /api/posts/global`
```json
// Request
{ "content": "Hello world from the global feed!", "mentions": [] }

// Response 201
{
  "id": "post-uuid",
  "tenantId": null,
  "authorId": "user-uuid",
  "content": "Hello world from the global feed!",
  "mediaType": "text",
  "mediaUrl": null,
  "videoMuxPlaybackId": null,
  "createdAt": "...",
  "updatedAt": "..."
}
```

### GraphQL Feed _(requires Bearer token)_

**Endpoint:** `POST /graphql`

```graphql
query {
  globalFeed(limit: 20, offset: 0) {
    posts {
      id
      content
      mediaType
      mediaUrl
      videoMuxPlaybackId
      createdAt
      author {
        id
        fullName
        avatarUrl
      }
      latestComment {
        id
        content
        createdAt
        author {
          id
          fullName
        }
      }
    }
    total
    limit
    offset
  }
}
```

> GraphQL playground is available at `/graphql` in development mode.

---

## Step 5: Architecture Notes

### Fan-Out on Write

```
User B creates         PostsService            BullMQ              SocialFanout         Redis
global post            (HTTP context)          'social-fanout'      Processor            (feed lists)
    │                       │                       │                    │                    │
    │   POST /posts/global  │                       │                    │                    │
    │──────────────────────▶│                       │                    │                    │
    │                       │   save post to DB     │                    │                    │
    │                       │──────────────────────▶│                    │                    │
    │                       │   add job             │                    │                    │
    │                       │──────────────────────▶│                    │                    │
    │   201 Created         │                       │                    │                    │
    │◀──────────────────────│                       │                    │                    │
    │                       │                       │   poll job         │                    │
    │                       │                       │───────────────────▶│                    │
    │                       │                       │                    │  query followers   │
    │                       │                       │                    │──────────────────▶  │
    │                       │                       │                    │                    │
    │                       │                       │                    │  LPUSH + LTRIM     │
    │                       │                       │                    │  per follower      │
    │                       │                       │                    │───────────────────▶│
    │                       │                       │                    │                    │
```

**Write path:** O(followers) — each follower's Redis list gets an LPUSH.  
**Read path:** O(1) — LRANGE on the user's pre-computed feed list + batch DB fetch.

### Why Fan-Out on Write (Not Fan-Out on Read)

| | Fan-Out on Write | Fan-Out on Read |
| :--- | :--- | :--- |
| **Write cost** | O(followers) — higher | O(1) — just save the post |
| **Read cost** | O(1) — pre-computed | O(following) — compute at read time |
| **Latency** | Reads are instant | Reads are slow for users following many people |
| **Best for** | Read-heavy social feeds | Write-heavy analytics |

A social feed is overwhelmingly read-heavy (users scroll the feed constantly, but post infrequently). Fan-out on write trades write amplification for instant reads — the correct trade-off for this use case.

### Redis Feed List Design

```
Key:     user:{userId}:feed:global
Type:    List (LPUSH/LRANGE)
Values:  Post UUIDs, newest first
Max:     500 entries (LTRIM after each LPUSH)
TTL:     None (evicted on Redis memory pressure via allkeys-lru)
```

**Why a List, not a Sorted Set?** Lists are simpler and sufficient here — we only need FIFO ordering (newest first). Sorted Sets would be needed for score-based ranking (e.g., "trending"), which is a Phase 3 concern.

### Cold Start Fallback

When a user's Redis feed is empty (new user, follows nobody, Redis eviction), the `FeedService` falls back to a direct DB query for recent global posts (`WHERE tenant_id IS NULL ORDER BY created_at DESC`). This ensures users always see content, even before they follow anyone.

### DataLoader-Style Batch Resolution (N+1 Prevention)

The feed resolver uses a batched approach to avoid N+1 queries:

```
Without batching (N+1):
  For 20 posts: 1 (posts) + 20 (authors) + 20 (latest comments) + 20 (comment authors) = 61 queries

With batching:
  For 20 posts: 1 (posts) + 1 (authors) + 1 (latest comments) + 1 (comment authors) = 4 queries
```

The `FeedService.enrichPosts` method collects all author IDs and post IDs, then resolves them in single batch queries using `WHERE id IN (...)` and `DISTINCT ON`.

### Follows Are Platform-Wide (Not Tenant-Scoped)

The `follows` table has no `tenant_id` column. A user can follow anyone on the platform regardless of church membership. The RLS policies use `auth.uid()` directly (not `current_tenant_id`). This is intentional — the global social feed is a platform-wide feature.

### PostsController: Per-Method vs Class-Level Interceptors

The `PostsController` was refactored from class-level `@UseInterceptors(RlsContextInterceptor)` to per-method decorators. This is necessary because `POST /posts/global` must NOT use the RLS interceptor (global posts have no tenant context), while all other routes still require it.

---

## Step 6: Verification

```bash
export USER_A_TOKEN="<user-a-access-token>"
export USER_B_TOKEN="<user-b-access-token>"
export USER_A_ID="<user-a-uuid>"
export USER_B_ID="<user-b-uuid>"
```

---

### Test 6.1 — User A follows User B

```bash
curl -X POST http://localhost:3000/api/users/$USER_B_ID/follow \
  -H "Authorization: Bearer $USER_A_TOKEN"
```

Expected: `201` — `{ "message": "Followed successfully" }`

- `[ ]` PASS

---

### Test 6.2 — Duplicate follow returns 409

```bash
curl -X POST http://localhost:3000/api/users/$USER_B_ID/follow \
  -H "Authorization: Bearer $USER_A_TOKEN"
```

Expected: `409` — `{ "message": "You are already following this user" }`

- `[ ]` PASS

---

### Test 6.3 — Self-follow returns 400

```bash
curl -X POST http://localhost:3000/api/users/$USER_A_ID/follow \
  -H "Authorization: Bearer $USER_A_TOKEN"
```

Expected: `400` — `{ "message": "You cannot follow yourself" }`

- `[ ]` PASS

---

### Test 6.4 — Get followers of User B

```bash
curl http://localhost:3000/api/users/$USER_B_ID/followers \
  -H "Authorization: Bearer $USER_A_TOKEN"
```

Expected: `200` — `users` array contains User A's profile.

- `[ ]` PASS

---

### Test 6.5 — Get following list for User A

```bash
curl http://localhost:3000/api/users/$USER_A_ID/following \
  -H "Authorization: Bearer $USER_A_TOKEN"
```

Expected: `200` — `users` array contains User B's profile.

- `[ ]` PASS

---

### Test 6.6 — User B creates a global post

```bash
curl -X POST http://localhost:3000/api/posts/global \
  -H "Authorization: Bearer $USER_B_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"content": "Hello from the global feed!"}'
```

Expected: `201` with `tenantId: null`. Check backend logs for:
```
Global post created: <post-id> by <user-b-id>
Fan-out job enqueued for global post <post-id>
```

- `[ ]` PASS — global post created, fan-out job enqueued

---

### Test 6.7 — Fan-out processor pushes post to User A's Redis feed

Wait 1–2 seconds for the async job, then check backend logs for:
```
Fan-out started for post <post-id> by author <user-b-id>
Fanning out post <post-id> to 1 follower(s)
Fan-out complete: post <post-id> pushed to 1 feed(s)
```

Optionally verify directly in Redis:
```bash
redis-cli LRANGE "user:${USER_A_ID}:feed:global" 0 -1
```

Expected: The global post ID appears in the list.

- `[ ]` PASS — post ID present in User A's Redis feed

---

### Test 6.8 — User A queries the global feed via GraphQL

```bash
curl -X POST http://localhost:3000/graphql \
  -H "Authorization: Bearer $USER_A_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "query { globalFeed(limit: 20, offset: 0) { posts { id content mediaType createdAt author { id fullName } latestComment { id content } } total limit offset } }"
  }'
```

Expected: `200` with `data.globalFeed.posts` containing User B's global post, with `author.id` matching `$USER_B_ID`.

- `[ ]` PASS — GraphQL feed returns the fan-out post with resolved author

---

### Test 6.9 — Unfollow User B

```bash
curl -X DELETE http://localhost:3000/api/users/$USER_B_ID/follow \
  -H "Authorization: Bearer $USER_A_TOKEN"
```

Expected: `200` — `{ "message": "Unfollowed successfully" }`

- `[ ]` PASS

---

### Test 6.10 — Unfollow a user you're not following returns 404

```bash
curl -X DELETE http://localhost:3000/api/users/$USER_B_ID/follow \
  -H "Authorization: Bearer $USER_A_TOKEN"
```

Expected: `404` — `{ "message": "You are not following this user" }`

- `[ ]` PASS

---

### Test 6.11 — Cold start: empty Redis feed falls back to DB

```bash
# Clear User A's Redis feed (simulate cold start)
redis-cli DEL "user:${USER_A_ID}:feed:global"

# Query the global feed
curl -X POST http://localhost:3000/graphql \
  -H "Authorization: Bearer $USER_A_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "query { globalFeed(limit: 10, offset: 0) { posts { id content } total } }"
  }'
```

Expected: `200` with recent global posts from the DB (fallback). Check backend logs for:
```
Cold start: falling back to DB query for global feed
```

- `[ ]` PASS — cold start fallback returns global posts from DB

---

### Test 6.12 — End-to-end fan-out flow (complete)

This test validates the entire pipeline in sequence:

```bash
# 1. User A follows User B
curl -X POST http://localhost:3000/api/users/$USER_B_ID/follow \
  -H "Authorization: Bearer $USER_A_TOKEN"

# 2. User B creates a global post
GLOBAL_POST=$(curl -s -X POST http://localhost:3000/api/posts/global \
  -H "Authorization: Bearer $USER_B_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"content": "End-to-end fan-out test!"}')
echo "Post created: $(echo $GLOBAL_POST | jq -r '.id')"

# 3. Wait for fan-out
sleep 2

# 4. User A queries global feed — should see User B's post
curl -X POST http://localhost:3000/graphql \
  -H "Authorization: Bearer $USER_A_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "query { globalFeed(limit: 5, offset: 0) { posts { id content author { fullName } } total } }"
  }'
```

Expected: The GraphQL response contains User B's post with resolved author name.

- `[ ]` PASS — complete fan-out pipeline verified end-to-end

---

### Test 6.13 — Phase 1 + Week 4 regression check

```bash
# Tenant posts still work (RLS interceptor now per-method)
curl http://localhost:3000/api/posts \
  -H "Authorization: Bearer $USER_A_TOKEN"

# Comments still work
curl http://localhost:3000/api/posts/$POST_ID/comments \
  -H "Authorization: Bearer $USER_A_TOKEN"

# Notifications still work
curl http://localhost:3000/api/notifications \
  -H "Authorization: Bearer $USER_A_TOKEN"

# Media pre-signed URL still works
curl -X POST http://localhost:3000/api/media/presigned-url \
  -H "Authorization: Bearer $USER_A_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"filename": "test.jpg", "contentType": "image/jpeg"}'
```

Expected: All return `200` with valid data.

- `[ ]` PASS — no regressions in Phase 1 or Week 4

---

## Step 7: Sign-Off

| Test | Owner | Result | Date |
| :--- | :--- | :--- | :--- |
| Migration 007 — follows table + global posts | DB Team | `[ ] PASS / [ ] FAIL` | |
| 6.1 Follow a user | Backend | `[ ] PASS / [ ] FAIL` | |
| 6.2 Duplicate follow rejected (409) | Backend | `[ ] PASS / [ ] FAIL` | |
| 6.3 Self-follow rejected (400) | Backend | `[ ] PASS / [ ] FAIL` | |
| 6.4 Get followers | Backend | `[ ] PASS / [ ] FAIL` | |
| 6.5 Get following | Backend | `[ ] PASS / [ ] FAIL` | |
| 6.6 Create global post + fan-out job | Backend | `[ ] PASS / [ ] FAIL` | |
| 6.7 Fan-out processor populates Redis | Backend | `[ ] PASS / [ ] FAIL` | |
| 6.8 GraphQL globalFeed returns posts | Backend | `[ ] PASS / [ ] FAIL` | |
| 6.9 Unfollow | Backend | `[ ] PASS / [ ] FAIL` | |
| 6.10 Unfollow non-followed returns 404 | Backend | `[ ] PASS / [ ] FAIL` | |
| 6.11 Cold start fallback to DB | Backend | `[ ] PASS / [ ] FAIL` | |
| 6.12 End-to-end fan-out pipeline | Backend | `[ ] PASS / [ ] FAIL` | |
| 6.13 Phase 1 + Week 4 regression | Backend | `[ ] PASS / [ ] FAIL` | |

**Signed off by:** ___________________________  **Date:** ___________

---

## Step 8: Next Steps (unlocked after sign-off)

### Backend Team — Week 6

1. **Church Feed API** — standard SQL query with RLS (`GET /api/posts` already works for tenant-scoped posts; may add a dedicated resolver for enriched feed format)
2. **Cursor-based pagination** — replace offset pagination with `cursor` (last post's `createdAt` timestamp) for both church and global feeds to handle real-time inserts gracefully
3. **Post reactions/likes** — `reactions` table (user_id, post_id, type), `GET /api/posts/:id/reactions`, `POST /api/posts/:id/react`
4. **Wire Mux webhook handler** — update post's `video_mux_playback_id` when `video.asset.ready` event arrives

### Frontend Team

1. **Follow/Unfollow UI** — button state from `GET /users/:id/followers` (check if current user is in the list)
2. **Followers/Following lists** — paginated user lists with avatar + name
3. **Global Feed** — GraphQL query `globalFeed` with infinite scroll
4. **Post creation** — toggle between "Church Post" and "Global Post" with different API endpoints
5. **GraphQL client setup** — Apollo Client or urql with auth header injection
