# Backend Data Fixes — What Changed and What the Dashboard Should Now Show

> **Date:** April 10, 2026
> **From:** Backend Team
> **For:** Admin Dashboard Team (Next.js) + Mobile App Team (React Native)

---

## What Was Wrong and What Was Fixed

### 1. Members Showing as "Unnamed" — FIXED

**Problem:** All 75 demo members had `full_name: null`. Supabase's `auth.users` trigger was overwriting our values on insert.

**Fix:** Updated all 75 users directly via UPDATE. Every member now has a full name and staggered join dates spanning 6 months.

**Verify in your UI:** Members list should show names like "Marcus Johnson", "Sarah Williams", etc. If you're still seeing "Unnamed", check that your frontend is reading `full_name` from the API response (not `name` or `display_name`).

**API field:** `GET /api/tenants/:tenantId/members` returns `fullName` per member. The profile endpoint `GET /api/members/:userId/profile` returns `personalInfo.fullName`.

---

### 2. No Join Dates — FIXED

**Problem:** `tenant_memberships.created_at` was the same timestamp for all 75 members (the moment the seed ran) instead of staggered over 6 months.

**Fix:** Updated all membership `created_at` values to match each user's account creation date, spread from 180 days ago to today.

**What the Growth Chart should now show:** Monthly new member counts ramping up — more new members in recent months than older months.

**API:** `GET /api/dashboard/growth-chart` groups by `tenant_memberships.created_at`.

---

### 3. Transactions Showing "Anonymous" Donors — FIXED

**Problem:** Transactions had valid `user_id` FKs but the linked users had `full_name: null`, so the donor names appeared as "Anonymous" in reports.

**Fix:** Now that all users have names, the giving reports, top donors, and transaction history will display real names.

**Verify:** `GET /api/giving/donors` should show named donors. `GET /api/reports/export?type=giving` should show `donorName` populated.

---

### 4. Year-over-Year Giving — NEW DATA ADDED

**Problem:** Only 6 months of current-year data existed. The YoY chart had nothing to compare against.

**Fix:** Added 120 transactions across all 12 months of 2025 (last year) for 10 regular donors with realistic varying amounts.

**What the YoY chart should now show:** Two lines — 2025 (complete year) vs 2026 (partial year through April), showing month-by-month comparison.

**API:** `GET /api/reports/giving-yoy`

**Total transactions now:** 240 (120 this year + 120 last year = ~$36,000 total)

---

### 5. No Rooms or Bookings — NEW DATA ADDED

**Problem:** The `rooms` table was empty. Facilities page had nothing.

**Fix:** Created 8 rooms and 10 upcoming bookings:

| Room | Capacity | Description |
|------|----------|-------------|
| Main Sanctuary | 500 | Primary worship space |
| Fellowship Hall | 200 | Multipurpose events hall |
| Youth Room | 50 | Youth ministry space |
| Conference Room A | 20 | Meeting room |
| Conference Room B | 15 | Counseling/small groups |
| Children's Wing | 80 | Children's ministry |
| Prayer Room | 10 | Prayer and meditation |
| Gymnasium | 300 | Basketball, recreation |

