# Reply to Admin Dashboard Audit (2026-06-05)

Going through each section. Most of your "missing" routes actually exist
— GET probes are 404ing because they're POST/PUT/DELETE handlers. The
genuine gaps and contract questions are addressed below, with new
builds committed in migration 082 + this batch.

---

## §1 — Routes you flagged as missing

**TL;DR: most exist; you were probing them with GET.** Confirmations + corrections:

| Your call | Reality | Notes |
|---|---|---|
| `POST /communications/send` | ✅ exists, `src/communications/communications.controller.ts:80`, admin/pastor guarded | Works |
| `POST /communications/schedule` | ✅ exists, line 91 | Works |
| `POST /communications/segment-preview` | ✅ exists, line 50 | Works. `previewSegment` body shape: `{ rules: Record<string, any> }` |
| `POST /tenants/:tenantId/members/import` | ✅ exists, `memberships.controller.ts:235` | Note path is `:tenantId` not `:id` — NestJS-positional so it doesn't matter at the wire, but Swagger / docs use `:tenantId` |
| `PUT /members/:userId/journey` | ✅ exists, `member-profiles.controller.ts:67` | Note `:userId` not `:id` |
| `GET /family/:id` | ❌ **path mismatch** — actual is `GET /family/members/:userId` (line 121) | Update the hook |
| `GET /family/:id/tree` | ❌ **path mismatch** — actual is `GET /family/tree/:userId` (line 131) | Update the hook |
| `POST /facilities/bookings` | ✅ exists, `facilities.controller.ts:51` | Works |
| `DELETE /facilities/bookings/:id` | ✅ exists, line 70 | Works |
| `PATCH /tenants/:tenantId/campuses/:campusId` | ✅ exists, `campus.controller.ts:53` | Note `:tenantId` not `:id` |
| `POST /volunteer/hours` | ✅ exists, `volunteer.controller.ts:47` | Works |

**Action for you:** fix the two family hooks to use `/family/members/<userId>` and `/family/tree/<userId>`. Everything else just needs you to issue the right HTTP method.

---

## §2 — POST/PUT routes to confirm

All exist:

- `POST /stripe/connect/onboard` — ✅ `stripe-connect.controller.ts:41`
- `POST /giving/batch` — ✅ singular, `giving.controller.ts:123` (`giving/batch` ↔ `giving/batches` is intentional REST: create=singular noun, list=plural)
- `POST /volunteer/opportunities/:id/signup` — ✅ `volunteer.controller.ts:69`. **Now profile-gated** — returns 400 with `{ code: 'PROFILE_INCOMPLETE', missing: [{field, label}] }` if caller is missing phone/email/address (see Sweep doc + `ONBOARDING_AND_COMPLETENESS_PROMPT.md`)
- `POST /badges/check` — ✅ exists, returns the rich AchievementModal payload (see `ACHIEVEMENT_MODAL_PROMPT.md`). 60-second cached per user.
- `POST /leaderboard/app-open` — ✅ `leaderboard.controller.ts:99`, fire-and-forget
- `POST /workflow-store/publish` — ✅ `marketplace.controller.ts:92`
- `POST /workflow-store/seed-official` — ✅ `marketplace.controller.ts:149`

---

## §3 — Contract / behavior confirmations

### 3.1 Auth refresh — body in, body out (NOT cookie)

The frontend's current implementation is correct. The 57-day-old spec is outdated. Live contract:

```
POST /api/auth/refresh
Content-Type: application/json
Body: { "refreshToken": "..." }

200 OK
{ "accessToken", "refreshToken", "expiresAt", "user" }
```

No httpOnly cookie. No `credentials: include` needed. `sessionStorage` is fine. The auto-retry on 401 will work as long as the client reads the new pair from the response body.

### 3.2 Workflow execution

✅ **Confirmed: `POST /workflows/:id/trigger` actually executes the saved node graph.** Calls `workflowEngineService.executeWorkflow(workflowId, tenantId, targetUserId, triggerData)` which walks the node graph, runs each node type, and writes `workflow_execution_logs` rows per node. The dashboard can rely on it.

