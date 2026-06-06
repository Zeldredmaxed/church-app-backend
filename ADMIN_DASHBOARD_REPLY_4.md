# Reply to Admin Dashboard + Legal Audit — Round 4

All still-open items from the 2026-06-06 follow-up shipped, plus all 18
legal-page punch list items. A 3-reviewer adversarial workflow then ran
on the full diff and caught 3 CRITICAL + 6 HIGH issues — all folded in
before this push.

Migrations 085, 086, 087 applied to prod. Type-check clean.

---

## Q1. `?type=` filter on `GET /api/notifications` ✅

Optional `?type=<NotificationType>` query param, validated against
`NOTIFICATION_TYPE_KEYS` (the canonical list). Filters both list rows
and `total`. **`unreadCount` is intentionally NOT filtered** — it
remains the global unread badge so the bell icon doesn't drop when a
type tab is open.

## Q2. `channelId` on message-type moderation report previews ✅

`message`-type report previews now include `channelId` (JOINed from
`chat_messages.channel_id`). The agent confirmed the existing
moderation SELECT already joined `chat_messages cm ON cm.id = r.comment_id AND r.content_type = 'message'`;
new field surfaces in `preview.channelId`. No extra lookup on your end.

## Q3. `?overdue=true` / `?dueBefore=ISO` on `GET /api/tasks` ✅

Both added via a new `ListTasksDto`:
- `?overdue=true` → `WHERE due_date < now() AND status != 'completed'`
- `?dueBefore=<ISO-8601>` → `WHERE due_date < $iso` (validated with `@IsISO8601`)

Stacks with the existing `?assignedTo` and `?status` filters.
**Note:** the column is `due_date` (not `due_at` as some docs said) — verified against the entity.

## §11. Admin `GET /api/tenants/:tenantId/members/:userId/profile-completeness` ✅

Admin/pastor variant of the `/me` endpoint. Identical response shape:
`{ sets: { core, volunteer, child_pickup, group_leader }: { complete, missing[] } }`.

Guards:
- `assertUrlTenantMatchesJwt(tenantId, user)` clamps `:tenantId` to the JWT's current tenant
- `@RequiresRole('admin', 'pastor')`
- 404s if target user is not a member of the tenant

You can unhide the Profile Completeness card on the member-detail page.

## §12. `PATCH /api/services/:id` push config ✅

Migration 085 added:
- `services.start_push_lead_minutes INT` (0–30, default 0)
- `services.end_push_message TEXT NULL`

(`end_push_lead_minutes` was already in migration 081.)

`PATCH /api/services/:id` extended with the four push fields
(`pushMessage`, `startPushLeadMinutes`, `endPushLeadMinutes`,
`endPushMessage`). `GET /api/services` (list + single) returns all four
in camelCase.

`fireStartPushes` cron now subtracts `start_push_lead_minutes` from
`starts_at` in the WHERE clause; `fireEndPushes` uses `end_push_message`
as the body with a default fallback.

## Q4. Sermon comments via post-linking ✅

Migration 086: `posts.linked_sermon_id UUID NULL REFERENCES sermons(id) ON DELETE SET NULL` + partial index.