**Bookings this week/month:**
- Men's Breakfast (Fellowship Hall, 3 days out)
- Women's Conference (Main Sanctuary, 10 days out)
- Youth Game Night (Youth Room, 5 days out)
- Deacon Board Meeting (Conference Room A, 7 days out)
- Basketball League (Gymnasium, 4 days out)
- Pre-Service Prayer (Prayer Room, 2 days out)
- VBS Planning (Children's Wing, 6 days out)
- Potluck Dinner (Fellowship Hall, 8 days out)
- Pastoral Counseling (Conference Room B, 1 day out)
- Choir Rehearsal (Main Sanctuary, 2 days out)

**API:** `GET /api/facilities/rooms`, `GET /api/facilities/rooms/:id/calendar?start=&end=`, `GET /api/facilities/availability?roomId=&date=`

---

### 6. Storage Showing 0 — NEW DATA ADDED

**Problem:** `tenant_storage_usage` had 0 bytes. No files in `storage_files` ledger.

**Fix:** Added 20 mock storage file records totaling **1.17 GB**:

| Category | Files | Size |
|----------|-------|------|
| Sermons (video) | 5 | 1.09 GB |
| Gallery (images) | 7 | 27.1 MB |
| Posts (images) | 3 | 6.0 MB |
| Stories (video + image) | 2 | 51.0 MB |
| Documents (PDFs) | 3 | 6.5 MB |

**What the storage page should now show:**
- Usage bar: 1.17 GB / 10 GB (11.7%) for Standard plan
- Breakdown by type: Sermons dominate, then gallery, stories, posts, documents
- Largest files: The 5 sermon videos are the biggest

**API:**
- `GET /api/storage` — usage summary
- `GET /api/storage/breakdown` — by source type
- `GET /api/storage/files?limit=5` — largest files

---

### 7. No Family Connections — NEW DATA ADDED

**Problem:** `family_connections` was empty. Family tree feature had nothing to display.

**Fix:** Created a complete family unit (32 connections):

```
                Robert Anderson ──── Lisa Thomas
                (Grandfather)        (Grandmother)
                      |
              Marcus Johnson ──── Sarah Williams
              (Father/Pastor)    (Mother/Pastor)
               /          \
    Timothy Collins    Megan Stewart
    (Son)              (Daughter)
    [siblings]
```

Plus:
- Michael Davis ↔ Angela Martinez (married couple)
- James Wilson ↔ Patricia Taylor (married couple)

**In-law connections auto-created:**
- Sarah → Robert = Father-in-Law
- Sarah → Lisa = Mother-in-Law
- Robert/Lisa → Timothy/Megan = Grandchildren

**API:** `GET /api/family/:userId/tree` for Marcus should show the full tree above.

---

### 8. Events — DATA EXISTS, CHECK FRONTEND

**6 upcoming events exist** in the database with future dates:
- Men's Breakfast (Apr 13)
- Women's Conference (Apr 20)
- Summer Baptism Service (Apr 27)
- Youth Summer Camp (May 10)
- Back to School Prayer (May 25)
- Church Anniversary (Jun 9)

Plus 6 past events for history.

**If events still aren't showing**, check:
- Are you filtering with `start_at > now()`? The events are there.
- `GET /api/events?upcoming=true` should return the 6 future events
- `GET /api/dashboard/upcoming-events` returns the next 5

---

### 9. Groups — DATA EXISTS, CHECK FRONTEND

**6 groups exist** with members and messages:
- Men's Fellowship (15 members)
- Women's Bible Study (15 members)
- Young Adults (12 members)
- Marriage & Family (12 members)
- Prayer Warriors (11 members)
- Worship Team Rehearsal (8 members)

**API:** `GET /api/groups` should return all 6. Each has member counts and recent messages.

---

### 10. Care Cases — DATA EXISTS, CHECK FRONTEND RENDERING

**8 care cases exist** with full data:
- 2 resolved, 4 in progress, 2 new
- Priorities: 1 urgent, 2 high, 3 medium, 1 low
- 15 care notes across the cases

**If the dashboard shows counts but no content**, verify:
- `GET /api/care-cases` returns the full list with `title`, `description`, `status`, `priority`, `assignedTo`
- `GET /api/care-cases/kpis` returns counts grouped by status
- The endpoint returns real objects, not just tags — check your frontend mapping

---

### 11. Tasks — DATA EXISTS, CHECK CLICK-THROUGH

**12 tasks exist** in mixed statuses:
- 5 pending, 3 in progress, 4 completed
- 2 high priority, 1 urgent
- 2 overdue (due date in the past, status still pending/in progress)

**If clicking a count doesn't show the list**, check:
- `GET /api/tasks?status=pending` should return the 5 pending tasks
- `GET /api/tasks?priority=high` should return the 2 high-priority tasks
- Each task has `id`, `title`, `description`, `status`, `priority`, `assignedTo`, `dueDate`

---

### 12. Volunteer Schedules Showing "Invalid Date" and "Unassigned"

**Data exists** — 5 opportunities, 25 signups, 15 hour logs.

**If showing "Invalid Date"**, check:
- `GET /api/volunteer/schedule` returns `schedule` as a **text string** (e.g., "Every Sunday 8:30-9:15 AM"), not a date object. Don't try to parse it with `new Date()`.

**If showing "Unassigned"**, check:
- The volunteer signups link `user_id` to users who now have names. `GET /api/volunteer/schedule` should JOIN and return `fullName` for each volunteer.

---

## Summary of Current Data State

| Table | Count | Notes |
|-------|-------|-------|
| Members | 75 (all named, staggered dates) | |
| Memberships | 77 (75 demo + your 2 real accounts) | |
| Transactions | 240 (120 this year + 120 last year) | ~$36K total |
| Check-Ins | 581 over 12 weeks | |
| Events | 12 (6 past, 6 upcoming) | |
| Groups | 6 with 73 members | |
| Posts | 48 with 82 comments, 281 likes | |
| Prayers | 20 (4 answered, 16 open) | |
| Sermons | 15 across 3 series | |
| Care Cases | 8 with 15 notes | |
| Tasks | 12 (5 pending, 3 in progress, 4 done) | |
| Rooms | 8 with 10 bookings | |
| Volunteers | 5 roles, 25 signups, 15 hour logs | |
| Badges | 8 definitions, 31 awards | |
| Tags | 6 with 69 assignments | |
| Storage | 1.17 GB across 20 files | |
| Family | 32 connections (3 couples, 1 full family tree) | |
| Journeys | 75 spiritual journey records | |
| Notifications | 20 | |

---

## Common Frontend Debugging Checklist

If data exists in the database but isn't showing on the dashboard:

1. **Field name mismatch** — Backend returns `fullName`, frontend expects `name`
2. **Date parsing** — Backend returns ISO strings. Don't parse text fields like volunteer `schedule` as dates.
3. **Null handling** — If a field is null, render "N/A" not crash
4. **API path** — Make sure you're hitting `/api/` prefix (e.g., `/api/events`, not `/events`)
5. **Auth header** — All endpoints require `Authorization: Bearer <jwt>` except public ones
6. **Tenant context** — JWT must have `app_metadata.current_tenant_id` set to the New Birth Test tenant ID
7. **Query params** — Some endpoints need `?upcoming=true` or `?status=pending` to filter

If an endpoint returns 401, re-login. If it returns 403, the tier may be too low (Standard doesn't have chat, search, AI). If it returns 500, that's a backend bug — report it.
