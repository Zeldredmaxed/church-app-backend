# Mobile Backend Updates — Sweep Fix Handoff

Big backend sweep just shipped. Headline: **idempotency, performance,
and missing endpoints are all closed**. Migrations 073-079 applied to
prod. Render auto-deployed.

Below is what changed that affects the mobile app, organized so the
most likely "this used to work" bugs are first.

---

## 0. Breaking-ish changes (test these flows first)

### `POST /api/posts/global` now validates ownership

If you currently pass `videoMuxPlaybackId` or `sharedBadgeId` on a
global post:
- `videoMuxPlaybackId` → backend now confirms it was uploaded by you
  (via `pending_video_uploads`). Reusing someone else's playback ID
  returns 400.
- `sharedBadgeId` → backend confirms the user actually earned that
  badge. 400 otherwise. (Same check `POST /api/posts` already does.)
- `visibility` is force-set to `'public'` on global posts regardless
  of what you send.

Also: mention notifications on global posts now pass `tenantId: null`
instead of `tenantId: ''` (you weren't seeing it, but the receipt
table did).

### `POST /api/auth/switch-tenant` indirectly affected

You haven't changed how you call it, but `POST /api/memberships/me/switch-church`
now refuses if:
1. `leaveTenantId` doesn't match the caller's JWT current tenant — 403
2. The caller is the **sole admin/pastor** of the source tenant — 403
   (must promote another admin first)

The sole-admin guard is mainly relevant if you build a "leave church"
flow for admins. Surface the error message cleanly.

### Check-in race condition closed

`POST /api/leaderboard/checkin` (geo) — a double-tap that previously
"succeeded twice" today returns one success + one *"You have already
checked in today"*. The check now uses the church's **timezone**
(see below). Mobile should handle the same-day rejection gracefully
without re-prompting the user.

### Account deletion is now rate-limited

`DELETE /api/users/me` — 3/day per IP. `GET /api/users/me/export` —
5/day per IP. Reasonable for real users; just don't loop on retry.

---

## 1. New / changed endpoints

### `GET /api/notifications/categories` — call this for the prefs screen

**Don't hardcode notification types in the prefs screen.** New endpoint
returns the canonical catalog:

```json
{
  "categories": [
    {
      "key": "post_like",
      "label": "Post likes",
      "description": "When someone likes your post",
      "group": "Social",
      "defaultPush": true,
      "defaultEmail": false,
      "defaultSms": false
    },
    // ...23 more
  ]
}
```

Groups: `Social | Chat | Church | Prayer | Giving | Groups | Admin | Family`.

Render the toggle list from the catalog. `UpdatePreferenceDto.type` is
now `@IsIn` validated against this catalog — passing an unknown type
returns 400 instead of silently inserting a no-op preference.

### `GET /api/notifications` response shape changed

Now returns the standard offset envelope:
```json
{
  "data": [...],
  "total": 0,
  "limit": 20,
  "offset": 0,
  "unreadCount": 0,
  "notifications": [...]  // legacy — duplicate of `data`, removed next release
}
```

Use `query.offset` not `query.page`. The DTO defaults to `limit=20`,
max 50. The old `?page=` param is gone; the controller now parses via
the DTO so negative offsets / NaN no longer 500 — they 400.

### `GET /api/users/:userId/public-profile` now includes birthday/anniversary

Surfaced **only when the member opted in** via the `birthdayVisible` /
`anniversaryVisible` flags. Year is stripped (you only need MM-DD for
"happy birthday today" widgets).

```json
{
  "id": "...",
  "fullName": "...",
  "avatarUrl": "...",
  "church": { "id": "...", "name": "...", "brandColor": "..." } | null,
  "createdAt": "...",
  "birthday": "06-15" | null,
  "anniversary": "09-22" | null
}
```

If you build a "birthdays this week" widget, this is the field to use.
Members can hide themselves by toggling `birthdayVisible: false` via
`PATCH /api/users/me`.

### Donation flow — fundraiser donate is idempotent

`POST /api/fundraisers/:id/donate` — if you retry the same donation
(same fundraiser + amount + donor) within 30 min, the backend now
returns the existing pending donation's `clientSecret` instead of
creating a duplicate PaymentIntent. This closes the historical
"double-credited fundraiser" bug.

You don't need to change anything mobile-side; retries are just safer
now.

### Family connections write audit + admin-overridable

Mobile flow unchanged. Backend now writes `family.relationship_created`
on accept + `family.relationship_removed` on delete. Admins can
force-remove via a new admin endpoint (out of mobile scope).

---

## 2. Performance changes (silent improvements)

- **Feed latency:** `GET /api/posts` reads denormalized
  `posts.like_count` + `posts.comment_count` columns instead of two
  LATERAL COUNT subqueries per row. Same JSON shape, just faster.
  Triggers keep the counts in sync on every like/unlike + comment
  create/delete.
- **Leaderboard ranks:** `GET /api/leaderboard/my-ranks` and
  `getUserRanks` are now 5-min cached per user. Screen-spam no longer
  hammers the DB; a brand-new rank change shows up within 5 min.
