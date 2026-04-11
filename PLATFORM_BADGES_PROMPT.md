# Platform Badge System — Frontend Implementation Guide

> **Date:** April 11, 2026
> **From:** Backend Team
> **For:** Admin Dashboard (Next.js) + Mobile App (React Native)

---

## Overview

Shepard now has **246 platform-wide badges** that every church gets automatically. These are progression-based achievements that members unlock through activity — attendance, giving, social engagement, prayer, volunteering, and more. There are also **5 "Mythic" super-rare badges** that are nearly impossible to earn.

On top of these, pastors can create **custom church-specific badges** (this already works via `POST /badges`).

### Two Badge Categories
- **Shepard Badges** — 246 platform badges, read-only, same for every church (`is_system: true`)
- **Church Badges** — custom badges created by pastors (`is_system: false`)

---

## 1. Rarity Tiers (6 levels)

Every badge has a `rarityTier` that determines its visual treatment:

| Tier | Color | Visual Treatment | Expected % of Users |
|------|-------|-----------------|---------------------|
| **Common** | `#9CA3AF` (grey) | Flat background, no effects | 50%+ will earn |
| **Uncommon** | `#22C55E` (green) | Subtle pulse animation | 20–50% will earn |
| **Rare** | `#3B82F6` (blue) | Gentle outer glow | 5–20% will earn |
| **Epic** | `#A855F7` (purple) | Steady glow + slight sparkle | 1–5% will earn |
| **Legendary** | `#F59E0B` (gold) | Gold shimmer + particle effect | 0.1–1% will earn |
| **Mythic** | `#EF4444` → `#F59E0B` (red→gold gradient) | Animated fire border + sparkle particles + special showcase | <0.01% will earn |

### Rarity Color Map (for styling)
```typescript
const RARITY_COLORS: Record<string, string> = {
  common: '#9CA3AF',
  uncommon: '#22C55E',
  rare: '#3B82F6',
  epic: '#A855F7',
  legendary: '#F59E0B',
  mythic: '#EF4444',
};

const RARITY_LABELS: Record<string, string> = {
  common: 'Common',
  uncommon: 'Uncommon',
  rare: 'Rare',
  epic: 'Epic',
  legendary: 'Legendary',
  mythic: 'Mythic',
};
```

---

## 2. API Endpoints

### GET /api/badges/global — All 246 Platform Badges

Returns every system badge with rarity percentage and whether the authenticated user has earned it.

```json
[
  {
    "id": "uuid",
    "name": "First Steps",
    "description": "Attended your first service",
    "icon": "running-shoes",
    "color": "#4CAF50",
    "tier": "bronze",
    "category": "attendance",
    "rarityTier": "common",
    "autoAwardRule": { "type": "attendance_count", "count": 1 },
    "isEarned": true,
    "isSystem": true,
    "totalEarned": 12450,
    "totalUsers": 45000,
    "rarityPercent": 27.67
  },
  {
    "id": "uuid",
    "name": "Millionaire Heart",
    "description": "Donated over $1,000,000 lifetime — the ultimate act of generosity",
    "icon": "treasure-chest",
    "color": "#EF4444",
    "tier": "diamond",
    "category": "giving",
    "rarityTier": "mythic",
    "autoAwardRule": { "type": "giving_lifetime", "threshold": 1000000 },
    "isEarned": false,
    "isSystem": true,
    "totalEarned": 0,
    "totalUsers": 45000,
    "rarityPercent": 0.0
  }
]
```

**Key fields:**
- `rarityTier` — determines visual treatment (common through mythic)
- `rarityPercent` — real-time % of all users who have this badge
- `isEarned` — whether the authenticated user has this badge
- `totalEarned` — how many users platform-wide have earned it
- `totalUsers` — total users on the platform (for rarity calculation)

### GET /api/badges/progress — Current User's Progress

Returns progress toward every badge with auto-award rules:

