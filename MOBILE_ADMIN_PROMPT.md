# Shepard Mobile App — Admin Dashboard Integration Prompt

## What Is This?

This prompt gives the React Native mobile team everything needed to add admin/pastor dashboard screens to the existing mobile app. The backend API is fully built with ~170 endpoints. This document covers only the **admin-facing features** that need mobile screens.

**Backend API:** `https://church-app-backend-27hc.onrender.com/api`

---

## Auth Context (already implemented)

The mobile app already handles login, token storage, and tenant switching. For admin screens, you need to check the user's role:

```
GET /api/auth/session
→ { user, memberships: [{ tenantId, role, permissions }], currentTenantId }
```

**Gate admin screens by role:** Only show the admin dashboard to users with `role: 'admin'` or `role: 'pastor'`. For `accountant` and `worship_leader` roles, show only the sections their permissions allow.

**Permission check:** `admin` bypasses all checks. Other roles need specific permissions:
- `manage_finance` → Giving, Reports
- `manage_content` → Posts, Sermons, Moderation
- `manage_members` → Members, Tags, Invitations
- `manage_worship` → Events (future)
- `view_analytics` → Dashboard KPIs, Reports

---

## Admin Dashboard Screens to Build

### 1. Dashboard Home (the landing screen)

**API:** `GET /api/dashboard/kpis`
```json
{
  "totalMembers": 150,
  "newMembersThisMonth": 12,
  "totalGivingThisMonth": 8500.00,
  "activeGroups": 8,
  "totalPrayers": 45,
  "activeVolunteers": 23,
  "pendingPrayers": 18
}
```

**Layout:** Grid of KPI cards (2 columns on phone). Each card shows the metric name, value, and an icon.

**Supporting widgets:**
- `GET /api/dashboard/upcoming-events` → next 5 events
- `GET /api/dashboard/activity-feed?limit=10` → recent activity across all domains
- `GET /api/dashboard/care-summary` → `{ newCases, inProgress, resolved, needsLeader }`

---

### 2. Members Management

**List:** `GET /api/tenants/{tenantId}/members?limit=20&cursor=...`
```json
[{ "userId": "...", "email": "...", "fullName": "John", "avatarUrl": "...", "role": "member" }]
```

**KPIs:** `GET /api/tenants/{tenantId}/members/kpis`
```json
{ "totalMembers": 150, "newThisMonth": 12, "activeLast30d": 98 }
```

**Actions:**
- Invite: `POST /api/invitations { email, role }`
- Change role: `PATCH /api/tenants/{tenantId}/members/{userId}/role { role }`
- Edit permissions: `PATCH /api/tenants/{tenantId}/members/{userId}/permissions { permissions: { manage_finance: true, ... } }`
- Remove: `DELETE /api/tenants/{tenantId}/members/{userId}`
- View tags: `GET /api/members/{userId}/tags`
- Export CSV: `GET /api/tenants/{tenantId}/members/export`

---

### 3. Giving / Donations

**KPIs:** `GET /api/giving/kpis`
```json
{ "totalGiving": 52000.00, "thisMonth": 8500.00, "pendingCount": 3, "uniqueDonors": 45 }
```

**Transaction list:** `GET /api/tenants/{tenantId}/transactions?limit=20&cursor=...`
```json
{ "transactions": [{ "id": "...", "amount": 100.00, "currency": "usd", "status": "succeeded", "createdAt": "..." }], "nextCursor": "..." }
```

**Chart data:** `GET /api/dashboard/giving-chart?range=12m`
```json
{ "data": [{ "month": "2026-01-01", "total": 7200.00 }, ...] }
```

**Funds:** `GET /api/giving/funds` / `POST /api/giving/funds { name, description? }`
**Donors:** `GET /api/giving/donors` → `[{ id, fullName, email, avatarUrl }]`
**Recurring:** `GET /api/giving/recurring` / `POST .../pause` / `.../resume` / `DELETE .../cancel`

---

### 4. Events Management

**List:** `GET /api/events?upcoming=true&limit=20&cursor=...`
**Create:** `POST /api/events { title, description, startAt, endAt, location, coverImageUrl? }`
**Update:** `PATCH /api/events/{id} { ...partial }`
**Delete:** `DELETE /api/events/{id}`
**RSVP list:** `GET /api/events/{id}/attendees?limit=20&cursor=...`

---

### 5. Groups Management

**List:** `GET /api/groups?limit=20&cursor=...`
**Create:** `POST /api/groups { name, description?, imageUrl? }`
**Update:** `PUT /api/groups/{id} { name?, description?, imageUrl? }`
**Delete:** `DELETE /api/groups/{id}`
**Members:** `GET /api/groups/{id}/members?limit=20&cursor=...`

---

### 6. Care Cases (Pastoral Care)

**List:** `GET /api/care-cases?status=new&limit=20&cursor=...`
**KPIs:** `GET /api/care-cases/kpis`
```json
{ "newCases": 5, "inProgress": 8, "resolved": 42, "needsLeader": 2, "urgentCount": 1 }
```

**Create:** `POST /api/care-cases { memberId, title, description?, priority?, assignedTo? }`
**Update:** `PUT /api/care-cases/{id} { status?, priority?, assignedTo? }`
**Timeline:** `GET /api/care-cases/{id}/timeline` → chronological notes
**Add note:** `POST /api/care-cases/{id}/notes { content }`

---

### 7. Tasks

**List:** `GET /api/tasks?status=pending&priority=high&limit=20&cursor=...`
**KPIs:** `GET /api/tasks/kpis`
```json
{ "pending": 12, "inProgress": 5, "highPriority": 3, "overdue": 2 }
```

