# Backend Response to Mobile Audit — Cross-Team Sync

> **Date:** April 9, 2026
> **From:** Backend Team
> **For:** Mobile App Team (React Native) + Admin Dashboard Team (Next.js)
> **Re:** Mobile team's code audit findings and their backend implications

The mobile team ran a thorough audit and raised several backend concerns. We verified each one against the actual source code. Below is what's confirmed, what's already fine, and what both frontend teams should know.

---

## Confirmed Issues — Backend Will Fix

### 1. POST /api/check-in allows null serviceId silently

**Mobile concern:** What happens when `serviceId` is undefined/null?

**Verified:** The backend treats `serviceId` as optional. If undefined, it silently stores `null` — creating a check-in record with no service association. No validation error is thrown.

```typescript
// Current behavior (checkin.service.ts:35-44)
serviceId: serviceId ?? null  // quietly accepts undefined
```

**Action:** Backend will add validation. If `serviceId` is missing, return `400 Bad Request` with `"serviceId is required"`.

**Both teams:** After this fix, check-in calls without a `serviceId` will start failing. Make sure your check-in UI always passes a selected service.

---

### 2. DELETE endpoint inconsistency — 200 vs 204

**Mobile concern:** Some DELETEs return a body, others don't.

**Verified and confirmed.** Here's the current state:

| Endpoint | Status Code | Body |
|----------|-------------|------|
| DELETE /api/posts/:id | 204 | None |
| DELETE /api/events/:id | 204 | None |
| DELETE /api/sermons/:id | 204 | None |
| DELETE /api/feedback/:id | 204 | None |
| DELETE /api/badges/:id | 204 | None |
| DELETE /api/family/:userId/:familyMemberId | 204 | None |
| **DELETE /api/tasks/:id** | **200** | **{ deleted: true }** |
| **DELETE /api/groups/:id** | **200** | **{ deleted: true }** |

**Action:** Backend will standardize tasks and groups to return **204 No Content** with no body, matching the rest of the API.

**Both teams:** If you're doing `.then(r => r.data)` on DELETE calls to tasks or groups, remove it — 204 responses have no body. Best practice: don't try to read the response body on any DELETE call.

---

### 3. Badge progress response shape — nested, not flat

**Mobile concern:** Expected flat `{ badgeId, name, current, target, percent, earned }` but backend returns a nested structure.

**Verified.** The actual `GET /api/badges/progress` and `GET /api/members/:userId/badge-progress` response is:

```json
{
  "memberId": "uuid",
  "totalBadgesEarned": 3,
  "totalBadgesAvailable": 8,
  "badges": [
    {
      "badge": {
        "id": "uuid",
        "name": "Faithful Giver",
        "description": "Give $1,000 lifetime",
        "icon": "award",
        "color": "#6366f1",
        "tier": "bronze",
        "category": "custom"
      },
      "isEarned": true,
      "progress": {
        "current": 3200,
        "target": 5000,
        "percent": 64,
        "unit": "dollars",
        "remaining": 1800
      }
    }
  ]
}
```

**Key differences from what mobile expected:**
- `badges[]` contains objects with `badge` (nested) and `progress` (nested) — not flat
- Field is `isEarned` not `earned`
- No top-level `badgeId` — it's at `badges[].badge.id`
- Extra fields: `unit`, `remaining`, `totalBadgesEarned`, `totalBadgesAvailable`

**Action:** This is the intended shape. The nesting separates badge metadata from progress data cleanly. We won't flatten it.

**Both teams — how to consume this:**
```typescript
// Mapping to a flat structure if needed:
const flatBadges = response.badges.map(b => ({
  badgeId: b.badge.id,
  name: b.badge.name,
  icon: b.badge.icon,
  color: b.badge.color,
  tier: b.badge.tier,
  current: b.progress.current,
  target: b.progress.target,
  percent: b.progress.percent,
  earned: b.isEarned,
}));
```

---

## Already Fine — No Backend Changes Needed

### 4. POST /api/attendance/geo-check-in — lat/lng validation

**Mobile concern:** What if lat/lng are missing?

**Verified: Already validated.** The DTO uses `@IsNumber()` class-validator decorators on both fields. Missing or non-numeric values return `400 Bad Request` automatically.

---

### 5. POST /api/badges/check — field handling

**Mobile concern:** Missing fields?

**Verified: No body needed.** This endpoint takes no request body. It reads `tenantId` and `userId` from the JWT and auto-checks all badge criteria. Returns `{ newlyEarned: [...] }`.

---

### 6. Dashboard KPI field names

**Mobile concern:** Expected `totalPrayers, activeVolunteers, pendingPrayers` but backend returns different names.

**Verified: Backend returns exactly these fields:**
```json
{
  "totalMembers": 342,
  "newMembersThisMonth": 18,
  "totalGivingThisMonth": 24500.00,
  "activeGroups": 12,
  "totalPrayers": 34,
  "activeVolunteers": 67,
  "pendingPrayers": 28
}
```

The field names `totalPrayers`, `activeVolunteers`, and `pendingPrayers` **are present**. If the mobile app was seeing different names, it may have been hitting a different endpoint or an older API version.

**Both teams:** Use `GET /api/dashboard/kpis` — the field names above are the contract.

---

### 7. Activity feed uses `title` — confirmed

**Mobile concern:** Items use `title` not `description`.

**Verified: Correct.** `GET /api/dashboard/activity-feed` returns:
```json
{ "type": "post", "id": "uuid", "title": "Good morning church...", "createdAt": "..." }
```

The field is `title` across all activity types (post, event, prayer, announcement). For posts and prayers, the `content` column is aliased as `title`.

---

## Response Shape Reference — The Definitive Contract

