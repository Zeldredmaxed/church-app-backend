# Admin Dashboard Backend Updates — Sweep Fix Handoff

Comprehensive sweep just shipped. Headline: **every gap from the
adversarial audit is now closed**, with the admin-parity items
prioritized first. Migrations 073-079 applied to prod. All endpoints
type-check clean.

Below is what changed that affects the admin dashboard, organized by
priority. Each section names the new/changed endpoints and the screens
you can build now.

---

## 0. Critical security fixes (the dashboard is now safe to use)

These were exploitable today — re-test any admin screen that hits them:

| Surface | What changed |
|---|---|
| `GET /api/tenants/:tenantId/members` | Now requires admin/pastor/accountant **AND** path tenantId must match JWT current tenant. 403 otherwise. |
| `GET /api/tenants/:tenantId/members/kpis` | Same. |
| `GET /api/tenants/:tenantId/members/export` | Same + **5/hour rate limit** + writes `member.directory_exported` audit row. |
| `POST /api/tenants/:tenantId/members/import` | Now tenant-clamped to JWT. |
| `PATCH /api/tenants/:tenantId/members/:userId/role` | Same. |
| `PATCH /api/tenants/:tenantId/members/:userId/permissions` | Same. |
| `DELETE /api/tenants/:tenantId/members/:userId` | Tenant-clamped only when removing someone else (self-removal still works cross-tenant). |
| `/admin/moderation/*` | Whole controller now `@RequiresRole('admin','pastor')`. |
| `/communications/*` (incl. `/send`) | Whole controller now admin/pastor. SMS-blast no longer accessible to regular members. |
| `/dashboard/*` | Whole controller now admin/pastor/accountant. |
| `/reports/*` | Same. |
| `PUT /api/leaderboard/status` | Now admin/pastor. |
| `GET /api/giving/recurring/all` | Now `manage_finance` permission required. |
| `POST /api/attendance/bulk` | Now admin/pastor + each user_id must be a member of the target tenant. Returns `{ checkedIn, skipped }`. |

If your admin dashboard was relying on any of these returning 200 to
unauthenticated/member users, those calls will now 403. Fix the calling
code to use the admin JWT.

---

## 1. New admin endpoints to build screens for

### Moderation v2 — content-type-aware queue

`GET /api/admin/moderation?status=pending|reviewed|removed&limit=&cursor=`

Now branches on `content_type ∈ {post, comment, user, message}`. Every
report row includes a `preview` block keyed by `kind`:

```ts
type Report = {
  id: string;
  contentType: 'post' | 'comment' | 'user' | 'message';
  targetId: string;
  reason: string;
  status: 'pending' | 'reviewed' | 'removed';
  reportedBy: string;
  createdAt: string;
  preview:
    | { kind: 'post';    thumbnail: string; content: string; authorName: string; authorId: string }
    | { kind: 'comment'; content: string; authorName: string; authorId: string; postId: string }
    | { kind: 'user';    fullName: string; avatarUrl: string; userId: string }
    | { kind: 'message'; authorName: string; messageId: string };
};
```

`POST /api/admin/moderation/:id/remove` now does the right thing per
content type:
- **post** → hard delete + `post.deleted` audit
- **comment** → hard delete + `comment.deleted` audit
- **message** → **soft delete** (`deleted_at` + `deleted_by` + reason) on chat_messages + `chat.message_removed` audit
- **user** → no auto-suspend; writes `report.user_flagged` audit, admin follows up manually

**Screen to build:** moderation queue with per-content-type cards. Today's dashboard probably renders everything as a post thumbnail — those are blank for non-post reports. Branch on `report.preview.kind`.

### Refunds

`POST /api/giving/transactions/:id/refund`

Body: `{ amountCents?, reason?: 'duplicate'|'fraudulent'|'requested_by_customer', note? }`.
Omit amountCents for a full refund. Permission: `manage_finance`.

- Calls Stripe Refunds API.
- Updates the transaction: `refund_status` (none/partial/full/pending/failed CHECK), `refunded_amount`, `refunded_at`, `stripe_refund_id`, `refund_reason`.
- Writes `finance.donation_refunded` audit (targetUserId = donor, metadata includes PI/refund IDs).
- 409 if already fully refunded. 400 if requested > original or PI missing.

**Screen to build:** transaction detail → "Refund" button. Pull historical refunds via `GET /api/audit-log?actionPrefix=finance.donation_refunded`.

### Chat moderation

