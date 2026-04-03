# Phase 3, Week 7: Member Management & Full-Text Search — Verification Directive

> **Status:** Implementation Complete  
> **Prerequisite:** Phase 2, Week 6 (Chat & Push) verified and approved  
> **Deliverables:** MembershipsModule enhancements, Migration 009, SearchModule

---

## Architecture Decisions

### 1. MembershipsController Refactored to Multi-Resource Routes
The controller was refactored from `@Controller('memberships')` with class-level RLS to `@Controller()` with per-method `@UseInterceptors(RlsContextInterceptor)`. This enables RESTful routes:
- `GET /memberships` — existing "my memberships" (all tenants)
- `POST /memberships` — existing "add member" 
- `GET /tenants/:tenantId/members` — **new** list tenant members
- `PATCH /tenants/:tenantId/members/:userId/role` — **new** update role
- `DELETE /tenants/:tenantId/members/:userId` — **new** remove member

The `tenants/:tenantId/members` pattern is RESTful and makes the resource hierarchy explicit.

### 2. Cursor-Based Pagination for Members
Member lists use cursor-based pagination keyed on `(COALESCE(full_name, ''), user_id)` for deterministic alphabetical ordering. This is superior to offset because:
- Stable results when members are added/removed during pagination
- O(log n) performance via index

### 3. Postgres tsvector for Full-Text Search
At the current scale (< 100k posts), Postgres tsvector is the correct choice over external search engines (Elasticsearch, Typesense). It provides:
- **Zero operational overhead** — no separate service to deploy/maintain
- **Stemming** via `english` configuration ("running" → "run")
- **Weighted ranking** — author name (A weight) ranks higher than content (B weight)
- **Robust query parsing** via `websearch_to_tsquery` (handles phrases, OR, negation)

### 4. Cross-Table Search Vectors
The `posts.search_vector` includes the author's `full_name` (from `public.users`), computed at write time via a trigger. This denormalization enables "search posts by author name" without a runtime JOIN to users during search. Trade-off: if a user renames, their old posts' search vectors become stale until reindexed.

### 5. RLS-Enforced Search Results
Search queries run through the RLS-scoped QueryRunner. The `posts` search additionally filters `tenant_id IS NOT NULL` to exclude global posts from tenant-scoped search results. Member search inherits the `tenant_memberships` SELECT policy which already filters by `current_tenant_id`.

---

## Files Created / Modified

### New Files
| File | Purpose |
|------|---------|
| `migrations/009_full_text_search.sql` | tsvector columns, GIN indexes, triggers, backfill |
| `backend/src/memberships/dto/update-role.dto.ts` | UpdateRoleDto |
| `backend/src/memberships/dto/get-members.dto.ts` | GetMembersDto (cursor + limit) |
| `backend/src/search/dto/search-query.dto.ts` | SearchQueryDto (q, cursor, limit) |
| `backend/src/search/search.service.ts` | searchPosts + searchMembers with ranking |
| `backend/src/search/search.controller.ts` | GET /search/posts, GET /search/members |
| `backend/src/search/search.module.ts` | Module registration |

### Modified Files
| File | Change |
|------|--------|
| `backend/src/memberships/memberships.service.ts` | Added `getMembers`, `updateRole`, `removeMember` + `TenantMemberDetail` interface |
| `backend/src/memberships/memberships.controller.ts` | Refactored to multi-resource routes; added 3 new endpoints |
| `backend/src/app.module.ts` | Added `SearchModule` |

---

## API Endpoints

### Member Management
| Method | Path | Auth | RLS | Description |
|--------|------|------|-----|-------------|
| `GET` | `/tenants/:tenantId/members` | JWT | Yes | List tenant members (cursor-based) |
| `PATCH` | `/tenants/:tenantId/members/:userId/role` | JWT | Yes | Update member role (admin only) |
| `DELETE` | `/tenants/:tenantId/members/:userId` | JWT | Yes | Remove member (admin or self) |

### Full-Text Search
| Method | Path | Auth | RLS | Description |
|--------|------|------|-----|-------------|
| `GET` | `/search/posts?q=...&cursor=...&limit=20` | JWT | Yes | Search posts in current tenant |
| `GET` | `/search/members?q=...&cursor=...&limit=20` | JWT | Yes | Search members in current tenant |

---

## Verification Tests

### Test 1: Migration 009 — tsvector Columns Exist
```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_schema = 'public'
  AND column_name = 'search_vector'
  AND table_name IN ('posts', 'users')
ORDER BY table_name;
```
**Expected:** 2 rows — both with `data_type = 'tsvector'`

### Test 2: GIN Indexes Exist
```sql
SELECT indexname FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname IN ('idx_posts_search_vector', 'idx_users_search_vector');
```
**Expected:** 2 rows

