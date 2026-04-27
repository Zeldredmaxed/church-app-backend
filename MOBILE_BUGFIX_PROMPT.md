# Shepard Mobile — Bugfix Handoff (Chat-Test Round)

## Context

A pre-launch test round surfaced four issues. Two were backend bugs (now fixed and deployed). Two are frontend wiring issues that need fixes in the mobile app.

**Backend origin:** `https://church-app-backend-27hc.onrender.com` — endpoints live under `/api/...`. `EXPO_PUBLIC_API_URL` should be the origin only (no `/api` suffix); call sites already prefix `/api/` in path strings.

---

## Already fixed on the backend (no mobile changes needed)

- **DM creation 500.** `POST /api/messages/conversations` now succeeds. The earlier RLS recursion (chat_channels SELECT depends on channel membership; new direct channels have no members at INSERT-time) was replaced by a SECURITY DEFINER function — verified end-to-end against live prod.
- **Photo-attachment "validation failed, UUID is expected."** This was a downstream symptom of the DM-creation 500 — when conversation create failed, the mobile app retried `POST /api/messages/conversations/:id/messages` with `:id` undefined, which made `ParseUUIDPipe` reject the URL. Should resolve once you re-test photo send against the new backend.
- **Presence "everyone shows offline."** The backend now derives `isOnline` from `last_seen_at > now() - 5 minutes` instead of a stuck boolean. The presence interceptor still updates `last_seen_at` on every authenticated request (5-min throttle), so any active user will appear online to others within their 5-min activity window.

If your testers still see issues after rebuilding the APK against the latest backend, ping me with specifics.

---

## Bug 1 — Follow button doesn't work from search results

### Symptom
> "If I search someone's name and click follow on the search result, it does nothing. I have to navigate to their profile page and click follow there for it to work."

### Cause
The button on search-result rows isn't calling the follow API. The profile-page button works because it's wired to the API; the search-result button is either no-op or calling a stale handler.

### Fix
Wire the search-result follow button to the same endpoint the profile page uses:

```ts
// Follow
await apiClient.post(`/api/users/${targetUserId}/follow`);

// Unfollow
await apiClient.delete(`/api/users/${targetUserId}/follow`);
```

Both endpoints return:
- `201` (follow) / `200` (unfollow) on success
- `409` if already following / not following

The follow status should be reflected in the same component state the profile page uses, so the toggle works consistently in both views.

**Verified:** I hit `POST /api/users/:id/follow` against live prod from a server-side script and it returned `201 {"message":"Followed successfully"}`. The endpoint is healthy — this is purely frontend wiring.

---

## Bug 2 — Profile page shows hardcoded mock data

### Symptom
> "When looking at someone else's page, it shows fake information. It says they have 1.2K followers (fake), and that they're a 'Worship Leader at Grace Community' (fake). This information needs to be real."

### Cause
The profile screen renders hardcoded placeholder strings instead of fetching real data from the backend.

### Fix
Replace the mock values with live API calls:

#### Follower / following counts

There's now a dedicated count endpoint that returns both totals in one cheap call:

```ts
const { followers, following } = await apiClient.get(`/api/users/${userId}/follow-counts`);
// → { followers: number, following: number }
```

Use this for profile headers. The paginated `/followers` and `/following` endpoints are still there for the "see all followers" detail screens — those responses include `total` in the body too, but the dedicated count endpoint skips the pagination scan entirely.

#### Role / title

There is no "Worship Leader at Grace Community" string anywhere in the backend or DB — that's pure frontend mock copy. The real role data lives in tenant memberships:

```ts
// Returns the *current user's* memberships
const session = await apiClient.get('/api/auth/session');
// session.memberships[]: { tenantId, tenantName, role, permissions }
// session.currentTenantId
```

For viewing **another user's** role, the relevant endpoint is the tenant member listing:

```ts
const members = await apiClient.get(`/api/tenants/${tenantId}/members`);
// member: { userId, fullName, email, role, avatarUrl, ... }
```

Filter by `userId` to get the target user's role within the current tenant. If you need a "show me member X's role in tenant Y" lookup directly, ask — easy to add.

**Possible roles** (see `RoleGuard`): `admin`, `pastor`, `accountant`, `worship_leader`, `member`. Render them as friendly labels (e.g., `worship_leader` → "Worship Leader") in the UI.

#### Profile metadata that DOES come from the user record

`GET /api/users/:id/profile` (or whatever the existing endpoint is) returns the user's `fullName`, `avatarUrl`, bio, etc. Use this for everything the user controls about themselves; use the membership endpoints above for tenant-specific role/title.

### What to remove

Search the mobile profile screen for any of these strings and rip them out:
- `1.2K followers`, `1,200K`, any other hardcoded count
- `Worship Leader at Grace Community`, `Grace Community`
- Any `mockUser`, `placeholderProfile`, etc.

---

## Optional improvement — Foreground heartbeat for presence

The backend updates `last_seen_at` on every authenticated request, throttled to once per 5 minutes per user. So if the user is making any API calls (feed refresh, message send, etc.) at least every 5 min, they appear online to others.

If a user has the app open but is idle (e.g., reading a long post, scrolling without triggering API calls), they'll appear offline after 5 min. To keep them appearing online while the app is foregrounded, fire a cheap heartbeat:

```ts
// Foreground-only timer (Expo example)
useEffect(() => {
  const tick = () => apiClient.get('/api/auth/session').catch(() => {});
  const id = setInterval(tick, 4 * 60 * 1000); // every 4 min
  return () => clearInterval(id);
}, []);
```

Any authenticated GET works as a heartbeat — `/api/auth/session` is a good choice because it's cheap and non-mutating. 4 minutes ensures we beat the 5-min staleness window even if a tick is delayed.

This is optional — not strictly needed for the test round. Add it once everything else is solid if presence accuracy matters.

---

## Test checklist after rebuilding the APK

- [ ] Log in successfully (you mentioned this was env-var related — confirm the new APK is built against `EXPO_PUBLIC_API_URL=https://church-app-backend-27hc.onrender.com`)
- [ ] Create a DM with another user (search → tap user → "message" — should reach the chat screen, no 500)
- [ ] Send a text message — should appear immediately
- [ ] Send a photo attachment — should upload and send without "UUID is expected"
- [ ] Search for a user → tap follow button on the search row → button toggles, status persists when navigating to their profile
- [ ] View another user's profile → followers/following counts are real numbers, role label is one of the canonical roles (or hidden if user has no admin role)