`GET /api/admin/chat/threads/:channelId/context?aroundMessageId=<id>&window=10`

Returns the messages immediately before/after a target message id so an admin can review a reported DM in context. Bypasses the channel-member rule the user-facing path enforces; tenant-clamped.

Response:
```json
{ "before": [...], "target": {...}, "after": [...] }
```

`DELETE /api/admin/chat/messages/:id`

Body: `{ reason?: string }`. Soft-deletes (deleted_at/deleted_by/deleted_reason). Audits `chat.message_removed`. The user-facing message list now filters `deleted_at IS NULL`, so removed messages disappear from the chat immediately.

**Screen to build:** report queue → tap a reported message → context viewer → "Remove this message" action.

### Family relationship oversight

`GET /api/admin/family/relationships?userId=<optional>`

Lists confirmed + inferred relationships with both parties' names, `is_inferred`, `inferred_from`, `status`, timestamps. Cap 500.

`DELETE /api/admin/family/relationships/:id`

Body: `{ reason: string }` (mandatory). Removes both directions + cascade. Writes `family.relationship_force_removed` audit row with the reason.

Both directions of normal user-initiated family changes now also write audit: `family.relationship_created` (on accept), `family.relationship_removed` (on delete).

**Screen to build:** member profile → "Family connections" section → relationships list with "force remove" for the admin override. Critical for child-pickup safety reviews.

### Workflow failure dashboard

`GET /api/workflows/executions/admin?status=&since=&limit=`

Cross-workflow execution browser. Status accepts `running|completed|failed|paused|cancelled`. Returns workflow name, target user name, error_message, trigger_data joined per row.

**Screen to build:**
- "Workflows failing today" hero tile (count via this endpoint with `status=failed&since=<24h ago>`)
- Click-through → full execution browser with status filter
- Detail page already exists at `/api/workflows/executions/:executionId`

### Volunteer hours verification queue

`GET /api/volunteer/hours/pending` — admin/pastor only. Returns pending rows with member name + opportunity name.

`POST /api/volunteer/hours/:id/verify` — body `{ reason? }`. Audits `volunteer.hours_verified`.

`POST /api/volunteer/hours/:id/reject` — body `{ reason? }`. Deletes row + audits `volunteer.hours_rejected` with original notes preserved.

`GET /api/volunteer/kpis` now returns `pendingVerificationCount` alongside `activeVolunteers` and `hoursThisMonth`. **Verified rows count toward KPIs; pending do not.**

**Screen to build:** dashboard tile + dedicated verification queue with approve/reject inline.

### Stripe Connect health

`GET /api/stripe/connect/health` — admin only.

Returns:
```ts
{
  account: {
    chargesEnabled: boolean,
    payoutsEnabled: boolean,
    detailsSubmitted: boolean,
    requirements: {
      currentlyDue: string[],
      eventuallyDue: string[],
      pastDue: string[],
      disabledReason: string | null,
    },
  },
  balance: { available: [{ amount, currency }], pending: [...] },
  recentPayouts: [{ id, amount, currency, status, arrivalDate }],  // up to 10
}
```

**Screen to build:** hero "Connect Health" card on the giving dashboard. Alert (red banner) when `chargesEnabled=false` or `requirements.pastDue` is non-empty.

### Broadcast read-back

`GET /api/notifications/broadcasts/history` — admin/pastor only.

Returns past broadcasts with sender name, audience size, delivered/failed/read counts, timestamps. Capped at 200.

`POST /api/notifications/broadcast` now writes a `broadcast_history` row up front and returns the `broadcastId` alongside `sent` count.

**Screen to build:** "Broadcasts" list page; each row shows delivery stats. The dedupe key is now persisted so retries of a broadcast job don't double-send.

---

## 2. Audit log additions

**Action keys** the dashboard's audit-log viewer now needs to handle (all new in this sweep):

