# Backend Audit Changes — Frontend Impact Notice

> **Date:** April 11, 2026
> **From:** Backend Team
> **For:** Admin Dashboard (Next.js) + Mobile App (React Native)
> **Summary:** 30+ bugs fixed across 5 audit passes. Most changes are backend-internal, but several affect API behavior. Read the "Action Required" sections.

---

## Action Required — Mobile App

### 1. Child Pickup Security Code is Now 8-Character Alphanumeric

**Before:** 4-digit numeric code (e.g., `4827`)
**Now:** 8-character uppercase alphanumeric (e.g., `A7KM2XBR`)

The `POST /api/checkin/child` response now returns a code like:
```json
{ "id": "uuid", "securityCode": "A7KM2XBR", "checkedInAt": "..." }
```

**What to change:**
- Update the pickup code display UI to show 8 characters instead of 4 digits
- Update the code verification input to accept alphanumeric (not just numbers)
- The verify endpoint is now rate-limited to **10 attempts per minute** — show an error if the user hits the limit
- If you're printing thermal labels, widen the code field to fit 8 characters

### 2. Giving Statements — Self-Access Only

**Before:** Any authenticated member could call `GET /api/giving/statements/:userId` with any user ID
**Now:** Members can only view **their own** statement. Admins/pastors/accountants can view anyone's.

If the mobile app currently lets members browse other members' statements, remove that. The backend will return **403 Forbidden** for unauthorized access.

```
GET /api/giving/statements/my-own-uuid?year=2025  → 200 OK
GET /api/giving/statements/other-user-uuid?year=2025  → 403 Forbidden (unless admin)
```

### 3. Member Profiles — Self-Access or Admin Only

**Before:** Any member could view any other member's full 360-degree profile
**Now:** The full profile (giving history, pastor notes, spiritual journey, phone, onboarding responses) is restricted:
- Members can view **their own** profile
- Admin/pastor/accountant can view anyone's profile

If the mobile app has a "View Profile" button on other members, it should now only show basic public info (name, avatar, role) — not the full profile. The backend returns **403 Forbidden** if a regular member tries to access another member's full profile.

### 4. Medical Alerts — Admin/Pastor Only

**Before:** Any authenticated member could view, add, and delete medical alerts for any member
**Now:** All medical alert endpoints require admin or pastor role:
- `GET /api/members/:userId/medical-alerts` → 403 for regular members
- `POST /api/members/:userId/medical-alerts` → 403 for regular members
- `DELETE /api/members/:userId/medical-alerts/:alertId` → 403 for regular members

If the mobile app shows medical alerts on member profiles viewed by non-admin users, hide that section or catch the 403.

### 5. Data Export Now Has Date Ranges

The export endpoint now accepts optional date filters:
```
GET /api/reports/export?type=attendance&startDate=2025-01-01&endDate=2025-12-31
```
- Default: last 1 year if no dates provided
- Maximum: 50,000 rows per export (prevents timeout)
- If the mobile app has an export feature, add date picker fields

---

## Action Required — Admin Dashboard

### 1. Icon Picker — Use CDN Preview URLs

**The `/api/badges/icons` endpoint response changed.**

**Before:** Just name/label/category
**Now:** Includes `previewUrl` — a CDN image URL for each icon

```json
{
  "icons": [
    {
      "name": "hand-prayer",
      "label": "Praying Hands",
      "category": "Faith & Spiritual",
      "previewUrl": "https://ico.hugeicons.com/hand-prayer-stroke-rounded@2x.webp?v=1.0.0"
    }
  ],
  "categories": ["Faith & Spiritual", "Water & Baptism", ...],
  "total": 100,
  "page": 1,
  "limit": 30
}
```

**What to change:**
- **Remove** `import * as HugeIcons from '@hugeicons/core-free-icons'` — this loads 5,100 JS components and kills performance
- Render icons as `<img src={icon.previewUrl} width={32} height={32} loading="lazy" />` instead of React components
- The endpoint is now **paginated**: `?page=1&limit=30`
- **Searchable**: `?search=prayer`
- **Filterable by category**: `?category=Faith+%26+Spiritual`
- Lazy-load the next page on scroll

### 2. Badge CRUD Requires Admin/Pastor Role

All badge management endpoints now return **403 Forbidden** for non-admin users:
- `POST /api/badges` (create)
- `PATCH /api/badges/:id` (update)
- `DELETE /api/badges/:id` (delete)
- `POST /api/badges/:id/award` (award to members)
- `DELETE /api/badges/:id/revoke/:userId` (revoke)

