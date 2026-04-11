# Multi-Site / Multi-Campus — Backend Endpoints for Frontend Teams

> **Date:** April 10, 2026
> **From:** Backend Team
> **For:** Admin Dashboard (Next.js) + Mobile App (React Native)
> **Tier:** Enterprise only (`multiSite: true` in feature flags)

---

## Overview

Churches with multiple locations (campuses) can now manage all of them from one organization. Each campus is its own tenant linked to a parent via `parent_tenant_id`. The existing tenant switcher doubles as the **campus switcher** — switching campuses is the same as switching tenants.

### Key Concepts

- **Parent Organization** — The original church tenant. Has `parent_tenant_id = null`.
- **Campus** — A child tenant with `parent_tenant_id` pointing to the parent.
- **Campus Switching** — Uses the existing `POST /api/auth/switch-tenant` flow. Each campus is a tenant.
- **"All" View** — Aggregated data across all campuses. Uses the `/campuses/analytics`, `/campuses/members`, and `/campuses/feed` endpoints.
- **Feed Isolation** — Admin toggle. When OFF (default), congregation sees posts from all campuses. When ON, each campus feed is isolated.

---

## How It Works

### 1. Feature Flag Bootstrap

On login, the `GET /api/tenants/:id/features` response now includes a `campus` block when multi-site is active:

```json
{
  "tenant": {
    "id": "uuid",
    "name": "New Birth Church - 10th Street",
    "slug": "new-birth-10th",
    "tier": "enterprise",
    "tierDisplayName": "Enterprise",
    "campusName": "10th Street Campus",
    "parentTenantId": "parent-uuid"
  },
  "features": {
    "multiSite": true,
    "...": "..."
  },
  "campus": {
    "isMultiSite": true,
    "currentCampusId": "campus-uuid",
    "currentCampusName": "10th Street Campus",
    "parentOrganizationId": "parent-uuid",
    "feedIsolation": false,
    "campuses": [
      { "id": "parent-uuid", "name": "New Birth Church", "campusName": null, "isParent": true },
      { "id": "campus-1-uuid", "name": "New Birth Church - 10th Street", "campusName": "10th Street Campus", "isParent": false },
      { "id": "campus-2-uuid", "name": "New Birth Church - Westside", "campusName": "Westside Campus", "isParent": false }
    ]
  }
}
```

**Frontend logic:**
- If `features.multiSite === false` → standard single-church UI, no changes
- If `campus` block exists → show the campus switcher dropdown + "All" option

### 2. Memberships Response (Updated)

`GET /api/memberships` now returns `campusName` and `parentTenantId` per membership:

```json
[
  {
    "userId": "uuid",
    "tenantId": "parent-uuid",
    "role": "admin",
    "isCurrent": false,
    "tenant": {
      "id": "parent-uuid",
      "name": "New Birth Church",
      "tier": "enterprise",
      "slug": "new-birth",
      "createdAt": "...",
      "campusName": null,
      "parentTenantId": null
    }
  },
  {
    "userId": "uuid",
    "tenantId": "campus-1-uuid",
    "role": "admin",
    "isCurrent": true,
    "tenant": {
      "id": "campus-1-uuid",
      "name": "New Birth Church - 10th Street",
      "tier": "enterprise",
      "slug": "new-birth-10th",
      "createdAt": "...",
      "campusName": "10th Street Campus",
      "parentTenantId": "parent-uuid"
    }
  }
]
```

Use `parentTenantId` to group memberships by organization in the UI.

---

## 3. New Endpoints

### POST /api/tenants/:tenantId/campuses — Create a campus

```json
// Request
{
  "campusName": "Westside Campus",
  "name": "New Birth Church - Westside",   // optional, defaults to "OrgName - CampusName"
  "slug": "new-birth-westside",            // optional
  "address": "456 West Ave",
  "city": "Atlanta",
  "state": "GA",
  "zip": "30301",
  "latitude": 33.749,
  "longitude": -84.388
}

// Response 201
{
  "id": "new-campus-uuid",
  "name": "New Birth Church - Westside",
  "campusName": "Westside Campus",
  "slug": "new-birth-westside",
  "parentTenantId": "parent-uuid",
  "address": "456 West Ave",
  "city": "Atlanta",
  "state": "GA",
  "zip": "30301",
  "latitude": 33.749,
  "longitude": -84.388,
  "createdAt": "2026-04-10T..."
}
```

