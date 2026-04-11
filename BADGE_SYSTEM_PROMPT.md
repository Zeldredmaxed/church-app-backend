# Badge / Achievement System — Frontend Implementation Guide

> **Date:** April 11, 2026
> **From:** Backend Team
> **For:** Admin Dashboard (Next.js) + Mobile App (React Native)

---

## Overview

Shepard has a badge/achievement system where members earn badges for milestones (attendance, giving, baptism, etc.). There are two types:

1. **System badges** — 8 pre-configured badges that auto-award based on member activity
2. **Custom badges** — Pastors create their own badges with custom icons, colors, and optional auto-award rules

All badge icons use **Hugeicons** — a free library of 5,100+ stroke-rounded icons. The backend stores the icon name as a string (e.g., `"hand-prayer"`). The frontend renders it using the Hugeicons component library.

---

## Icon Library Setup

### Mobile App (React Native)

```bash
npm install @hugeicons/react-native @hugeicons/core-free-icons react-native-svg
```

```tsx
import { HugeiconsIcon } from '@hugeicons/react-native';
import { HandPrayerIcon } from '@hugeicons/core-free-icons';

// Render a badge icon
<HugeiconsIcon icon={HandPrayerIcon} size={32} color="#FFFFFF" strokeWidth={1.5} />
```

### Admin Dashboard (Next.js)

```bash
npm install @hugeicons/react @hugeicons/core-free-icons
```

```tsx
import { HugeiconsIcon } from '@hugeicons/react';
import { HandPrayerIcon } from '@hugeicons/core-free-icons';

<HugeiconsIcon icon={HandPrayerIcon} size={24} color="#FFFFFF" strokeWidth={1.5} />
```

### Converting Backend Icon Names to Components

The backend stores icon names in **kebab-case** (e.g., `"hand-prayer"`). Convert to PascalCase + `Icon` suffix for the import:

```typescript
// Utility function
function iconNameToComponent(kebabName: string): string {
  return kebabName
    .split('-')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join('') + 'Icon';
}

// Examples:
// "hand-prayer"       → "HandPrayerIcon"
// "running-shoes"     → "RunningShoesIcon"
// "calendar-check-01" → "CalendarCheck01Icon"
// "user-group"        → "UserGroupIcon"
```

### Dynamic Icon Rendering

Since pastors can pick any icon, you need dynamic rendering. Import all free icons and look up by name:

```tsx
import * as HugeIcons from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react-native'; // or '@hugeicons/react'

function BadgeIcon({ iconName, color, size = 32 }: { iconName: string; color: string; size?: number }) {
  const componentName = iconName
    .split('-')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join('') + 'Icon';
  
  const IconComponent = (HugeIcons as any)[componentName];
  
  if (!IconComponent) {
    // Fallback to a default icon if not found
    return <HugeiconsIcon icon={HugeIcons.Award01Icon} size={size} color={color} strokeWidth={1.5} />;
  }
  
  return <HugeiconsIcon icon={IconComponent} size={size} color={color} strokeWidth={1.5} />;
}
```

---

## API Endpoints

### GET /api/badges/icons — Icon Catalog for Badge Creation

Returns ~100 curated church-relevant icons grouped by category. The pastor picks from this list when creating a badge.

```json
[
  { "name": "hand-prayer", "label": "Praying Hands", "category": "Faith & Spiritual" },
  { "name": "church", "label": "Church", "category": "Faith & Spiritual" },
  { "name": "droplet", "label": "Water Drop", "category": "Water & Baptism" },
  { "name": "coins-01", "label": "Coins", "category": "Giving & Generosity" },
  { "name": "user-group", "label": "Group of People", "category": "Community & People" },
  { "name": "trophy", "label": "Trophy", "category": "Milestones & Achievement" },
  "... 100+ icons across 12 categories"
]
```

**Categories:** Faith & Spiritual, Water & Baptism, Worship & Music, Giving & Generosity, Community & People, Attendance & Check-in, Service & Volunteering, Communication & Social, Education & Growth, Milestones & Achievement, Health & Wellness, Nature & Seasons, Symbols