```json
{
  "memberId": "uuid",
  "totalBadgesEarned": 12,
  "totalBadgesAvailable": 246,
  "badges": [
    {
      "badge": {
        "id": "uuid",
        "name": "Generous Giver",
        "description": "Donated a total of $500",
        "icon": "hand-heart-01",
        "color": "#3B82F6",
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

### POST /api/badges/check — Trigger Auto-Award Check

Call this after key actions. Returns newly earned badges for the celebration overlay:

```json
{ "newlyEarned": [{ "badgeId": "uuid", "name": "First Steps" }] }
```

**When to call this:**
- After check-in
- After donation
- After creating a post or comment
- After sending a message
- After submitting a prayer
- After joining a group
- After logging volunteer hours
- On app open (for streak badges)

### Existing Endpoints (unchanged)
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/badges` | List church-specific badges (custom) |
| POST | `/badges` | Create a custom badge (admin) |
| GET | `/badges/user/:userId` | Get a user's earned badges |
| GET | `/badges/leaderboard` | Top members by badge count |
| GET | `/badges/icons` | Icon catalog for badge creation |

---

## 3. The 5 Mythic Badges

These deserve special treatment in the UI — they are the rarest achievements on the platform.

| Badge | Icon | Requirement | Time to Earn |
|-------|------|-------------|-------------|
| **Millionaire Heart** | `treasure-chest` | $1,000,000 lifetime giving | ~19 years at $1K/week |
| **Voice of a Generation** | `megaphone-01` | 1,000,000 total interactions | ~27 years at 100/day |
| **Eternal Flame** | `fire` | 3,650 consecutive daily logins (10 years) | Exactly 10 years, no misses |
| **Shepherd of Thousands** | `user-group` | 10,000 followers | Requires cross-church influence |
| **Prayer Mountain** | `hand-prayer` | 100,000 prayer requests | ~27 years at 10/day |

**Visual treatment for Mythic badges:**
- Animated red-to-gold gradient border
- Fire/sparkle particle effect
- Special "showcase slot" at the top of the profile
- When earned, show a full-screen celebration with confetti + sound

---

## 4. Badge Categories & Counts

| Category | Badge Count | Rule Types Used |
|----------|------------|----------------|
| Attendance | 30 | `attendance_count`, `attendance_streak` |
| Giving | 35 | `giving_lifetime`, `giving_single`, `fundraiser_donation_count`, `fundraiser_donation_total` |
| Social (Posts) | 18 | `post_count` |
| Social (Comments) | 17 | `comment_count` |
| Social (Messages) | 16 | `message_count` |
| Total Interactions | 24 | `total_interactions` |
| Prayer | 25 | `prayer_count` |
| Volunteering | 25 | `volunteer_hours` |
| Groups | 10 | `group_count` |
| Followers | 15 | `follower_count` |
| Following | 10 | `following_count` |
| Streaks | 20 | `login_streak` |
| Spiritual | 3 | `baptized`, `members_class` |

---

## 5. Recommended UI — Mobile App

### Badge Collection Screen (Main)

```
┌──────────────────────────────────┐
│  My Badges          12 / 246     │
│                                  │
│  ═══ MYTHIC ═══════════════════  │
│  ┌────────────────────────────┐  │
│  │  🔥 ??? | 🔥 ??? | 🔥 ??? │  │
│  │  0.00%  | 0.00%  | 0.00%  │  │
│  │  🔥 ??? | 🔥 ???          │  │
│  │  0.00%  | 0.00%           │  │
│  └────────────────────────────┘  │
│  (All 5 blurred/locked, rarity   │
│   % visible beneath each one)    │
│                                  │
│  ═══ LEGENDARY ════════════════  │
│  ┌────┐ ┌────┐ ┌────┐ ┌────┐   │
│  │ 🔒 │ │ 🔒 │ │ 🔒 │ │ 🔒 │   │
│  │0.3%│ │0.1%│ │0.5%│ │0.2%│   │
│  └────┘ └────┘ └────┘ └────┘   │
│  ... (75 legendary badges)       │
│                                  │
│  ═══ EPIC ═════════════════════  │
│  ┌────┐ ┌────┐ ┌────┐ ┌────┐   │
│  │ 🟣 │ │ 🔒 │ │ 🔒 │ │ 🔒 │   │
│  │ ✅ │ │2.1%│ │3.5%│ │1.8%│   │
│  └────┘ └────┘ └────┘ └────┘   │
│  ... (49 epic badges)            │
│                                  │
│  ═══ RARE ═════════════════════  │
│  ┌────┐ ┌────┐ ┌────┐ ┌────┐   │
│  │ 🔵 │ │ 🔵 │ │ 🔒 │ │ 🔒 │   │
│  │ ✅ │ │ ✅ │ │8.2%│ │12% │   │
│  └────┘ └────┘ └────┘ └────┘   │
│                                  │
│  ═══ UNCOMMON ═════════════════  │
│  ... (earned ones full color)    │
│                                  │
│  ═══ COMMON ═══════════════════  │
│  ... (most will be earned)       │
└──────────────────────────────────┘
```

