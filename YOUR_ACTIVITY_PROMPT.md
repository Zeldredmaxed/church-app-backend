# Shepard — "Your Activity" Design

## What this is

A self-contained dashboard the user opens to see what they've been doing inside the app. Instagram-style. Covers usage stats (time, opens, streak), content history (posts, comments, likes, saves), and church-specific activity (giving, events, check-ins, prayers, family).

This doc is a **design + handoff spec**. Backend implementation is gated on your sign-off — most of the read endpoints reuse data we already have; the only net-new infrastructure is time-on-app tracking, which needs a mobile contract too. Tell me which sections you want shipped and I'll build them.

**Backend origin:** `https://church-app-backend-27hc.onrender.com` — endpoints under `/api/...`.

---

## Top-level proposal: one route family

All endpoints live under `/api/me/activity/*` and are implicitly scoped to the caller via the JWT. No path params needed for "me." This keeps the URL space coherent and the mobile screen's data fetches predictable.

```
GET /api/me/activity                  // summary card — counts + headline numbers
GET /api/me/activity/usage            // time, opens, streak (the new tracking)
GET /api/me/activity/posts            // posts I authored
GET /api/me/activity/comments         // comments I authored
GET /api/me/activity/likes            // posts I liked
GET /api/me/activity/saves            // posts I saved      (alias of /api/posts/saved)
GET /api/me/activity/story-views      // stories I viewed
GET /api/me/activity/family           // family requests I sent / received / accepted
GET /api/me/activity/giving           // donations I made   (alias of existing giving history)
GET /api/me/activity/events           // events I RSVP'd to
GET /api/me/activity/checkins         // service check-ins
GET /api/me/activity/prayers          // prayers I posted + ones I prayed for
GET /api/me/activity/sermons          // sermons I watched   (if tracked)
GET /api/me/activity/logins           // recent sign-in events
POST /api/me/activity/heartbeat       // mobile pings while app is in foreground
```

---

## Section 1 — Usage (the part that needs new infra)

### Why it's new

The backend doesn't currently track minutes spent in the app. We have `last_seen_at` (touched every 5 min during activity) and `daily_app_opens` (one row per user per day), but no per-day minute totals or session counts.

To do this right, the mobile needs to send a periodic heartbeat while the app is in the foreground. The backend aggregates per-user-per-day.

### Schema (migration NNN — gated on sign-off)

```sql
CREATE TABLE public.user_app_activity (
  user_id           UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  date              DATE NOT NULL DEFAULT CURRENT_DATE,
  minutes_total     INT NOT NULL DEFAULT 0,
  session_count     INT NOT NULL DEFAULT 0,
  first_open_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, date)
);

CREATE INDEX idx_user_app_activity_user_date
  ON public.user_app_activity (user_id, date DESC);
```

One row per (user, date). Idempotent upserts roll the counters forward.

### Heartbeat contract (mobile sends this)

```
POST /api/me/activity/heartbeat
{
  "deltaSeconds": 60,        // time elapsed since last heartbeat, capped at 90s server-side
  "isNewSession": false      // true on first heartbeat after foregrounding the app
}
→ 200 { "ok": true }
```

**Mobile rules:**
- Fire every **60 seconds** while the app is in the foreground (use `AppState` + `setInterval`, clear on background).
- On every foregrounding (from background to active), set `isNewSession: true` on the next heartbeat.
- Cap `deltaSeconds` at 90 on the client too. If you sleep through a long interval, send 90, not the actual gap.

**Backend rules:**
- Cap `deltaSeconds` at 90 server-side to defend against spoofing or buggy clients.
- Upsert into `user_app_activity` for today: `minutes_total += round(deltaSeconds/60)`, `last_seen_at = now()`, `session_count += isNewSession ? 1 : 0`, `first_open_at = LEAST(existing, now())`.
- This endpoint is throttled to 2 req/sec per user (rate-limit) — way more than any honest client needs.

### Read endpoint