**Note:** This is a curated subset. The full 5,100+ Hugeicons library is available in the npm package — pastors can type a custom icon name if they know it. The catalog just makes discovery easier.

### GET /api/badges — List All Badges (with award counts)

```json
[
  {
    "id": "uuid",
    "tenantId": "uuid",
    "name": "First Steps",
    "description": "Attended your first service",
    "icon": "running-shoes",
    "color": "#4CAF50",
    "tier": "bronze",
    "category": "attendance",
    "autoAwardRule": { "type": "attendance_count", "count": 1 },
    "isActive": true,
    "displayOrder": 1,
    "createdBy": "uuid",
    "createdAt": "2026-04-11T...",
    "awardCount": 12
  }
]
```

### POST /api/badges — Create a Badge (Admin)

```json
// Request
{
  "name": "Book Club Member",
  "description": "Completed the monthly book study",
  "icon": "book-open-01",
  "color": "#6366f1",
  "tier": "silver",
  "category": "engagement",
  "autoAwardRule": null,
  "displayOrder": 10
}

// Response 201 — the created badge object
```

**Fields:**
- `icon` — Hugeicons name from the catalog (kebab-case)
- `color` — hex color for the badge background
- `tier` — `bronze`, `silver`, `gold`, `platinum`, `diamond`
- `category` — `giving`, `attendance`, `spiritual`, `service`, `engagement`, `custom`
- `autoAwardRule` — JSON rule object (see below) or `null` for manual-only badges

### PATCH /api/badges/:id — Update a Badge

### DELETE /api/badges/:id — Delete a Badge (cascades awards)

### POST /api/badges/:id/award — Manually Award to Members

```json
// Request
{ "userIds": ["uuid1", "uuid2"], "reason": "Completed leadership training" }

// Response
{ "awarded": 2 }
```

### DELETE /api/badges/:id/revoke/:userId — Revoke from a Member

### GET /api/badges/user/:userId — Get a Member's Earned Badges

```json
[
  {
    "id": "badge-uuid",
    "name": "First Steps",
    "description": "Attended your first service",
    "icon": "running-shoes",
    "color": "#4CAF50",
    "tier": "bronze",
    "category": "attendance",
    "awardedAt": "2026-03-15T...",
    "awardedReason": "Auto-awarded: attendance_count"
  }
]
```

### GET /api/badges/progress — Current User's Badge Progress

```json
{
  "memberId": "uuid",
  "totalBadgesEarned": 3,
  "totalBadgesAvailable": 8,
  "badges": [
    {
      "badge": {
        "id": "uuid",
        "name": "Generous Giver",
        "description": "Donated a total of $500+",
        "icon": "hand-heart-01",
        "color": "#E91E63",
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
    },
    {
      "badge": { "...": "..." },
      "isEarned": true,
      "progress": { "current": 1, "target": 1, "percent": 100, "unit": "milestone", "remaining": 0 }
    }
  ]
}
```

Sorted: unearned badges first (closest to earning at top), then earned badges.

### POST /api/badges/check — Trigger Auto-Award Check

```json
// Response
{ "newlyEarned": [{ "badgeId": "uuid", "name": "First Steps" }] }
```

Call this after actions that might trigger a badge (check-in, donation, post, etc.). If `newlyEarned` is non-empty, show a celebration overlay.

### GET /api/badges/leaderboard?limit=20 — Badge Leaderboard

```json
[
  { "id": "uuid", "fullName": "Sarah Johnson", "avatarUrl": "...", "badgeCount": 7 },
  { "id": "uuid", "fullName": "Marcus Brown", "avatarUrl": "...", "badgeCount": 5 }
]
```

---

## Auto-Award Rule Types (for the admin badge creation form)

When a pastor creates a badge, they can optionally set an auto-award rule. The badge will be automatically awarded when the condition is met.

