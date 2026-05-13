# Shepard Mobile — In-App Notification Banners (Live)

## What this is

When the user has the app foregrounded and someone messages / comments / likes / sends a family request / etc., the mobile shows a top-of-screen banner ("toast / dropdown") with the notification. The bell badge count updates the same instant. No polling.

The backend already inserts a row into `public.notifications` for every event. The mobile subscribes to those inserts over Supabase's real-time channel — sub-second latency, zero new backend endpoints.

**Backend origin:** `https://church-app-backend-27hc.onrender.com` — endpoints live under `/api/...`.

---

## What was done backend-side

**Migration 062 (applied to prod):**

1. Added `public.notifications` to the `supabase_realtime` publication. Postgres now broadcasts every INSERT to subscribers via Supabase Realtime.
2. Added `in_app_notifications BOOLEAN DEFAULT true` to `public.user_settings` so users can toggle this independently from device push.

**Code (deployed):**

- `UserSettings` entity, `UpdateSettingsDto`, and `getSettings/updateSettings` all accept and return `inAppNotifications`.
- RLS SELECT policy on `notifications` is already `recipient_id = auth.uid()` — Supabase Realtime respects RLS, so each user can only receive realtime events for rows where they're the recipient. **No leakage.**

That's the entire backend change. Everything else is mobile.

---

## Mobile pattern — Supabase Realtime subscription

You already use `@supabase/supabase-js` for auth. The same client subscribes to the realtime channel. One-time setup:

```ts
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL!,
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
);

// After login, store the session so Realtime auth is set:
await supabase.auth.setSession({
  access_token: tokens.accessToken,
  refresh_token: tokens.refreshToken,
});
```

The session is what gates Realtime against RLS — without it, the subscription gets zero events because RLS denies anon.

### Subscribe at app-foreground

```ts
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import type { RealtimeChannel } from '@supabase/supabase-js';

function useNotificationStream(userId: string, onArrive: (notif: Notification) => void) {
  const channelRef = useRef<RealtimeChannel | null>(null);

  useEffect(() => {
    if (!userId) return;

    function connect() {
      if (channelRef.current) return;
      const channel = supabase
        .channel(`notifications:${userId}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'notifications',
            filter: `recipient_id=eq.${userId}`,
          },
          (payload) => {
            // payload.new is the inserted row, shape matches GET /api/notifications
            onArrive(mapDbRowToNotification(payload.new));
          },
        )
        .subscribe();
      channelRef.current = channel;
    }

    function disconnect() {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    }

    connect();
    const sub = AppState.addEventListener('change', s => {
      if (s === 'active') connect();
      else disconnect();
    });
    return () => {
      disconnect();
      sub.remove();
    };
  }, [userId, onArrive]);
}

function mapDbRowToNotification(row: any): Notification {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    data: row.data,  // already JSONB, parsed by the supabase client
    sender: row.sender_id ? { id: row.sender_id } : null,  // hydrate later if you need name/avatar
    isRead: !!row.read_at,
    createdAt: row.created_at,
  };
}
```

The `filter: recipient_id=eq.${userId}` is enforced both client-side (wire-level) and server-side (RLS). Sub-second delivery.

### Showing the banner

Pair the subscription with a toast library (e.g. `react-native-toast-message`, `sonner-native`, or a custom in-house component). On every `onArrive`:

```ts
useNotificationStream(currentUser.id, (notif) => {
  // 1. Increment the bell badge optimistically
  setUnreadCount(c => c + 1);

  // 2. Respect the user's in-app toggle
  if (!settings.inAppNotifications) return;

  // 3. Show the banner with a tap handler that deep-links
  showToast({
    title: notif.title,
    body: notif.body,
    icon: iconForType(notif.type),
    onTap: () => {
      // The data column already carries { screen, params } for deep-linking —
      // same fields the bell-screen uses on tap.
      if (notif.data?.screen) {
        navigation.navigate(notif.data.screen, notif.data.params);
      }
    },
  });
});
```

### Per-type banner copy

The DB row has `title` and `body` already filled in. For chat (the only type where the body is just the message preview), you may want a richer template:

| `type` | Banner title | Banner body |
|---|---|---|
| `NEW_MESSAGE` | `notif.title` ("Zel") | `notif.body` (the message preview) |
| `NEW_COMMENT` | `notif.title` ("Zel commented on your post") | `notif.body` (preview) |
| `family_request` | `notif.title` ("Family Connection Request") | `notif.body` ("Zel wants to add you as their Father") |
| `family_accepted` | "Family request accepted" | `notif.body` |
| `POST_LIKE` (when wired) | "New like" | `notif.body` |

The backend pre-formats `title` and `body` for every type. Mobile can pass them through directly — only override per-type if you want a different visual style (e.g. green for likes, blue for comments).

---

## Settings toggle

`GET /api/users/me/settings` now returns:

```ts
{
  userId,
  emailNotifications: true,
  pushNotifications: true,
  smsNotifications: false,
  inAppNotifications: true,    // ← new
  updatedAt
}
```

`PUT /api/users/me/settings` accepts any subset of those fields. Add the toggle to the notification settings screen alongside the others.

**Semantics:**

| Setting | What it controls |
|---|---|
| `pushNotifications` | Device push (Expo / APNs / FCM) when app is **not** foregrounded |
| `inAppNotifications` | Banner/toast over the UI when the app **is** foregrounded |
| `emailNotifications` | Email digests (not wired for most events yet — informational) |
| `smsNotifications` | SMS via Twilio (broadcasts only) |

The mobile reads `inAppNotifications` and short-circuits the toast if it's `false`. The Realtime subscription keeps running (to update the bell badge), but no banner appears.

---

## Why this approach

- **No new endpoints, no polling, no WebSocket gateway code.** Supabase Realtime is already running in the project; the table just had to be added to the publication.
- **Sub-second latency.** Postgres logical replication → Supabase Realtime → mobile client. Typical end-to-end is 100–400ms.
- **Authenticated + tenant-safe.** RLS on `notifications` restricts to `recipient_id = auth.uid()` AND `tenant_id = current_tenant`. A user can't subscribe to anyone else's stream even if they tried.
- **Battery-friendly.** A long-lived WebSocket consumes far less than 30-second polling.

---

## Test checklist

After wiring on mobile:

- [ ] Open the app on two devices, A and B
- [ ] Device A sends Device B a message → B sees a banner within 1–2 seconds and the bell badge increments
- [ ] Device A likes B's post → same
- [ ] Device A comments on B's post → same
- [ ] Device A sends B a family request → same
- [ ] B accepts → A sees a banner ("family request accepted")
- [ ] B toggles **In-app notifications** OFF in settings → next event from A shows up in the bell but NO banner appears
- [ ] B backgrounds the app → A messages → B gets a normal device push (banner doesn't fight with it)
- [ ] B signs out → subscription cleanly tears down, no leaks (verify with Supabase realtime dashboard if needed)

---

## One thing not handled here

Push de-duplication when both push and in-app fire on a foregrounded device. Expo on iOS shows foreground push as a system banner by default unless you set `presentation: 'none'` in `setNotificationHandler`. The cleanest approach:

```ts
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: false,   // suppress Expo's own banner
    shouldPlaySound: false,
    shouldSetBadge: true,     // still update the iOS badge
  }),
});
```

That way the in-app toast is the only visible alert when the app is foregrounded, and Expo's system push only appears when the app is backgrounded. Wire this once in the mobile root.
