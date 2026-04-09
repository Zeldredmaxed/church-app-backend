# Shepard Admin Dashboard — Complete Frontend Build Prompt

## What Is This?

Complete specification for building the **Shepard Admin Dashboard** — the desktop web app where church pastors/admins manage their church. The backend has **~170 endpoints** across 27 API domains, all deployed and ready. This document covers every screen, every endpoint, and every data shape.

**Backend API:** `https://church-app-backend-27hc.onrender.com/api`

---

## 1. Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | **Next.js 14+** (App Router) |
| Styling | **Tailwind CSS** + **shadcn/ui** |
| Data | **TanStack Query** (React Query) |
| Auth | **@supabase/supabase-js** |
| Charts | **Recharts** |
| Forms | **React Hook Form** + **Zod** |
| Icons | **Lucide React** |

---

## 2. Authentication

### Login
```
POST /api/auth/login { email, password }
→ { accessToken, refreshToken, expiresAt, user: { id, email, currentTenantId } }
```

### Session Bootstrap (call on every page load)
```
GET /api/auth/session
Headers: Authorization: Bearer <accessToken>
→ {
    user: { id, email, fullName, avatarUrl },
    memberships: [{ tenantId, tenantName, tenantSlug, role, permissions }],
    currentTenantId: "uuid"
  }
```

### Tenant Switching
```
1. POST /api/auth/switch-tenant { tenantId }
2. POST /api/auth/refresh { refreshToken } → new tokens with tenant context
3. Reload all data with new token
```

### Logout
```
POST /api/auth/logout → { message: "Logged out successfully" }
Then discard tokens client-side.
```

### Password Reset
```
POST /api/auth/forgot-password?redirectTo=https://yourapp.com/reset-password { email }
POST /api/auth/reset-password { password } (with Bearer token from reset link)
```

---

## 3. Role & Permission System

| Role | Dashboard Access |
|------|-----------------|
| `admin` | **Full access** — bypasses all permission checks |
| `pastor` | Most features, limited by permissions |
| `accountant` | Finance only (`manage_finance`) |
| `worship_leader` | Content + worship (`manage_content`, `manage_worship`) |
| `member` | **No dashboard access** — redirect to "no access" page |

### Permissions (from session response)
| Key | Controls |
|-----|----------|
| `manage_finance` | Giving, Reports, Stripe |
| `manage_content` | Posts, Sermons, Moderation |
| `manage_members` | Members, Tags, Invitations |
| `manage_worship` | Events (future) |
| `view_analytics` | Dashboard KPIs, Charts |

---

## 4. Tier Feature Gating

```
GET /api/tenants/{id}/features
→ { tenant: { tier, tierDisplayName }, features: { chat, search, granularRoles, ... } }
```

Show disabled features with upsell cards ("Upgrade to Premium to unlock Chat").

---

## 5. Application Shell

```
┌──────────────────────────────────────────────────────┐
│  Top Bar: Church name | Global Search | Bell | Avatar │
├──────────┬───────────────────────────────────────────┤
│ Sidebar  │                                           │
│          │          Main Content Area                 │
│ Dashboard│                                           │
│ Members  │                                           │
│ Giving   │                                           │
│ Events   │                                           │
│ Groups   │                                           │
│ Care     │                                           │
│ Tasks    │                                           │
│ Attend.  │                                           │
│ Voluntrs │                                           │
│ Sermons  │                                           │
│ Comms    │                                           │
│ Facility │                                           │
│ Reports  │                                           │
│ Tags     │                                           │
│ Moderate │                                           │
│ Settings │                                           │
│──────────│                                           │
│ Church   │                                           │
│ Switcher │                                           │
└──────────┴───────────────────────────────────────────┘
```

---

## 6. Page-by-Page Specification

---

### 6.1 Dashboard (`/dashboard`)

**KPIs:** `GET /api/dashboard/kpis`
```json
{ "totalMembers": 150, "newMembersThisMonth": 12, "totalGivingThisMonth": 8500,
  "activeGroups": 8, "totalPrayers": 45, "activeVolunteers": 23, "pendingPrayers": 18 }
```

**Giving chart:** `GET /api/dashboard/giving-chart?range=12m`
```json
{ "data": [{ "month": "2026-01-01", "total": 7200 }] }
```