| Key | Source | Notes |
|---|---|---|
| `member.directory_exported` | exportMembers | metadata.rowCount |
| `member.account_deleted` | (NEW — `account_deletion_log` table writes own row) | Not via `audit.log`; expose via dedicated endpoint (TODO: add `GET /api/admin/account-deletions`) |
| `member.profile_extras_viewed` | getProfileExtras | only when admin views someone else's profile |
| `badge.created`/`updated`/`deleted`/`awarded`/`revoked` | badges admin | manual moderation trail |
| `sermon.updated` | sermons.updateSermon | (created/deleted already existed) |
| `prayer.deleted` | admin prayer delete | only when deleter !== author |
| `chat.message_removed` | admin chat moderation | metadata.contentPreview |
| `comment.deleted` | moderation v2 | metadata.via='report_action' when triggered from queue |
| `finance.donation_refunded` | refund endpoint | metadata: refundId, paymentIntentId, amountCents, originalCents, currency |
| `report.user_flagged` | moderation v2 user-report | metadata.reason |
| `report.dismissed`/`actioned` | moderation v2 | unchanged action keys |
| `family.relationship_created`/`_removed`/`_force_removed` | family service + admin endpoint | `_force_removed` carries `reason` |
| `volunteer.hours_verified`/`_rejected` | verification queue | metadata.hours, reason |

**New filters on `GET /api/audit-log`:**

- `?actorRole=admin|pastor|accountant|volunteer_leader|member|unknown`
- `?summarySearch=<substring>` — case-insensitive ILIKE on summary. Capped at 200 chars.

Combined index on `(tenant_id, action, created_at DESC)` + `(tenant_id, actor_role, created_at DESC)` so these queries hit indexes.

---

## 3. KPI / analytics changes

`GET /api/dashboard/kpis` (existing endpoint) — body shape unchanged, but
will be extended next sweep with `workflowFailures24h` once the engine
exposes the cross-workflow stat hook.

`GET /api/volunteer/kpis` now returns:
```json
{
  "activeVolunteers": 0,
  "hoursThisMonth": 0,         // VERIFIED hours only (not raw self-reports)
  "pendingVerificationCount": 0
}
```

**Important:** if your volunteer hour count drops in the dashboard
after deploy, that's because the previous number included raw
self-reports. Verified-only is the correct number going forward.

---

## 4. Response shape changes you may need to handle

### Pagination

`GET /api/notifications` now returns the standard offset envelope:
```json
{
  "data": [...],
  "total": 0,
  "limit": 20,
  "offset": 0,
  "unreadCount": 0,
  "notifications": [...]  // legacy field — duplicate of data, will be removed next release
}
```

Move the dashboard's notifications consumer to `data` + `total` + `limit` + `offset` shape. The `page` field is gone (was wrong anyway — service was computing offset from page but DTO defined offset directly).

### Post responses

Posts now return `sharedBadge` (new in last sweep), `videoCropRect`, `author.church`, and now denormalized `likeCount` + `commentCount` (the values are identical — only the source changed from per-row subquery to a column).

### `POST /api/giving/transactions/:id/refund` response

```json
{
  "refundId": "re_...",
  "amountCents": 5000,
  "status": "full" | "partial" | "pending",
  "stripeStatus": "succeeded" | "pending" | "failed"
}
```

---

## 5. Future-work flags (out of scope for this sweep)

- **GET `/api/admin/account-deletions`** — endpoint to expose `account_deletion_log` rows for compliance officers. Backend table + write path are ready (migration 074); read endpoint not yet exposed.
- **Broadcast delivery counts** — `broadcast_history.delivered_count`/`failed_count`/`read_count` columns exist but are not yet populated by the Expo receipts pipeline. Will be wired when the Expo receipts processor is built. Until then, expect `audienceSize` populated + `deliveredCount: 0`.
- **Workflow failures 24h KPI** — endpoint to compute `workflowFailures24h` as a hero stat exists in raw form via the new admin executions endpoint; not yet on `GET /api/dashboard/kpis`.

---

## 6. Summary of new endpoints

```
GET    /api/admin/moderation                                  (now with content-type preview)
POST   /api/admin/moderation/:id/approve
POST   /api/admin/moderation/:id/remove                       (content-type aware)
POST   /api/giving/transactions/:id/refund                    (NEW)
GET    /api/admin/chat/threads/:channelId/context             (NEW)
DELETE /api/admin/chat/messages/:id                           (NEW)
GET    /api/admin/family/relationships                        (NEW)
DELETE /api/admin/family/relationships/:id                    (NEW)
GET    /api/workflows/executions/admin                        (NEW)
GET    /api/volunteer/hours/pending                           (NEW)
POST   /api/volunteer/hours/:id/verify                        (NEW)
POST   /api/volunteer/hours/:id/reject                        (NEW)
GET    /api/stripe/connect/health                             (NEW)
GET    /api/notifications/broadcasts/history                  (NEW)
GET    /api/notifications/categories                          (NEW)
```

All deploys auto-roll via Render on `main`. Migrations 073-079 already
applied to prod.
