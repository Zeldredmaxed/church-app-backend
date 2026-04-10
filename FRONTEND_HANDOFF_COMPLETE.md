# Shepard — Complete Backend API Reference for Frontend Teams

> **Last Updated:** April 9, 2026
> **Base URL:** `https://your-render-domain.onrender.com/api`
> **Auth:** All endpoints require `Authorization: Bearer <jwt>` unless marked **PUBLIC** or **WEBHOOK**.
> **Tenant Context:** The JWT contains `app_metadata.current_tenant_id` — the backend reads it automatically. No need to pass `tenantId` in most requests.

---

## Table of Contents

1. [Authentication & Session](#1-authentication--session)
2. [Users & Settings](#2-users--settings)
3. [Tenants & Church Management](#3-tenants--church-management)
4. [Memberships & People](#4-memberships--people)
5. [Dashboard & KPIs](#5-dashboard--kpis)
6. [Posts & Social Feed](#6-posts--social-feed)
7. [Comments](#7-comments)
8. [Stories](#8-stories)
9. [Follows](#9-follows)
10. [Notifications](#10-notifications)
11. [Events & Calendar](#11-events--calendar)
12. [Groups](#12-groups)
13. [Prayers](#13-prayers)
14. [Chat](#14-chat)
15. [Sermons](#15-sermons)
16. [Announcements](#16-announcements)
17. [Giving & Donations](#17-giving--donations)
18. [Recurring Giving](#18-recurring-giving)
19. [Stripe Connect](#19-stripe-connect)
20. [Attendance & Check-In](#20-attendance--check-in)
21. [Geo Check-In (Mobile)](#21-geo-check-in-mobile)
22. [Volunteers](#22-volunteers)
23. [Care Cases](#23-care-cases)
24. [Tasks](#24-tasks)
25. [Facilities & Room Booking](#25-facilities--room-booking)
26. [Tags](#26-tags)
27. [Gallery](#27-gallery)
28. [Search](#28-search)
29. [Moderation](#29-moderation)
30. [Invitations](#30-invitations)
31. [Communications](#31-communications)
32. [Reports & Analytics](#32-reports--analytics)
33. [Member Profiles (360-Degree View)](#33-member-profiles-360-degree-view)
34. [Onboarding Forms](#34-onboarding-forms)
35. [Badges & Achievements](#35-badges--achievements)
36. [Leaderboard](#36-leaderboard)
37. [Workflows](#37-workflows)
38. [Workflow Marketplace](#38-workflow-marketplace)
39. [AI Assistant](#39-ai-assistant)
40. [Feedback & Requests](#40-feedback--requests)
41. [Family Tree](#41-family-tree)
42. [Media Uploads](#42-media-uploads)
43. [Health Checks](#43-health-checks)
44. [Global Feed (GraphQL)](#44-global-feed-graphql)
45. [Tier Feature Gating](#45-tier-feature-gating)
46. [Pagination Patterns](#46-pagination-patterns)
47. [Error Format](#47-error-format)

---

## 1. Authentication & Session

All auth endpoints are under `/api/auth`. Login/signup are rate-limited to 5 req/min.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/auth/signup` | PUBLIC | Register a new user |
| POST | `/auth/login` | PUBLIC | Log in and receive tokens |
| POST | `/auth/refresh` | PUBLIC | Exchange refresh token for new access token |
| POST | `/auth/forgot-password` | PUBLIC | Request password reset email |
| POST | `/auth/reset-password` | JWT | Set new password (from reset link) |
| POST | `/auth/logout` | JWT | Log out (discard tokens client-side) |
| GET | `/auth/session` | JWT | Get current session (user + memberships + tenant) |
| POST | `/auth/switch-tenant` | JWT | Switch active tenant context |

### POST /auth/signup
```json
// Request
{
  "email": "user@example.com",
  "password": "secureP@ss1",       // 8-72 chars
  "fullName": "John Smith",         // optional
  "tenantId": "uuid",               // optional — auto-join church
  "onboardingResponses": {           // optional — submit during signup
    "is_saved": true,
    "interests": ["Worship/Music"]
  }
}

// Response 201
{
  "userId": "uuid",
  "email": "user@example.com",
  "fullName": "John Smith",
  "tenantId": "uuid",
  "accessToken": "eyJ...",
  "refreshToken": "...",
  "expiresAt": 1712700000,
  "message": "Account created"
}
```

### POST /auth/login
```json
// Request
{ "email": "user@example.com", "password": "secureP@ss1" }

// Response 200
{
  "accessToken": "eyJ...",
  "refreshToken": "...",
  "expiresAt": 1712700000,
  "user": { "id": "uuid", "email": "...", "currentTenantId": "uuid" }
}
```

### POST /auth/refresh
```json
// Request
{ "refreshToken": "..." }

// Response 200
{ "accessToken": "eyJ...", "refreshToken": "...", "expiresAt": 1712700000 }
```

### POST /auth/forgot-password
```json
// Request
{ "email": "user@example.com" }
// Optional query param: ?redirectTo=https://yourdomain.com/reset-password

// Response 200
{ "message": "If an account with that email exists, a password reset link has been sent." }
```

### POST /auth/reset-password
```json
// Request (requires valid session from reset link)
{ "password": "newSecureP@ss1" }

// Response 200
{ "message": "Password updated successfully." }
```

### GET /auth/session
```json
// Response 200
{
  "user": { "id": "uuid", "email": "...", "fullName": "...", "avatarUrl": "..." },
  "memberships": [
    { "tenantId": "uuid", "tenantName": "Grace Church", "tenantSlug": "grace-church", "role": "admin", "permissions": {} }
  ],
  "currentTenantId": "uuid"
}
```

### POST /auth/switch-tenant
```json
// Request
{ "tenantId": "uuid" }

// Response 200
{ "message": "Tenant switched", "currentTenantId": "uuid", "yourRole": "member" }
```

---

## 2. Users & Settings

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/users/me` | JWT | Get my profile |
| PATCH | `/users/me` | JWT | Update my profile (fullName, avatarUrl) |
| DELETE | `/users/me` | JWT | Delete my account (GDPR) |
| GET | `/users/me/settings` | JWT | Get notification settings |
| PUT | `/users/me/settings` | JWT | Update notification settings |
| GET | `/users/me/streak` | JWT | Get login streak |
| GET | `/users/me/export` | JWT | Export all my data as JSON (GDPR) |

### GET /users/me/streak
```json
{ "currentStreak": 7, "longestStreak": 21 }
```

### GET /users/me/settings
```json
{
  "pushEnabled": true,
  "emailEnabled": true,
  "smsEnabled": false,
  "quietHoursStart": "22:00",
  "quietHoursEnd": "07:00"
}
```

---

## 3. Tenants & Church Management

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/tenants/register` | PUBLIC | Register a new church (requires registration key) |
| GET | `/tenants/public` | PUBLIC | List all churches (for church picker) |
| POST | `/tenants` | JWT + Super Admin | Create a tenant (internal) |
| GET | `/tenants/:id` | JWT | Get tenant details |
| GET | `/tenants/:id/features` | JWT | Get tier feature flags (for frontend bootstrap) |
| GET | `/tenants/:id/profile` | PUBLIC | Get public church profile |
| GET | `/tenants/:id/analytics` | JWT (manage_finance) | Get admin analytics |

### GET /tenants/public
```json
// Query: ?q=grace (optional search)
[
  { "id": "uuid", "name": "Grace Church", "slug": "grace-church" }
]
```

### GET /tenants/:id/features
```json
// Use this on app launch to know what to show/hide
{
  "tier": "premium",
  "mobileApp": true,
  "maxAdminUsers": -1,
  "granularRoles": true,
  "internalFeed": true,
  "globalFeed": true,
  "videoPostsAllowed": true,
  "search": true,
  "pushNotifications": true,
  "chat": true,
  "videoUploads": true,
  "storageLimit": 100,
  "transactionFeePercent": 1.0,
  "aiAssistant": true,
  "workflows": true,
  "maxWorkflows": 1,
  "maxWorkflowNodes": 5,
  "customBranding": false,
  "multiSite": false,
  "apiAccess": false
}
```

---

## 4. Memberships & People

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/memberships` | JWT | List all tenants I belong to |
| POST | `/memberships` | JWT (admin/pastor) | Add a user by email |
| GET | `/tenants/:tenantId/members` | JWT | List members (cursor-paginated) |
| GET | `/tenants/:tenantId/members/kpis` | JWT | Member KPI dashboard cards |
| GET | `/tenants/:tenantId/members/export` | JWT | Export members as CSV |
| PATCH | `/tenants/:tenantId/members/:userId/role` | JWT (admin) | Update member role |
| PATCH | `/tenants/:tenantId/members/:userId/permissions` | JWT (admin, Pro+) | Update member permissions |
| DELETE | `/tenants/:tenantId/members/:userId` | JWT (admin or self) | Remove member |

### GET /tenants/:tenantId/members
```json
// Query: ?cursor=xxx&limit=20
{
  "items": [
    { "userId": "uuid", "email": "...", "fullName": "...", "role": "member", "permissions": {}, "joinedAt": "..." }
  ],
  "nextCursor": "xxx"
}
```

### GET /tenants/:tenantId/members/kpis
```json
{ "totalMembers": 342, "newThisMonth": 18, "activeLast30d": 156 }
```

---

## 5. Dashboard & KPIs

**Admin Dashboard only.** All require JWT.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/dashboard/kpis` | All KPI cards (members, giving, attendance, etc.) |
| GET | `/dashboard/giving-chart` | Monthly giving totals (`?range=6m\|12m\|24m`) |
| GET | `/dashboard/attendance-chart` | Weekly attendance (last 12 weeks) |
| GET | `/dashboard/growth-chart` | Monthly new members |
| GET | `/dashboard/care-summary` | Care case summary counts |
| GET | `/dashboard/upcoming-events` | Next 5 upcoming events |
| GET | `/dashboard/engagement` | Weekly active + 6-week trend |
| GET | `/dashboard/activity-feed` | Cross-domain activity feed (`?limit=20`) |

### GET /dashboard/kpis
```json
{
  "totalMembers": 342,
  "newMembersThisMonth": 18,
  "totalGivingThisMonth": 24500.00,
  "avgAttendance": 187,
  "activeGroups": 12,
  "openPrayerRequests": 34,
  "openCareCases": 7,
  "upcomingEventsCount": 3
}
```

### GET /dashboard/engagement
```json
{
  "currentWeek": 156,
  "previousWeek": 142,
  "delta": 14,
  "trend": "up",
  "weeklyHistory": [
    { "week": "2026-03-03", "activeMembers": 130 },
    { "week": "2026-03-10", "activeMembers": 142 },
    { "week": "2026-03-17", "activeMembers": 135 },
    { "week": "2026-03-24", "activeMembers": 148 },
    { "week": "2026-03-31", "activeMembers": 142 },
    { "week": "2026-04-07", "activeMembers": 156 }
  ]
}
```

### GET /dashboard/activity-feed
```json
[
  { "type": "post", "id": "uuid", "title": "New post by John...", "createdAt": "2026-04-09T..." },
  { "type": "event", "id": "uuid", "title": "Sunday Service", "createdAt": "..." },
  { "type": "prayer", "id": "uuid", "title": "Please pray for...", "createdAt": "..." },
  { "type": "announcement", "id": "uuid", "title": "Building fund update", "createdAt": "..." }
]
```

---

## 6. Posts & Social Feed

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/posts` | JWT | Create a church-internal post |
| POST | `/posts/global` | JWT | Create a global post (fan-out to followers) |
| GET | `/posts` | JWT | List tenant posts (cursor-paginated) |
| GET | `/posts/saved` | JWT | List my saved/bookmarked posts |
| GET | `/posts/:id` | JWT | Get a single post |
| PATCH | `/posts/:id` | JWT (author) | Update post content |
| DELETE | `/posts/:id` | JWT (author/admin) | Delete a post |
| POST | `/posts/:id/like` | JWT | Like (idempotent) |
| DELETE | `/posts/:id/like` | JWT | Unlike (idempotent) |
| POST | `/posts/:id/save` | JWT | Bookmark (idempotent) |
| DELETE | `/posts/:id/save` | JWT | Unbookmark (idempotent) |

### POST /posts
```json
// Request
{
  "content": "Good morning church family!",
  "mediaUrl": "https://...",      // optional
  "mediaType": "image"             // optional: image | video
}
```

---

## 7. Comments

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/posts/:postId/comments` | JWT | Create a comment (supports `parentId` for replies) |
| GET | `/posts/:postId/comments` | JWT | List comments (newest first) |

### POST /posts/:postId/comments
```json
// Request
{
  "content": "Amen!",
  "parentId": "uuid"   // optional — set for replies
}
```

---

## 8. Stories

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/stories/feed` | JWT | Stories feed (grouped by author, last 24h) |
| GET | `/stories/mine` | JWT | My active stories |
| POST | `/stories` | JWT | Create a story |
| DELETE | `/stories/:id` | JWT | Delete my story |
| POST | `/stories/:id/view` | JWT | Mark as viewed |

### POST /stories
```json
{ "mediaUrl": "https://...", "mediaType": "image", "caption": "Sunday vibes" }
```

### GET /stories/feed
```json
[
  {
    "authorId": "uuid",
    "authorName": "Pastor Mike",
    "authorAvatar": "https://...",
    "stories": [
      { "id": "uuid", "mediaUrl": "...", "caption": "...", "createdAt": "...", "viewed": false }
    ]
  }
]
```

---

## 9. Follows

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/users/:id/follow` | JWT | Follow a user (platform-wide) |
| DELETE | `/users/:id/follow` | JWT | Unfollow |
| GET | `/users/:id/followers` | JWT | List followers |
| GET | `/users/:id/following` | JWT | List following |

---

## 10. Notifications

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/notifications` | JWT | List my notifications (paginated) |
| PATCH | `/notifications/:id/read` | JWT | Mark as read |

---

## 11. Events & Calendar

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/events` | JWT | List events (`?upcoming=true&limit=20&cursor=xxx`) |
| GET | `/events/:id` | JWT | Get event with RSVP status |
| POST | `/events` | JWT (manage_content) | Create event |
| PATCH | `/events/:id` | JWT (manage_content) | Update event |
| DELETE | `/events/:id` | JWT (manage_content) | Delete event |
| POST | `/events/:id/rsvp` | JWT | RSVP to event |
| GET | `/events/:id/attendees` | JWT | List attendees (cursor-paginated) |

### POST /events
```json
{
  "title": "Sunday Service",
  "description": "Join us for worship",
  "startTime": "2026-04-13T09:00:00Z",
  "endTime": "2026-04-13T11:00:00Z",
  "location": "Main Sanctuary",
  "isRecurring": false,
  "imageUrl": "https://..."
}
```

---

## 12. Groups

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/groups` | JWT | List groups (cursor-paginated) |
| GET | `/groups/:id` | JWT | Get group with membership status |
| POST | `/groups` | JWT | Create group |
| PUT | `/groups/:id` | JWT | Update group |
| DELETE | `/groups/:id` | JWT | Delete group (cascades) |
| GET | `/groups/:id/members` | JWT | List members (cursor-paginated) |
| POST | `/groups/:id/join` | JWT | Join group (idempotent) |
| DELETE | `/groups/:id/leave` | JWT | Leave group |
| GET | `/groups/:id/messages` | JWT | List messages (cursor-paginated) |
| POST | `/groups/:id/messages` | JWT | Send message |

---

## 13. Prayers

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/prayers` | JWT | List prayers (`?filter=all\|mine\|answered&cursor=xxx`) |
| POST | `/prayers` | JWT | Create prayer request |
| POST | `/prayers/:id/pray` | JWT | Toggle praying (like/unlike) |
| PATCH | `/prayers/:id/answer` | JWT (author) | Mark as answered |
| DELETE | `/prayers/:id` | JWT (author/admin) | Delete |

---

## 14. Chat

**Requires Premium tier or higher.** Returns 403 on Standard.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/channels` | JWT | Create channel (public/private/direct) |
| GET | `/channels` | JWT | List my channels |
| POST | `/channels/:id/members` | JWT | Add member to channel |
| POST | `/channels/:id/messages` | JWT | Send message |
| GET | `/channels/:id/messages` | JWT | Get messages (cursor-paginated) |

---

## 15. Sermons

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/sermons` | JWT | List sermons (`?filter=all\|recent\|series\|topics&cursor=xxx`) |
| GET | `/sermons/featured` | JWT | Get featured sermon |
| GET | `/sermons/series` | JWT | List distinct series with counts |
| GET | `/sermons/:id` | JWT | Get sermon detail |
| POST | `/sermons` | JWT | Create sermon |
| PUT | `/sermons/:id` | JWT | Update sermon |
| DELETE | `/sermons/:id` | JWT | Delete sermon |
| GET | `/sermons/:id/engagement` | JWT | Get engagement stats (views, likes, avg watch time) |
| POST | `/sermons/:id/like` | JWT | Like a sermon |
| POST | `/sermons/:id/view` | JWT | Record view (fire-and-forget) |

---

## 16. Announcements

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/announcements` | JWT | List (`?filter=all\|urgent\|week&cursor=xxx`) |
| POST | `/announcements` | JWT | Create announcement |

---

## 17. Giving & Donations

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/giving/kpis` | JWT | Giving dashboard KPIs |
| GET | `/giving/donors` | JWT | List unique donors |
| GET | `/giving/funds` | JWT | List giving funds |
| POST | `/giving/funds` | JWT | Create a giving fund |
| POST | `/giving/donate` | JWT | Create donation (returns Stripe clientSecret) |
| GET | `/giving/transactions` | JWT | My donation history (cursor-paginated) |
| GET | `/tenants/:tenantId/transactions` | JWT (manage_finance) | All tenant transactions |

### POST /giving/donate
```json
// Request
{
  "amount": 50.00,
  "currency": "usd",
  "fundId": "uuid"    // optional — defaults to general fund
}

// Response 201
{
  "clientSecret": "pi_xxx_secret_xxx",
  "transactionId": "uuid"
}
```
> **Frontend:** Use the `clientSecret` with Stripe.js `confirmPayment()` to complete the charge.

### GET /giving/kpis
```json
{
  "totalGiving": 124500.00,
  "thisMonth": 24500.00,
  "pendingCount": 3,
  "uniqueDonors": 89
}
```

---

## 18. Recurring Giving

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/giving/recurring` | JWT | List my active recurring gifts |
| POST | `/giving/recurring` | JWT | Create recurring gift |
| POST | `/giving/recurring/:id/pause` | JWT | Pause |
| POST | `/giving/recurring/:id/resume` | JWT | Resume |
| DELETE | `/giving/recurring/:id/cancel` | JWT | Cancel |

---

## 19. Stripe Connect

Admin-only endpoints for church payment setup.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/stripe/connect/onboard` | JWT (admin) | Start Stripe Connect onboarding (returns redirect URL) |
| GET | `/stripe/connect/status` | JWT (admin) | Check onboarding status |
| POST | `/stripe/connect/setup-intent` | JWT | Create SetupIntent (save payment method) |

### GET /stripe/connect/status
```json
{
  "status": "active",
  "chargesEnabled": true,
  "payoutsEnabled": true,
  "detailsSubmitted": true
}
```

---

## 20. Attendance & Check-In

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/services/current` | JWT | Get today's services |
| POST | `/check-in` | JWT | Check in to a service |
| GET | `/attendance/services` | JWT | All services (all days) |
| GET | `/attendance/roster` | JWT | Attendance roster (`?serviceId=&date=`) |
| POST | `/attendance/bulk` | JWT | Bulk check-in multiple users |
| GET | `/attendance/kpis` | JWT | Attendance KPI metrics |
| POST | `/attendance/visitors` | JWT | Record visitor check-in |

### POST /check-in
```json
{ "serviceId": "uuid" }
```

### GET /attendance/kpis
```json
{
  "totalCheckInsToday": 187,
  "avgWeeklyAttendance": 165,
  "visitorsThisMonth": 23,
  "growthPercent": 8.5
}
```

---

## 21. Geo Check-In (Mobile)

Mobile-only. Uses device GPS to verify the user is physically at the church.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/attendance/geo-check-in` | JWT | Geo-fenced check-in |

### POST /attendance/geo-check-in
```json
// Request
{ "lat": 32.7767, "lng": -96.7970 }

// Response 200 (success)
{ "success": true, "message": "Checked in! You're 45m from church.", "distance": 45 }

// Response 200 (too far)
{ "success": false, "message": "You're 2.3km away — must be within 200m.", "distance": 2300 }
```

### Admin: Configure Geo Check-In
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/admin/check-in-config` | JWT | Get geo config (lat, lng, radius) |
| PUT | `/admin/check-in-config` | JWT | Update geo config |

```json
// PUT /admin/check-in-config
{
  "latitude": 32.7767,
  "longitude": -96.7970,
  "radiusMeters": 200,
  "enableGeoCheckin": true
}
```

---

## 22. Volunteers

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/volunteer/kpis` | JWT | Volunteer KPIs (active count, hours this month) |
| GET | `/volunteer/schedule` | JWT | Volunteer schedule with assigned people |
| GET | `/volunteer/opportunities` | JWT | List volunteer opportunities |
| POST | `/volunteer/hours` | JWT | Log volunteer hours |
| POST | `/volunteer/opportunities/:id/signup` | JWT | Sign up for opportunity |

---

## 23. Care Cases

Pastoral care tracking system.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/care-cases` | JWT | List cases (`?status=&priority=&cursor=`) |
| POST | `/care-cases` | JWT | Create care case |
| GET | `/care-cases/kpis` | JWT | KPI counts |
| GET | `/care-cases/:id` | JWT | Get case detail |
| PUT | `/care-cases/:id` | JWT | Update case |
| GET | `/care-cases/:id/timeline` | JWT | Get notes timeline |
| POST | `/care-cases/:id/notes` | JWT | Add a note |

### POST /care-cases
```json
{
  "memberId": "uuid",
  "title": "Hospital visit needed",
  "description": "Member recovering from surgery",
  "priority": "high",
  "assignedTo": "uuid"
}
```

---

## 24. Tasks

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/tasks` | JWT | List tasks (`?status=&priority=&assignedTo=&linkedType=&linkedId=&cursor=`) |
| POST | `/tasks` | JWT | Create task |
| GET | `/tasks/kpis` | JWT | KPI counts |
| GET | `/tasks/:id` | JWT | Get task detail |
| PUT | `/tasks/:id` | JWT | Update task |
| DELETE | `/tasks/:id` | JWT | Delete task |
| PUT | `/tasks/:id/complete` | JWT | Mark as completed |

### POST /tasks
```json
{
  "title": "Follow up with new visitor",
  "description": "Call John about small groups",
  "priority": "medium",
  "assignedTo": "uuid",
  "dueDate": "2026-04-15",
  "linkedType": "care_case",
  "linkedId": "uuid"
}
```

---

## 25. Facilities & Room Booking

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/facilities/rooms` | JWT | List all rooms with availability |
| GET | `/facilities/rooms/:roomId/calendar` | JWT | Room bookings (`?start=&end=`) |
| POST | `/facilities/bookings` | JWT | Create booking |
| PUT | `/facilities/bookings/:id` | JWT | Update booking |
| DELETE | `/facilities/bookings/:id` | JWT | Cancel booking |
| GET | `/facilities/availability` | JWT | Hourly slots (`?roomId=&date=`) |

### POST /facilities/bookings
```json
{
  "roomId": "uuid",
  "title": "Youth Group Meeting",
  "startTime": "2026-04-13T18:00:00Z",
  "endTime": "2026-04-13T20:00:00Z",
  "notes": "Need projector setup"
}
```

---

## 26. Tags

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/tags` | JWT | List tags for current tenant |
| POST | `/tags` | JWT (manage_members) | Create tag |
| PATCH | `/tags/:id` | JWT (manage_members) | Update tag |
| DELETE | `/tags/:id` | JWT (manage_members) | Delete tag |
| POST | `/tags/:id/members` | JWT | Assign tag to users |
| DELETE | `/tags/:id/members/:userId` | JWT | Remove tag from member |
| GET | `/tags/:id/members` | JWT | List members with tag (cursor-paginated) |
| GET | `/members/:userId/tags` | JWT | Get all tags for a member |

### POST /tags
```json
{ "name": "Volunteer", "color": "#4CAF50" }
```

### POST /tags/:id/members
```json
{ "userIds": ["uuid1", "uuid2", "uuid3"] }
```

---

## 27. Gallery

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/gallery` | JWT | List photos (`?album=&limit=&cursor=`) |
| POST | `/gallery` | JWT | Upload photo |

---

## 28. Search

| Method | Path | Auth | Tier | Description |
|--------|------|------|------|-------------|
| GET | `/search/posts` | JWT | All | Search posts (`?q=&cursor=&limit=`) |
| GET | `/search/members` | JWT | Premium+ | Search members (`?q=&cursor=&limit=`) |

---

## 29. Moderation

Admin-only content moderation.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/admin/moderation` | JWT | List reports (`?status=pending\|reviewed\|removed&cursor=`) |
| POST | `/admin/moderation/:id/approve` | JWT | Approve report |
| POST | `/admin/moderation/:id/remove` | JWT | Remove reported post |

---

## 30. Invitations

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/invitations` | JWT (admin/pastor) | List pending invitations |
| POST | `/invitations` | JWT | Send invitation (by email) |
| POST | `/invitations/:token/accept` | JWT | Accept invitation |

---

## 31. Communications

Email, SMS, and push notification system for admin dashboard.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/communications/segments` | JWT | List audience segments |
| POST | `/communications/segments` | JWT | Create segment |
| POST | `/communications/segment-preview` | JWT | Preview matched count |
| GET | `/communications/templates` | JWT | List message templates |
| POST | `/communications/templates` | JWT | Create template |
| POST | `/communications/send` | JWT | Send message (email/SMS/push) |
| POST | `/communications/schedule` | JWT | Schedule message for later |
| GET | `/communications/history` | JWT | Sent messages history (`?limit=&cursor=`) |
| GET | `/communications/analytics` | JWT | Communications analytics |

### POST /communications/segments
```json
{
  "name": "New Members (30 days)",
  "rules": {
    "joinedAfter": "2026-03-09",
    "role": "member",
    "tags": ["Guest"]
  }
}
```

### POST /communications/send
```json
{
  "channel": "email",
  "templateId": "uuid",
  "segmentId": "uuid",
  "subject": "Welcome to Grace Church!",
  "body": "Hi {{fullName}}, we're glad you're here!"
}
```

---

## 32. Reports & Analytics

All admin dashboard. All require JWT.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/reports/giving-yoy` | Year-over-year giving comparison |
| GET | `/reports/funnel` | Discipleship funnel counts |
| GET | `/reports/engagement` | Engagement score distribution |
| GET | `/reports/giving-by-fund` | Giving breakdown by fund |
| GET | `/reports/kpis` | YTD report KPIs |
| GET | `/reports/export` | Export data for CSV (`?type=members\|giving\|attendance`) |

### GET /reports/funnel
```json
{
  "totalMembers": 342,
  "visitors": 89,
  "regularAttenders": 187,
  "members": 156,
  "serving": 67,
  "leading": 23
}
```

---

## 33. Member Profiles (360-Degree View)

The full member profile view for admin dashboard.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/members/:userId/profile` | JWT | Full 360-degree member profile |
| PUT | `/members/:userId/journey` | JWT | Update spiritual journey |
| GET | `/members/:userId/notes` | JWT | Get pastor notes |
| POST | `/members/:userId/notes` | JWT | Add pastor note |
| DELETE | `/members/:userId/notes/:noteId` | JWT | Delete note |

### GET /members/:userId/profile

Returns everything about a member in one call:

```json
{
  "personalInfo": {
    "id": "uuid",
    "email": "john@example.com",
    "fullName": "John Smith",
    "avatarUrl": "https://...",
    "phone": "+1234567890",
    "joinedAt": "2026-01-15T...",
    "role": "member",
    "permissions": {}
  },
  "tags": [
    { "id": "uuid", "name": "Volunteer", "color": "#4CAF50" },
    { "id": "uuid", "name": "Guest", "color": "#9E9E9E" }
  ],
  "journey": {
    "id": "uuid",
    "attendedMembersClass": true,
    "membersClassDate": "2026-02-10",
    "isBaptized": true,
    "baptismDate": "2026-03-01",
    "salvationDate": "2020-06-15",
    "discipleshipTrack": "growth",
    "skills": ["Music/Singing", "Teaching"],
    "interests": ["Worship/Music", "Youth Ministry"],
    "bio": "Passionate about worship"
  },
  "engagement": {
    "posts": 5,
    "comments": 12,
    "checkIns": 8,
    "likes": 23,
    "totalScore": 77,
    "level": "high"
  },
  "giving": {
    "recentTransactions": [
      { "id": "uuid", "amount": 50.00, "currency": "usd", "status": "succeeded", "createdAt": "..." }
    ],
    "totalGiven": 1250.00,
    "donationCount": 15
  },
  "activityTimeline": [
    { "type": "check_in", "id": "uuid", "description": "Checked in", "occurredAt": "..." },
    { "type": "post", "id": "uuid", "description": "Good morning church...", "occurredAt": "..." },
    { "type": "donation", "id": "uuid", "description": "Donated $50", "occurredAt": "..." }
  ],
  "notes": [
    { "id": "uuid", "authorName": "Pastor Mike", "content": "Met with John about...", "isPrivate": true, "createdAt": "..." }
  ],
  "badges": [
    { "id": "uuid", "name": "First Steps", "icon": "footprints", "color": "#4CAF50", "tier": "bronze", "awardedAt": "..." }
  ],
  "onboarding": {
    "submittedAt": "2026-01-15T...",
    "answers": [
      { "key": "is_saved", "label": "Have you accepted Jesus Christ as your Lord and Savior?", "type": "boolean", "category": "spiritual", "value": true },
      { "key": "is_baptized", "label": "Have you been baptized?", "type": "boolean", "category": "spiritual", "value": true },
      { "key": "interests", "label": "What areas of ministry interest you?", "type": "multiselect", "category": "interests", "value": ["Worship/Music", "Youth Ministry"] },
      { "key": "how_did_you_hear", "label": "How did you hear about us?", "type": "select", "category": "personal", "value": "Friend/Family" },
      { "key": "marital_status", "label": "Marital Status", "type": "select", "category": "family", "value": "Married" },
      { "key": "children_count", "label": "Number of Children", "type": "number", "category": "family", "value": 3 },
      { "key": "custom_tshirt_size", "label": "custom_tshirt_size", "type": "text", "category": "custom", "value": "XL" }
    ]
  }
}
```

> **Key:** The `onboarding` object is `null` if the member hasn't submitted onboarding. Each answer includes `label`, `type`, and `category` so you can render it without calling the field library. Group answers by `category` for display (Spiritual, Personal, Family, Interests, Background, Custom).

---

## 34. Onboarding Forms

### Admin Endpoints (JWT required)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/onboarding/field-library` | Get all 37 pre-built fields grouped by category |
| GET | `/onboarding/form` | Get current church form |
| PUT | `/onboarding/form` | Create or update form |
| DELETE | `/onboarding/form` | Delete form |
| GET | `/onboarding/responses` | Get all submitted responses |
| GET | `/onboarding/responses/:userId` | Get specific member's response |
| GET | `/onboarding/stats` | Get response statistics |

### Public Endpoints (no auth — used during signup)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/onboarding/:tenantId/form` | Get active form for signup screen |
| POST | `/onboarding/:tenantId/submit` | Submit responses during signup |

### GET /onboarding/field-library

Returns all 37 fields grouped by category:

```json
{
  "spiritual": [
    { "key": "is_saved", "label": "Have you accepted Jesus Christ as your Lord and Savior?", "type": "boolean", "category": "spiritual", "mapsTo": "journey.salvation" },
    { "key": "salvation_date", "label": "When were you saved?", "type": "text", "placeholder": "e.g., June 2020 or 2018" },
    { "key": "is_baptized", "label": "Have you been baptized?", "type": "boolean" },
    { "key": "baptism_date", "label": "When were you baptized?", "type": "text" },
    { "key": "baptism_interest", "label": "Are you interested in being baptized?", "type": "boolean" },
    { "key": "holy_spirit", "label": "Have you received the Holy Spirit?", "type": "boolean" },
    { "key": "previous_church", "label": "What church were you attending previously?", "type": "text" },
    { "key": "how_long_christian", "label": "How long have you been a Christian?", "type": "select", "options": ["New believer (< 1 year)", "1-3 years", "3-5 years", "5-10 years", "10+ years", "Exploring faith"] },
    { "key": "faith_journey", "label": "Where would you say you are in your faith journey?", "type": "select", "options": ["Just exploring", "New believer", "Growing in faith", "Mature believer", "Ready to lead/serve"] },
    { "key": "discipleship_interest", "label": "Are you interested in a discipleship program?", "type": "boolean" }
  ],
  "personal": [
    { "key": "date_of_birth", "label": "Date of Birth", "type": "date" },
    { "key": "gender", "label": "Gender", "type": "select", "options": ["Male", "Female", "Prefer not to say"] },
    { "key": "address", "label": "Home Address", "type": "textarea" },
    { "key": "city", "label": "City", "type": "text" },
    { "key": "state", "label": "State", "type": "text" },
    { "key": "zip_code", "label": "ZIP Code", "type": "text" },
    { "key": "phone_secondary", "label": "Secondary Phone Number", "type": "phone" },
    { "key": "emergency_contact", "label": "Emergency Contact Name", "type": "text" },
    { "key": "emergency_phone", "label": "Emergency Contact Phone", "type": "phone" },
    { "key": "how_did_you_hear", "label": "How did you hear about us?", "type": "select", "options": ["Friend/Family", "Social Media", "Website", "Drive-by", "Online Search", "Community Event", "Other"] },
    { "key": "how_did_you_hear_detail", "label": "If referred, who invited you?", "type": "text" }
  ],
  "family": [
    { "key": "marital_status", "label": "Marital Status", "type": "select", "options": ["Single", "Married", "Divorced", "Widowed", "Separated"] },
    { "key": "spouse_name", "label": "Spouse Name", "type": "text" },
    { "key": "wedding_anniversary", "label": "Wedding Anniversary", "type": "date" },
    { "key": "children_count", "label": "Number of Children", "type": "number" },
    { "key": "children_names_ages", "label": "Children Names & Ages", "type": "textarea" },
    { "key": "family_in_church", "label": "Do you have family members already in our church?", "type": "text" }
  ],
  "interests": [
    { "key": "interests", "label": "What areas of ministry interest you?", "type": "multiselect", "options": ["Worship/Music", "Youth Ministry", "Children's Ministry", "Small Groups", "Outreach/Missions", "Prayer Ministry", "Media/Tech", "Hospitality/Greeting", "Teaching/Bible Study", "Counseling/Care", "Administration", "Men's Ministry", "Women's Ministry", "Senior's Ministry", "Food/Kitchen", "Maintenance/Facilities"] },
    { "key": "skills", "label": "What skills or talents do you have?", "type": "multiselect", "options": ["Music/Singing", "Musical Instrument", "Teaching", "Counseling", "IT/Technology", "Graphic Design", "Video/Photography", "Writing", "Cooking/Baking", "Construction/Handyman", "Medical/Nursing", "Legal", "Financial/Accounting", "Event Planning", "Public Speaking", "Languages/Translation"] },
    { "key": "volunteer_interest", "label": "Would you like to volunteer?", "type": "boolean" },
    { "key": "small_group_interest", "label": "Are you interested in joining a small group?", "type": "boolean" },
    { "key": "preferred_service", "label": "Which service time do you prefer?", "type": "select", "options": ["Early Morning", "Mid-Morning", "Afternoon", "Evening", "No preference"] },
    { "key": "communication_preference", "label": "How would you like us to contact you?", "type": "multiselect", "options": ["Email", "Text/SMS", "Phone Call", "Church App"] }
  ],
  "background": [
    { "key": "occupation", "label": "Occupation", "type": "text" },
    { "key": "employer", "label": "Employer/School", "type": "text" },
    { "key": "education", "label": "Highest Education Level", "type": "select", "options": ["High School", "Some College", "Associate Degree", "Bachelor's Degree", "Master's Degree", "Doctorate", "Trade/Vocational", "Other"] },
    { "key": "military", "label": "Are you a veteran or active military?", "type": "select", "options": ["No", "Active Duty", "Veteran", "Reserves", "Military Spouse"] },
    { "key": "special_needs", "label": "Do you or a family member have any special needs we should know about?", "type": "textarea" },
    { "key": "prayer_request", "label": "Is there anything you would like us to pray about?", "type": "textarea" },
    { "key": "additional_info", "label": "Is there anything else you would like us to know?", "type": "textarea" }
  ]
}
```

**Field types:** `text`, `textarea`, `select`, `multiselect`, `date`, `boolean`, `number`, `phone`, `email`

### PUT /onboarding/form (Admin — Save Form)

```json
{
  "isActive": true,
  "welcomeMessage": "Welcome to Grace Church! Help us get to know you.",
  "fields": [
    { "key": "is_saved", "required": true },
    { "key": "is_baptized", "required": true },
    { "key": "date_of_birth", "required": false },
    { "key": "interests", "required": false },
    { "key": "how_did_you_hear", "required": true },
    {
      "key": "custom_tshirt",
      "label": "T-Shirt Size",
      "type": "select",
      "options": ["S", "M", "L", "XL", "2XL"],
      "required": false
    }
  ]
}
```

> **Rules:**
> - For library fields: only send `key` + `required`. Backend resolves the rest.
> - For custom fields: send `key`, `label`, `type`, and optionally `options`/`placeholder`.
> - Array order = display order on signup form.
> - One form per church. PUT upserts.
> - Fields with `mapsTo` auto-populate the member's journey record on submission.

### GET /onboarding/stats
```json
{
  "totalResponses": 142,
  "topInterests": [{ "interest": "Worship/Music", "count": 67 }],
  "topSkills": [{ "skill": "Music/Singing", "count": 38 }],
  "referralSources": [{ "source": "Friend/Family", "count": 89 }]
}
```

---

## 35. Badges & Achievements

### Admin Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/badges` | JWT | List all badge definitions |
| POST | `/badges` | JWT | Create badge |
| PATCH | `/badges/:id` | JWT | Update badge |
| DELETE | `/badges/:id` | JWT | Delete badge |
| POST | `/badges/:id/award` | JWT | Award badge to members |
| DELETE | `/badges/:id/revoke/:userId` | JWT | Revoke badge |

### Member-Facing Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/badges/leaderboard` | JWT | Top members by badge count |
| GET | `/badges/progress` | JWT | My badge progress (current/target/percent) |
| POST | `/badges/check` | JWT | Check and auto-award my badges |
| GET | `/badges/user/:userId` | JWT | Badges earned by a user |
| GET | `/members/:userId/badges` | JWT | Badges for a member |
| GET | `/members/:userId/badge-progress` | JWT | Badge progress for a member |

### POST /badges (Create)
```json
{
  "name": "First Steps",
  "description": "Complete your first check-in",
  "icon": "footprints",
  "color": "#4CAF50",
  "tier": "bronze",
  "category": "attendance",
  "isAutoAwarded": true,
  "awardCriteria": { "type": "check_ins", "threshold": 1 },
  "displayOrder": 1
}
```

### GET /badges/progress
```json
[
  {
    "badgeId": "uuid",
    "name": "First Steps",
    "icon": "footprints",
    "tier": "bronze",
    "current": 1,
    "target": 1,
    "percent": 100,
    "earned": true,
    "earnedAt": "2026-03-15T..."
  },
  {
    "badgeId": "uuid",
    "name": "Prayer Warrior",
    "icon": "praying-hands",
    "tier": "gold",
    "current": 35,
    "target": 50,
    "percent": 70,
    "earned": false,
    "earnedAt": null
  }
]
```

---

## 36. Leaderboard

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/leaderboard/status` | JWT | Check if leaderboards are enabled |
| PUT | `/leaderboard/status` | JWT (admin) | Enable/disable leaderboards |
| GET | `/leaderboard` | JWT | Get leaderboard (`?category=&scope=&period=&limit=`) |
| GET | `/leaderboard/my-ranks` | JWT | My ranks across all categories |
| GET | `/leaderboard/user/:userId/ranks` | JWT | User's ranks |
| POST | `/leaderboard/app-open` | JWT | Record daily app open (fire-and-forget) |
| PUT | `/leaderboard/visibility` | JWT | Toggle my leaderboard visibility |

### GET /leaderboard

Query params:
- `category`: `check_ins` | `giving` | `attendance` | `posts`
- `scope`: `church` | `global`
- `period`: `all_time` | `this_month` | `this_week`
- `limit`: 1-100 (default 10)

```json
{
  "entries": [
    { "rank": 1, "userId": "uuid", "fullName": "John Smith", "avatarUrl": "...", "value": 52 },
    { "rank": 2, "userId": "uuid", "fullName": "Sarah Jones", "avatarUrl": "...", "value": 48 }
  ],
  "myRank": 5,
  "myValue": 31
}
```

---

## 37. Workflows

Automation engine (church-specific Zapier). Tier-gated.

| Tier | Max Workflows | Max Nodes |
|------|--------------|-----------|
| Standard | 1 | 5 |
| Premium | 1 | 5 |
| Enterprise | Unlimited | Unlimited |

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/workflows/node-types` | JWT | Get node type palette for builder |
| GET | `/workflows` | JWT | List all workflows |
| POST | `/workflows` | JWT | Create workflow |
| GET | `/workflows/:id` | JWT | Get workflow with nodes/connections |
| PUT | `/workflows/:id` | JWT | Update workflow |
| DELETE | `/workflows/:id` | JWT | Delete workflow |
| PUT | `/workflows/:id/toggle` | JWT | Enable/disable workflow |
| POST | `/workflows/:id/trigger` | JWT | Manually trigger (test) |
| GET | `/workflows/:id/executions` | JWT | List executions (`?status=&cursor=`) |
| GET | `/workflows/executions/:executionId` | JWT | Get execution with logs |
| POST | `/workflows/executions/:executionId/cancel` | JWT | Cancel execution |
| POST | `/workflows/generate` | JWT (Enterprise) | AI-generate from prompt |

### POST /workflows/generate (Enterprise only)
```json
// Request
{ "prompt": "When a new member joins, wait 3 days, then send a welcome email" }

// Response 201
{ "id": "uuid", "name": "AI-generated workflow", "nodes": [...], "connections": [...] }
```

---

## 38. Workflow Marketplace

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/workflow-store` | PUBLIC | Browse templates (`?category=&search=&sort=&official=`) |
| GET | `/workflow-store/categories` | PUBLIC | List categories |
| GET | `/workflow-store/:id` | PUBLIC | Template detail |
| GET | `/workflow-store/my/published` | JWT | My published templates |
| GET | `/workflow-store/my/installed` | JWT | My installed templates |
| POST | `/workflow-store/publish` | JWT | Publish workflow as template |
| DELETE | `/workflow-store/:id/unpublish` | JWT | Unpublish template |
| POST | `/workflow-store/:id/install` | JWT | Install template (creates workflow) |
| POST | `/workflow-store/:id/rate` | JWT | Rate template (1-5 stars) |
| POST | `/workflow-store/seed-official` | PUBLIC | Seed 22 official templates (call once) |

---

## 39. AI Assistant

**Requires Premium or Enterprise tier.** Returns 403 on Standard.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/assistant/ask` | JWT (Premium+) | Natural language query |

### POST /assistant/ask
```json
// Request
{ "query": "How many new members joined this month?" }

// Response 200
{
  "query": "How many new members joined this month?",
  "summary": "18 new members joined this month, a 12% increase from last month.",
  "results": [{ "metric": "new_members", "value": 18, "comparison": "+12%" }],
  "resultCount": 1,
  "suggestions": ["Show me the top referral sources", "Compare with last quarter"]
}
```

---

## 40. Feedback & Requests

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/feedback` | JWT | List feedback (`?type=node_request\|bug_report\|feature_request`) |
| POST | `/feedback` | JWT | Submit feedback |
| PATCH | `/feedback/:id` | JWT (admin) | Update status |
| DELETE | `/feedback/:id` | JWT (admin) | Delete feedback |

### POST /feedback
```json
{
  "type": "feature_request",
  "title": "Add calendar sync",
  "description": "Would love Google Calendar integration"
}
```

---

## 41. Family Tree

Bidirectional family connections between church members. Every connection is stored as **two rows** (A->B and B->A). Labels are auto-resolved from the target's gender. An inference engine auto-creates in-law, shared-child, and sibling links when connections are accepted.

### Auto-Inference Rules (Critical)

1. **Spouse + Child = Both Parents' Child** — If A and B are spouses and A has children, those children auto-link to B too
2. **Spouse + Parent = In-Law** — A's parents become B's parents-in-law (and vice versa)
3. **Spouse + Sibling = Sibling-in-Law** — A's siblings become B's siblings-in-law
4. **Spouse + Cousin = Cousin-in-Law** — Same pattern
5. **Parent + Existing Children = Siblings** — If A sets P as parent and P already has children X/Y, then A becomes siblings with X/Y

All inferred connections are created with `isInferred: true`, `status: "accepted"` (no approval needed).

### Relationship Enum Values

`spouse`, `child`, `parent`, `sibling`, `grandparent`, `grandchild`, `uncle_aunt`, `nephew_niece`, `cousin`, `parent_in_law`, `child_in_law`, `sibling_in_law`, `cousin_in_law`

### Label Resolution (based on target's gender)

| Relationship | Male | Female | Unknown |
|---|---|---|---|
| spouse | Husband | Wife | Spouse |
| parent | Father | Mother | Parent |
| child | Son | Daughter | Child |
| sibling | Brother | Sister | Sibling |
| grandparent | Grandfather | Grandmother | Grandparent |
| grandchild | Grandson | Granddaughter | Grandchild |
| uncle_aunt | Uncle | Aunt | Uncle/Aunt |
| nephew_niece | Nephew | Niece | Nephew/Niece |
| cousin | Cousin | Cousin | Cousin |
| parent_in_law | Father-in-Law | Mother-in-Law | Parent-in-Law |
| child_in_law | Son-in-Law | Daughter-in-Law | Child-in-Law |
| sibling_in_law | Brother-in-Law | Sister-in-Law | Sibling-in-Law |
| cousin_in_law | Cousin-in-Law | Cousin-in-Law | Cousin-in-Law |

### Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/family/:userId/tree` | JWT | Structured family tree |
| GET | `/family/:userId` | JWT | Flat list of all connections |
| POST | `/family/request` | JWT | Send connection request |
| GET | `/family/requests` | JWT | Pending requests (sent + received) |
| POST | `/family/requests/:id/accept` | JWT | Accept (triggers inference engine) |
| POST | `/family/requests/:id/decline` | JWT | Decline request |
| DELETE | `/family/:userId/:familyMemberId` | JWT | Remove connection (cascades inferred) |

### POST /family/request

```json
// Request
{ "targetUserId": "uuid", "relationship": "spouse" }

// Response 201
{
  "id": "uuid",
  "userId": "requester-uuid",
  "relatedUserId": "target-uuid",
  "relationship": "spouse",
  "relationshipLabel": "Wife",
  "status": "pending",
  "isInferred": false,
  "createdAt": "2026-04-09T..."
}
```
> Notification sent to target: "David Johnson wants to add you as their Wife"

### GET /family/requests

```json
[
  {
    "id": "request-uuid",
    "userId": "requester-uuid",
    "userName": "David Johnson",
    "userAvatar": "https://...",
    "relatedUserId": "target-uuid",
    "relatedUserName": "Sarah Johnson",
    "relatedUserAvatar": "https://...",
    "relationship": "spouse",
    "relationshipLabel": "Wife",
    "status": "pending",
    "direction": "received",
    "createdAt": "2026-04-09T..."
  }
]
```

### POST /family/requests/:id/accept

No request body needed. Returns `{ "status": "accepted" }`.
Triggers:
1. Forward row updated to `accepted`
2. Reverse row created (B->A with inverse relationship + gender-resolved label)
3. Inference engine runs all 5 rules
4. Notification sent to requester: "Sarah Johnson accepted your family request (Wife)"

### POST /family/requests/:id/decline

No request body needed. Returns `{ "status": "declined" }`.

### GET /family/:userId/tree (Structured Tree)

```json
{
  "rootUser": {
    "userId": "uuid",
    "fullName": "David Johnson",
    "avatarUrl": "...",
    "gender": "male"
  },
  "spouse": {
    "userId": "uuid",
    "fullName": "Sarah Johnson",
    "relationship": "spouse",
    "relationshipLabel": "Wife",
    "status": "accepted",
    "isInferred": false
  },
  "children": [
    { "userId": "...", "fullName": "Timmy Johnson", "relationship": "child", "relationshipLabel": "Son", "status": "accepted", "isInferred": false }
  ],
  "parents": [
    { "userId": "...", "fullName": "Mary Johnson", "relationship": "parent", "relationshipLabel": "Mother", "status": "accepted", "isInferred": false },
    { "userId": "...", "fullName": "Robert Smith", "relationship": "parent_in_law", "relationshipLabel": "Father-in-Law", "status": "accepted", "isInferred": true }
  ],
  "siblings": [
    { "userId": "...", "fullName": "James Smith", "relationship": "sibling_in_law", "relationshipLabel": "Brother-in-Law", "status": "accepted", "isInferred": true }
  ],
  "grandparents": [],
  "grandchildren": [],
  "extended": []
}
```

### GET /family/:userId (Flat List)

```json
[
  { "userId": "...", "fullName": "Sarah Johnson", "avatarUrl": "...", "relationship": "spouse", "relationshipLabel": "Wife", "status": "accepted", "isInferred": false },
  { "userId": "...", "fullName": "Mary Johnson", "avatarUrl": "...", "relationship": "parent", "relationshipLabel": "Mother", "status": "accepted", "isInferred": false },
  { "userId": "...", "fullName": "Robert Smith", "avatarUrl": "...", "relationship": "parent_in_law", "relationshipLabel": "Father-in-Law", "status": "accepted", "isInferred": true }
]
```

### DELETE /family/:userId/:familyMemberId

Deletes both directions of the connection + all inferred links that were triggered by it. Returns **204 No Content**.

### Member Profile Integration

`GET /members/:userId/profile` now includes a `family` array in the response:

```json
{
  "personalInfo": { ... },
  "family": [
    { "userId": "uuid", "fullName": "Sarah Johnson", "avatarUrl": "...", "relationship": "spouse", "relationshipLabel": "Wife", "isInferred": false },
    { "userId": "uuid", "fullName": "Timmy Johnson", "avatarUrl": "...", "relationship": "child", "relationshipLabel": "Son", "isInferred": false }
  ]
}
```

### Notification Templates

**Request sent:**
```
title: "Family Connection Request"
body: "{fromUserName} wants to add you as their {relationshipLabel}"
type: "family_request"
actionUrl: "/family/requests"
```

**Request accepted:**
```
title: "Family Connection Accepted"
body: "{targetUserName} accepted your family request ({relationshipLabel})"
type: "family_accepted"
```

### UI Recommendations

**Admin Dashboard — Member Profile:**
- "Family Tree" tab with tree visualization (react-d3-tree or react-flow)
- Spouse on same row, parents above, children below, extended on sides
- Color-code: blue=spouse, green=children, orange=parents, gray=in-laws
- Dashed borders for inferred connections, solid for manual
- Click any node to navigate to that member's profile

**Mobile — Member Profile:**
- "Family" section with avatar circles + relationship labels
- "Add Family" button: search member -> pick relationship from dropdown (13 options) -> send
- Pending requests in notification bell with Accept/Decline buttons

---

## 42. Media Uploads

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/media/presigned-url` | JWT | Get pre-signed S3 upload URL (5 min expiry) |

```json
// Request
{ "fileName": "photo.jpg", "contentType": "image/jpeg" }

// Response
{ "uploadUrl": "https://s3.amazonaws.com/...", "publicUrl": "https://..." }
```

> **Flow:** Get presigned URL -> upload file directly to S3 -> use `publicUrl` in post/story/profile.

---

## 43. Health Checks

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/health` | PUBLIC | Liveness probe |
| GET | `/health/ready` | PUBLIC | Readiness probe (checks DB) |

---

## 44. Global Feed (GraphQL)

The global feed uses GraphQL, not REST.

```graphql
query {
  globalFeed(limit: 20, offset: 0) {
    id
    content
    mediaUrl
    mediaType
    authorId
    authorName
    authorAvatar
    likesCount
    commentsCount
    createdAt
  }
}
```

**Endpoint:** `POST /graphql` with `Authorization: Bearer <jwt>`

---

## 45. Tier Feature Gating

Call `GET /api/tenants/:id/features` on app launch and use the response to show/hide features.

| Feature | Standard ($29/mo) | Premium ($79/mo) | Enterprise ($199/mo) |
|---------|-------------------|-------------------|----------------------|
| Mobile App | Yes | Yes | Yes |
| Internal Feed | Yes | Yes | Yes |
| Global Feed | Yes | Yes | Yes |
| Video Posts | No | Yes | Yes |
| Search | No | Yes | Yes |
| Push Notifications | No | Yes | Yes |
| Chat | No | Yes | Yes |
| Video Uploads | No | Yes | Yes |
| Granular Roles | No | Yes | Yes |
| AI Assistant | No | Yes | Yes |
| Workflows | 1 / 5 nodes | 1 / 5 nodes | Unlimited |
| AI Workflow Generation | No | No | Yes |
| Custom Branding | No | No | Yes |
| Multi-Site | No | No | Yes |
| API Access | No | No | Yes |
| Transaction Fee | 1.3% | 1.0% | 0.5% |
| Storage | 10 GB | 100 GB | Unlimited |
| Max Admin Users | 5 | Unlimited | Unlimited |

### How to gate features in the frontend:

```typescript
// On app load
const features = await api.get(`/tenants/${tenantId}/features`);

// Then conditionally render
if (features.chat) { showChatTab(); }
if (features.aiAssistant) { showAssistantButton(); }
if (features.workflows) { showWorkflowsPage(); }
if (!features.videoPostsAllowed) { disableVideoButton(); showUpsellBanner("Premium"); }
```

---

## 46. Pagination Patterns

### Cursor-Based (most endpoints)
```
GET /api/posts?limit=20&cursor=eyJ...
```
```json
{
  "items": [...],
  "nextCursor": "eyJ..."   // null when no more pages
}
```
> Pass `nextCursor` as `cursor` in the next request. Stop when `nextCursor` is null.

### Offset-Based (GraphQL only)
```graphql
globalFeed(limit: 20, offset: 0)
```

---

## 47. Error Format

All errors follow this shape:

```json
{
  "statusCode": 400,
  "message": "Validation failed",
  "error": "Bad Request"
}
```

| Code | Meaning |
|------|---------|
| 400 | Validation error or bad request |
| 401 | Missing or invalid JWT |
| 403 | Insufficient permissions or tier too low |
| 404 | Resource not found |
| 409 | Conflict (duplicate) |
| 429 | Rate limited (100 req/min default, 5 req/min for auth) |
| 500 | Server error |

For tier-gated 403 errors:
```json
{
  "statusCode": 403,
  "message": "This feature requires Premium tier or higher",
  "error": "Forbidden"
}
```

---

## Webhook Endpoints (Backend-to-Backend, not for frontend)

These are signature-verified endpoints called by external services, not by your frontend:

| Method | Path | Source |
|--------|------|--------|
| POST | `/webhooks/stripe` | Stripe payment events |
| POST | `/webhooks/mux` | Mux video processing events |
| POST | `/webhooks/workflows/:workflowId` | Inbound workflow triggers |

---

## Quick Reference: Which Team Needs What

### Mobile App (React Native)
- Auth (signup/login/refresh/forgot-password)
- Tenants (public list for church picker, features for gating)
- Posts, Comments, Stories, Follows, Notifications
- Events, Groups, Prayers, Chat
- Sermons, Announcements
- Giving (donate, transactions, recurring)
- Attendance (check-in, geo check-in)
- Gallery, Search
- Badges (progress, check, leaderboard)
- Leaderboard (ranks, app-open, visibility)
- Media (presigned-url for uploads)
- Onboarding (public form during signup)
- Family (add family, pending requests, direct family list)
- User settings, streak
- Global Feed (GraphQL)

### Admin Dashboard (Next.js)
- Auth (login/session/switch-tenant)
- Dashboard KPIs + charts
- Members (list, KPIs, export, roles, permissions)
- Member Profiles (360-degree view with onboarding data + family tree)
- Onboarding Forms (field library, form builder, responses, stats)
- Events (full CRUD + attendees)
- Groups (full CRUD + members)
- Sermons (full CRUD + engagement)
- Announcements (create + list)
- Giving (KPIs, donors, funds, transactions)
- Attendance (services, roster, bulk check-in, KPIs, visitors)
- Volunteers (KPIs, schedule, opportunities, hours)
- Care Cases (full CRUD + timeline + notes + KPIs)
- Tasks (full CRUD + KPIs)
- Facilities (rooms, bookings, availability)
- Tags (full CRUD + member assignment)
- Communications (segments, templates, send, schedule, history, analytics)
- Reports (YoY, funnel, engagement, giving-by-fund, KPIs, export)
- Moderation (reports, approve, remove)
- Invitations (list, send)
- Badges (full CRUD, award, revoke)
- Leaderboard (status toggle, geo check-in config)
- Workflows (full CRUD, trigger, executions, generate)
- Workflow Marketplace (browse, publish, install, rate)
- AI Assistant (ask)
- Feedback (list, status update, delete)
- Family Tree (full tree visualization, relationship management)
- Stripe Connect (onboard, status)
