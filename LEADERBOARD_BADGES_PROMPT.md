# Leaderboard, Badges & Geo Check-In — Admin Dashboard Frontend Prompt

## Overview

The backend has three interconnected systems the admin dashboard needs to integrate:

1. **Leaderboard** — church + global rankings with admin toggle
2. **Badge System** — achievements with progress tracking and auto-awards
3. **Geo-Fenced Check-In** — GPS-based Sunday attendance

**Backend API:** `https://church-app-backend-27hc.onrender.com/api`

---

## Part 1: Leaderboard Management

### Admin Toggle (Settings Page)

The admin can enable/disable leaderboards for their entire church.

```
GET /api/leaderboard/status
→ { "enabled": true }

PUT /api/leaderboard/status
{ "enabled": false }
→ { "enabled": false }
```

**When disabled:**
- No member of this church appears on ANY leaderboard (church or global)
- Members see: "Your church administration has disabled leaderboards"
- The toggle is a simple on/off switch in church settings

**UI:** Toggle switch in Settings → Church Settings with a warning: "Disabling leaderboards removes all your members from church and global rankings."

---

### Leaderboard View

```
GET /api/leaderboard?category=giving&scope=church&period=this_month&limit=50
→ {
    "category": "giving",
    "scope": "church",
    "period": "this_month",
    "entries": [
      {
        "rank": 1,
        "userId": "uuid",
        "fullName": "Sarah Johnson",
        "avatarUrl": "https://...",
        "churchName": "Grace Community",
        "value": 2500,
        "label": "$2,500"
      }
    ],
    "myRank": 7,
    "myValue": 840
  }
```

**Categories (4 tabs):**

| Category | What It Measures | Label Format |
|----------|-----------------|-------------|
| `check_ins` | Daily app opens (distinct days) | "142 check-ins" |
| `giving` | Total donation amount | "$5,200" |
| `attendance` | Service check-ins (geo + manual) | "48 Sundays" |
| `posts` | Posts created | "87 posts" |

**Scopes (2 sub-tabs):**
- `church` — only members of this church
- `global` — all users across all churches (includes `churchName`)

**Periods (3 filter buttons):**
- `all_time` — lifetime
- `this_month` — current calendar month
- `this_week` — current calendar week

**`myRank` + `myValue`** — always included even if the user is outside the top 50. Show at the bottom: "Your rank: #7 ($840)"

### Leaderboard Layout

```
┌──────────────────────────────────────────────────┐
│ Leaderboard                    [Church] [Global]  │
├──────────────────────────────────────────────────┤
│ [Check-ins] [Giving] [Attendance] [Posts]         │
│ [All Time] [This Month] [This Week]               │
├──────────────────────────────────────────────────┤
│  🥇  Sarah Johnson         $2,500                 │
│  🥈  Michael Chen          $1,800                 │
│  🥉  Emily Davis           $1,200                 │
│  4.  James Wilson           $950                  │
│  5.  Rachel Kim             $820                  │
│  ...                                              │
├──────────────────────────────────────────────────┤
│  Your rank: #7  •  $840                           │
└──────────────────────────────────────────────────┘
```

### Member Rank Badges (for profile pages)

```
GET /api/leaderboard/user/:userId/ranks
→ [
    { "category": "giving", "scope": "church", "rank": 3, "value": 5200, "label": "$5,200" },
    { "category": "attendance", "scope": "global", "rank": 7, "value": 48, "label": "48 Sundays" }
  ]
```

Only returns entries where `rank <= 10`. Display as small pills on the member profile:
`🏆 #3 Giving` `🌍 #7 Attendance`

**Shortcut for current user:**
```
GET /api/leaderboard/my-ranks
```
Same response — use on the user's own profile.

### App Open Tracking

```
POST /api/leaderboard/app-open
→ 204 No Content
```

Call this once when the admin dashboard loads (fire-and-forget). Tracks daily active usage for the "check-ins" leaderboard category.

### User Visibility Toggle

```
PUT /api/leaderboard/visibility
{ "visible": false }
```

Members can opt out of appearing on leaderboards. Show this in member settings as "Show me on leaderboards" toggle.

---

## Part 2: Badge System

### Badge Management (Admin Page)

#### List All Badges
```
GET /api/badges
→ [
    {
      "id": "uuid",
      "name": "Generous Giver",
      "description": "Given $1,000 lifetime",
      "icon": "heart",
      "color": "#10b981",
      "tier": "gold",
      "category": "giving",
      "autoAwardRule": { "type": "giving_lifetime", "threshold": 1000 },
      "isActive": true,
      "displayOrder": 1,
      "awardCount": 12,
      "createdAt": "..."
    }
  ]
```