### Test 3: Triggers Fire on Insert
```sql
-- Insert a post, then verify search_vector is populated
INSERT INTO public.posts (author_id, content, tenant_id)
VALUES ('<user_id>', 'The Sunday worship service was incredible', '<tenant_id>');

SELECT id, search_vector IS NOT NULL AS has_vector
FROM public.posts WHERE content = 'The Sunday worship service was incredible';
```
**Expected:** `has_vector = true`

### Test 4: websearch_to_tsquery Works
```sql
SELECT id, content, ts_rank(search_vector, websearch_to_tsquery('english', 'worship service')) AS rank
FROM public.posts
WHERE search_vector @@ websearch_to_tsquery('english', 'worship service')
ORDER BY rank DESC;
```
**Expected:** Returns posts matching "worship" AND "service" (stemmed)

### Test 5: List Tenant Members (Paginated)
```bash
curl /tenants/<tenantId>/members?limit=2
# Response: { members: [...], nextCursor: "user-uuid" }

curl /tenants/<tenantId>/members?limit=2&cursor=user-uuid
# Response: { members: [...], nextCursor: null }
```
**Expected:** Members returned alphabetically by full_name. Cursor pagination works without gaps.

### Test 6: Update Member Role (Admin Only)
```bash
# As admin
curl -X PATCH /tenants/<tenantId>/members/<userId>/role \
  -d '{"role": "pastor"}'
```
**Expected:** `200 OK` with updated member detail.

### Test 7: Update Member Role (Non-Admin — Rejected)
```bash
# As regular member
curl -X PATCH /tenants/<tenantId>/members/<userId>/role \
  -d '{"role": "admin"}'
```
**Expected:** RLS UPDATE policy blocks — returns 404 (affected === 0).

### Test 8: Remove Member (Admin Removes Other)
```bash
curl -X DELETE /tenants/<tenantId>/members/<userId> \
  -H "Authorization: Bearer <admin_jwt>"
```
**Expected:** `204 No Content`. Member is removed from tenant.

### Test 9: Remove Member (Self-Removal)
```bash
curl -X DELETE /tenants/<tenantId>/members/<own_userId> \
  -H "Authorization: Bearer <member_jwt>"
```
**Expected:** `204 No Content`. User leaves the tenant.

### Test 10: Remove Member (Non-Admin, Other User — Rejected)
```bash
curl -X DELETE /tenants/<tenantId>/members/<other_userId> \
  -H "Authorization: Bearer <member_jwt>"
```
**Expected:** RLS DELETE policy blocks — returns 404.

### Test 11: Search Posts — Tenant Isolation
1. Create a post with content "prayer meeting" in Tenant A
2. Create a post with content "prayer meeting" in Tenant B
3. Search `GET /search/posts?q=prayer meeting` as Tenant A user
**Expected:** Only Tenant A's post is returned. RLS filters Tenant B.

### Test 12: Search Posts — Relevance Ranking
1. Create Post A: content = "The church prayer group meets on Wednesdays"
2. Create Post B: content = "Prayer is important for the community"
3. Search `GET /search/posts?q=church prayer`
**Expected:** Post A ranks higher (contains both "church" AND "prayer").

### Test 13: Search Members — Name + Email
```bash
# User "John Smith" with email "john@example.com" exists in tenant
curl /search/members?q=John
# Expected: returns John Smith (matched on full_name, A weight)

curl /search/members?q=john@example
# Expected: returns John Smith (matched on email, B weight)
```

### Test 14: Search — Phrase and Negation
```bash
# websearch_to_tsquery supports natural search syntax
curl /search/posts?q="Sunday worship"
# Expected: matches posts with the phrase "Sunday worship"

curl /search/posts?q=worship -prayer
# Expected: matches posts with "worship" but NOT "prayer"
```

### Test 15: Search Cursor Pagination
```bash
curl /search/posts?q=church&limit=2
# Response: { results: [post1, post2], nextCursor: "post2-uuid" }

curl /search/posts?q=church&limit=2&cursor=post2-uuid
# Response: { results: [post3], nextCursor: null }
```
**Expected:** Results maintain relevance ordering across pages. No duplicates.

---

## Next Steps (Phase 3 continued)
1. **Stripe Connect Integration** — Church onboarding, tithing/giving payments with split-payment flow
2. **Post Reactions/Likes** — Lightweight engagement layer with reaction counts
3. **Mux Webhook Wiring** — Update `posts.video_mux_playback_id` on `video.asset.ready` event
4. **Church Feed API** — Tenant-scoped feed with cursor-based pagination (distinct from global feed)
5. **Search Enhancements** — Filter by media_type, date range, and chat message search