**Attendance chart:** `GET /api/dashboard/attendance-chart`
```json
{ "data": [{ "week": "2026-03-31", "count": 85 }] }
```

**Growth chart:** `GET /api/dashboard/growth-chart`

**Care summary:** `GET /api/dashboard/care-summary`
```json
{ "newCases": 5, "inProgress": 8, "resolved": 42, "needsLeader": 2 }
```

**Upcoming events:** `GET /api/dashboard/upcoming-events`

**Activity feed:** `GET /api/dashboard/activity-feed?limit=20`
```json
{ "items": [{ "type": "post|event|prayer|announcement", "id": "...", "title": "...", "createdAt": "..." }] }
```

---

### 6.2 Members (`/members`)

**List:** `GET /api/tenants/{tenantId}/members?limit=20&cursor=...`

**KPIs:** `GET /api/tenants/{tenantId}/members/kpis`
```json
{ "totalMembers": 150, "newThisMonth": 12, "activeLast30d": 98 }
```

**Invite:** `POST /api/invitations { email, role }`
**Change role:** `PATCH /api/tenants/{tenantId}/members/{userId}/role { role }`
**Permissions:** `PATCH /api/tenants/{tenantId}/members/{userId}/permissions { permissions }`
**Remove:** `DELETE /api/tenants/{tenantId}/members/{userId}`
**Export CSV:** `GET /api/tenants/{tenantId}/members/export`
**Tags:** `GET /api/members/{userId}/tags`
**Pending invites:** `GET /api/invitations`

---

### 6.3 Giving (`/giving`)

**KPIs:** `GET /api/giving/kpis`
```json
{ "totalGiving": 52000, "thisMonth": 8500, "pendingCount": 3, "uniqueDonors": 45 }
```

**Transactions:** `GET /api/tenants/{tenantId}/transactions?limit=20&cursor=...`
**Donors:** `GET /api/giving/donors`
**Funds:** `GET /api/giving/funds` / `POST /api/giving/funds { name, description? }`
**Recurring:** `GET /api/giving/recurring` / pause / resume / cancel
**Chart:** `GET /api/dashboard/giving-chart?range=6m|12m|24m`

**Stripe Connect banner:**
```
GET /api/stripe/connect/status → { status, chargesEnabled, payoutsEnabled }
POST /api/stripe/connect/onboard { refreshUrl, returnUrl } → { url } (redirect admin)
```

---

### 6.4 Events (`/events`)

**List:** `GET /api/events?upcoming=true&limit=20&cursor=...`
**Create:** `POST /api/events { title, description, startAt, endAt, location, coverImageUrl? }`
**Update:** `PATCH /api/events/{id}`
**Delete:** `DELETE /api/events/{id}`
**RSVP:** `POST /api/events/{id}/rsvp { status: 'going'|'interested'|'not_going' }`
**Attendees:** `GET /api/events/{id}/attendees?limit=20&cursor=...`

---

### 6.5 Groups (`/groups`)

**List:** `GET /api/groups?limit=20&cursor=...`
**Create:** `POST /api/groups { name, description?, imageUrl? }`
**Update:** `PUT /api/groups/{id} { name?, description?, imageUrl? }`
**Delete:** `DELETE /api/groups/{id}`
**Members:** `GET /api/groups/{id}/members?limit=20&cursor=...`
**Messages:** `GET /api/groups/{id}/messages?limit=50&cursor=...`

---

### 6.6 Care Cases (`/care`)

**List:** `GET /api/care-cases?status=new&priority=urgent&limit=20&cursor=...`

**KPIs:** `GET /api/care-cases/kpis`
```json
{ "newCases": 5, "inProgress": 8, "resolved": 42, "needsLeader": 2, "urgentCount": 1 }
```

**Create:** `POST /api/care-cases { memberId, title, description?, priority?, assignedTo? }`
**Update:** `PUT /api/care-cases/{id} { status?, priority?, assignedTo? }`
**Detail + Timeline:** `GET /api/care-cases/{id}` then `GET /api/care-cases/{id}/timeline`
**Add note:** `POST /api/care-cases/{id}/notes { content }`

---

### 6.7 Tasks (`/tasks`)

**List:** `GET /api/tasks?status=pending&priority=high&assignedTo=&limit=20&cursor=...`