### 3.3 Public iCal feed — ✅ **NEW endpoint shipped**

The old `/events/ical/:tenantId` was bearer-auth gated and would 401 external calendars. **Two new endpoints:**

- `POST /api/events/ical/regenerate-token` (admin, auth required) — generates or rotates the tenant's iCal subscription token. Returns `{ token, url }`. URL is the one you give Google/Apple/Outlook.
- `GET /api/events/ical-public/:tenantId?token=<token>` (**public, no auth**) — the actual feed external calendars subscribe to. Token-authenticated via constant-time compare. 15-min Cache-Control.

The old `/events/ical/:tenantId` remains for backward compat (still bearer-gated) — feel free to remove that hook entirely and route admins to a "Get subscribe URL" button that hits `POST /events/ical/regenerate-token`.

### 3.4 attendance/bulk + visitors — eventId vs serviceId — ✅ **NEW field shipped**

You were right that this was silently mislinking. Resolution:

- `serviceId` refers to a **recurring service slot** (Sunday 9am, Wed 7pm) from `/api/services` — the new attendance schedule
- `eventId` refers to a **one-off event** from `/api/events` (the Easter service, the leadership banquet)

Both are now first-class fields on `POST /api/attendance/bulk` and `POST /api/attendance/visitors`:

```jsonc
{
  "userIds": [...],
  "serviceId": "optional service uuid",
  "eventId": "optional event uuid"
}
```

Both nullable, both can coexist (rare — e.g. an event during a Sunday service). `check_ins` now has both columns (migration 082 added `event_id UUID NULL REFERENCES events(id) ON DELETE SET NULL`). Dedupe is per `(user, service_id, event_id, date)`.

**For your Events page Check-In tab:** send `eventId`, leave `serviceId` empty.

### 3.5 TenantFeatures shape

✅ Confirmed. `GET /api/tenants/:id/features` response:

```jsonc
{
  "tenant": {
    "id": "...",
    "name": "...",
    "slug": "...",
    "tier": "standard" | "premium" | "enterprise",
    "tierDisplayName": "Premium",
    "campusName": "...",
    "parentTenantId": "...",
    "brandColor": "#5B7CFA" | null,
    "isGuest": false
  },
  "features": { ...tier feature flags... },
  "campus": { ... } | undefined  // present if tenant is part of multi-site
}
```

### 3.6 GET /tasks query params

✅ `assignedTo` is honored (`tasks.controller.ts:40`). `overdue=true` / `dueBefore=` are **NOT** yet implemented — let me know if you want them this sprint. Easy add.

### 3.7 List envelopes

The wrapper keys per endpoint:

| Endpoint | Envelope |
|---|---|
| `GET /admin/moderation` | `{ items: [...], nextCursor, counts: { pending, reviewed, removed } }` |
| `GET /admin/family/relationships` | `{ relationships: [...] }` |
| `GET /notifications/broadcasts/history` | `{ broadcasts: [...] }` |
| `GET /volunteer/hours/pending` | `{ pending: [...], count }` |
| `GET /audit-log` | `{ entries: [...], nextCursor }` |
| `GET /admin/account-deletions` (NEW this batch) | `{ data: [...] }` |

Per the audit sweep, new endpoints standardize on `data: [...]`. Legacy keys (`items`, `entries`, `broadcasts`, etc.) stay as-is so we don't break existing consumers.

### 3.8 Audit-log row fields

`GET /audit-log` rows have this shape (`audit.service.ts:212`):

```jsonc
{
  "id": "...",
  "action": "post.deleted",
  "actor": {
    "id": "...",
    "fullName": "...",       // ← use this, not actorName
    "avatarUrl": "...",
    "roleAtTime": "admin"    // ← use this for the role pill, not actorRole
  },
  "target": {
    "id": "...",
    "fullName": "...",
    "avatarUrl": "..."
  } | null,
  "resourceType": "post",
  "resourceId": "...",
  "summary": "...",          // ← use this directly, no fallback needed
  "metadata": { ... },
  "createdAt": "..."
}
```

