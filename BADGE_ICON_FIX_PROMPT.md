# CRITICAL: Badge Icon System Rebuild — Remove Hugeicons Package

> **Date:** April 11, 2026
> **From:** Backend Team
> **For:** Admin Dashboard (Next.js) + Mobile App (React Native)
> **Priority:** CRITICAL — Dashboard is currently unusable

---

## The Problem

The Hugeicons npm package (`@hugeicons/core-free-icons`) contains **5,100 React components** totaling ~10MB of JavaScript. When imported, the browser must parse and hold all 5,100 components in memory — even if you only render 15. This is what's causing:

- Infinite loading on the dashboard
- CPU overheating / fans running full speed
- Site never fully renders

**The `import * as HugeIcons from '@hugeicons/core-free-icons'` pattern is the root cause.** Even lazy loading or code splitting doesn't help because the package registers all 5,100 components at import time.

---

## The Fix — Remove the Package Entirely

We are replacing the npm package with **103 pre-approved icons served as tiny CDN images** (~1.5KB each). No npm package, no React components, no bundle bloat.

### Step 1: Uninstall

**Admin Dashboard:**
```bash
npm uninstall @hugeicons/react @hugeicons/core-free-icons
```

**Mobile App:**
```bash
npm uninstall @hugeicons/react-native @hugeicons/core-free-icons react-native-svg
```

Delete ALL imports referencing `@hugeicons` anywhere in the codebase. Search for:
```
@hugeicons/core-free-icons
@hugeicons/react
@hugeicons/react-native
HugeiconsIcon
```

Remove every single one.

---

### Step 2: Badge Icon Component (Replacement)

**Admin Dashboard (Next.js):**
```tsx
// components/BadgeIcon.tsx
const CDN = 'https://ico.hugeicons.com';

interface BadgeIconProps {
  name: string;
  size?: number;
  className?: string;
}

export function BadgeIcon({ name, size = 32, className }: BadgeIconProps) {
  return (
    <img
      src={`${CDN}/${name}-stroke-rounded@2x.webp?v=1.0.0`}
      alt={name}
      width={size}
      height={size}
      loading="lazy"
      className={className}
      style={{ objectFit: 'contain' }}
    />
  );
}
```

**Mobile App (React Native):**
```tsx
// components/BadgeIcon.tsx
import { Image } from 'react-native';

const CDN = 'https://ico.hugeicons.com';

export function BadgeIcon({ name, size = 32 }: { name: string; size?: number }) {
  return (
    <Image
      source={{ uri: `${CDN}/${name}-stroke-rounded@2x.webp?v=1.0.0` }}
      style={{ width: size, height: size }}
      resizeMode="contain"
    />
  );
}
```

**Usage everywhere a badge icon is displayed:**
```tsx
// Before (BROKEN — loads 5,100 components):
import { HugeiconsIcon } from '@hugeicons/react';
import { HandPrayerIcon } from '@hugeicons/core-free-icons';
<HugeiconsIcon icon={HandPrayerIcon} size={32} />

// After (FAST — loads one 1.5KB image):
import { BadgeIcon } from '@/components/BadgeIcon';
<BadgeIcon name="hand-prayer" size={32} />
```

---

### Step 3: Icon Picker for Custom Badge Creation (Admin Dashboard Only)

When a pastor creates a custom badge, they pick an icon from 103 options. Fetch from the API, render as `<img>` tags:

```tsx
// components/IconPicker.tsx
import { useState, useEffect } from 'react';

interface IconItem {
  name: string;
  label: string;
  category: string;
  previewUrl: string;
}

export function IconPicker({ selected, onSelect }: {
  selected: string | null;
  onSelect: (name: string) => void;
}) {
  const [icons, setIcons] = useState<IconItem[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');

  useEffect(() => {
    // Fetches all 103 icons in one call (~3KB JSON payload)
    fetch('/api/badges/icons?limit=200')
      .then(r => r.json())
      .then(data => {
        setIcons(data.icons);
        setCategories(data.categories);
      });
  }, []);

  const filtered = icons.filter(icon => {
    if (search && !icon.label.toLowerCase().includes(search.toLowerCase())
        && !icon.name.includes(search.toLowerCase())) return false;
    if (category && icon.category !== category) return false;
    return true;
  });

  return (
    <div>
      {/* Search bar */}
      <input
        type="text"
        placeholder="Search icons..."
        value={search}
        onChange={e => setSearch(e.target.value)}
        className="w-full px-3 py-2 border rounded-lg mb-3"
      />

      {/* Category tabs */}
      <div className="flex flex-wrap gap-2 mb-4">
        <button
          onClick={() => setCategory('')}
          className={`px-3 py-1 rounded-full text-sm ${!category ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100'}`}
        >
          All
        </button>
        {categories.map(cat => (
          <button
            key={cat}
            onClick={() => setCategory(cat)}
            className={`px-3 py-1 rounded-full text-sm ${category === cat ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100'}`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Icon grid — 103 icons, renders instantly */}
      <div className="grid grid-cols-6 sm:grid-cols-8 gap-2 max-h-80 overflow-y-auto">
        {filtered.map(icon => (
          <button
            key={icon.name}
            onClick={() => onSelect(icon.name)}
            className={`flex flex-col items-center p-2 rounded-lg border-2 transition-all ${
              selected === icon.name
                ? 'border-indigo-500 bg-indigo-50'
                : 'border-transparent hover:border-gray-200 hover:bg-gray-50'
            }`}
          >
            <img
              src={icon.previewUrl}
              alt={icon.label}
              width={28}
              height={28}
              loading="lazy"
            />
            <span className="text-[10px] text-gray-500 mt-1 text-center leading-tight">
              {icon.label}
            </span>
          </button>
        ))}
      </div>

      {filtered.length === 0 && (
        <p className="text-center text-gray-400 py-8">No icons match your search</p>
      )}
    </div>
  );
}
```

---

### Step 4: Badge Display Component (Both Teams)

For rendering badges in grids (profile, collection screen, leaderboard):

**Admin Dashboard:**
```tsx
// components/BadgeDisplay.tsx
export function BadgeDisplay({
  icon, color, name, tier, isEarned, rarityPercent
}: {
  icon: string;
  color: string;
  name: string;
  tier: string;
  isEarned: boolean;
  rarityPercent?: number;
}) {
  return (
    <div className={`flex flex-col items-center gap-1 ${isEarned ? '' : 'opacity-40'}`}>
      <div
        className="relative w-14 h-14 rounded-full flex items-center justify-center"
        style={{ background: isEarned ? color : '#9ca3af' }}
      >
        <img
          src={`https://ico.hugeicons.com/${icon}-stroke-rounded@2x.webp?v=1.0.0`}
          alt={name}
          width={28}
          height={28}
          loading="lazy"
          className={isEarned ? 'invert brightness-0 invert' : 'opacity-30 invert'}
          style={{ filter: 'brightness(0) invert(1)' }}
        />
        {!isEarned && <span className="absolute -bottom-0.5 -right-0.5 text-sm">🔒</span>}
      </div>
      <span className={`text-xs ${isEarned ? 'font-semibold' : ''}`}>
        {isEarned ? name : '???'}
      </span>
      {rarityPercent !== undefined && (
        <span className="text-[10px] text-gray-400">{rarityPercent}%</span>
      )}
    </div>
  );
}
```

**Mobile App (React Native):**
```tsx
// components/BadgeDisplay.tsx
import { View, Text, Image } from 'react-native';

export function BadgeDisplay({ icon, color, name, isEarned, rarityPercent }) {
  return (
    <View style={{ alignItems: 'center', gap: 4, opacity: isEarned ? 1 : 0.4 }}>
      <View style={{
        width: 56, height: 56, borderRadius: 28,
        backgroundColor: isEarned ? color : '#9ca3af',
        alignItems: 'center', justifyContent: 'center',
      }}>
        <Image
          source={{ uri: `https://ico.hugeicons.com/${icon}-stroke-rounded@2x.webp?v=1.0.0` }}
          style={{ width: 28, height: 28, tintColor: '#fff' }}
          resizeMode="contain"
        />
        {!isEarned && (
          <Text style={{ position: 'absolute', bottom: -2, right: -2, fontSize: 14 }}>🔒</Text>
        )}
      </View>
      <Text style={{ fontSize: 11, fontWeight: isEarned ? '600' : '400' }}>
        {isEarned ? name : '???'}
      </Text>
      {rarityPercent !== undefined && (
        <Text style={{ fontSize: 10, color: '#9ca3af' }}>{rarityPercent}%</Text>
      )}
    </View>
  );
}
```

---

## The 103 Available Icons (Complete List)

Pastors can ONLY choose from these when creating custom badges. The backend enforces this — these are the only icons returned by `GET /api/badges/icons`.

| Category | Icons |
|----------|-------|
| **Faith & Spiritual** | hand-prayer, church, book-02, fire, candle-02, star, peace-sign, angel, moon-02, sun-03, sparkles, lighthouse |
| **Water & Baptism** | droplet, water-wave, swimming, ocean-wave |
| **Worship & Music** | music-note-01, mic-01, headphones, guitar, piano, voice, hand-pointing-up |
| **Giving & Generosity** | coins-01, money-send-01, gift, heart-check, hand-heart-01, treasure-chest, donation |
| **Community & People** | user-group, user-add-01, handshake, family, baby-02, globe-02, puzzle, link-04, bridge, love-korean-finger |
| **Attendance & Check-in** | running-shoes, calendar-check-01, clock-01, location-01, door-01, key-01, sunrise, notification-03 |
| **Service & Volunteering** | helping-hand, paint-brush-01, wrench-01, first-aid-kit, cooking-pot, shopping-bag-01, truck, shield-check, apron |
| **Communication & Social** | message-01, message-multiple-01, megaphone-01, mail-01, phone-01, video-01, pen-tool-01, share-01 |
| **Education & Growth** | graduation-scroll, book-open-01, idea-01, plant-01, tree-06, mountain, telescope-01, brain-02, scroll |
| **Milestones & Achievement** | trophy, medal-01, star-01, diamond-01, crown, rocket-01, target-02, flag-01, award-01, certificate-01 |
| **Health & Wellness** | heartbeat, running, apple-01, yoga-01 |
| **Nature & Seasons** | flower, leaf-01, snowflake, rainbow, cloud |
| **Symbols** | heart-01, compass-01, anchor, infinity-01, butterfly, dove, feather, fingerprint, eye, flash |

---

## API Reference

### GET /api/badges/icons — Icon Catalog

Returns all 103 icons in one call:
```
GET /api/badges/icons?limit=200
```

Response:
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
  "categories": [
    "Faith & Spiritual", "Water & Baptism", "Worship & Music",
    "Giving & Generosity", "Community & People", "Attendance & Check-in",
    "Service & Volunteering", "Communication & Social", "Education & Growth",
    "Milestones & Achievement", "Health & Wellness", "Nature & Seasons", "Symbols"
  ],
  "total": 103,
  "page": 1,
  "limit": 200
}
```

Optional filters:
- `?search=prayer` — filter by name/label
- `?category=Faith+%26+Spiritual` — filter by category
- `?page=1&limit=50` — paginate (default returns all)

### CDN URL Pattern

Every icon is available as a small webp image:
```
https://ico.hugeicons.com/{icon-name}-stroke-rounded@2x.webp?v=1.0.0
```

Examples:
- `https://ico.hugeicons.com/hand-prayer-stroke-rounded@2x.webp?v=1.0.0`
- `https://ico.hugeicons.com/trophy-stroke-rounded@2x.webp?v=1.0.0`
- `https://ico.hugeicons.com/fire-stroke-rounded@2x.webp?v=1.0.0`

Each image is ~1-2KB. The browser caches them after first load.

---

## Performance Comparison

| Metric | Before (npm package) | After (CDN images) |
|--------|---------------------|-------------------|
| JS bundle impact | **+10MB** (5,100 components) | **+0KB** (no package) |
| Parse time on load | **3-8 seconds** (blocks UI) | **0ms** (images load async) |
| Icon picker render | 5,100 React nodes in memory | 103 `<img>` elements (~150KB) |
| Badge display | React component + reconciliation | Native `<img>`, browser-cached |
| CPU usage | High (React virtual DOM for 5,100 nodes) | Minimal (native image elements) |

---

## Checklist

### Admin Dashboard
- [ ] `npm uninstall @hugeicons/react @hugeicons/core-free-icons`
- [ ] Delete ALL `import` lines referencing `@hugeicons`
- [ ] Create `BadgeIcon` component (CDN `<img>` tag)
- [ ] Create `BadgeDisplay` component (circular badge with icon)
- [ ] Create `IconPicker` component (fetches from `/api/badges/icons`)
- [ ] Replace all Hugeicons usage with `BadgeIcon`
- [ ] Verify `node_modules/@hugeicons` does NOT exist
- [ ] Test: dashboard loads in < 2 seconds
- [ ] Test: badge management page opens instantly
- [ ] Test: icon picker shows all 103 icons grouped by category
- [ ] Test: creating a custom badge saves correctly
- [ ] Test: badge collection grid renders with CDN images

### Mobile App
- [ ] `npm uninstall @hugeicons/react-native @hugeicons/core-free-icons`
- [ ] Delete ALL `import` lines referencing `@hugeicons`
- [ ] Create `BadgeIcon` component (React Native `Image` with CDN URI)
- [ ] Create `BadgeDisplay` component with `tintColor: '#fff'` for white-on-color
- [ ] Replace all Hugeicons usage with `BadgeIcon`
- [ ] Verify `node_modules/@hugeicons` does NOT exist
- [ ] Test: badge collection screen loads quickly
- [ ] Test: badge icons render from CDN