- **Badge check coalescing:** `POST /api/badges/check` is 60-second
  cached per user. A brand-new badge award still pops the
  AchievementModal within a minute. You can still call it on every
  screen focus; the cache absorbs the spam.

The previous handoff said "consider calling /badges/check on
app-foreground only" — that's no longer required, the backend
coalesces.

---

## 3. Notification dedupe (silent improvement)

The notifications queue now uses `dedupe_key` so BullMQ retries
(attempts: 5) don't duplicate in-app rows or push notifications.

You may have been seeing occasional "I got the same notification 3
times" reports — those are gone.

Social fan-out also dedupes: a retry of a 10k-follower fan-out job
won't re-pop posts at the top of feeds.

---

## 4. Time-zone aware streaks

Attendance streaks for badges + leaderboard now bucket by the **church's
timezone** (new `tenants.timezone` column, defaulting to
`America/New_York`). Previously a Pacific-time Sunday 6pm check-in
landed on Monday UTC and broke streaks.

If you surface a tenant timezone anywhere in the UI ("Your church
operates in PT"), pull it from any tenant response — the field is
`timezone` and ships on every tenant payload now.

---

## 5. Push notification dedupe and broadcasts

`POST /api/notifications/broadcast` (admin endpoint, but affects the
push you receive) now passes a per-broadcast dedupe key. If your client
ever saw the same broadcast push twice from a retry, that's gone.

Broadcast response now includes `broadcastId` so the admin can correlate
delivery — irrelevant to mobile but the push payload's `data` now
carries `broadcastId` too if you want to use it for tap-deduplication
on the client.

---

## 6. Pagination convention going forward

Backend has standardized on two pagination envelopes (defined in
`common/types/pagination.ts`):

```ts
PaginatedOffset<T> = { data: T[]; total: number; limit: number; offset: number }
PaginatedCursor<T> = { data: T[]; nextCursor: string | null }
```

New endpoints use these envelopes. **Don't bake the current per-
endpoint shapes into shared hooks.** As legacy routes migrate over
time, expect:
- `GET /api/posts` → `PaginatedOffset<Post>` (currently `{ posts, total, limit, offset }`)
- `GET /api/groups` → already cursor-shaped
- `GET /api/notifications` → done, see #1

---

## 7. Privacy + GDPR audit improvements

- `GET /api/users/me/export` now includes more tables in the dump (the
  endpoint was already in your hands; payload is broader).
- `DELETE /api/users/me` now writes to `account_deletion_log` BEFORE
  the cascade so a compliance officer can later answer "show me every
  erasure request" — no mobile change.
- Admin views of someone else's profile now write a
  `member.profile_extras_viewed` audit — no mobile change, but if you
  show admins their own activity history you'll see new rows.

---

## 8. Things you should know but don't need to change

- `POST /api/posts/:id/admin-archive` (admin moderation) is unchanged
  from the previous sweep. Continues to write `post.archived` audit
  with `byAdmin: true`.
- Stripe webhooks are now fully idempotent. Mux webhooks too. If a
  video's `videoMuxPlaybackId` ever flipped back to `null` on you
  mysteriously after a Mux replay — that's fixed.
- `POST /api/check-in` for self check-in is unchanged.
- `POST /api/attendance/bulk` (admin) now also returns
  `{ checkedIn, skipped }`. If the mobile admin app uses this and shows
  a confirmation, show both counts.

---

## 9. Suggested mobile work order

1. **Wire `GET /api/notifications/categories`** into the prefs screen.
   Drop hardcoded type list.
2. **Migrate `GET /api/notifications`** consumer to `data`+`total`+
   `limit`+`offset` (the legacy `notifications` field will be removed
   next release).
3. **Test global post creation** — make sure your video posting flow
   doesn't reuse another user's playback id (it shouldn't, but worth
   confirming after the ownership tightening).
4. **Handle the new check-in same-day-reject** gracefully — show a
   toast, don't re-prompt.
5. **Add `birthday` / `anniversary` rendering** to the public-profile
   card if you want a "birthdays today" widget. Both fields are
   nullable and respect the visibility flags.

---

## 10. Summary of new + changed endpoints affecting mobile

```
GET    /api/notifications/categories                          (NEW — preferences catalog)
GET    /api/notifications                                     (CHANGED — offset envelope)
GET    /api/users/:userId/public-profile                      (CHANGED — birthday + anniversary)
POST   /api/posts/global                                      (CHANGED — ownership validation)
POST   /api/memberships/me/switch-church                      (CHANGED — sole-admin guard, leave-tenant clamp)
POST   /api/fundraisers/:id/donate                            (CHANGED — idempotent retry)
POST   /api/leaderboard/checkin                               (CHANGED — timezone-aware dedupe)
DELETE /api/users/me                                          (CHANGED — 3/day rate limit + audit row)
GET    /api/users/me/export                                   (CHANGED — 5/day rate limit)
```

Nothing else in this sweep should require mobile changes. Existing
behavior preserved.