- The creating admin is automatically added to the new campus as admin.
- The new campus inherits the parent's tier and Stripe account.

### GET /api/tenants/:tenantId/campuses — List all campuses

```json
{
  "organizationId": "parent-uuid",
  "campuses": [
    {
      "id": "parent-uuid",
      "name": "New Birth Church",
      "campusName": null,
      "slug": "new-birth",
      "isParent": true,
      "address": "123 Main St",
      "city": "Atlanta",
      "state": "GA",
      "zip": "30301",
      "latitude": 33.749,
      "longitude": -84.388,
      "feedIsolation": false,
      "memberCount": 245,
      "createdAt": "..."
    },
    {
      "id": "campus-1-uuid",
      "name": "New Birth Church - 10th Street",
      "campusName": "10th Street Campus",
      "slug": "new-birth-10th",
      "isParent": false,
      "address": "789 10th St",
      "city": "Atlanta",
      "state": "GA",
      "zip": "30302",
      "latitude": 33.755,
      "longitude": -84.392,
      "feedIsolation": false,
      "memberCount": 120,
      "createdAt": "..."
    }
  ]
}
```

### PATCH /api/tenants/:tenantId/campuses/:campusId — Update campus

```json
// Request — update details
{
  "campusName": "East 10th Street Campus",
  "address": "789 E 10th St"
}

// Request — toggle feed isolation (parent org only!)
{
  "feedIsolation": true
}

// Response 200
{
  "id": "campus-uuid",
  "name": "New Birth Church - East 10th Street",
  "campusName": "East 10th Street Campus",
  "slug": "new-birth-10th",
  "parentTenantId": "parent-uuid",
  "address": "789 E 10th St",
  "city": "Atlanta",
  "state": "GA",
  "zip": "30302",
  "latitude": 33.755,
  "longitude": -84.392,
  "feedIsolation": false
}
```

**Note:** `feedIsolation` can only be set on the parent organization tenant, not on individual campuses. The backend returns 400 if you try to set it on a child campus.

---

## 4. Cross-Campus Aggregation Endpoints ("All" View)

These endpoints aggregate data across ALL campuses in the organization.

### GET /api/tenants/:tenantId/campuses/analytics?range=30d

```json
{
  "organizationTenantIds": ["parent-uuid", "campus-1-uuid", "campus-2-uuid"],
  "totalMembers": 487,
  "newMembers": [
    { "date": "2026-04-01", "count": 3 },
    { "date": "2026-04-02", "count": 1 }
  ],
  "totalGiving": 45230.00,
  "givingTrends": [
    { "date": "2026-04-01", "amount": 1520.00 },
    { "date": "2026-04-02", "amount": 890.00 }
  ],
  "campusBreakdown": [
    {
      "campusId": "parent-uuid",
      "campusName": "New Birth Church",
      "isParent": true,
      "memberCount": 245,
      "givingTotal": 28500.00,
      "checkinCount": 890
    },
    {
      "campusId": "campus-1-uuid",
      "campusName": "10th Street Campus",
      "isParent": false,
      "memberCount": 120,
      "givingTotal": 10230.00,
      "checkinCount": 430
    },
    {
      "campusId": "campus-2-uuid",
      "campusName": "Westside Campus",
      "isParent": false,
      "memberCount": 122,
      "givingTotal": 6500.00,
      "checkinCount": 320
    }
  ]
}
```

### GET /api/tenants/:tenantId/campuses/members?cursor=&limit=20

De-duplicated member list across all campuses:

```json
{
  "members": [
    {
      "id": "user-uuid",
      "email": "marcus@example.com",
      "fullName": "Marcus Johnson",
      "avatarUrl": "https://...",
      "role": "admin",
      "campusId": "campus-1-uuid",
      "campusName": "10th Street Campus",
      "joinedAt": "2026-01-15T..."
    }
  ],
  "nextCursor": "uuid-or-null"
}
```

### GET /api/tenants/:tenantId/campuses/feed?limit=20&offset=0

Cross-campus social feed (respects `feedIsolation` toggle):