```
GET /api/me/activity/usage?range=week
→ {
  "range": "week" | "month" | "all",
  "totalMinutes": 312,
  "totalOpens": 42,
  "currentStreakDays": 5,           // from login_streaks
  "longestStreakDays": 18,
  "daily": [                         // most recent first
    { "date": "2026-05-12", "minutes": 47, "opens": 5 },
    { "date": "2026-05-11", "minutes": 12, "opens": 1 },
    ...
  ]
}
```

Mobile renders a bar chart per day + headline numbers.

---

## Section 2 — Content I created

### Posts I authored

```
GET /api/me/activity/posts?limit=20&offset=0
→ { posts: [...], total, limit, offset }
```

**Reuses existing infra.** The current `GET /api/posts?authorId=<me>` already does this. The `/me/activity/posts` route is just a more discoverable URL with `authorId` defaulted to the JWT sub. Returns full PostWithMeta shape (same as the feed) so mobile reuses its post card.

### Comments I authored

```
GET /api/me/activity/comments?limit=20&offset=0
→ {
  comments: [
    {
      id, content, createdAt,
      post: { id, content: "first 100 chars...", author: { fullName, avatarUrl } }
    },
    ...
  ],
  total, limit, offset
}
```

**Needs a new endpoint.** Reads `public.comments WHERE author_id = caller ORDER BY created_at DESC`. Joined to posts for context so the mobile can show "you commented on Bob's post: ...".

---

## Section 3 — Content I interacted with

### Posts I liked

```
GET /api/me/activity/likes?limit=20&offset=0
→ { posts: [...], total, limit, offset }
```

**Needs a new endpoint.** Reads `post_likes WHERE user_id = caller JOIN posts`, ordered by like timestamp. Same PostWithMeta shape as the feed. Excludes archived posts (consistent with the rest of the app).

### Posts I saved (bookmarks)

```
GET /api/me/activity/saves        // alias of GET /api/posts/saved
```

**Already exists.** I'll just alias `/me/activity/saves` to the existing handler for URL consistency.

### Stories I viewed

```
GET /api/me/activity/story-views?limit=20
→ {
  views: [
    {
      storyId, viewedAt,
      story: { id, mediaUrl, mediaType, author: { id, fullName }, expiresAt }
    }
  ]
}
```

**Needs a new endpoint.** Reads `story_views WHERE viewer_id = caller`. Useful for "you watched 12 stories yesterday." Stories that have expired return null for the inner `story` field (or we just skip expired rows — open question, lean toward skipping for simpler UX).

---

## Section 4 — Church-specific activity

These are the sections that make the church platform feel different from a generic social app. Most of the underlying data exists already — we just need a unified endpoint shape.

### Family

```
GET /api/me/activity/family
→ {
  sentRequests:     [...],   // status: pending/approved/denied
  receivedRequests: [...],
  acceptedConnections: [...] // accepted family ties, both directions
}
```

Mostly reuses `family.service.getRequests` with an additional "accepted" section.

### Giving

```
GET /api/me/activity/giving?limit=20&offset=0
→ {
  donations: [
    { id, amount, currency, fundName, occurredAt, status, receiptUrl }
  ],
  totalLifetime: 1234.56,
  totalYearToDate: 412.00,
  total, limit, offset
}
```

**Backend already has giving history** under `/api/giving` — this endpoint adds the YTD/lifetime aggregates for the activity summary card.

### Events I RSVP'd to

```
GET /api/me/activity/events?status=upcoming|past&limit=20
→ { events: [...], total }
```

Joins `event_rsvps WHERE user_id = caller` to `events`. Split by upcoming/past via the event's start time.

### Service check-ins

```
GET /api/me/activity/checkins?limit=20
→ {
  checkins: [
    { id, serviceDate, campusName, isFirstTime, kidsCheckedIn: [...] }
  ],
  total,
  totalLifetimeCount: 47,
  currentStreakWeeks: 4
}
```

Existing `check_ins` table. Streak is "consecutive weeks with at least one check-in."

### Prayer activity

```
GET /api/me/activity/prayers?limit=20
→ {
  myPrayers: [...],   // prayers I posted
  prayedFor: [...]    // others' prayers I prayed for
}
```

Reads `prayers WHERE author_id = caller` plus `prayer_prays WHERE user_id = caller`.

### Sermons watched