#### Create Badge
```
POST /api/badges
{
  "name": "Faithful Giver",
  "description": "Given $500 lifetime to the church",
  "icon": "heart",
  "color": "#6366f1",
  "tier": "silver",
  "category": "giving",
  "autoAwardRule": { "type": "giving_lifetime", "threshold": 500 },
  "displayOrder": 2
}
```

**Tiers:** `bronze`, `silver`, `gold`, `platinum`, `diamond`
**Categories:** `giving`, `attendance`, `spiritual`, `service`, `engagement`, `custom`

**Auto-Award Rule Types (dropdown in create form):**

| Rule Type | Config Fields | Description |
|-----------|--------------|-------------|
| `giving_lifetime` | `threshold` (number) | Total giving exceeds $X |
| `giving_single` | `threshold` (number) | Single donation exceeds $X |
| `attendance_count` | `count` (number) | Total lifetime check-ins |
| `attendance_streak` | `days` (number) | Consecutive weeks attending |
| `baptized` | `value: true` | Member has been baptized |
| `members_class` | `value: true` | Completed members class |
| `group_count` | `min` (number) | Member of N+ groups |
| `volunteer_hours` | `min` (number) | Total volunteer hours |
| `post_count` | `min` (number) | Created N+ posts |
| `prayer_count` | `min` (number) | Submitted N+ prayer requests |

**Badge Create Form:**
```
┌──────────────────────────────────────────┐
│ Create Badge                             │
├──────────────────────────────────────────┤
│ Name:     [Faithful Giver            ]   │
│ Describe: [Given $500 lifetime       ]   │
│                                          │
│ Icon:     [heart ▾]  Color: [#6366f1 🎨] │
│ Tier:     [● Bronze ○ Silver ○ Gold ...] │
│ Category: [Giving ▾]                     │
│                                          │
│ Auto-Award Rule:                         │
│ When:     [Lifetime Giving ▾]            │
│ Reaches:  [$500                      ]   │
│                                          │
│           [Cancel]  [Create Badge]       │
└──────────────────────────────────────────┘
```

#### Update / Delete
```
PATCH /api/badges/:id { name?, color?, tier?, autoAwardRule?, isActive? }
DELETE /api/badges/:id
```

#### Manual Award
```
POST /api/badges/:id/award
{ "userIds": ["uuid1", "uuid2"], "reason": "Completed leadership training" }
```

Show a member picker dialog where admin selects members and adds an optional reason.

#### Revoke
```
DELETE /api/badges/:id/revoke/:userId
```

---

### Badge Progress (Member-Facing)

#### Current User's Progress
```
GET /api/badges/progress
→ {
    "memberId": "uuid",
    "totalBadgesEarned": 3,
    "totalBadgesAvailable": 8,
    "badges": [
      {
        "badge": {
          "id": "uuid",
          "name": "Faithful Giver",
          "description": "Given $500 lifetime",
          "icon": "heart",
          "color": "#6366f1",
          "tier": "silver",
          "category": "giving"
        },
        "isEarned": false,
        "progress": {
          "current": 320,
          "target": 500,
          "percent": 64,
          "unit": "dollars",
          "remaining": 180
        }
      }
    ]
  }
```

**Progress Bar Card:**
```
┌────────────────────────────────────────┐
│ 💰  Faithful Giver              SILVER │
│ Given $500 lifetime                    │
│ ████████████░░░░░░░░  64%             │
│ $320 / $500  •  $180 to go            │
└────────────────────────────────────────┘

┌────────────────────────────────────────┐
│ 💧  Baptized                     GOLD  │
│ Get baptized                     ✅    │
│ ████████████████████  100%            │
│ Earned!                                │
└────────────────────────────────────────┘
```

- Color the progress bar by tier: bronze=#CD7F32, silver=#C0C0C0, gold=#FFD700, platinum=#E5E4E2, diamond=#B9F2FF
- Show checkmark overlay when `isEarned: true`
- Sort: unearned closest-to-earning first, then earned

#### Check & Award (Celebration Trigger)
```
POST /api/badges/check
→ { "newlyEarned": [{ "badgeId": "uuid", "name": "Faithful Giver" }] }
```

**Call this after:** donations, check-ins, post creation, profile updates.

If `newlyEarned` has items → fire the celebration overlay:
- Confetti particles
- Badge icon with tier-colored glow
- "Badge Earned!" text with name + description
- Auto-dismiss after 4 seconds

#### User's Earned Badges (for profiles)
```
GET /api/badges/user/:userId
→ [{ "id": "...", "name": "Faithful Giver", "icon": "heart", "color": "#6366f1", "tier": "silver", "awardedAt": "..." }]
```

Display as circular icons with tier-colored borders in a horizontal scroll on profiles.