| Rule Type | Description | Config Fields | Example |
|-----------|-------------|---------------|---------|
| `attendance_count` | Total check-ins | `count` (integer) | `{ "type": "attendance_count", "count": 10 }` |
| `attendance_streak` | Consecutive weekly check-ins | `days` (integer, in weeks) | `{ "type": "attendance_streak", "days": 30 }` |
| `giving_lifetime` | Total lifetime giving | `threshold` (dollars) | `{ "type": "giving_lifetime", "threshold": 500 }` |
| `giving_single` | Largest single donation | `threshold` (dollars) | `{ "type": "giving_single", "threshold": 100 }` |
| `baptized` | Member is baptized | _(none)_ | `{ "type": "baptized" }` |
| `members_class` | Completed new members class | _(none)_ | `{ "type": "members_class" }` |
| `group_count` | Number of groups joined | `min` (integer) | `{ "type": "group_count", "min": 3 }` |
| `volunteer_hours` | Total volunteer hours | `min` (number) | `{ "type": "volunteer_hours", "min": 10 }` |
| `post_count` | Number of posts created | `min` (integer) | `{ "type": "post_count", "min": 5 }` |
| `prayer_count` | Number of prayers submitted | `min` (integer) | `{ "type": "prayer_count", "min": 5 }` |

If `autoAwardRule` is `null`, the badge can only be awarded manually by an admin.

---

## Pre-Configured System Badges

These 8 badges exist from day one for every church. Pastors can edit them but not delete them.

| Badge | Icon | Color | Tier | Auto-Award |
|-------|------|-------|------|------------|
| First Steps | `running-shoes` | #4CAF50 | Bronze | 1 check-in |
| Faithful Attender | `calendar-check-01` | #2196F3 | Silver | 10 check-ins |
| Prayer Warrior | `hand-prayer` | #9C27B0 | Bronze | 5 prayers |
| Generous Giver | `hand-heart-01` | #E91E63 | Silver | $500 lifetime |
| Baptized | `droplet` | #00BCD4 | Gold | Baptized = true |
| Community Builder | `user-group` | #FF9800 | Silver | 3 groups |
| Servant Heart | `helping-hand` | #795548 | Silver | 10 volunteer hours |
| Social Butterfly | `message-01` | #607D8B | Bronze | 5 posts |

---

## Recommended UI

### Mobile App — Member Profile Badge Section

```
┌──────────────────────────────────┐
│  Badges (3 of 8)          [All] │
│                                  │
│  ┌──────┐ ┌──────┐ ┌──────┐    │
│  │ 🟢   │ │ 🔵   │ │ 🟣   │    │
│  │ 👟   │ │ 📅✓  │ │ 🙏   │    │
│  │Bronze │ │Silver│ │Bronze│    │
│  └──────┘ └──────┘ └──────┘    │
│  First    Faithful  Prayer      │
│  Steps    Attender  Warrior     │
│                                  │
│  ┌──────┐ ┌──────┐ ┌──────┐    │
│  │ ⬜   │ │ ⬜   │ │ ⬜   │    │
│  │ 🔒   │ │ 🔒   │ │ 🔒   │    │
│  │ ???  │ │ ???  │ │ ???  │    │
│  └──────┘ └──────┘ └──────┘    │
│  Generous  Baptized  Community  │
│  Giver     (locked)  Builder    │
└──────────────────────────────────┘
```

**Badge rendering:**
- Earned: full color background (`badge.color`) + white Hugeicons icon + tier shimmer rim
- Locked: greyscale background + lock icon overlay + "???" or dimmed name
- Tap earned badge → show detail modal with award date + reason
- Tap locked badge → show progress bar (from `/badges/progress`)

### Mobile App — Badge Progress Screen

