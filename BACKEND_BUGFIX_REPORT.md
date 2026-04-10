# Shepard Backend — Bug Fix Report (April 9, 2026)

> **For:** Admin Dashboard Team (Next.js) + Mobile App Team (React Native)
> **From:** Backend Team
> **Priority:** Read before your next deploy. Some fixes change response behavior.

---

## What Happened

We ran a full deep-dive audit of all 47 backend service/controller files. We found **8 bugs** — 2 critical (would crash at runtime), 2 high severity, and 4 medium/low. All have been fixed and pushed. **Migration 035 must be run in Supabase before these fixes go live.**

---

## Fixes That Affect the Frontend

### 1. Dashboard KPIs + Growth Chart — Were Broken, Now Work

**Who this affects:** Admin Dashboard

**What was wrong:** The `tenant_memberships` table was missing a `created_at` timestamp column. These endpoints would have returned a 500 error:
- `GET /api/dashboard/kpis` — the `newMembersThisMonth` field
- `GET /api/dashboard/growth-chart` — the entire response

**What changed:** Migration 035 adds the `created_at` column and backfills it from user account creation dates. These endpoints now return real data.

**Do you need to change anything?** No. The response shapes are unchanged. If you were catching 500 errors from these endpoints during development, they should now work.

---

### 2. Moderation Queue — Author Names Were Always Null

**Who this affects:** Admin Dashboard

**What was wrong:** The moderation endpoint `GET /api/admin/moderation` had a broken SQL JOIN — it was looking for `posts.user_id` which doesn't exist (the column is `posts.author_id`). As a result, the `authorName` field in every report was always `null`.

**What changed:** The JOIN now uses the correct column. `authorName` will populate correctly.

**Do you need to change anything?** If you were hiding the author name because it was always null, or showing "Unknown" as a fallback — you can now display it normally. The response shape is:

```json
{
  "items": [
    {
      "id": "uuid",
      "postId": "uuid",
      "reportedBy": "uuid",
      "reason": "...",
      "status": "pending",
      "reviewedBy": null,
      "postThumbnail": "https://...",
      "authorName": "John Smith",   // <-- was always null, now works
      "createdAt": "2026-04-09T..."
    }
  ],
  "nextCursor": "...",
  "counts": { "pending": 3, "reviewed": 12, "removed": 1 }
}
```

---

### 3. Members Export — Column Name Fixed

**Who this affects:** Admin Dashboard

**What was wrong:** `GET /api/reports/export?type=members` was querying a column called `joined_at` that didn't exist. This endpoint would crash with a 500 error.

**What changed:** Now uses `created_at` (added by migration 035) and aliases it as `joined_at` in the response. The field name in your response is still `joinedAt` — no change needed on your end.

```json
{
  "data": [
    {
      "id": "uuid",
      "email": "user@example.com",
      "fullName": "John Smith",
      "role": "member",
      "joinedAt": "2026-01-15T..."   // <-- was crashing, now returns the date
    }
  ]
}
```

**Do you need to change anything?** No. Same response shape. If your export/CSV feature was broken because of 500 errors, it should now work.

---

### 4. Tenant Context Errors — Now Return 400 Instead of 500

**Who this affects:** Both teams (Admin Dashboard + Mobile App)

**What was wrong:** Several controllers used `throw new Error()` (generic JavaScript error) when the JWT was missing a tenant context. This returned a **500 Internal Server Error** with an unhelpful message. Affected endpoints:
- All `/api/sermons/*` endpoints
- All `/api/volunteer/*` endpoints  
- All `/api/attendance/*` endpoints (except `POST /api/check-in`)

**What changed:** These now return a proper **400 Bad Request** with a clear message:

```json
{
  "statusCode": 400,
  "message": "No tenant context",
  "error": "Bad Request"
}
```

**Do you need to change anything?** If your error handling checks for specific status codes:
- **Before:** These returned `500` when tenant context was missing
- **After:** These return `400`

If you're catching errors generically (any non-2xx = show error), no change needed. If you have specific `500` vs `400` handling, update accordingly. This is a better developer experience — a 400 tells you the JWT is missing `current_tenant_id`, while a 500 suggested a server crash.

---

### 5. AI Assistant — No Response Change, Security Hardening Only

**Who this affects:** Admin Dashboard (Premium/Enterprise only)

**What was wrong:** The `POST /api/assistant/ask` fallback queries used string interpolation to inject user-parsed numbers into SQL. While not exploitable (values were sanitized with `parseInt`), it was flagged as a security anti-pattern.

**What changed:** The SQL now uses proper parameterized queries. Response shapes are identical.

**Do you need to change anything?** No.

---

## Fixes With No Frontend Impact

These fixes improved backend reliability but don't change any API responses:

| Fix | What changed | Why |
|-----|-------------|-----|
| DELETE result checking | Sermons, feedback, and moderation DELETE/UPDATE operations now use `RETURNING id` instead of checking `result[1]` | More reliable across database driver versions |
| Sermon likes ON CONFLICT | `ON CONFLICT DO NOTHING` now specifies `(sermon_id, user_id)` | Prevents catching unrelated constraint violations |
| Sermon view recording | Fire-and-forget `recordView()` now logs errors instead of silently swallowing them | Easier debugging if view counting breaks |

---

## Migration Required

**Migration 035** must be run in the Supabase SQL editor before these fixes take effect:

```
migrations/035_tenant_memberships_created_at.sql
```

This adds a `created_at` column to `tenant_memberships` and backfills existing rows from user account creation dates. It's non-destructive — no existing data is modified or deleted.

**If migration 035 is NOT run:**
- `GET /api/dashboard/kpis` will crash (500)
- `GET /api/dashboard/growth-chart` will crash (500)
- `GET /api/reports/export?type=members` will crash (500)

**If migration 035 IS run:** Everything works as expected.

---

## Quick Reference: What Changed Per Endpoint

| Endpoint | Before | After | Team |
|----------|--------|-------|------|
| `GET /api/dashboard/kpis` | 500 error | Returns `newMembersThisMonth` correctly | Admin |
| `GET /api/dashboard/growth-chart` | 500 error | Returns monthly member growth data | Admin |
| `GET /api/admin/moderation` | `authorName: null` always | `authorName: "John Smith"` | Admin |
| `GET /api/reports/export?type=members` | 500 error | Returns `joinedAt` dates | Admin |
| `POST /api/assistant/ask` | Worked but had SQL smell | Same response, hardened SQL | Admin |
| `GET/POST/PUT/DELETE /api/sermons/*` | 500 on missing tenant | 400 "No tenant context" | Both |
| `GET/POST /api/volunteer/*` | 500 on missing tenant | 400 "No tenant context" | Both |
| `GET/POST /api/attendance/*` | 500 on missing tenant | 400 "No tenant context" | Both |
| `DELETE /api/sermons/:id` | Fragile result check | Reliable RETURNING check | Both |
| `DELETE /api/feedback/:id` | Fragile result check | Reliable RETURNING check | Admin |
| `POST /api/admin/moderation/:id/approve` | Fragile result check | Reliable RETURNING check | Admin |

---

## TL;DR

- **Admin Dashboard:** Your moderation queue author names will show up now. Dashboard KPIs and growth chart will work after migration 035. Members export will work.
- **Mobile App:** Sermon, volunteer, and attendance endpoints now give you a clean 400 instead of a confusing 500 when tenant context is missing. No response shape changes.
- **Both teams:** Run migration 035 before next deploy. Everything else is backwards-compatible.