```json
{
  "posts": [
    {
      "id": "post-uuid",
      "tenantId": "campus-1-uuid",
      "authorId": "user-uuid",
      "content": "Great sermon today!",
      "mediaType": "text",
      "mediaUrl": null,
      "videoMuxPlaybackId": null,
      "visibility": "public",
      "createdAt": "2026-04-10T...",
      "updatedAt": "2026-04-10T...",
      "campusName": "10th Street Campus",
      "author": {
        "id": "user-uuid",
        "email": "marcus@example.com",
        "fullName": "Marcus Johnson",
        "avatarUrl": "https://..."
      },
      "likeCount": 12,
      "commentCount": 3,
      "isLikedByMe": false,
      "isSavedByMe": false
    }
  ],
  "total": 156,
  "limit": 20,
  "offset": 0
}
```

Each post includes `campusName` so you can show a campus badge on the post card (e.g., "10th Street Campus").

---

## 5. Recommended UI

### Admin Dashboard — Campus Switcher

```
┌────────────────────────────────────────────────┐
│  ┌──────────────────────────────────────────┐  │
│  │ ▾ 10th Street Campus                    │  │
│  ├──────────────────────────────────────────┤  │
│  │   ★ All Campuses                        │  │
│  │   ─────────────────────────────────────  │  │
│  │   ● New Birth Church (HQ)     245 mbrs  │  │
│  │   ○ 10th Street Campus        120 mbrs  │  │
│  │   ○ Westside Campus           122 mbrs  │  │
│  │   ─────────────────────────────────────  │  │
│  │   + Add New Campus                       │  │
│  └──────────────────────────────────────────┘  │
│                                                │
│  When user selects a specific campus:          │
│    → Call POST /api/auth/switch-tenant         │
│      with that campus's tenant ID              │
│    → All existing dashboard pages work as-is   │
│      (members, giving, events, etc.)           │
│                                                │
│  When user selects "All Campuses":             │
│    → Use the /campuses/analytics endpoint      │
│    → Use the /campuses/members endpoint        │
│    → Show per-campus breakdown cards           │
└────────────────────────────────────────────────┘
```

### Admin Dashboard — "All Campuses" Dashboard

```
┌──────────────────────────────────────────────────┐
│  All Campuses Overview                           │
│                                                  │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐        │
│  │ 487      │ │ $45,230  │ │ 1,640    │        │
│  │ Members  │ │ Giving   │ │ Check-ins│        │
│  │ Total    │ │ This Mo. │ │ This Mo. │        │
│  └──────────┘ └──────────┘ └──────────┘        │
│                                                  │
│  Campus Breakdown:                               │
│  ┌────────────────┬────────┬─────────┬────────┐ │
│  │ Campus         │Members │ Giving  │Checkins│ │
│  ├────────────────┼────────┼─────────┼────────┤ │
│  │ HQ (Main)      │  245   │ $28,500 │  890   │ │
│  │ 10th Street    │  120   │ $10,230 │  430   │ │
│  │ Westside       │  122   │ $6,500  │  320   │ │
│  └────────────────┴────────┴─────────┴────────┘ │
│                                                  │
│  [New Members Chart - All Campuses Combined]     │
│  [Giving Trends Chart - All Campuses Combined]   │
└──────────────────────────────────────────────────┘
```

### Admin Dashboard — Campus Management

```
┌──────────────────────────────────────────────────┐
│  Campus Management                    [+ Add]    │
│                                                  │
│  ┌──────────────────────────────────────────────┐│
│  │ New Birth Church (Headquarters)              ││
│  │ 123 Main St, Atlanta, GA 30301              ││
│  │ 245 members                        [Edit]   ││
│  ├──────────────────────────────────────────────┤│
│  │ 10th Street Campus                           ││
│  │ 789 10th St, Atlanta, GA 30302              ││
│  │ 120 members                        [Edit]   ││
│  ├──────────────────────────────────────────────┤│
│  │ Westside Campus                              ││
│  │ 456 West Ave, Atlanta, GA 30303             ││
│  │ 122 members                        [Edit]   ││
│  └──────────────────────────────────────────────┘│
│                                                  │
│  Feed Settings (Organization-wide):              │
│  ┌──────────────────────────────────────────────┐│
│  │ Feed Isolation  [○ OFF / ● ON]               ││
│  │                                              ││
│  │ OFF: Members see posts from all campuses     ││
│  │ ON:  Members only see posts from their       ││
│  │      own campus                              ││
│  └──────────────────────────────────────────────┘│
└──────────────────────────────────────────────────┘
```

### Mobile App — Feed with Campus Badges

