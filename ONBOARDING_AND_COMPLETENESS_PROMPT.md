# Mobile Handoff — Onboarding Forms + Profile Completeness + Attendance Push Clarification

Two things shipped in this batch + one clarification on a prior commit.

---

## 1. Onboarding forms (already fully functional — confirming for the team)

Admins can configure a per-church onboarding form with both pre-built
fields from a 50+ item curated library AND custom fields. The form is
fully wired end-to-end — admin → mobile signup → response storage →
auto-populated `member_journeys` row.

### Mobile-side flow

**During signup, BEFORE auth call:**

```
1. Mobile collects required-for-auth fields (email, password)
2. Mobile collects "essential" fields (mobile UX choice: name, phone)
3. If user chose a tenant → fetch the onboarding form:
   GET /api/onboarding/<tenantId>/form          (NO auth required)
4. Render form (skip if no form is configured or is_active=false)
5. Collect responses
6. POST /api/auth/signup with body:
   { email, password, fullName?, tenantId, onboardingResponses }
   The auth service writes responses + auto-populates the journey row
```

### Form response shape

`GET /api/onboarding/<tenantId>/form` returns:

```jsonc
{
  "id": "form-uuid",
  "tenantId": "...",
  "isActive": true,
  "welcomeMessage": "Welcome to Grace Church!",
  "fields": [
    {
      "key": "is_saved",
      "label": "Have you accepted Jesus Christ as your Lord and Savior?",
      "description": "Salvation status",
      "type": "boolean",
      "category": "spiritual",
      "required": true,        // per-field flag set by the admin
      "isCustom": false
    },
    {
      "key": "interests",
      "label": "What areas of ministry interest you?",
      "type": "multiselect",
      "category": "interests",
      "options": ["Worship/Music", "Youth Ministry", ...],
      "required": false,
      "isCustom": false
    },
    {
      "key": "custom-favoriteVerse",
      "label": "What's your favorite Bible verse?",
      "type": "textarea",
      "category": "custom",
      "required": false,
      "isCustom": true        // admin-added, not from the library
    }
  ]
}
```

Field types: `text | textarea | select | multiselect | date | boolean | number | phone | email`.
Categories: `spiritual | personal | family | interests | background | custom`.

If the response is `null`, the admin hasn't configured a form yet — skip
the onboarding step in your signup wizard. **The form is optional** —
users can still sign up and join.

### Auto-populated journey fields

When responses are submitted, these keys auto-populate the
`member_journeys` table:

| Response key | Maps to journey field |
|---|---|
| `is_baptized` | `is_baptized` |
| `baptism_date` | `baptism_date` |
| `salvation_date` | `salvation_date` |
| `is_saved=true` (without `salvation_date`) | sets `salvation_date` to today |
| `interests` | `interests` |
| `skills` | `skills` |
| `faith_journey` | `discipleship_track` (mapped: "Just exploring"→"exploring", "New believer"→"foundations", etc.) |

The rest of the responses live on the `onboarding_responses` row and
are visible to admins via `GET /api/onboarding/responses`.

---

## 2. NEW: Profile completeness API + volunteer gate

The pastor's spec: volunteer signup (and similar features) should
require contact info first. If phone/email/address are missing, the
mobile should prompt the user to fill them in instead of letting the
signup go through.

### New endpoint

`GET /api/users/me/profile-completeness`

Returns one entry per **requirement set** with what's missing:

```jsonc
{
  "sets": {
    "core": {
      "complete": true,
      "missing": []
    },
    "volunteer": {
      "complete": false,
      "missing": [
        { "field": "address", "label": "Mailing address" }
      ]
    },
    "child_pickup": {
      "complete": false,
      "missing": [
        { "field": "address", "label": "Mailing address" },
        { "field": "emergencyContact", "label": "Emergency contact (name + phone)" },
        { "field": "dateOfBirth", "label": "Date of birth (for ID matching)" }
      ]
    },
    "group_leader": {
      "complete": false,
      "missing": [
        { "field": "address", "label": "Mailing address" },
        { "field": "phoneSecondary", "label": "Secondary phone number" }
      ]
    }
  }
}
```

### Requirement sets (server-defined product policy)

| Set | Fields required |
|---|---|
| **`core`** | `fullName`, `email`, `phone` |
| **`volunteer`** | core + `address` (street + city + state + postalCode all populated) |
| **`child_pickup`** | core + `address` + `emergencyContact` (name + phone) + `dateOfBirth` |
| **`group_leader`** | core + `address` + `phoneSecondary` |

To add new sets, edit `src/users/profile-completeness.service.ts`. They
intentionally live in code (not a config table) — adding a new
requirement set is a code change because it ties to a specific feature
endpoint's behavior.

### Gating behavior

`POST /api/volunteer/opportunities/:id/signup` now calls
`completeness.require(userId, 'volunteer')` before the INSERT.

If incomplete, the response is:

```http
HTTP/1.1 400 Bad Request

{
  "statusCode": 400,
  "message": "Profile incomplete",
  "code": "PROFILE_INCOMPLETE",
  "requirementSet": "volunteer",
  "missing": [
    { "field": "address", "label": "Mailing address" }
  ]
}
```

**Mobile pattern:**
1. Check `profile-completeness.sets.volunteer.complete` before showing
   the "Sign up to volunteer" button as enabled.
2. If incomplete, show a disabled state with a "Complete your profile
   to volunteer" CTA that opens the profile editor pre-scrolled to
   the missing field.
3. As a backstop, if the user somehow hits the endpoint with an
   incomplete profile (e.g. via deep link), parse the 400 response and
   show the same "Complete your profile" sheet — the `missing` array
   tells you exactly which fields to highlight.

### Push reminders (optional — your call)

The backend does **not** auto-fire a push notification when a user
attempts something with an incomplete profile. The rationale: the user
is literally in the app at that moment — a local prompt is the right
UX, not a push. If you want a periodic "fill in your profile" nudge
(daily, weekly, etc.), build it client-side OR ask me to add a
backend cron that fires `notifications.profile_incomplete` to opted-in
members weekly.

---

## 3. CLARIFICATION on the auto-attendance scheduler

You raised a concern about the cron pushing every minute for 24 hours.
**That's not what's happening, but the doc wasn't clear enough.** And —
the pastor's spec called for two checks per service (start + end), so I
added the missing end-of-service push while I was here.

### How the cron actually works

The scheduler **ticks** every minute, but the work each tick does is a
~5ms query that's a **no-op 1438 minutes per day**. Pushes go out
**exactly once per service occurrence**.

Concrete example for one Sunday 9am–10:30am service:
- At 8:59 → tick runs, query returns nothing (no occurrence starting in next 60s yet). No-op.
- At 9:00 → tick runs, query finds the 9am occurrence (`starts_at ≤ now + 60s AND start_push_sent_at IS NULL`). Push fires. `start_push_sent_at` is set.
- At 9:01 → tick runs, query returns nothing (same occurrence is now disqualified by `start_push_sent_at IS NULL`). No-op.
- ... (1438 more no-op ticks) ...
- At 10:27 (3 min before 10:30 end) → end-push tick fires. `end_push_sent_at` is set. Mobile sends final location.
- At 10:35 (5 min after end) → sweep tick computes attendance. `swept_at` is set.
- ... no more activity until the next service ...

So a member at a church with one Sunday service receives **two push
notifications per Sunday** — one at start, one near the end. Not 1440.

### Migration 081: end-of-service push (new, just shipped)

Added two columns:
- `service_occurrences.end_push_sent_at TIMESTAMPTZ NULL` (mirror of `start_push_sent_at`)
- `services.end_push_lead_minutes INT NOT NULL DEFAULT 3` — how many minutes before `ends_at` to fire the end push (3 = enough headroom for the push → mobile → backend round-trip to land before the 5-min sweep)

New scheduler entry `fireEndPushes()` runs alongside the existing tick.
Same lock-and-fire pattern — once per occurrence.

The end push:
- Title: `<Service name> — wrapping up`
- Body: `Final attendance check. Thanks for being with us today.`
- Data: `{ occurrenceId, kind: 'auto_attendance_ping', phase: 'end' }`

Mobile handler: when `data.kind === 'auto_attendance_ping'` AND
`data.phase === 'end'`, capture a high-accuracy location and POST to
`/api/attendance/ping` with `source: 'auto_push_reply'`. The sweep at
end + 5 min then has fresh data to detect early leavers correctly.

If you'd rather show a different end-push body (e.g. silent push with
no visible notification), the admin can configure `services.push_message`
which overrides the default. We can also add a separate
`services.end_push_message` field if you want different copy for start
vs end — just say so.

---

## Summary of new + changed endpoints

```
GET    /api/users/me/profile-completeness         (NEW — per-requirement-set check)
POST   /api/volunteer/opportunities/:id/signup    (CHANGED — 400 PROFILE_INCOMPLETE if missing fields)
                                                  (migration 081 adds end-of-service push, no API change)
```

---

## Suggested mobile work order

1. **Today, no new backend work needed for onboarding** — just confirm
   you're calling `GET /api/onboarding/<tenantId>/form` on the signup
   wizard and passing `onboardingResponses` through to `POST /auth/signup`.
2. **Add a "Complete your profile" screen** that calls
   `GET /api/users/me/profile-completeness`, renders each requirement
   set's missing fields as a checklist, and routes taps into the
   profile editor.
3. **Gate volunteer button** — check `sets.volunteer.complete` before
   showing it enabled. Handle the 400 PROFILE_INCOMPLETE response on
   the signup endpoint as the backstop.
4. **Auto-attendance end push** — when handling silent push from the
   backend, check `data.phase === 'end'` and capture a fresh location
   for the final sweep.

Everything is deployed via the next push to `main`.