If the dashboard shows badge management to non-admin users, hide those controls. Read endpoints (list, progress, leaderboard) remain open to all authenticated users.

### 3. Fundraiser CRUD Requires Admin/Pastor Role

Same as badges — create and update now require admin/pastor:
- `POST /api/fundraisers` → 403 for regular members
- `PATCH /api/fundraisers/:id` → 403 for regular members

Donation and browsing endpoints remain open to all members.

### 4. Member Import Requires Admin Role

`POST /api/tenants/:tenantId/members/import` now requires **admin role only** (not even pastor). This is a high-privilege bulk operation.

### 5. Data Export Has Date Ranges + Row Limit

The export endpoint now accepts `startDate` and `endDate` query params:
```
GET /api/reports/export?type=giving&startDate=2025-01-01&endDate=2025-12-31
```
- Defaults to last 1 year if omitted
- Hard cap at 50,000 rows
- Add date range picker to the export UI

### 6. Giving Statements Access Control

If the dashboard has an admin view to generate statements for specific members, it still works — the requesting user just needs admin/pastor/accountant role. Regular member requests for other members' statements will now fail with 403.

### 7. Member Profile Access Control

The full 360-degree member profile (`GET /api/members/:userId/profile`) now requires:
- Self-access (your own profile), OR
- Admin/pastor/accountant role

Pastor notes endpoints (`GET/POST/DELETE /:userId/notes`) and spiritual journey update (`PUT /:userId/journey`) now require admin/pastor role specifically. If the dashboard shows these sections to non-admin staff, they'll get 403s.

---

## No Action Required — Backend-Internal Changes

These changes don't affect the frontend but improve backend reliability:

| Change | Impact |
|--------|--------|
| Stripe `client_secret` null checks added | Payment flows now return a clean error instead of crashing if Stripe returns null |
| Dashboard KPI safe destructuring | Dashboard no longer crashes when a church has 0 data |
| Fundraiser list COUNT query fixed | Category/status/search filters on fundraiser list now work correctly (were erroring) |
| Batch giving wrapped in transaction | Partial batch failures now roll back cleanly |
| Auth array literal injection fixed | Signup with special characters in interests/skills no longer breaks |
| 5 empty `.catch(() => {})` replaced with logging | Errors in background operations are now visible in logs |
| Badge auto-award N+1 eliminated | `POST /badges/check` is ~5x faster (1 query instead of 100+) |
| Workflow config.days sanitized | Workflow condition nodes validate numeric input |
| Giving KPIs cached (60s) | Giving dashboard loads faster on repeated visits |
| Report giving-by-fund cached (60s) | Same |
| Tenant profile cached (5min) | Public church profile page loads faster |
| Email HTML escaping added | Church names and message bodies in outbound emails are now sanitized |
| Storage controller RLS interceptor added | Storage endpoints now have proper tenant isolation |

---

## Summary of Permission Changes

| Endpoint | Before | After |
|----------|--------|-------|
| `GET /giving/statements/:userId` | Any member | Self or admin/pastor/accountant |
| `GET /members/:userId/profile` | Any member | Self or admin/pastor/accountant |
| `PUT /members/:userId/journey` | Any member | Admin/pastor only |
| `GET/POST/DELETE /:userId/notes` | Any member | Admin/pastor only |
| `GET/POST/DELETE /medical-alerts` | Any member | Admin/pastor only |
| `POST /badges` (create) | Any member | Admin/pastor only |
| `PATCH /badges/:id` (update) | Any member | Admin/pastor only |
| `DELETE /badges/:id` (delete) | Any member | Admin/pastor only |
| `POST /badges/:id/award` | Any member | Admin/pastor only |
| `DELETE /badges/:id/revoke/:userId` | Any member | Admin/pastor only |
| `POST /fundraisers` (create) | Any member | Admin/pastor only |
| `PATCH /fundraisers/:id` (update) | Any member | Admin/pastor only |
| `POST /members/import` | Any member | Admin only |
| `GET /checkin/child/:code/verify` | No limit | 10 requests/minute rate limit |

**Rule of thumb for both teams:** If the user's role (from `GET /api/memberships`) is `member`, hide all create/edit/delete/admin controls. Only show them for `admin`, `pastor`, or `accountant` roles.