**KPIs:** `GET /api/tasks/kpis`
```json
{ "pending": 12, "inProgress": 5, "highPriority": 3, "overdue": 2 }
```

**Create:** `POST /api/tasks { title, description?, priority?, assignedTo?, dueDate?, linkedType?, linkedId? }`
**Update:** `PUT /api/tasks/{id}`
**Complete:** `PUT /api/tasks/{id}/complete`
**Delete:** `DELETE /api/tasks/{id}`

---

### 6.8 Attendance (`/attendance`)

**KPIs:** `GET /api/attendance/kpis`
```json
{ "todayCount": 85, "visitorsThisWeek": 4, "uniqueLast7d": 120 }
```

**Services:** `GET /api/attendance/services`
**Roster:** `GET /api/attendance/roster?date=2026-04-09&serviceId=...`
**Bulk check-in:** `POST /api/attendance/bulk { userIds: [...], serviceId? }`
**Add visitor:** `POST /api/attendance/visitors { name, serviceId? }`
**Chart:** `GET /api/dashboard/attendance-chart`

---

### 6.9 Volunteers (`/volunteers`)

**KPIs:** `GET /api/volunteer/kpis`
```json
{ "activeVolunteers": 23, "hoursThisMonth": 156.5 }
```

**Opportunities:** `GET /api/volunteer/opportunities`
**Schedule:** `GET /api/volunteer/schedule`
**Log hours:** `POST /api/volunteer/hours { userId, hours, date, notes? }`
**Signup:** `POST /api/volunteer/opportunities/{id}/signup`

---

### 6.10 Sermons (`/sermons`)

**List:** `GET /api/sermons?filter=all|recent|series&limit=20&cursor=...`
**Featured:** `GET /api/sermons/featured`
**Series:** `GET /api/sermons/series` → `[{ seriesName, count }]`
**Create:** `POST /api/sermons { title, speaker, audioUrl?, videoUrl?, thumbnailUrl?, duration?, seriesName?, notes? }`
**Update:** `PUT /api/sermons/{id}`
**Delete:** `DELETE /api/sermons/{id}`
**Engagement:** `GET /api/sermons/{id}/engagement` → `{ viewCount, likeCount }`

---

### 6.11 Communications (`/communications`)

**Segments:** `GET/POST /api/communications/segments`
**Preview:** `POST /api/communications/segment-preview { rules }` → `{ matchedCount }`
**Templates:** `GET/POST /api/communications/templates`
**Send:** `POST /api/communications/send { channel, body, segmentId?, subject? }`
**Schedule:** `POST /api/communications/schedule { channel, body, scheduledFor, ... }`
**History:** `GET /api/communications/history?limit=20&cursor=...`
**Analytics:** `GET /api/communications/analytics` → `{ totalSent, sentThisMonth, avgRecipients }`

---

### 6.12 Facilities (`/facilities`)

**Rooms:** `GET /api/facilities/rooms`
**Calendar:** `GET /api/facilities/rooms/{id}/calendar?start=...&end=...`
**Book:** `POST /api/facilities/bookings { roomId, title, startAt, endAt, notes? }`
**Update:** `PUT /api/facilities/bookings/{id}`
**Cancel:** `DELETE /api/facilities/bookings/{id}`
**Availability:** `GET /api/facilities/availability?roomId=...&date=...`

---

### 6.13 Reports (`/reports`)

**Giving YoY:** `GET /api/reports/giving-yoy` → monthly current vs last year
**Funnel:** `GET /api/reports/funnel` → `{ visitors, regular, members, leaders }`
**Engagement:** `GET /api/reports/engagement` → `{ inactive, low, medium, high }`
**By fund:** `GET /api/reports/giving-by-fund` → `[{ fundName, total }]`
**KPIs:** `GET /api/reports/kpis` → `{ ytdGiving, totalMembers, avgMonthlyAttendance }`
**Export:** `GET /api/reports/export?type=members|giving|attendance`

---

### 6.14 Tags (`/tags`)

**List:** `GET /api/tags` → `[{ id, name, color, memberCount, createdAt }]`
**Create:** `POST /api/tags { name, color }` (hex like "#6366f1")
**Update:** `PATCH /api/tags/{id} { name?, color? }`
**Delete:** `DELETE /api/tags/{id}`
**Assign:** `POST /api/tags/{id}/members { userIds: [...] }`
**Remove:** `DELETE /api/tags/{id}/members/{userId}`
**Members:** `GET /api/tags/{id}/members?limit=20&cursor=...`

