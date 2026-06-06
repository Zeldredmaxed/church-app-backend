# Mobile Handoff — Automated Geo-Attendance

Backend is fully wired. Migration 080 applied to prod. The pastor's
vision (auto-pings + start-of-service + end-of-service sweep to detect
late arrivers + early leavers) works end-to-end on the server. The
mobile side now needs the OS plumbing.

---

## How it works end-to-end

1. **Admin** sets up one or more services per church via the dashboard
   (Sunday 9am–10:30am at lat/lng with 800m radius, Wednesday 7pm, etc.)
2. Nightly at 02:00 UTC the backend **generates** `service_occurrences`
   rows for the next 30 days — one row per recurring service per date.
3. The **member opts in** in the app's settings ("auto-attendance"
   toggle). The opt-in is per (user × church) so a user who belongs to
   two churches can opt in for one and not the other.
4. At each service's start time (within ±60s) the backend **fires a
   push** to every opted-in member of that tenant with the body
   `Marking you present at <Service Name>. Make sure location is on.`
   That push wakes the app to send a fresh location.
5. The mobile app **POSTs the location** to `/api/attendance/ping`.
   Geofence entry/exit events also POST here whenever they fire.
6. At each service's end time + 5 min the backend **sweeps the ping
   log** and writes one `service_attendance` row per opted-in member:
   `status ∈ {present, absent}`, `was_late: bool`, `left_early: bool`,
   `first_in_radius_at`, `last_in_radius_at`, `ping_count`.

If the member is opted-out, the backend silently drops the ping
without recording any location — no data retained.

---

## Mobile responsibilities

### 1. Permissions

iOS `Info.plist` (already in the store-compliance handoff, but here
verbatim for clarity):

```jsonc
{
  "NSLocationWhenInUseUsageDescription":
    "Shepard uses your location to mark you present at services your church has configured.",
  "NSLocationAlwaysAndWhenInUseUsageDescription":
    "Shepard uses your location to mark you present at services your church has configured. Without 'Always Allow' permission, attendance only registers when the app is open.",
  "UIBackgroundModes": ["location", "fetch", "remote-notification"]
}
```

Android `app.json`:

```jsonc
{
  "android": {
    "permissions": [
      "ACCESS_COARSE_LOCATION",
      "ACCESS_FINE_LOCATION",
      "ACCESS_BACKGROUND_LOCATION",
      "POST_NOTIFICATIONS"
    ]
  }
}
```

**Important UX rule from Apple/Google reviewers:** never request
`ACCESS_BACKGROUND_LOCATION` / `Always Allow` until the user has first
**opted in** to auto-attendance. The flow is:

1. Open Settings → Auto-attendance → tap toggle ON
2. Show a rationale screen explaining: "Your church wants to mark you
   present at services. We'll only ping your location during these
   times: [list of upcoming service times from `GET /api/attendance/opt-in`]"
3. After the rationale, request `WhenInUse` permission
4. After `WhenInUse` is granted, request `Always Allow` / background
   location (iOS only — Android prompts separately)
5. Register the geofence
6. POST `/api/attendance/opt-in` with `{ optedIn: true }` only after
   all of the above succeed

If the user denies background location, store the opt-in as on but
**show a banner** saying "Auto-attendance is on, but you'll only be
counted when you have the app open during service. Tap to grant
background access."

### 2. Geofence registration

Register a `CLCircularRegion` (iOS) / `Geofence` (Android) for each
service the user's current tenant has — pull from
`GET /api/attendance/opt-in.upcomingOccurrences` or the dedicated
`GET /api/attendance/upcoming` endpoint.

Each geofence:
- Center at `(service.latitude, service.longitude)`
- Radius = `service.radiusMeters` (default 800m)
- Notify on entry **AND** exit

When the OS fires the entry/exit callback, immediately POST to
`/api/attendance/ping` with `source: 'geofence_entry'` or
`'geofence_exit'`.

**Limit:** iOS allows 20 simultaneous geofences per app. With one
geofence per service and most churches running ≤3 services per week
at one campus, you're fine. If a church has more, register only the
geofences for the next 2 occurrences.

### 3. Foreground pings

When the app is in the foreground and the user is within the church's
service window (check `upcomingOccurrences` for `startsAt - 30 min ≤
now ≤ endsAt + 30 min`), opportunistically POST a foreground ping
every ~3 min. `source: 'foreground'`.

### 4. Silent-push handler

When the backend's auto-push lands during a service window
(notification `data.kind === 'auto_attendance_ping'`):

- iOS: declare a notification service extension, get the current
  location with high accuracy, POST to `/attendance/ping` with
  `source: 'auto_push_reply'`, then suppress the notification (return
  `false` from the handler).
- Android: handle in a foreground service triggered by the data push.

If you can't suppress the notification (iOS won't always let you on
older OS versions), let the visible notification show — it doubles as
transparency that the church is checking attendance right now.

### 5. Settings screen — transparency requirement

Per the pastor: a settings screen that shows the **exact ping times**
for the user's church, so they can see what they're opting into.

`GET /api/attendance/opt-in` returns:

```jsonc
{
  "optedIn": true,
  "optedInAt": "2026-05-14T...",
  "optedOutAt": null,
  "updatedAt": "...",
  "upcomingOccurrences": [
    {
      "occurrenceId": "...",
      "serviceName": "Sunday Worship",
      "occurrenceDate": "2026-05-19",
      "startsAt": "2026-05-19T14:00:00Z",
      "endsAt": "2026-05-19T15:30:00Z",
      "isCancelled": false,
      "lateThresholdMinutes": 15,
      "earlyLeaveThresholdMinutes": 15,
      "radiusMeters": 800
    },
    ...next 14 days
  ]
}
```