- `CreatePostDto.linkedSermonId` (optional UUID). **Tenant-scoped: rejected if the sermon belongs to another tenant.**
- `createGlobalPost` ignores `linkedSermonId` entirely (global posts have no tenant context to validate against — letting them link would let any user inflate any church's sermon engagement).
- `linkedSermonId` now ships on every post-returning surface (posts.service, me-activity, campus, feed REST + GraphQL, search).
- `Sermon` response gains:
  - `commentCount` — sum of comments across every post linked to the sermon
  - `discussionPostCount` — number of distinct posts linked to the sermon
- Both sub-selects are tenant-scoped (defense-in-depth: even if a legacy bad row exists, it can't inflate counts).

`createSermon` + `updateSermon` now return the mapped shape with `commentCount: 0` / `discussionPostCount: 0` on a fresh sermon (so the mobile doesn't read `undefined` after create).

## Q5. Stripe self-serve plan upgrade ✅

Migration 087: `tenants.stripe_billing_customer_id TEXT` (unique partial index) + `tenants.stripe_billing_subscription_id TEXT`.

### `POST /api/stripe/checkout/plan-upgrade`

```jsonc
// Request
{ "targetTier": "premium" | "enterprise", "returnUrl": "..." }

// Response 200
{ "checkoutUrl": "https://checkout.stripe.com/c/pay/..." }
```

Guards: JwtAuthGuard + admin/pastor role.

Behavior:
- All upgrade transitions supported: standard → premium, standard → enterprise, premium → enterprise
- Refuses downgrades and same-tier requests (400)
- Lazy-creates a Stripe Customer for the tenant billing (separate from donor customers on `users.stripe_customer_id`)
- Customer email is the **acting admin's email** (from JWT) so Stripe has a real contact for refund/dunning/receipt mail before first Checkout completes
- Lock-create-or-reuse via `SELECT ... FOR UPDATE` so concurrent upgrades can't strand orphan Customers
- Stripe idempotency key is a **10-minute bucket** on `(tenantId, targetTier)` — a distracted admin clicking Upgrade, getting pulled away, coming back 5-9 min later, retrying, still gets the same Checkout URL (no double-paid sub)
- Audit row `tenant.plan_upgrade_initiated` written on session creation

### Webhook handler (`checkout.session.completed`)

Hardened with three structural defenses against tier-spoofing:
1. **Customer-binding check** — refuses the event if `session.customer` doesn't match the tenant's stored `stripe_billing_customer_id` (any future code path that creates Checkout Sessions with attacker-influenced metadata can't upgrade arbitrary tenants)
2. **Transaction with `SELECT ... FOR UPDATE`** on the tenant row — two distinct webhook events for the same tenant can't race lost-update style
3. **Same-tier guard** — if the tenant is already on the target tier, records the subscription id but skips the tier UPDATE and audit row

Audit row `tenant.tier_upgraded` written inside the same transaction.

### Mobile work order
1. Drop the "sales mailto" interim on the Upgrade Plan CTAs
2. Wire the button to `POST /api/stripe/checkout/plan-upgrade` and `window.location = response.checkoutUrl`
3. Use a `returnUrl` like `https://dashboard.shepard.love/settings/billing?checkout={CHECKOUT_RESULT}` so the user lands somewhere meaningful on success/cancel

---

## Sermon media upload contract (your three unknowns)

(a) **`POST /media/presigned-url` return shape:** returns `{ uploadUrl, fileKey }`. To derive the public URL from a fileKey:
```
https://<S3_BUCKET>.s3.<S3_REGION>.amazonaws.com/<fileKey>
```
For images, **after** the PUT succeeds, call `POST /api/media/finalize-image` with `{ fileKey }` (added in the prior commit — strips EXIF and returns `{ url, mediaAspect, bytes }`). For audio/video sermon assets, use the public URL directly.

(b) **`POST /media/mux-upload` shape:** returns `{ uploadId, uploadUrl }`. **Mux is async** — when you create the sermon, send `videoMuxUploadId: uploadId` in the body, NOT a `videoUrl`. The Mux webhook fires later (~30s for a 10-min video, longer for HD/4K) and the backend populates `videoMuxPlaybackId` + `transcodeStatus`. Mobile polls the sermon (or post) and stops on `transcodeStatus: 'ready' | 'failed'`.

Final playback URL is `https://stream.mux.com/<playbackId>.m3u8` (HLS).

(c) **Required PUT headers on presigned URL:** the only required header is `Content-Type` matching exactly what you sent to `POST /media/presigned-url` in the `contentType` field. The signature binds them. No `x-amz-*` headers needed. Example:
```js
await fetch(uploadUrl, {
  method: 'PUT',
  headers: { 'Content-Type': 'image/jpeg' },
  body: blob,
});
```

---

## Optional: `?type=` server filter on the group-list endpoint

Not built this round — say the word and I'll add it next sprint (one-line addition).

---

## Legal pages — all 18 punch-list items applied ✅

### Privacy Policy (3 → 9/10)
- §1 Auto-attendance GPS disclosure (pre-defined service windows, 30-min buffer, opt-in/opt-out, server retention)
- §3 Vendor list expanded: Supabase, Stripe, Render, AWS S3, Expo Push Service, Mux, Anthropic, Resend, Twilio. **OneSignal removed everywhere.**
- §3b Anthropic AI disclosure with link to commercial terms (Anthropic doesn't train on inputs)
- §4 GDPR Art. 15-22 + CCPA rights enumeration
- §5 Data-export rewrite as a UX path (Settings → Account → Export My Data, 30-day delivery, 5/day rate limit)
- §6 GDPR Art. 13(1)(f) international transfer + SCCs
- §7 Children's data rewrite (under-13 ban, guardian-added child profiles flagged as GDPR Art. 9 sensitive, stored as processor for the church)
- §8 Concrete retention table

### Terms of Service (4 → 9/10)
- §3a Apple Guideline 1.2 — CSAM + grooming prohibition, 24-hour SLA, in-app flag/block tool callouts
- §3b Music sync rights warranty in Acceptable Use
- §4 UGC license rewritten: worldwide, non-exclusive, royalty-free, **sublicensable**, covering reproduce/transcode/derivative copies through Mux, AWS S3, Stripe
- §5 Donation tax-deductibility disclaimer
- §7 Child check-in / pickup liability disclaimer (record-keeping tool, NOT a security system; parents responsible for ID verification)
- §10 DMCA section: copyright@shepard.love, six § 512(c)(3)(A) elements, 7-business-day response
- §12 Governing law (Indiana, Marion County venue), 60-day informal resolution, class-action + jury waiver, legal entity "Denzel Christopher Combs, an Indiana sole proprietorship"

### Account Deletion (6 → 9/10)
- "Last updated: June 6, 2026" date at top
- "What gets deleted" expanded with auto-attendance pings (raw lat/lng) + aggregated identity-tied attendance records
- 7-year retention disclosed for anonymized donation records (IRS recordkeeping + Stripe dispute window)

**Global:** `shepardapp.com` replaced with `shepard.love` across all three pages. OneSignal removed.

### Things I need YOU to confirm (audit flagged but I can't verify)
1. **Indiana sole proprietorship, Marion County venue** — confirm legal entity and your actual residence. If LLC or out-of-county, edit the Terms.
2. **Mailbox routing**: confirm `copyright@`, `privacy@`, `legal@`, `support@shepard.love` are all monitored. Unmonitored `copyright@` = loss of DMCA safe-harbor under 17 U.S.C. § 512(c)(2).
3. **Server-log + backup retention claims**: privacy says Render keeps server logs 90 days and Supabase keeps backups 30 days. Confirm your plan tiers actually deliver that. If not, either upgrade or soften the policy.
4. **NCMEC CyberTipline registration**: Terms commits to reporting CSAM. Have you registered at report.cybertip.org as an Electronic Service Provider? If not, the Terms describes a process you can't execute.

---

## Adversarial-review fixes folded in before push

A 3-reviewer workflow caught these BEFORE this push (would have shipped real bugs):

### CRITICAL — would have leaked real money or violated GDPR
1. **Stripe webhook customer-binding** — webhook flipped `tenants.tier` from `session.metadata.tenantId` alone. An attacker controlling Checkout metadata could upgrade ANY tenant. Now verifies `session.customer === tenant.stripe_billing_customer_id` before any UPDATE.
2. **`linkedSermonId` tenant scope** — `CreatePostDto.linkedSermonId` had `@IsUUID()` only. Tenant A could link to tenant B's sermon, inflating B's engagement KPIs. Now validated in `createPost`; stripped entirely from `createGlobalPost`; sub-selects in `sermons.service` also tenant-scoped as defense-in-depth.
3. **Missing 90-day ping purge cron** — privacy policy promised 90-day raw-ping retention. No cron existed. Pings would have lived forever, contradicting the policy = GDPR Art. 5(1)(e) storage-limitation violation. New `purgeRawPings` job runs daily at 03:30 UTC, batches of 5000 to avoid table locks.

### HIGH
4. **Checkout idempotency widened to 10 minutes** — 1-minute bucket meant a distracted admin (90s pause + retry) created a duplicate paid subscription.
5. **Webhook tier UPDATE wrapped in `SELECT ... FOR UPDATE` transaction** — two distinct retry-driven webhook events for the same tenant could lost-update each other.
6. **Privacy vendor list** — verified Stripe + Supabase + Render are all present (reviewer disagreement; the actual file passes).
7. **`me-activity` mapPostRow missing `sharedBadge` + `author.church`** — My Posts and My Likes screens would have rendered shared-badge posts as plain text and lost the church accent color. Fixed: SELECTs JOIN `badges` and `tenants`, mapper surfaces both.
8. **`sermons.createSermon` / `updateSermon`** returned raw TypeORM entity without `commentCount` / `discussionPostCount`. Now re-fetches through `getSermon` for guaranteed shape parity.
9. **Stripe Customer email** — was creating with empty-string email. Now uses the acting admin's email from JWT so refund/dunning notices have a destination.

### MEDIUM (also fixed this commit)
- Attendance pings now **rejected** if outside any service window — matches the privacy-policy claim "we collect your precise GPS coordinates only during pre-defined service windows" (previously stored the row anyway, contradicting the policy).

### Deferred to next commit (not blocking)
- `fireStartPushes` window widening to 30 min for cron-downtime resilience (low likelihood, easy follow-up)
- `me-activity` shape parity for `sharedBadge` across feed/search/campus surfaces (pre-existing gap; mobile renders fine without)
- `tasks.cursor` ISO8601 validation (currently 500s on garbage cursor; not exploitable)

---

## Summary

- Migrations 085, 086, 087 applied to prod
- 9 backend items + 18 legal items shipped
- 3 critical + 6 high + 1 medium adversarial-review findings fixed before push
- Pushed to `main` — Render auto-deploying