### Badge States

**Earned badge:**
- Full color background (`badge.color`)
- White Hugeicons icon rendered from `badge.icon`
- Badge name visible
- Rarity tier border effect (glow for epic+, shimmer for legendary, fire for mythic)
- Checkmark indicator

**Unearned badge:**
- Greyscale background
- Icon blurred/obscured (use opacity 0.3 or blur filter)
- Name shows as "???" (hidden)
- Rarity percentage shown below: "2.1% of members"
- Lock icon overlay

**Mythic badge (unearned):**
- Dark background with faint red-gold shimmer
- Icon completely hidden (just a "?" silhouette)
- "< 0.01%" rarity shown
- Tapping reveals the badge name and requirement but keeps the icon locked

### Badge Detail Modal (tap any badge)

```
┌──────────────────────────────────┐
│                                  │
│      ┌──────────────┐            │
│      │              │            │
│      │   🏆 Icon    │            │
│      │              │            │
│      └──────────────┘            │
│                                  │
│      Generous Giver              │
│      ─────────────────           │
│      "Donated a total of $500"   │
│                                  │
│      Rarity: Uncommon            │
│      27.67% of members have this │
│                                  │
│      ████████████░░░░  64%       │
│      $320 of $500 · $180 to go   │
│                                  │
│      Category: Giving            │
│                                  │
│      [Close]                     │
└──────────────────────────────────┘
```

For earned badges, show:
- "Earned on March 15, 2026"
- Full color icon
- No progress bar (100% complete)

For unearned badges:
- Progress bar with current/target
- "X remaining" text
- Greyscale icon

### Profile — Badge Showcase

On the member's profile, show their top 3–6 rarest earned badges in a showcase row:

```
┌──────────────────────────────────┐
│  Zel's Profile                   │
│  ┌──────────────────────────┐    │
│  │  Badges: 12 earned        │    │
│  │  ┌────┐┌────┐┌────┐      │    │
│  │  │Epic││Rare││Rare│      │    │
│  │  │ 🟣 ││ 🔵 ││ 🔵 │      │    │
│  │  └────┘└────┘└────┘      │    │
│  │  [View All 246 →]         │    │
│  └──────────────────────────┘    │
└──────────────────────────────────┘
```

Show badges sorted by rarity (rarest first) so the most impressive ones are visible.

### Celebration Overlay

When `POST /badges/check` returns `newlyEarned` with badges:

```
┌──────────────────────────────────┐
│                                  │
│         🎉 ✨ 🎉                │
│                                  │
│      Badge Earned!               │
│                                  │
│      ┌──────────────┐            │
│      │   #4CAF50    │            │
│      │    👟        │            │
│      │   Bronze     │            │
│      └──────────────┘            │
│                                  │
│      First Steps                 │
│      "Attended your first        │
│       service"                   │
│                                  │
│      Rarity: Common              │
│      52.3% of members            │
│                                  │
│      [View All Badges]           │
│      [Dismiss]                   │
│                                  │
└──────────────────────────────────┘
```