Render a list:
```
🟢 Auto-attendance is ON
You'll be pinged at these times:
  Sunday, May 19   9:00 AM – 10:30 AM
  Wednesday, May 22   7:00 PM – 8:30 PM
  ...
```

When the user taps the toggle to OFF, POST `{ optedIn: false }`. The
backend stops processing pings immediately. Mobile should also
**unregister geofences** + stop foreground pings to be a good citizen.

---

## API summary

| Method | Path | Who | Body / Query | Returns |
|---|---|---|---|---|
| `GET` | `/api/attendance/opt-in` | member | — | `{ optedIn, optedInAt, optedOutAt, upcomingOccurrences[] }` |
| `POST` | `/api/attendance/opt-in` | member | `{ optedIn: boolean }` | same as GET |
| `POST` | `/api/attendance/ping` | member | `{ lat, lng, accuracyMeters?, source? }` | `{ recorded, pingId?, serviceOccurrenceId?, distance?, inRadius? }` |
| `GET` | `/api/attendance/upcoming` | member | `?days=14` | array of occurrences (next N days) |
| `GET` | `/api/services` | admin/pastor | — | array of services with `upcomingOccurrenceCount` |
| `POST` | `/api/services` | admin/pastor | `CreateServiceDto` | created service |
| `PATCH` | `/api/services/:id` | admin/pastor | `UpdateServiceDto` | updated service |
| `DELETE` | `/api/services/:id` | admin/pastor | — | `{ deactivated: true }` |
| `POST` | `/api/services/occurrences/:id/cancel` | admin/pastor | `{ reason? }` | `{ cancelled: true }` |
| `GET` | `/api/services/occurrences/:id/attendance` | admin/pastor | — | `{ occurrence, counts, attendees[] }` |

### Ping rate limit

`POST /api/attendance/ping` is throttled to **30/min per IP**. That's
generous (a foreground ping every 3 min = 20/hour) but blocks runaway
background loops.

### Opt-out behavior

- If the user has no `attendance_opt_in` row, or has one with
  `opted_in=false`, the backend returns
  `{ recorded: false, reason: 'not_opted_in' }` for any ping and
  **never writes the location to disk**.
- Switching churches resets — opt-in is per-tenant. If you switch from
  Church A (opted in) to Church B (no opt-in), pings to B's window get
  silently dropped.

---

## Status computation (so you know what the dashboard will show)

After end-of-service + 5 min, for each opted-in member:
- **status**: `present` if ≥1 in-radius ping during the window; else `absent`
- **was_late**: first in-radius ping > `startsAt + lateThresholdMinutes`
- **left_early**: last in-radius ping < `endsAt - earlyLeaveThresholdMinutes`

A user can be `present` + `was_late=true` + `left_early=true` (came
late and left early). The dashboard will show all three counts:
`23 present, 12 late, 5 left early`.

If a member opted in **after** the sweep ran, no service_attendance
row exists for them for that occurrence — they're effectively
unrecorded. That's intentional (we don't retroactively guess).

---

## Edge cases worth knowing

1. **Member is in radius all the time** (they live across the street
   from the church): they'll show `present` for every service whether
   they actually attended or not. This is a known limitation of
   geofence-based attendance and is mentioned in the privacy/opt-in
   copy ("if you live near the church, auto-attendance may not
   accurately reflect physical presence").
2. **Service has no end_time** (legacy row from before migration 080):
   the occurrence generator skips it — no automation will fire. Edit
   the service via PATCH to set `endTime` and the next nightly run
   picks it up.
3. **Service is cancelled** (holiday, weather): admin calls
   `POST /api/services/occurrences/:id/cancel`. Start-push cron skips,
   end-sweep cron skips. Pings that already landed before cancellation
   stay in the log but aren't aggregated into attendance.
4. **Mobile is offline during service**: pings buffer in the OS until
   reconnect, then post. The backend accepts pings with a `recordedAt`
   in the past as long as they fall in the window (with the 30-min
   lead-out). For pings that arrive AFTER the sweep ran, no attendance
   is updated — there's currently no re-sweep path. Possible follow-up
   if it bites in practice.
5. **iOS kills the app**: geofence callbacks still wake it. iOS
   handles this transparently. Android's WorkManager also persists
   across reboots.

---

## Render deploy notes

The scheduler runs `@Cron(EVERY_MINUTE)` on every Render instance. The
DB locks (`UPDATE … WHERE start_push_sent_at IS NULL RETURNING id`)
guarantee exactly-once delivery even when Render scales to multiple
instances.

The occurrence generator runs once a day at 02:00 UTC. No special
configuration needed — `@nestjs/schedule` reads the cron string from
the decorator.

---

## Suggested mobile work order

1. Wire `Settings → Auto-Attendance` toggle that calls
   `GET /api/attendance/opt-in` + `POST /api/attendance/opt-in`.
2. Render the upcoming-occurrences list on the opt-in screen for
   transparency.
3. Request `WhenInUse` then `Always Allow` location after opt-in.
4. Register geofences for the next 2 occurrences per service.
5. Wire the geofence entry/exit handler to POST to
   `/api/attendance/ping` with the right `source`.
6. Wire the silent-push handler for `data.kind === 'auto_attendance_ping'`
   to capture a high-accuracy location and POST it.
7. Add a foreground 3-min ping when the app is open during a service
   window.

That's everything backend-side. Render will auto-deploy on the next
push.