```
GET /api/me/activity/sermons?limit=20
→ { sermons: [...] }
```

**Open question:** we have `sermons` and `sermon_likes` but not a `sermon_watches` view-tracking table. If you want this, mobile needs to fire `POST /api/sermons/:id/watch` when a user opens a sermon player. Otherwise we can substitute `sermon_likes` as a weaker signal of engagement.

---

## Section 5 — Account / security

### Recent login events

```
GET /api/me/activity/logins?limit=10
→ {
  logins: [
    { signedInAt, device: 'iOS', appVersion?, location?: 'New York, NY' }
  ]
}
```

**Status:** Supabase keeps `auth.audit_log_entries` with auth events. We can query that table for the user's recent sign-ins. The `device` and `location` columns are best-effort — they come from User-Agent and IP geolocation; if you want richer info, the mobile would need to send `User-Agent` consistently and we'd add an IP→location lookup (paid service, low priority).

### Headline summary (top of the screen)

```
GET /api/me/activity
→ {
  thisWeek: {
    minutes: 312,
    opens: 42,
    posts: 3,
    comments: 8,
    likes: 17,
    checkins: 1,
    donations: 1,
    streakDays: 5
  },
  lifetime: {
    posts: 87,
    comments: 412,
    donationsTotal: 1234.56,
    checkins: 47,
    badges: 12
  }
}
```

One round-trip for the dashboard header. Pulls from the same data the section endpoints expose. The mobile screen renders this immediately and lazy-loads each detail section on tap.

---

## What I'll build (in order, if you greenlight everything)

| Order | Work | Effort |
|---|---|---|
| 1 | Migration: `user_app_activity` table | tiny |
| 2 | `POST /me/activity/heartbeat` (idempotent upsert) | tiny |
| 3 | `GET /me/activity` (summary) + `GET /me/activity/usage` | small |
| 4 | `GET /me/activity/posts` `comments` `likes` `saves` `story-views` | small (reuse + thin wrappers) |
| 5 | `GET /me/activity/family` `giving` `events` `checkins` `prayers` | small per section |
| 6 | `GET /me/activity/logins` (Supabase audit log) | small |

Total: about 1–2 commits if I bundle by section, 1 deploy cycle each.

## What the mobile team needs to do

Only one mobile contract: the **heartbeat ping** (Section 1). Everything else is read-only — they call the endpoints they want and render the response. Heartbeat snippet:

```ts
import { AppState } from 'react-native';

let intervalId: NodeJS.Timeout | null = null;
let isNewSession = true;
let lastSent = Date.now();

function startHeartbeat() {
  if (intervalId) return;
  intervalId = setInterval(() => {
    const now = Date.now();
    const deltaSeconds = Math.min(Math.round((now - lastSent) / 1000), 90);
    apiClient.post('/api/me/activity/heartbeat', { deltaSeconds, isNewSession })
      .catch(() => {}); // fire-and-forget
    lastSent = now;
    isNewSession = false;
  }, 60_000);
}

function stopHeartbeat() {
  if (intervalId) clearInterval(intervalId);
  intervalId = null;
}

useEffect(() => {
  startHeartbeat();
  const sub = AppState.addEventListener('change', state => {
    if (state === 'active') {
      isNewSession = true;
      lastSent = Date.now();
      startHeartbeat();
    } else {
      stopHeartbeat();
    }
  });
  return () => {
    stopHeartbeat();
    sub.remove();
  };
}, []);
```

---

## Decisions I'd like you to make

1. **Build all of it, or just Section 1 + summary first?** The usage tracking is the most novel piece and most likely to surface bugs in mobile. Could ship that alone, validate, then layer in the rest.
2. **Sermon watch tracking?** Yes/no. Skipping it for now means the sermons row in the activity screen falls back to "sermons you liked," which is fine.
3. **IP-based location for login history?** Skipping for now means just "signed in on iOS at 8:14 PM" without a city. Lower priority.
4. **Anything I'm missing?** This list is generous — if you want a narrower MVP, name it.

Once you pick the cuts, I'll wire it up and hand the mobile team a much shorter "here's the endpoint shape" doc for each section.