#### Leaderboard
```
GET /api/badges/leaderboard?limit=20
→ [{ "id": "uuid", "fullName": "Sarah Johnson", "avatarUrl": "...", "badgeCount": 7 }]
```

---

## Part 3: Geo-Fenced Check-In Configuration

### Admin Setup Page

```
GET /api/admin/check-in-config
→ {
    "enabled": true,
    "dayOfWeek": 0,
    "startTime": "09:00",
    "endTime": "12:00",
    "location": { "lat": 33.7490, "lng": -84.3880 },
    "radiusMeters": 800,
    "pushMessage": "Good morning! Tap to check in to today's service."
  }
```

```
PUT /api/admin/check-in-config
{
  "enabled": true,
  "dayOfWeek": 0,
  "startTime": "09:00",
  "endTime": "12:00",
  "lat": 33.7490,
  "lng": -84.3880,
  "radiusMeters": 800,
  "pushMessage": "Good morning! Tap to check in to today's service."
}
```

**Admin Config Form:**
```
┌──────────────────────────────────────────────┐
│ Geo Check-In Configuration                   │
├──────────────────────────────────────────────┤
│ Enable Geo Check-In:  [ON ●○ OFF]           │
│                                              │
│ Service Day:  [Sunday ▾]                     │
│ Window:       [09:00] to [12:00]             │
│                                              │
│ Church Location:                             │
│ ┌──────────────────────────────────┐         │
│ │                                  │         │
│ │      📍 (draggable pin)          │         │
│ │                                  │         │
│ │         [Map View]               │         │
│ │                                  │         │
│ └──────────────────────────────────┘         │
│ Lat: [33.7490]  Lng: [-84.3880]              │
│ Radius: [800] meters  (0.5 miles)            │
│                                              │
│ Push Message:                                │
│ [Good morning! Tap to check in...]           │
│                                              │
│              [Save Configuration]             │
└──────────────────────────────────────────────┘
```

**Day of week values:** 0=Sunday, 1=Monday, ... 6=Saturday

Use a map component (Google Maps or Mapbox) where the admin can:
1. Search for their church address
2. Drag a pin to the exact location
3. See a circle overlay showing the radius
4. Adjust the radius with a slider (50m - 5000m)

---

## Part 4: Complete API Reference

### Leaderboard

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/leaderboard/status` | Yes | Check if admin enabled leaderboards |
| PUT | `/leaderboard/status` | Yes | Admin toggle `{ enabled }` |
| GET | `/leaderboard` | Yes | Ranked list (query: category, scope, period, limit) |
| GET | `/leaderboard/my-ranks` | Yes | Current user's top-10 rankings |
| GET | `/leaderboard/user/:userId/ranks` | Yes | Any user's top-10 rankings |
| POST | `/leaderboard/app-open` | Yes | Record daily app open (204) |
| PUT | `/leaderboard/visibility` | Yes | User opt-in/out `{ visible }` |

### Badges

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/badges` | Yes | All badge definitions with award counts |
| POST | `/badges` | Yes | Create badge (admin) |
| PATCH | `/badges/:id` | Yes | Update badge (admin) |
| DELETE | `/badges/:id` | Yes | Delete badge (admin) |
| GET | `/badges/progress` | Yes | Current user's progress on all badges |
| GET | `/badges/user/:userId` | Yes | User's earned badges |
| POST | `/badges/check` | Yes | Check & auto-award (returns newlyEarned) |
| POST | `/badges/:id/award` | Yes | Bulk award `{ userIds, reason? }` |
| DELETE | `/badges/:id/revoke/:userId` | Yes | Revoke badge |
| GET | `/badges/leaderboard` | Yes | Top members by badge count |

### Geo Check-In

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/admin/check-in-config` | Yes | Get geo config |
| PUT | `/admin/check-in-config` | Yes | Set geo config (admin) |
| POST | `/attendance/geo-check-in` | Yes | Submit GPS coords for check-in |

---

## Part 5: Integration Points

### When to call `POST /badges/check`:
- After a donation succeeds
- After a check-in (manual or geo)
- After creating a post
- After completing a spiritual journey milestone
- After volunteering hours are logged
- The response triggers the celebration overlay if `newlyEarned.length > 0`

### When to call `POST /leaderboard/app-open`:
- Once per dashboard session load (fire-and-forget, 204)
- Don't await the response — it's just tracking

### Priority chain for leaderboard visibility:
```
1. GET /leaderboard/status → { enabled: false }
   → BLOCKED by admin. Show lock icon. No override.

2. GET /leaderboard/status → { enabled: true }
   → Check local user preference
   → If user hidden: show eye-off + "Open Settings"
   → If user visible: show full leaderboard
```
