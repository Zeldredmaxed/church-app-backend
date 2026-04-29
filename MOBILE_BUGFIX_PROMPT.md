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

## Bug 3 — Push notifications: device tokens never get registered

### Symptom
> Push notifications never arrive, even though backend logs show `[NotificationsProcessor] Processing job N: NEW_MESSAGE` etc.

### Cause
Verified against prod: the test user has **zero rows** in `device_tokens`. The backend dispatches push jobs correctly, but the processor finds no token to send to, so each job is a no-op. The mobile app isn't calling `POST /api/notifications/register-device` after login.

### Fix
Wire device registration into the post-login flow. Expo example:

```ts
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

async function registerForPushNotifications(apiClient) {
  // 1. Request permission (iOS prompts on first call; Android 13+ requires it explicitly)
  const { status } = await Notifications.requestPermissionsAsync();
  if (status !== 'granted') {
    // User declined — leave them un-registered. Optionally show a settings deep-link.
    return;
  }

  // 2. Acquire the Expo push token (requires permission AND a real device — Expo Go works,
  //    simulators do not. Standalone APK/IPA needs `expo-notifications` configured in app.json.)
  const tokenResult = await Notifications.getExpoPushTokenAsync();
  const token = tokenResult.data; // e.g. "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]"

  // 3. POST it to the backend
  await apiClient.post('/api/notifications/register-device', {
    token,
    platform: Platform.OS, // 'ios' | 'android'
  });
}
```

**Where to call this:**
- After every successful login (in the auth-success handler)
- On app foreground if you want to refresh stale tokens (Expo can rotate them)
- The endpoint is idempotent on `(user_id, token)` — calling it repeatedly is safe

**On logout:**
```ts
await apiClient.delete('/api/notifications/unregister-device', { data: { token } });
```
This deactivates the token so the now-logged-out device doesn't keep getting the previous user's pushes.

### How to verify it worked
After logging in once with the new code, ping me — I can check `device_tokens` directly and trigger a test push (have a demo user DM you). The push should land within ~5 seconds.

### Notes
- **Standalone APK requires `expo-notifications` in `app.json`** (`"plugins": ["expo-notifications"]`) — without it, `getExpoPushTokenAsync()` returns nothing in the production build even though it works in Expo Go.
- **iOS additionally needs an APNs key** uploaded to Expo's dashboard. Not a concern for Android-only testing right now.
- The backend currently routes everything through Expo Push — the OneSignal columns in `device_tokens` are a legacy artifact; ignore them. Just send `{ token, platform }`.

---

## Bug 4 — Notifications screen shows count but renders empty list

### Symptom
> The notifications badge shows "4 notifications," but when the user taps it, the screen shows nothing — empty list. Verified the user actually has unread notifications in the DB.

### Cause (verified server-side)
The backend is fine. I hit `/api/notifications` as the affected user against live prod and got back all 4 notifications fully-formed. The count comes from the same data source as the list — there's no scenario where the count can be > 0 and the list is genuinely empty. So this is a parser or render bug on mobile.

### What the API actually returns

```ts
GET /api/notifications
→ {
  notifications: [
    {
      id: "uuid",
      type: "NEW_MESSAGE",     // also: NEW_COMMENT, POST_MENTION, NEW_GLOBAL_POST, etc.
      title: "Zel",            // sender name or notification title
      body: "Replied to your story...",
      data: {
        params: { userId: "uuid" },
        screen: "Conversation"
      },
      sender: {
        id: "uuid",
        fullName: "Zel",
        avatarUrl: "https://..."
      },
      isRead: false,
      createdAt: "2026-04-29T12:19:20.538Z"
    },
    ...
  ],
  unreadCount: 4,
  total: 4,
  page: 1
}

GET /api/notifications/unread-count
→ { count: 4 }
```

The list endpoint accepts `?unreadOnly=true&limit=20&page=1` for filtering/pagination if you need it.

### Likely root causes (in order of probability)

1. **Response parser mismatch.** The list code reads the response wrong — e.g., expects a flat array, or reads `data` as the top-level key, or destructures `items` instead of `notifications`. The list field is literally `response.notifications` (or `response.data.notifications` if your client wraps responses). Confirm by logging the parsed object right after the fetch.

2. **Auto-navigation on render crashes the screen.** Each notification has `data.screen` (e.g., `"Conversation"`). If your render code tries to `navigation.navigate(notification.data.screen, ...)` for every item on render instead of only on tap, and one of those screen names isn't registered in your nav stack, React Navigation throws and the list unmounts. The `data.screen` field is meant for *click-to-navigate* (tap an item → go to that screen), not for auto-routing.

3. **Wrong endpoint URL.** Mobile might be hitting `/api/notifications/list` or `/api/notifications/all` — neither exists. The correct path is just `/api/notifications`. Check the actual outgoing request URL.

4. **Silent ErrorBoundary.** Some prop being `undefined` (e.g., `sender.avatarUrl` for a notification with no avatar — though our data always sets it) causes a render error that an ErrorBoundary swallows, leaving the list area blank.

### Quickest debug

In the notifications-screen component, right after the API call:

```ts
const res = await apiClient.get('/api/notifications');
console.log('[NOTIF-DEBUG]', JSON.stringify(res, null, 2));
console.log('[NOTIF-DEBUG] notifications array:', res.notifications?.length);
```

If `res.notifications` is an array of 4 → it's a render bug, look at the FlatList/map. If `res.notifications` is `undefined` → it's a parser/path bug, check the request URL and response handling.

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
- [ ] Grant the notification permission prompt on first launch → `device_tokens` row appears for your user → sending a DM from another user causes your phone to buzz within ~5s
- [ ] Tap the notifications badge with unread items → list renders all of them (not empty); each item shows sender name, body, relative time
- [ ] View another user's profile → followers/following counts are real numbers, role label is one of the canonical roles (or hidden if user has no admin role)