For **Mythic** badges, the celebration should be extra dramatic:
- Full-screen gold + fire animation
- Confetti particles
- Sound effect
- "MYTHIC ACHIEVEMENT UNLOCKED" header
- Auto-share prompt: "Share this achievement?"

---

## 6. Recommended UI — Admin Dashboard

### Badge Management Page — Two Tabs

```
┌──────────────────────────────────────────────────┐
│  Badges                                          │
│                                                  │
│  [Shepard Badges (246)] [Church Badges (3)]      │
│                                                  │
│  ── Shepard Badges Tab (read-only) ──────────── │
│                                                  │
│  Filter: [All ▾]  [Common ▾]  🔍 Search         │
│                                                  │
│  MYTHIC (5)                                      │
│  ┌──────────────────────────────────────────────┐│
│  │ 🔥 Millionaire Heart    Mythic   0 earned   ││
│  │    $1M lifetime giving                       ││
│  │ 🔥 Voice of a Generation Mythic   0 earned  ││
│  │    1M total interactions                     ││
│  │ 🔥 Eternal Flame        Mythic   0 earned   ││
│  │    10-year daily streak                      ││
│  │ 🔥 Shepherd of Thousands Mythic  0 earned   ││
│  │    10,000 followers                          ││
│  │ 🔥 Prayer Mountain       Mythic  0 earned   ││
│  │    100,000 prayers                           ││
│  └──────────────────────────────────────────────┘│
│                                                  │
│  LEGENDARY (75)                                  │
│  ┌──────────────────────────────────────────────┐│
│  │ ⭐ Thousand Services   Legendary  2 earned  ││
│  │ ⭐ $100K Cornerstone   Legendary  0 earned  ││
│  │ ⭐ 365-Day Streak      Legendary  1 earned  ││
│  │ ... (72 more)                                ││
│  └──────────────────────────────────────────────┘│
│                                                  │
│  EPIC (49) | RARE (45) | UNCOMMON (34) |         │
│  COMMON (38)                                     │
│                                                  │
│  Note: Shepard badges cannot be edited or        │
│  deleted. They are platform-wide achievements.   │
│                                                  │
│  ── Church Badges Tab ────────────────────────── │
│  [+ Create Badge]                                │
│  (This is the existing badge CRUD — unchanged)   │
└──────────────────────────────────────────────────┘
```

### Badge Stats Card (Admin Dashboard KPI)

```
┌────────────────────────────────────┐
│  Badge Engagement                  │
│                                    │
│  Total Badges Earned (all members) │
│  ████████████████  1,247           │
│                                    │
│  Avg Badges Per Member: 4.2       │
│  Most Common: First Steps (89%)    │
│  Rarest Earned: Year Streak (0.3%) │
│  Mythic Earned: 0                  │
└────────────────────────────────────┘
```

---

## 7. Implementation Guide

### Fetching & Grouping Badges

```typescript
// Fetch all platform badges
const globalBadges = await api.get('/badges/global');

// Group by rarity tier for the collection screen
const grouped = {
  mythic: globalBadges.filter(b => b.rarityTier === 'mythic'),
  legendary: globalBadges.filter(b => b.rarityTier === 'legendary'),
  epic: globalBadges.filter(b => b.rarityTier === 'epic'),
  rare: globalBadges.filter(b => b.rarityTier === 'rare'),
  uncommon: globalBadges.filter(b => b.rarityTier === 'uncommon'),
  common: globalBadges.filter(b => b.rarityTier === 'common'),
};

// Render sections in order: mythic → common (rarest first)
```

### Rendering a Badge