**Create:** `POST /api/tasks { title, description?, priority?, assignedTo?, dueDate? }`
**Update:** `PUT /api/tasks/{id} { ...partial }`
**Complete:** `PUT /api/tasks/{id}/complete`
**Delete:** `DELETE /api/tasks/{id}`

---

### 8. Attendance

**Today's check-in:** `GET /api/attendance/kpis`
```json
{ "todayCount": 85, "visitorsThisWeek": 4, "uniqueLast7d": 120 }
```

**Roster:** `GET /api/attendance/roster?date=2026-04-09&serviceId=...`
**Bulk check-in:** `POST /api/attendance/bulk { userIds: [...], serviceId? }`
**Add visitor:** `POST /api/attendance/visitors { name, serviceId? }`
**Chart:** `GET /api/dashboard/attendance-chart` → weekly counts for 12 weeks

---

### 9. Volunteers

**KPIs:** `GET /api/volunteer/kpis`
```json
{ "activeVolunteers": 23, "hoursThisMonth": 156.5 }
```

**Opportunities:** `GET /api/volunteer/opportunities`
**Schedule:** `GET /api/volunteer/schedule`
**Log hours:** `POST /api/volunteer/hours { userId, hours, date, notes? }`

---

### 10. Tags

**List:** `GET /api/tags` → `[{ id, name, color, memberCount, createdAt }]`
**Create:** `POST /api/tags { name, color }` (color is hex like "#6366f1")
**Update:** `PATCH /api/tags/{id} { name?, color? }`
**Delete:** `DELETE /api/tags/{id}`
**Assign:** `POST /api/tags/{id}/members { userIds: [...] }`
**Remove:** `DELETE /api/tags/{id}/members/{userId}`
**Tag members:** `GET /api/tags/{id}/members?limit=20&cursor=...`

---

### 11. Sermons

**List:** `GET /api/sermons?filter=all|recent|series&limit=20&cursor=...`
**Featured:** `GET /api/sermons/featured`
**Series:** `GET /api/sermons/series` → `[{ seriesName, count }]`
**Create:** `POST /api/sermons { title, speaker, audioUrl?, videoUrl?, thumbnailUrl?, duration?, seriesName?, notes? }`
**Update:** `PUT /api/sermons/{id} { ...partial }`
**Delete:** `DELETE /api/sermons/{id}`
**Engagement:** `GET /api/sermons/{id}/engagement` → `{ viewCount, likeCount }`

---

### 12. Communications

**Segments:** `GET /api/communications/segments` / `POST { name, rules }`
**Templates:** `GET /api/communications/templates` / `POST { name, body, channel, subject? }`
**Send:** `POST /api/communications/send { channel, body, segmentId?, subject? }`
**Schedule:** `POST /api/communications/schedule { channel, body, scheduledFor, ... }`
**History:** `GET /api/communications/history?limit=20&cursor=...`
**Analytics:** `GET /api/communications/analytics` → `{ totalSent, sentThisMonth, avgRecipients }`

---

### 13. Facilities

**Rooms:** `GET /api/facilities/rooms`
**Calendar:** `GET /api/facilities/rooms/{id}/calendar?start=...&end=...`
**Book:** `POST /api/facilities/bookings { roomId, title, startAt, endAt, notes? }`
**Cancel:** `DELETE /api/facilities/bookings/{id}`
**Availability:** `GET /api/facilities/availability?roomId=...&date=...`

---

### 14. Reports

**Giving YoY:** `GET /api/reports/giving-yoy`
**Funnel:** `GET /api/reports/funnel` → `{ visitors, regular, members, leaders }`
**Engagement:** `GET /api/reports/engagement` → `{ inactive, low, medium, high }`
**By fund:** `GET /api/reports/giving-by-fund`
**KPIs:** `GET /api/reports/kpis` → `{ ytdGiving, totalMembers, avgMonthlyAttendance }`
**Export:** `GET /api/reports/export?type=members|giving|attendance`

---

### 15. Content Moderation

**List:** `GET /api/admin/moderation?status=pending&limit=20&cursor=...`
**Approve:** `POST /api/admin/moderation/{id}/approve`
**Remove:** `POST /api/admin/moderation/{id}/remove`

---

## Navigation Structure for Mobile Admin

```
Admin Tab (gear icon in bottom nav, only visible to admin/pastor)
├── Dashboard Home (KPI cards + widgets)
├── Members (list + invite + roles)
├── Giving (KPIs + transactions + chart)
├── Events (calendar + CRUD)
├── Groups (list + CRUD)
├── Care (cases + notes)
├── Tasks (list + CRUD)
├── Attendance (roster + check-in)
├── Volunteers (schedule + hours)
├── Tags (manage member tags)
├── Sermons (library + CRUD)
├── Communications (send + history)
├── Facilities (rooms + bookings)
├── Reports (charts + export)
└── Moderation (flagged content)
```

---

## Key Patterns

1. **All requests need:** `Authorization: Bearer <accessToken>`
2. **Tenant context:** Most endpoints read tenantId from the JWT. Some require it in the URL path.
3. **Pagination:** Cursor-based (`?limit=20&cursor=<lastId>`). Response includes `nextCursor: string | null`.
4. **Errors:** `{ statusCode, message, error }` — handle 401 (re-login), 403 (no permission), 429 (rate limit).
5. **Image uploads:** `POST /api/media/presigned-url { filename, contentType }` → PUT to the returned `uploadUrl` → use `fileKey` in subsequent calls.