---

### 6.15 Content Moderation (`/moderation`)

**List:** `GET /api/admin/moderation?status=pending&limit=20&cursor=...`
```json
{ "items": [...], "nextCursor": "...", "counts": { "pending": 5, "reviewed": 12, "removed": 3 } }
```
**Approve:** `POST /api/admin/moderation/{id}/approve`
**Remove:** `POST /api/admin/moderation/{id}/remove`

---

### 6.16 Settings (`/settings`)

**Church info:** `GET /api/tenants/{id}` + `GET /api/tenants/{id}/features`
**User profile:** `GET /api/users/me` / `PATCH /api/users/me { fullName?, avatarUrl? }`
**Notification prefs:** `GET /api/users/me/settings` / `PUT /api/users/me/settings { emailNotifications?, pushNotifications?, smsNotifications? }`
**Login streak:** `GET /api/users/me/streak` → `{ currentStreak, longestStreak }`
**Invitations:** `GET /api/invitations`

---

### 6.17 Notifications (Top Bar Bell)

**List:** `GET /api/notifications?limit=20&offset=0&unreadOnly=true`
**Mark read:** `PATCH /api/notifications/{id}/read`

Types: `NEW_COMMENT`, `POST_MENTION`, `NEW_GLOBAL_POST`, `NEW_MESSAGE`

---

### 6.18 Search (Command Palette / Top Bar)

**Posts:** `GET /api/search/posts?q=...&limit=20&cursor=...`
**Members:** `GET /api/search/members?q=...&limit=20&cursor=...`

---

## 7. Key Implementation Notes

### Error Handling
```json
{ "statusCode": 400, "message": "Description", "error": "Bad Request" }
```
Handle: 401 (re-login), 403 (no permission), 404, 409 (conflict), 429 (rate limit).

### Pagination
- **Offset:** posts, comments, notifications → `?limit=20&offset=0`
- **Cursor:** everything else → `?limit=20&cursor=<lastId>` → response has `nextCursor`

### Image Upload
```
1. POST /api/media/presigned-url { filename, contentType }
2. PUT <uploadUrl> with raw file + Content-Type header
3. Use fileKey as mediaUrl/avatarUrl/coverImageUrl
```

### Token Storage
- `accessToken` in memory (never localStorage)
- `refreshToken` in httpOnly cookie
- Attach via fetch/axios interceptor

---

## 8. File Structure

```
shepard-admin/
├── app/
│   ├── (auth)/login/page.tsx
│   ├── (dashboard)/
│   │   ├── layout.tsx              ← Shell: sidebar + top bar
│   │   ├── dashboard/page.tsx
│   │   ├── members/page.tsx
│   │   ├── giving/page.tsx
│   │   ├── events/page.tsx
│   │   ├── groups/page.tsx
│   │   ├── care/page.tsx
│   │   ├── tasks/page.tsx
│   │   ├── attendance/page.tsx
│   │   ├── volunteers/page.tsx
│   │   ├── sermons/page.tsx
│   │   ├── communications/page.tsx
│   │   ├── facilities/page.tsx
│   │   ├── reports/page.tsx
│   │   ├── tags/page.tsx
│   │   ├── moderation/page.tsx
│   │   ├── settings/page.tsx
│   │   └── notifications/page.tsx
│   ├── layout.tsx
│   └── page.tsx                    ← Redirect to /dashboard or /login
├── components/ui/                  ← shadcn
├── lib/
│   ├── api.ts                      ← fetch wrapper with auth
│   ├── auth-context.tsx
│   └── hooks/                      ← React Query hooks per domain
└── package.json
```

---

## 9. Build Order (MVP first)

1. Login + auth context + session bootstrap
2. Dashboard (KPI cards + charts — the "wow" moment)
3. Members (list + invite + roles — most used)
4. Giving (transactions + KPIs + Stripe status)
5. Events (calendar + CRUD)
6. Care Cases (pastoral care tracking)
7. Tasks (task management)
8. Attendance (roster + check-in)
9. Everything else (groups, volunteers, sermons, comms, facilities, reports, tags, moderation)