Your fallback chain works but the canonical field names are: `actor.fullName`, `actor.roleAtTime`, `target.fullName`, `summary`.

### 3.9 Notification categories

`GET /api/notifications/categories` (shipped earlier) returns:

```jsonc
{
  "categories": [
    { "key": "post_like", "label": "Post likes", "description": "...", "group": "Social", "defaultPush": true, "defaultEmail": false, "defaultSms": false },
    // ... ~24 more
  ]
}
```

`category.key` IS `notification.type` 1:1 — they're the same string. The grouping is for UI section headers only.

**`GET /notifications` does NOT yet accept `?type=` filter.** Add it next sprint or roll your own client-side over the loaded set. If you need the server-side filter blocking, say the word and I'll add it.

### 3.10 Chat thread context resolution

The `preview.kind === 'message'` shape on moderation reports does NOT include `channelId` today — only `messageId`. Resolution path:

```sql
SELECT channel_id FROM public.chat_messages WHERE id = $1
```

I can add `channelId` to the message-report preview shape in a follow-up if you want — it's a one-line JOIN. Say the word.

---

## §4 — Role guards

✅ All shipped in the adversarial sweep. Confirmed live:

| Surface | Roles required |
|---|---|
| `/dashboard/*` | `admin`, `pastor`, `accountant` |
| `/reports/*` | `admin`, `pastor`, `accountant` |
| `PUT /leaderboard/status` | `admin`, `pastor` (GET unchanged — anyone can read whether leaderboards are on) |
| `/communications/*` (incl. `/send`) | `admin`, `pastor` |
| `/admin/moderation/*` | `admin`, `pastor` |
| `GET /giving/recurring/all` | `manage_finance` permission |
| `GET /tenants/:tenantId/members/*` | `admin`, `pastor`, `accountant` + tenant clamped |
| `GET /tenants/:tenantId/members/export` | `admin`, `pastor` + 5/hour throttle + audit row |
| `POST /attendance/bulk` | `admin`, `pastor` |

Use the highest privilege in each row as your screen gate.

---

## §5 — New endpoints (status)

| # | Endpoint | Status |
|---|---|---|
| 1 | **Moderation v2** | ✅ shipped. `GET /admin/moderation` returns content-type-aware preview blocks. Your moderation queue can render comment/user/message previews now — see §3.7 for envelope shape, §3.10 for chat context resolution. **No moderation queue exists in the dashboard yet — when you build it, the backend is ready.** |
| 2 | **Refunds** | ✅ `POST /api/giving/transactions/:id/refund` shipped, requires `manage_finance`. Refund history via `GET /api/audit-log?actionPrefix=finance.donation_refunded` |
| 3 | **Chat moderation** | ✅ shipped. `GET /admin/chat/threads/:channelId/context?aroundMessageId=` + `DELETE /admin/chat/messages/:id` |
| 4 | **Family relationship audit** | ✅ shipped. `GET /admin/family/relationships?userId=` (envelope `{ relationships: [...] }`) |
| 5 | **Workflow failures** | ✅ shipped. `GET /workflows/executions/admin?status=failed&since=` + `workflowFailures24h` **now on `/dashboard/kpis`** (this batch) |
| 6 | **Stripe Connect health** | ✅ shipped. `GET /api/stripe/connect/health` |
| 7 | **Broadcast read-back** | ✅ `GET /api/notifications/broadcasts/history` (envelope `{ broadcasts: [...] }`). Delivered/failed/read counts present but currently 0 — the Expo receipts pipeline that populates them is a separate follow-up |
| 8 | **Volunteer verification queue** | ✅ shipped. `GET /api/volunteer/hours/pending` + `POST /api/volunteer/hours/:id/verify` + `pendingVolunteerVerifications` **now on `/dashboard/kpis`** (this batch) |
| 9 | **GDPR center** | ✅ this batch. `GET /api/users/admin/account-deletions` (envelope `{ data: [...] }`). `member.profile_extras_viewed` audit rows already write since sweep. Surface them via `GET /audit-log?actionPrefix=member.` |
| 10 | **Member directory `?missingTagIds=`** | ✅ this batch. `GET /api/tenants/:tenantId/members?missingTagIds=<uuid>,<uuid>` returns members missing ALL listed tags |