```
┌──────────────────────────────────┐
│  My Badge Progress               │
│  3 of 8 earned                   │
│                                  │
│  ┌────────────────────────────┐  │
│  │ 💰 Generous Giver  Silver │  │
│  │ ████████████░░░░░░  64%   │  │
│  │ $320 of $500 · $180 to go │  │
│  └────────────────────────────┘  │
│                                  │
│  ┌────────────────────────────┐  │
│  │ 👥 Community Builder  Slvr│  │
│  │ ██████████░░░░░░░░  67%   │  │
│  │ 2 of 3 groups             │  │
│  └────────────────────────────┘  │
│                                  │
│  ┌────────────────────────────┐  │
│  │ ✅ First Steps     Bronze │  │
│  │ ████████████████████ 100% │  │
│  │ Earned Mar 15, 2026       │  │
│  └────────────────────────────┘  │
└──────────────────────────────────┘
```

### Admin Dashboard — Badge Management

```
┌──────────────────────────────────────────────────┐
│  Badges                         [+ Create Badge] │
│                                                  │
│  System Badges (8)                               │
│  ┌──────────────────────────────────────────────┐│
│  │ 🟢 First Steps        Bronze   12 awarded   ││
│  │ 🔵 Faithful Attender  Silver    6 awarded   ││
│  │ 🟣 Prayer Warrior     Bronze    0 awarded   ││
│  │ 🩷 Generous Giver     Silver    5 awarded   ││
│  │ 🩵 Baptized           Gold      2 awarded   ││
│  │ 🟠 Community Builder  Silver    2 awarded   ││
│  │ 🟤 Servant Heart      Silver    2 awarded   ││
│  │ ⬛ Social Butterfly    Bronze    2 awarded   ││
│  └──────────────────────────────────────────────┘│
│                                                  │
│  Custom Badges (0)                               │
│  No custom badges yet. Create one to get started.│
└──────────────────────────────────────────────────┘
```

### Admin Dashboard — Create Badge Form

```
┌──────────────────────────────────────────────────┐
│  Create New Badge                                │
│                                                  │
│  Badge Name *                                    │
│  ┌──────────────────────────────────────────────┐│
│  │ Book Club Member                             ││
│  └──────────────────────────────────────────────┘│
│                                                  │
│  Description                                     │
│  ┌──────────────────────────────────────────────┐│
│  │ Completed the monthly book study             ││
│  └──────────────────────────────────────────────┘│
│                                                  │
│  Icon *                    Color *               │
│  ┌─────────────────┐      ┌──────────────┐      │
│  │ 📖 book-open-01 │      │ ● #6366f1    │      │
│  └─────────────────┘      └──────────────┘      │
│  [Browse Icons]            [Color Picker]        │
│                                                  │
│  Tier *                    Category *            │
│  ┌─────────────────┐      ┌──────────────┐      │
│  │ Silver        ▾ │      │ Engagement ▾ │      │
│  └─────────────────┘      └──────────────┘      │
│                                                  │
│  Auto-Award Rule (optional)                      │
│  ┌──────────────────────────────────────────────┐│
│  │ (●) No auto-award — manual only             ││
│  │ (○) Auto-award when condition is met        ││
│  │     Rule Type: [Attendance Count  ▾]        ││
│  │     Threshold:  [10              ]          ││
│  └──────────────────────────────────────────────┘│
│                                                  │
│  Preview:                                        │
│  ┌──────────┐                                    │
│  │  #6366f1 │  Book Club Member                  │
│  │   📖    │  Silver · Engagement                │
│  │  Silver  │  "Completed the monthly book study" │
│  └──────────┘                                    │
│                                                  │
│  [Create Badge]                                  │
└──────────────────────────────────────────────────┘
```

### Admin Dashboard — Icon Picker Modal