The mobile team's audit identified several shape mismatches. Here's the **authoritative backend response** for the endpoints in question. Both teams should align to these:

### GET /api/dashboard/kpis
```json
{
  "totalMembers": 342,
  "newMembersThisMonth": 18,
  "totalGivingThisMonth": 24500.00,
  "activeGroups": 12,
  "totalPrayers": 34,
  "activeVolunteers": 67,
  "pendingPrayers": 28
}
```

### GET /api/dashboard/engagement
```json
{
  "currentWeek": {
    "weekStart": "2026-04-07",
    "activeMembers": 156,
    "totalMembers": 342,
    "engagementPercent": 45.6
  },
  "previousWeek": {
    "weekStart": "2026-03-31",
    "activeMembers": 142,
    "totalMembers": 338,
    "engagementPercent": 42.0
  },
  "delta": 3.6,
  "trend": "up",
  "weeklyHistory": [
    { "weekStart": "2026-03-03", "activeMembers": 130, "totalMembers": 330, "engagementPercent": 39.4 }
  ]
}
```

Note: `currentWeek` is an **object** containing `weekStart`, `activeMembers`, `totalMembers`, `engagementPercent` — not a plain number.

### GET /api/dashboard/activity-feed
```json
{
  "items": [
    { "type": "post", "id": "uuid", "title": "...", "createdAt": "..." },
    { "type": "event", "id": "uuid", "title": "...", "createdAt": "..." }
  ]
}
```

### GET /api/badges/progress (or /api/members/:userId/badge-progress)
```json
{
  "memberId": "uuid",
  "totalBadgesEarned": 3,
  "totalBadgesAvailable": 8,
  "badges": [
    {
      "badge": { "id": "uuid", "name": "...", "icon": "...", "color": "...", "tier": "...", "category": "..." },
      "isEarned": true,
      "progress": { "current": 3200, "target": 5000, "percent": 64, "unit": "dollars", "remaining": 1800 }
    }
  ]
}
```

### GET /api/attendance/kpis
```json
{
  "totalCheckInsToday": 187,
  "avgWeeklyAttendance": 165,
  "visitorsThisMonth": 23,
  "growthPercent": 8.5
}
```

---

## Error Response Format — Standard Contract

All NestJS error responses follow this shape:

```json
{
  "statusCode": 400,
  "message": "Human-readable description of what went wrong",
  "error": "Bad Request"
}
```

The `message` field is **always present** in error responses (400, 401, 403, 404, 409, 500). This is guaranteed by NestJS's built-in exception classes.

**Both teams:** You can safely display `err.response.data.message` to users on all error responses. If you're seeing "Something went wrong" instead of a specific message, you may be catching the error at the wrong level.

Validation errors (from class-validator) return an array in `message`:
```json
{
  "statusCode": 400,
  "message": ["serviceId must be a UUID", "title should not be empty"],
  "error": "Bad Request"
}
```

**Tip:** Check if `message` is a string or array. Display the first item if it's an array.

---

## Mobile Team's Recommendations — Our Response

| Mobile Recommendation | Backend Response |
|----------------------|------------------|
| Validate null inputs on check-in, geo-check-in, badges | Check-in: will add validation. Geo: already validated. Badges: no body needed. |
| Consistent error format with `message` field | Already guaranteed by NestJS. All exceptions include `message`. |
| Consistent DELETE responses | Will standardize to 204 everywhere. |
| Document field name changes | This document serves as the authoritative contract. See "Response Shape Reference" above. |
| Shared TypeScript types package | Good idea for Phase 2. For now, the `FRONTEND_HANDOFF_COMPLETE.md` file serves as the single source of truth for all response shapes. |

---

## Action Items Summary

### Backend (we will do)
- [ ] Add `serviceId` validation to `POST /api/check-in`
- [ ] Standardize `DELETE /api/tasks/:id` and `DELETE /api/groups/:id` to 204
- [ ] Run migration 035 (already created, waiting to deploy)

### Admin Dashboard Team (check your code)
- [ ] Grep for hooks inside conditionals (mobile found this crash pattern)
- [ ] Grep for mutations without `onError` handlers
- [ ] Verify your badge progress UI handles the nested structure (see section 3)
- [ ] Verify you're not reading response bodies from DELETE calls
- [ ] Check that your engagement display handles the object shape (not a plain number)

### Mobile App Team (check your code)
- [ ] Update check-in call to always include `serviceId` (will become required)
- [ ] Stop reading response body on DELETE calls (tasks/groups will change to 204)
- [ ] Update badge progress mapping to handle nested `badge` + `progress` objects
- [ ] Confirm `isEarned` field name (not `earned`)

---

## Files Changed in This Audit Cycle

Backend changes already committed and pushed:

| File | What changed |
|------|-------------|
| `migrations/035_tenant_memberships_created_at.sql` | Added `created_at` to tenant_memberships |
| `moderation.service.ts` | Fixed JOIN: `p.user_id` → `p.author_id` |
| `assistant.service.ts` | Parameterized SQL intervals |
| `reports.service.ts` | Fixed `tm.joined_at` → `tm.created_at` |
| `sermons.service.ts` | RETURNING pattern + ON CONFLICT target |
| `feedback.service.ts` | RETURNING pattern for DELETE |
| `moderation.service.ts` | RETURNING pattern for UPDATE |
| `sermons.controller.ts` | Proper tenant validation + error logging |
| `volunteer.controller.ts` | `Error` → `BadRequestException` |
| `checkin.controller.ts` | `Error` → `BadRequestException` |

**Still pending (will do next):**
- `checkin.service.ts` — add serviceId required validation
- `tasks.controller.ts` — change DELETE to 204
- `groups.controller.ts` — change DELETE to 204