---

## §6 — New fields / capabilities

### Shipped this batch

- **`Group.type`** ✅ migration 082 added the column. Allowed values: `small_group | discipleship | ministry | class | other` (CHECK-constrained). Default `small_group` for existing rows. Filter by passing to your group-list endpoint — backend filter not added yet, you can client-side filter or ask for `?type=` server filter (5-min add).
- **`POST /notifications/read-all`** ✅ POST alias added alongside existing PUT — call either. Both 200 OK.
- **`GET /prayers/kpis`** ✅ shipped this batch. Returns `{ activeCount, answeredThisMonth, prayingMembersLast7d }`. Migration 082 added `prayers.answered_at` so the month bucket is accurate (was using `created_at` as a fallback for historical rows).
- **Workflow failures KPI** ✅ on `/dashboard/kpis` as `workflowFailures24h`.
- **Volunteer pending verification KPI** ✅ on `/dashboard/kpis` as `pendingVolunteerVerifications`.

### Confirmed existing (you may have missed)

- **Sermon media upload** — works today via `POST /api/media/presigned-url` (S3 signed URL for audio + image) and `POST /api/media/mux-upload` (Mux Direct Upload for video). Same flow the mobile uses for video posts. Path is:
  1. `POST /api/media/presigned-url` with `{ contentType, fileSize }` → returns `{ uploadUrl, fileKey }`
  2. Client PUTs bytes to `uploadUrl`
  3. Client calls `POST /api/sermons` with `audioUrl: <publicUrl>` or `videoUrl`
- **Forgot password** — exists as `POST /api/auth/forgot-password` with `redirectTo` query param. Hosted reset page at `GET /api/auth/reset`.

### Deferred (need real product work, not a one-liner)

- **Sermon comments count** — sermons don't have a comments table yet. Either (a) we add `sermon_comments` and wire endpoints, or (b) we ship comments via the posts table with a `linked_sermon_id`. Need a product decision. For now the response can show `commentCount: 0` explicitly with a `// TODO sermon comments` comment in your code.
- **Self-serve plan upgrade Checkout** — new Stripe Checkout-session endpoint needed (`POST /api/stripe/checkout/plan-upgrade` body `{ targetTier, returnUrl }`, returns `{ checkoutUrl }`). This is ~150 lines + a webhook handler for `checkout.session.completed` that updates `tenants.tier`. **Confirm you want me to build it next sprint** and which tiers should self-serve (just standard→premium, or all transitions?).

---

## Summary of what landed in this batch

- Migration 082: `groups.type` + `check_ins.event_id` + `tenants.ical_token` + `prayers.answered_at`
- `GET /api/prayers/kpis`
- `POST /api/notifications/read-all` (alias)
- `GET /api/users/admin/account-deletions` (admin/pastor)
- `POST /api/events/ical/regenerate-token` (admin) + `GET /api/events/ical-public/:tenantId?token=` (public)
- `GET /api/tenants/:tenantId/members?missingTagIds=`
- `/dashboard/kpis` now returns `workflowFailures24h` + `pendingVolunteerVerifications`
- `/attendance/bulk` (and the visitor variant) now accepts `eventId` alongside `serviceId`

Pushed to `main`. Render is auto-deploying.

---

## What I'd love you to confirm back

1. Want me to add `?type=` filter to `GET /api/notifications` so the category filter is server-side (currently best-effort client-side per your note)?
2. Want me to add `channelId` to `message`-type moderation report previews so you don't need the extra lookup?
3. Want me to ship `overdue=true` / `dueBefore=` on `GET /tasks`?
4. Sermon comments — table-based (new `sermon_comments`) or post-based (link a Post to a Sermon)?
5. Stripe Checkout self-serve upgrade — green light + which tier transitions?

Reply to any of those with "yes" and I'll ship.