```tsx
import * as HugeIcons from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react-native'; // or '@hugeicons/react'

function BadgeCard({ badge, isEarned }: { badge: Badge; isEarned: boolean }) {
  const iconName = badge.icon.split('-').map(p => p[0].toUpperCase() + p.slice(1)).join('') + 'Icon';
  const IconComponent = (HugeIcons as any)[iconName] ?? HugeIcons.Award01Icon;

  return (
    <View style={[styles.badge, { backgroundColor: isEarned ? badge.color : '#374151' }]}>
      {/* Rarity border effect */}
      {badge.rarityTier === 'mythic' && <AnimatedFireBorder />}
      {badge.rarityTier === 'legendary' && <ShimmerBorder color="#F59E0B" />}
      {badge.rarityTier === 'epic' && <GlowBorder color="#A855F7" />}

      {/* Icon */}
      <View style={isEarned ? {} : { opacity: 0.2, filter: 'blur(4px)' }}>
        <HugeiconsIcon icon={IconComponent} size={32} color="#FFFFFF" strokeWidth={1.5} />
      </View>

      {/* Lock overlay for unearned */}
      {!isEarned && <LockIcon />}

      {/* Name */}
      <Text>{isEarned ? badge.name : '???'}</Text>

      {/* Rarity percent */}
      <Text style={styles.rarity}>{badge.rarityPercent.toFixed(1)}%</Text>
    </View>
  );
}
```

### Triggering Badge Checks

```typescript
// After any qualifying action, check for new badges
async function checkForNewBadges() {
  const result = await api.post('/badges/check');
  if (result.newlyEarned.length > 0) {
    // Show celebration overlay for each new badge
    for (const badge of result.newlyEarned) {
      showBadgeCelebration(badge);
    }
  }
}

// Call after:
await checkIn(); checkForNewBadges();
await donate(); checkForNewBadges();
await createPost(); checkForNewBadges();
await sendPrayer(); checkForNewBadges();
await joinGroup(); checkForNewBadges();
await logVolunteerHours(); checkForNewBadges();
// On app open (for streak badges):
checkForNewBadges();
```

---

## 8. Endpoint Summary

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/badges/global` | JWT | All 246 platform badges with rarity % |
| GET | `/badges/progress` | JWT | Current user's progress toward all badges |
| POST | `/badges/check` | JWT | Trigger auto-award check, returns newly earned |
| GET | `/badges/user/:userId` | JWT | A specific user's earned badges |
| GET | `/badges/leaderboard` | JWT | Top members by badge count |
| GET | `/badges/icons` | JWT | Icon catalog for custom badge creation |
| GET | `/badges` | JWT | Church-specific custom badges |
| POST | `/badges` | JWT | Create custom badge (admin) |
| PATCH | `/badges/:id` | JWT | Update custom badge (admin) |
| DELETE | `/badges/:id` | JWT | Delete custom badge (admin) |
| POST | `/badges/:id/award` | JWT | Manually award to members |
| DELETE | `/badges/:id/revoke/:userId` | JWT | Revoke from a member |

---

## 9. Checklist

### Mobile App
- [ ] Install `@hugeicons/react-native` + `@hugeicons/core-free-icons`
- [ ] Build Badge Collection screen grouped by rarity tier (mythic → common)
- [ ] Earned badges: full color + icon + name + rarity %
- [ ] Unearned badges: greyscale + blurred icon + "???" + lock + rarity %
- [ ] Mythic unearned: dark with red-gold shimmer, "?" silhouette
- [ ] Badge detail modal with progress bar (earned shows date, unearned shows progress)
- [ ] Profile showcase: top 3–6 rarest earned badges
- [ ] Celebration overlay on newly earned badges (extra dramatic for mythic)
- [ ] Call `POST /badges/check` after every qualifying action + on app open
- [ ] Sort earned badges by rarity (rarest first) on profile

### Admin Dashboard
- [ ] Two-tab badge management: "Shepard Badges" (read-only) + "Church Badges" (CRUD)
- [ ] Shepard Badges tab: grouped by rarity, filterable, searchable, shows earn count
- [ ] Church Badges tab: existing create/edit/delete/award flow (unchanged)
- [ ] Badge stats KPI card: total earned, avg per member, rarest earned, mythic count
- [ ] Prevent editing/deleting system badges (`isSystem: true`)