```
┌──────────────────────────────────┐
│  My Church Feed                  │
│                                  │
│  ┌────────────────────────────┐  │
│  │ Marcus Johnson             │  │
│  │ 📍 10th Street Campus     │  │
│  │                            │  │
│  │ Great sermon today!        │  │
│  │ ❤ 12  💬 3               │  │
│  └────────────────────────────┘  │
│                                  │
│  ┌────────────────────────────┐  │
│  │ Sarah Williams             │  │
│  │ 📍 Westside Campus        │  │
│  │                            │  │
│  │ Praying for our community  │  │
│  │ ❤ 8   💬 1               │  │
│  └────────────────────────────┘  │
│                                  │
│  (When feed_isolation is OFF,    │
│   posts from ALL campuses show.  │
│   When ON, only own campus.)     │
└──────────────────────────────────┘
```

---

## 6. Implementation Guide

### Campus Switching (Both Teams)

Campus switching uses the **existing tenant switcher**. Each campus is a tenant.

```
1. User picks a campus from the dropdown
2. Call: POST /api/auth/switch-tenant { tenantId: "campus-uuid" }
3. Call: supabase.auth.refreshSession() to get updated JWT
4. All subsequent API calls now scope to that campus
5. Everything works — members, giving, events, check-in, etc.
```

### "All Campuses" Mode (Admin Dashboard Only)

When the admin selects "All Campuses":
- **Don't switch tenants** — stay on the current campus context
- Call the `/campuses/analytics` endpoint for aggregated KPIs
- Call the `/campuses/members` endpoint for the combined member list
- Call the `/campuses/feed` endpoint for the cross-campus feed
- The regular per-campus endpoints continue to work for drill-down

### Conditional UI (Both Teams)

```typescript
// On login, check the features endpoint
const { features, campus } = await api.get(`/tenants/${tenantId}/features`);

if (features.multiSite && campus?.isMultiSite) {
  // Show campus switcher dropdown
  // Show "All Campuses" option
  // Show campus badges on feed posts
  // Show campus management page (admin only)
} else {
  // Standard single-church UI — no changes needed
}
```

### Feed Isolation for Mobile App

```typescript
// When fetching the internal feed:
if (campus?.isMultiSite && !campus.feedIsolation) {
  // Use the cross-campus feed endpoint
  const feed = await api.get(`/tenants/${tenantId}/campuses/feed?limit=20`);
  // Each post has a campusName — show it as a badge
} else {
  // Use the regular feed endpoint (existing)
  const feed = await api.get(`/posts?limit=20`);
}
```

---

## 7. New Endpoints Summary

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/tenants/:tenantId/campuses` | JWT + Enterprise | Create a new campus |
| GET | `/tenants/:tenantId/campuses` | JWT + Enterprise | List all campuses in org |
| PATCH | `/tenants/:tenantId/campuses/:campusId` | JWT + Enterprise | Update campus details |
| GET | `/tenants/:tenantId/campuses/analytics?range=` | JWT + Enterprise | Cross-campus aggregated KPIs |
| GET | `/tenants/:tenantId/campuses/members?cursor=&limit=` | JWT + Enterprise | Cross-campus member list |
| GET | `/tenants/:tenantId/campuses/feed?limit=&offset=` | JWT + Enterprise | Cross-campus social feed |

### Updated Existing Endpoints

| Endpoint | Change |
|----------|--------|
| `GET /tenants/:id/features` | Now returns `campus` block with campus list |
| `GET /memberships` | Now returns `campusName` and `parentTenantId` per membership |

---

## 8. Checklist

### Admin Dashboard
- [ ] Add campus switcher dropdown (above or replacing current tenant switcher)
- [ ] Add "All Campuses" option that shows aggregated dashboard
- [ ] Build campus management page (list, create, edit campuses)
- [ ] Add feed isolation toggle on campus management page (parent org only)
- [ ] Show per-campus breakdown cards on "All Campuses" dashboard
- [ ] Show campus badge on posts in cross-campus feed
- [ ] Only show multi-site UI when `features.multiSite === true`

### Mobile App
- [ ] Show campus name badge on feed posts when multi-site is active
- [ ] Use cross-campus feed endpoint when `feedIsolation === false`
- [ ] Group memberships by organization in the tenant/church switcher
- [ ] Only show multi-site elements when `features.multiSite === true`