```
┌──────────────────────────────────────────────────┐
│  Choose an Icon                    [🔍 Search]   │
│                                                  │
│  Faith & Spiritual                               │
│  ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐    │
│  │ 🙏 │ │ ⛪ │ │ 📖 │ │ 🔥 │ │ 🕯 │ │ ⭐ │    │
│  └────┘ └────┘ └────┘ └────┘ └────┘ └────┘    │
│  Prayer  Church  Bible  Fire  Candle  Star      │
│                                                  │
│  Giving & Generosity                             │
│  ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐    │
│  │ 🪙 │ │ 💰 │ │ 🎁 │ │ 💝 │ │ 💗 │ │ 📦 │    │
│  └────┘ └────┘ └────┘ └────┘ └────┘ └────┘    │
│  Coins  Money   Gift  Heart  Hand   Treasure    │
│                                                  │
│  Community & People                              │
│  ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐    │
│  │ 👥 │ │ 👤+ │ │ 🤝 │ │ 👨‍👩‍👧 │ │ 🌍 │ │ 🧩 │    │
│  └────┘ └────┘ └────┘ └────┘ └────┘ └────┘    │
│  Group  Add     Shake  Family Globe  Puzzle     │
│                                                  │
│  ... (12 categories, ~100 icons total)           │
│                                                  │
│  Selected: 📖 book-open-01                       │
│  [Confirm]                                       │
└──────────────────────────────────────────────────┘
```

**Implementation:**
```typescript
// Fetch the curated catalog
const icons = await api.get('/badges/icons');

// Group by category for the picker
const grouped = icons.reduce((acc, icon) => {
  if (!acc[icon.category]) acc[icon.category] = [];
  acc[icon.category].push(icon);
  return acc;
}, {} as Record<string, typeof icons>);

// Render each category as a section with a grid of icon buttons
// When an icon is selected, store its `name` value (e.g., "book-open-01")
```

---

## Badge Celebration Overlay (Mobile App)

When `POST /badges/check` returns newly earned badges, show a celebration:

```
┌──────────────────────────────────┐
│                                  │
│         🎉 ✨ 🎉                │
│                                  │
│     Badge Earned!                │
│                                  │
│      ┌──────────┐               │
│      │  #4CAF50 │               │
│      │   👟     │               │
│      │  Bronze  │               │
│      └──────────┘               │
│                                  │
│      First Steps                 │
│  "Attended your first service"   │
│                                  │
│      [View All Badges]           │
│      [Dismiss]                   │
│                                  │
└──────────────────────────────────┘
```

**When to trigger the check:**
- After check-in completes
- After a donation succeeds
- After creating a post
- After submitting a prayer request
- After joining a group
- After logging volunteer hours
- After baptism is marked in their profile

---

## Endpoint Summary

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/badges/icons` | Curated icon catalog for badge creation |
| GET | `/badges` | List all badge definitions with award counts |
| POST | `/badges` | Create a new badge (admin) |
| PATCH | `/badges/:id` | Update a badge (admin) |
| DELETE | `/badges/:id` | Delete a badge (admin) |
| POST | `/badges/:id/award` | Manually award to members |
| DELETE | `/badges/:id/revoke/:userId` | Revoke from a member |
| GET | `/badges/user/:userId` | Get a member's earned badges |
| GET | `/badges/progress` | Current user's progress toward all badges |
| POST | `/badges/check` | Trigger auto-award check (returns newly earned) |
| GET | `/badges/leaderboard` | Top members by badge count |

---

## Checklist

### Mobile App
- [ ] Install `@hugeicons/react-native` + `@hugeicons/core-free-icons` + `react-native-svg`
- [ ] Build `BadgeIcon` component that renders Hugeicons by name dynamically
- [ ] Build badge grid on member profile (earned = color, locked = greyscale + lock)
- [ ] Build badge progress screen with progress bars
- [ ] Build badge detail modal (tap to view)
- [ ] Build celebration overlay for newly earned badges
- [ ] Call `POST /badges/check` after key actions (check-in, give, post, pray, join group)
- [ ] Show badge leaderboard

### Admin Dashboard
- [ ] Install `@hugeicons/react` + `@hugeicons/core-free-icons`
- [ ] Build badge management page (list all badges with award counts)
- [ ] Build create badge form with icon picker, color picker, tier/category dropdowns
- [ ] Build icon picker modal using `GET /badges/icons` catalog
- [ ] Build auto-award rule builder (dropdown for rule type + threshold input)
- [ ] Build badge award dialog (select members → POST award)
- [ ] Build badge edit form (same as create, pre-filled)
- [ ] Show badge preview in real-time as admin fills out the form
