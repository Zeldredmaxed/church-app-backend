# Mobile Handoff — AchievementModal Backend Wiring (Confirmations + Fixes)

All six checklist items addressed. Migration 072 applied to prod. Type-check clean. Deployed via auto-push.

---

## 1. `badge.description` length ✅ confirmed

Audited the 254-row catalog: max description is **65 chars**, zero rows over 120. Nothing to truncate — what's in `badges.description` today is already a one-liner. No `tagline` field needed.

If a church creates a badge in the future with a longer description, the backend won't truncate it — the modal can clamp to 2 lines at 14pt as a defensive client-side measure, but it shouldn't actually happen with the seeded catalog.

---

## 2. `badge.category` coercion ✅ done server-side

The catalog uses two legacy values that aren't in the modal's six:
- `spiritual` (28 badges)
- `service` (26 badges)

Coercion map (applied in the backend before the response goes out):

| Database value | Returned to modal |
|---|---|
| `attendance` | `attendance` |
| `giving` | `giving` |
| `community` | `community` |
| `prayer` | `prayer` |
| `volunteer` | `volunteer` |
| `engagement` | `engagement` |
| `spiritual` | `prayer` (closest semantic — devotional/faith milestones) |
| `service` | `volunteer` (closest semantic — service to others) |
| anything else | `engagement` (safety net) |

So every `category` you receive will already be one of the six — the modal's safety-net fallback should never fire in practice but is fine to keep.

---

## 3. `badge.tier` coercion ✅ done server-side

The catalog has 61 badges with `tier = diamond` which isn't on the metallic ladder.

Coercion map:

| Database value | Returned to modal |
|---|---|
| `bronze` | `bronze` |
| `silver` | `silver` |
| `gold` | `gold` |
| `platinum` | `platinum` |
| `diamond` | `platinum` (top of the ladder) |
| anything else | `bronze` |

`rarity_tier` (common/uncommon/rare/epic/legendary/mythic) is a separate column and is **not** sent on the modal payload — the metallic `tier` field is the only one the modal sees.

---

## 4. Offline queue ✅ wired

`POST /api/badges/check` now returns **every unseen earn** (not just the ones qualified in this specific call) ordered by `earnedAt ASC`. Sources of unseen earns:

- Just qualified during this `/check` call
- Awarded by background workers (post-count milestones, attendance streaks) since the user's last `/check`
- Manually awarded by an admin via `POST /api/badges/award`
- Awarded before this idempotency feature shipped — handled by the backfill (see #5)

Single round trip; modal walks the queue chronologically.

---

## 5. Idempotency ✅ enforced server-side

Migration 072 added `member_badges.celebration_seen_at TIMESTAMPTZ NULL`. Once a row is returned in a `/check` response, the column is set to `now()` in the same SQL statement (via `UPDATE … RETURNING` inside a CTE — no chance of returning a row to the modal and then failing to mark it).

**Backfill safety:** every pre-existing `member_badges` row was set to `celebration_seen_at = awarded_at` during the migration, so returning users don't get bombarded with their entire historic badge collection on the first `/check` after deploy.

Mobile can drop the client-side dedupe-by-badgeId logic if you want, or keep it as defense-in-depth against the rare network-retry edge case where the server marked seen but the response didn't reach the client. Both are fine.

---

## 6. Share-to-feed ✅ wired and ready

`POST /api/posts` now accepts `sharedBadgeId`:

```http
POST /api/posts
Authorization: Bearer <JWT>
Content-Type: application/json

{
  "content": "Earned the Voice of Faith badge for sharing 10 posts! 🎉",
  "sharedBadgeId": "badge-def-uuid"
}
```

Behavior:
- **Ownership check:** the backend rejects with 400 if the user hasn't actually earned this badge in their current tenant. Prevents fake-achievement posts.
- **`content` is still required** — no auto-template on the backend. The mobile owns the celebration copy. Suggested template strings (use whichever fits the brand):
  - `"Just earned the {badge.name} badge! 🎉"`
  - `"{badge.name} — earned! {badge.description}"`
  - Or let the user write their own, pre-filled.
- **`mediaType` defaults to `text`** if not provided. Pass `"image"` if you want to attach a screenshot of the badge card.

### Post response now includes `sharedBadge`

Every post in every response (feed, single, saved, archive, campus, "my posts") includes:

```jsonc
{
  ...
  "sharedBadge": {
    "id":          "badge-def-uuid",
    "name":        "Voice of Faith",
    "description": "Shared 10 posts with your community",
    "icon":        "message-01",     // Hugeicons name
    "tier":        "bronze",          // coerced — same enum as the modal
    "category":    "engagement",      // coerced — same enum as the modal
    "color":       "#CD7F32"
  } | null    // null for normal posts
}
```

Renderer can use the same badge-card component the modal uses — same field names, same enum constraints. Tier and category go through identical coercion on this path so the renderer doesn't need its own mapping.

If the church later deletes the badge definition, `shared_badge_id` falls to `NULL` (ON DELETE SET NULL) and the post survives as plain text.

---

## Full /api/badges/check response example

```json
{
  "newlyEarned": [
    {
      "id":       "user-badge-row-uuid-1",
      "badgeId":  "badge-def-uuid-a",
      "earnedAt": "2026-05-14T08:12:03.000Z",
      "badge": {
        "id":          "badge-def-uuid-a",
        "name":        "First Sunday",
        "description": "Attended your first Sunday service",
        "icon":        "calendar-check-in-01",
        "tier":        "bronze",
        "category":    "attendance",
        "color":       "#CD7F32"
      }
    },
    {
      "id":       "user-badge-row-uuid-2",
      "badgeId":  "badge-def-uuid-b",
      "earnedAt": "2026-05-15T19:45:21.000Z",
      "badge": {
        "id":          "badge-def-uuid-b",
        "name":        "Voice of Faith",
        "description": "Shared 10 posts with your community",
        "icon":        "message-01",
        "tier":        "silver",
        "category":    "engagement",
        "color":       "#C0C0C0"
      }
    }
  ]
}
```

(ASC order — modal plays oldest first.)

---

## Summary

| Item | Status | Notes |
|---|---|---|
| description one-liner | ✅ already short (max 65 chars) | no action |
| category enum | ✅ coerced server-side | spiritual→prayer, service→volunteer, others→engagement |
| tier enum | ✅ coerced server-side | diamond→platinum, others→bronze |
| offline queue | ✅ all unseen returned in ASC order | one round trip |
| idempotency | ✅ celebration_seen_at set on response | backfilled so first /check after deploy is empty |
| share-to-feed | ✅ `sharedBadgeId` on POST /api/posts | ownership-checked, response includes `sharedBadge` |

Backend is ready. Nothing else needs server-side work for the launch of the modal.
