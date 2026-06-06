# Shepard Backend — Single Source of Truth

> **For:** Admin Dashboard Team (Next.js) **AND** Mobile App Team (React Native)
> **Status:** Pre-launch, beta on Android via Expo Go, first church client imminent
> **Last updated:** 2026-06-06 (commit `151c923`)
> **Live backend:** `https://church-app-backend-27hc.onrender.com/api`
> **Latest migration applied:** `095_sermon_views.sql`

This document supersedes EVERY prior `*_PROMPT.md`, `*_REPLY*.md`,
`*_FIXES.md`, and `FRONTEND_HANDOFF*.md`. Going forward, ANY change to
the backend ships with a single doc — never separate ones per team —
and that doc always has both a **Mobile** and **Admin Dashboard**
section so both teams stay in lock-step.

---

## Document map

- [§0 — Shared context](#0--shared-context-both-teams) — both teams MUST read
- [§1 — Mobile team section](#1--mobile-team-section) — endpoints, payload shapes, push handlers, geo-attendance, AI, sermons, shop, livestream, fundraisers, bible, payment methods
- [§2 — Admin Dashboard team section](#2--admin-dashboard-team-section) — admin endpoints, KPIs, reports, moderation queue, chat moderation, audit log, Stripe checkout for plan upgrade, services CRUD, onboarding form builder, broadcasts, workflows, badges
- [§3 — Cross-cutting](#3--cross-cutting) — error contracts, rate limits, audit log conventions, retention policy, deferred work
- [§4 — User-confirmation items](#4--user-confirmation-items)

---

# §0 — Shared context (both teams)

## Tech stack

| Layer | Tech |
|---|---|
| Backend | NestJS (TypeScript), modular monolith |
| Database | PostgreSQL via Supabase with Row-Level Security |
| Auth | Supabase Auth (JWT with `app_metadata.current_tenant_id`) |
| Payments | Stripe Connect (Standard accounts, `application_fee_amount`) |
| Queue | BullMQ + Upstash Redis |
| Push | Expo Push SDK |
| Media | AWS S3 (images) + Mux (video upload/transcode/HLS + live streams) |
| Email | Resend |
| SMS | Twilio |
| AI | Anthropic Claude (assistant) + OpenAI Whisper (voice transcription) |
| Cache | Upstash Redis via CacheService |
| Hosting | Render (auto-deploy from `main` branch) |
| Icons | Hugeicons (5,100+ free stroke-rounded; kebab-case in DB, PascalCase + `Icon` suffix on frontend) |

## Auth + token transport

- **Body in, body out.** Refresh token lives in the JSON body of `POST /api/auth/refresh`. Mobile + dashboard both store the new access+refresh pair returned in the response body (sessionStorage on web, SecureStore on mobile).
- **NO httpOnly cookie.** No `credentials: "include"` needed on any request. Older spec docs claiming cookie-based refresh are wrong — ignore.
- **JWT carries** `sub` (user id), `email`, `app_metadata.current_tenant_id`, `app_metadata.role`.

```
POST /api/auth/refresh
Body: { "refreshToken": "..." }
200 → { "accessToken", "refreshToken", "expiresAt", "user" }
```

## Multi-tenant Row-Level Security

Every authenticated request enters `RlsContextInterceptor`, which:
1. Creates a dedicated `QueryRunner` (single DB connection)
2. Opens a transaction
3. Sets `SET LOCAL role = 'authenticated'` and `SET LOCAL "request.jwt.claims" = '<jwt>'`
4. Services access via `rlsStorage.getStore() → { queryRunner, currentTenantId, userId }`

Rules (for our own consumption — surfaces to clients as 401/403):
- `queryRunner` for tenant-scoped data → RLS enforced
- `dataSource` (service-role) only for system / cross-tenant / webhook code, with written justification

## Tier system + pricing

| Tier | Price/mo | Transaction fee | Storage | Admin users |
|---|---|---|---|---|
| **Standard** | $29 | 1.3% | 10 GB | Up to 5 |
| **Premium** | $79 | 1.0% | 100 GB | Unlimited |
| **Enterprise** | $199 | 0.5% | Unlimited | Unlimited |

Tier-gated features (server-enforced):
- **Standard:** core feed/social, members, giving, events, groups, prayer, sermons (audio-only), attendance, care cases, tasks, facilities, volunteers, basic notifications, moderation, feedback, dashboard, reports, leaderboard, badges, onboarding forms, 1 workflow (5 nodes)
- **Premium:** + video posts/sermons, real-time chat (channels + DMs), push notifications, advanced search, granular admin roles, AI Shepherd Assistant, communications (segments + email/SMS/push), workflow templates
- **Enterprise:** + unlimited workflows + 48 node types, AI workflow generation, workflow marketplace publish, segmented push, geo check-in, custom branding, multi-site, REST API access, unlimited storage

**Mobile + admin both call `GET /api/tenants/:id/features` on app load.** Returns `{ tenant: { id, name, slug, tier, tierDisplayName, ... }, features: { ... }, campus?: { ... } }`. Render gated UI off `features.<flag>`.

**Self-serve plan upgrade:** `POST /api/stripe/checkout/plan-upgrade` (admin/pastor only) — see [§2 Stripe billing](#admin-stripe-billing--plan-upgrade).

## Universal response envelope conventions

- **List endpoints standardize on** `{ data: T[], total?, limit?, offset?, nextCursor? }` going forward. Legacy endpoints may still return `{ posts: [...], total, ... }` or `{ items: [...] }` — the [§3 endpoint-by-endpoint envelope table](#endpoint-envelope-keys-current) lists the current key per route.
- **Errors return** `{ statusCode, message, code?, ...detail }` — code is a stable string match identifier (see [§3 error contracts](#error-contracts)).
- **Cursors** are either a UUID of the last row seen (most lists) or an ISO-8601 timestamp (tasks, audit log). The current returning endpoint says which.

## Required request headers (both teams)

| Header | When | Why |
|---|---|---|
| `Authorization: Bearer <jwt>` | All authenticated routes | Standard |
| `X-Active-Tenant-Id: <uuid>` | All authenticated routes once user has joined a church | Tenant-drift guard — backend returns 409 `TENANT_MISMATCH` if this disagrees with the JWT's `current_tenant_id`. Client must force-logout on that response. Skip on `/api/auth/*`, `/api/tenants/public`, `/api/tenants/register`, `/api/tenants/search`, `/api/legal/*`, `/api/health`, `/api/webhooks/*`, `/api/events/ical-public/*`, `/graphql`. |

The header is **optional** (server passes through if missing), but if present it must match. Mobile + admin both implement send-on-every-request + 409-handler.

## Migration state

Migrations are numbered SQL files under `migrations/NNN_*.sql`. Applied through migration **095**. Schema changes ONLY via numbered migrations — `synchronize: false` everywhere.

Notable recent migrations:
- 080 — Geo-attendance + service occurrences
- 084 — `posts.media_aspect` + `posts.transcode_status` + `broadcast_opens`
- 085 — `services.start_push_lead_minutes` + `services.end_push_message`
- 086 — `posts.linked_sermon_id`
- 087 — `tenants.stripe_billing_customer_id` (for plan upgrade)
- 088 — Shop tables
- 089 — Live streams
- 091 — AI conversations + messages
- 092 — Chat moderation flags + user mutes
- 093 — `services.pastor/location/capacity/tags` + `tenants.monthly_giving_goal_cents`
- 094 — `ai_conversations.expires_at` (90-day TTL)
- 095 — `sermon_views` (per-user watch progress)

---

# §1 — Mobile team section

Mobile reads + writes from these endpoints. Admin team should still skim this section so you know what mobile sees.

## §1.1 Auth

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/auth/signup` | Body: `{ email, password, fullName?, tenantId?, onboardingResponses? }`. Tenant + onboarding responses optional — signup without tenant = guest user; pass tenant to join immediately + populate the spiritual-journey row from `onboardingResponses`. |
| `POST` | `/api/auth/login` | Body: `{ email, password }`. |
| `POST` | `/api/auth/refresh` | Body: `{ refreshToken }`. |
| `POST` | `/api/auth/logout` | Discards client-side; endpoint exists for symmetry. |
| `POST` | `/api/auth/forgot-password` | Body: `{ email }`. Sends Supabase magic-link to a hosted reset page. |
| `GET` | `/api/auth/reset` | Hosted password-reset HTML page (linked from the email). |
| `POST` | `/api/auth/switch-tenant` | Body: `{ tenantId }`. Client MUST call `/auth/refresh` after to pick up the new JWT. |

## §1.2 Tenants / churches

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/tenants/public` | Public — no auth — lightweight list for the church-finder. |
| `GET` | `/api/tenants/search?q=` | Public — fuzzy search by name. |
| `GET` | `/api/tenants/:id/features` | Tier features + `tenant` block: `{ id, name, slug, tier, tierDisplayName, campusName, parentTenantId, brandColor, isGuest }` |
| `POST` | `/api/tenants/register` | Public — admin signup creates a new tenant. |
| `POST` | `/api/tenants/:tenantId/join` | Self-join after signup (used by ChurchProfileScreen "Join Church" button). |
| `GET` | `/api/tenants/:tenantId/branches` | Multi-site sub-tenants. |

## §1.3 Profile completeness gating

**`GET /api/users/me/profile-completeness`** returns:

```jsonc
{
  "sets": {
    "core":         { "complete": true,  "missing": [] },
    "volunteer":    { "complete": false, "missing": [{ "field": "address", "label": "Mailing address" }] },
    "child_pickup": { "complete": false, "missing": [...] },
    "group_leader": { "complete": false, "missing": [...] }
  }
}
```

Requirement sets (server-defined product policy):
- `core` — `fullName`, `email`, `phone`
- `volunteer` — core + `address` (street + city + state + postalCode)
- `child_pickup` — core + `address` + `emergencyContact` (name + phone) + `dateOfBirth`
- `group_leader` — core + `address` + `phoneSecondary`

**Gated endpoints — return 400 `PROFILE_INCOMPLETE`** with `{ requirementSet, missing[] }` if caller doesn't satisfy:
- `POST /api/volunteer/opportunities/:id/signup` — needs `volunteer`
- `POST /api/groups` — needs `group_leader`
- (Future: a parent-side child-pickup authorization endpoint will gate on `child_pickup`. Until then mobile pre-gates the UI off the completeness response.)

Type contract: `backend/src/users/profile-completeness.types.ts` exports the shapes. Copy that file into your shared types package — never inline string literals.

## §1.4 Posts + feed + comments

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/posts` | List with `{ posts, total, limit, offset }`. Filter by `?campusId=` / `?tag=` / `?visibility=`. |
| `GET` | `/api/posts/saved` | User-saved posts. |
| `GET` | `/api/posts/archive` | User-archived posts. |
| `GET` | `/api/posts/:id` | Single post. |
| `POST` | `/api/posts` | Body: `CreatePostDto` — see below. |
| `POST` | `/api/posts/global` | Cross-tenant public feed post. |
| `PUT` | `/api/posts/:id/archive` / `/restore` / `/save` / `/unsave` | Standard actions. |
| `DELETE` | `/api/posts/:id` | Author or admin. |
| `POST` | `/api/posts/:id/like` / `/unlike` | |
| `GET/POST/DELETE` | `/api/posts/:postId/comments[...]` | Threaded comments with media. |
| `GET` | `/api/feed/global` | Redis-backed cross-church feed. |

**Every post response includes:**
```ts
{
  id, tenantId, authorId, content,
  mediaType, mediaUrl, videoMuxPlaybackId,
  videoCropRect,       // { x, y, width, height, aspectRatio? } | null
  mediaAspect,         // width/height. null for text posts or pre-transcode video
  transcodeStatus,     // 'pending' | 'ready' | 'failed' | null (NULL for non-video; flips via Mux webhook)
  sharedBadgeId,
  sharedBadge,         // { id, name, description, icon, tier, category, color } | null
  linkedSermonId,      // a comment-on-sermon post links via this — tenant-validated on create
  visibility,
  createdAt, updatedAt,
  author: { id, fullName, avatarUrl, church: { id, name, brandColor } | null },
  likeCount, commentCount,
  isLikedByMe, isSavedByMe,
}
```

`mediaAspect` lets the feed pre-allocate cell height — kills the first-image layout shift. `transcodeStatus === 'failed'` is terminal — stop polling.

**CreatePostDto important optional fields:** `mediaUrl`, `mediaType`, `videoMuxUploadId` (NOT a finished playback id — the Mux webhook later flips `transcode_status='ready'` + sets `videoMuxPlaybackId`), `videoCropRect`, `sharedBadgeId`, `linkedSermonId`, `visibility`.

## §1.5 Media uploads

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/media/presigned-url` | Body: `{ contentType, fileSize, ... }` → `{ uploadUrl, fileKey }`. Mobile PUTs bytes to `uploadUrl`. **Headers on the PUT: only `Content-Type` matching what you sent in the request body.** No `x-amz-*` headers — the signature binds Content-Type only. |
| `POST` | `/api/media/finalize-image` | **REQUIRED after image PUT.** Body: `{ fileKey }`. Server downloads the image, re-encodes via sharp (strips EXIF/IPTC/XMP including GPS), re-uploads, returns `{ url, mediaAspect, bytes }`. Ownership-checked: `fileKey` MUST start with `tenants/<tenantId>/users/<userId>/`. 15 MB upload cap, 25 MP pixel cap. **Mux strips EXIF natively on video transcode** — no finalize step needed for video. |
| `POST` | `/api/media/mux-upload` | Returns `{ uploadId, uploadUrl }`. PUT bytes to `uploadUrl`, then pass `uploadId` as `videoMuxUploadId` to `POST /api/posts`. Mobile polls the post (or sermon) — stop on `transcodeStatus === 'ready'` (use `videoMuxPlaybackId`) or `'failed'`. Final playback URL is `https://stream.mux.com/<playbackId>.m3u8` (HLS). |

To derive the public URL from a `fileKey` (for images/audio):
```
https://<S3_BUCKET>.s3.<S3_REGION>.amazonaws.com/<fileKey>
```

## §1.6 Auto-attendance (geo-fenced check-in)

**Per-(user, tenant) opt-in.** No location is collected unless the user opts in. Opt-out is honored immediately — backend silently drops further pings.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/attendance/opt-in` | `{ optedIn, optedInAt, optedOutAt, updatedAt, upcomingOccurrences[] }`. Use `upcomingOccurrences` to render "your church will ping you at these times" on the opt-in screen. |
| `POST` | `/api/attendance/opt-in` | Body: `{ optedIn: boolean }`. |
| `POST` | `/api/attendance/ping` | Body: `{ lat, lng, accuracyMeters?, source? }`. Throttled 30/min per IP. Silently dropped (`{ recorded: false, reason: 'not_opted_in' \| 'outside_service_window' }`) if not opted in OR outside any service window. |
| `GET` | `/api/attendance/upcoming?days=14` | Standalone upcoming-services widget. |

**Auto-push payload (canonical shape, both start + end):**
```ts
data: {
  kind: 'auto_attendance_ping',     // hard-validate this string
  phase: 'start' | 'end',
  serviceOccurrenceId: string,
  tenantId: string,
}
```

When mobile receives this push:
1. If `phase === 'start'` — capture a high-accuracy location, POST to `/api/attendance/ping` with `source: 'auto_push_reply'`.
2. If `phase === 'end'` — same, captures the final position so the end-of-service sweep correctly classifies present / late / left-early.

**Geofence handlers** post pings with `source: 'geofence_entry'` / `'geofence_exit'`. Foreground app polls every ~3 min during a service window with `source: 'foreground'`.

**Push cron behavior:** `@Cron(EVERY_MINUTE)` ticks fire at most ONCE per service occurrence at start, ONCE at end (~3 min before `endsAt`, configurable per-service). 1438 ticks per day are no-ops. Members get exactly 2 attendance pushes per service.

**Mobile permission flow** (Apple/Google review compliance):
1. User taps "Auto-attendance" toggle ON in Settings
2. Show rationale screen rendering `upcomingOccurrences` as the actual ping schedule
3. Request `WhenInUse` location permission
4. If granted, request `Always Allow` (iOS) / `ACCESS_BACKGROUND_LOCATION` (Android)
5. Register geofences (CLCircularRegion / GeofencingClient) at the church coords + radius
6. POST `/api/attendance/opt-in` with `optedIn: true`

DO NOT request `Always Allow` before the opt-in toggle is on — Apple Guideline 5.1.5 reject.

## §1.7 Onboarding forms (church-configurable signup questions)

Mobile fetches the form during signup (no auth needed), shows the questions, submits responses with the signup body.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/api/onboarding/:tenantId/form` | **Public** | `{ id, tenantId, isActive, welcomeMessage, fields: [...] }`. Returns `null` if no form configured — skip the onboarding step. |
| `POST` | `/api/onboarding/:tenantId/submit` | Public | Body: `{ userId, responses: { ... } }`. Or pass `onboardingResponses` to `/api/auth/signup` inline. |

Field types: `text | textarea | select | multiselect | date | boolean | number | phone | email`. Categories: `spiritual | personal | family | interests | background | custom`.

Each field has `required: boolean`, `key`, `label`, `description?`, `options?`, `placeholder?`. When submitted, mapped fields auto-populate `member_journeys` (e.g. `is_baptized`, `interests`, `faith_journey` → `discipleship_track`).

## §1.8 Stripe payment methods

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/stripe/payment-methods` | `{ data: SavedPaymentMethod[] }` — empty array if no Stripe customer yet. |
| `DELETE` | `/api/stripe/payment-methods/:id` | 204. PM ownership-checked. |
| `POST` | `/api/stripe/payment-methods/:id/default` | `{ data: SavedPaymentMethod[] }` — same envelope as GET. |

`SavedPaymentMethod = { id (pm_xxx), brand, last4, expMonth, expYear, isDefault }`.

Set up new card via existing SetupIntent flow: `POST /api/stripe/connect/setup-intent` → Stripe Elements → returned `paymentMethod.id` can be used immediately for one-off (donate, fundraiser, shop) or recurring giving.

## §1.9 Giving (one-time + recurring)

| Method | Path | Notes |
|---|---|---|
| `POST` | `/api/giving/donate` | Body: `{ amountCents, fundId?, paymentMethodId?, message?, isAnonymous? }`. |
| `GET` | `/api/giving/funds` | Available funds for the church. |
| `GET` | `/api/giving/transactions` | User's giving history. |
| `POST` | `/api/giving/recurring` | Body: `{ amount, currency?, frequency: 'weekly'\|'biweekly'\|'monthly', fundName?, paymentMethodId }`. **`paymentMethodId` is REQUIRED.** Real Stripe Subscription created. Idempotent via 10-min bucket — distracted-admin retry returns the same sub. |
| `POST` | `/api/giving/recurring/:id/pause` / `/resume` / `/cancel` | Each wraps a `SELECT FOR UPDATE` + Stripe call + local update in one tx — no Stripe/local drift. |

## §1.10 Fundraisers

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/fundraisers?category=&q=&limit=&offset=` | `{ data: Fundraiser[], total, limit, offset }`. |
| `GET` | `/api/fundraisers/:id` | `Fundraiser & { backers, updates }`. |
| `POST` | `/api/fundraisers/:id/donate` | Body: `{ amountCents, paymentMethodId, message?, isAnonymous? }`. |
| `POST` | `/api/fundraisers/:id/bookmark` | Toggle. |
| `GET` | `/api/fundraisers/:id/updates` | Paginated updates feed. |
| `POST` | `/api/fundraisers/:id/updates` | Body: `{ content }`. Creator or admin. |

`Fundraiser` response shape (cents AND dollar fields both ship for back-compat):
```ts
{ id, tenantId, title, organization, category, target (dollars), raised (dollars),
  targetCents, raisedCents, daysLeft (null when ended), icon, overview,
  coverImageUrl, isClosed, createdAt }
```

## §1.11 Shop / Marketplace

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/shop?category=&q=&limit=&offset=` | `{ data: ShopItem[], total, limit, offset }`. |
| `GET` | `/api/shop/:id` | `ShopItem & { stock, options[] }`. |
| `POST` | `/api/shop/:id/purchase` | Body: `{ paymentMethodId, quantity, optionIds[] }`. Atomic stock reservation BEFORE the PI; restock-on-failure handled. Returns `{ order }`. If `paymentIntent.status === 'requires_action'`, mobile calls `confirmCardPayment(client_secret)` to settle 3DS. |

`ShopItem = { id, tenantId, title, price (cents), category: 'Merch'\|'Events'\|'Giving'\|'Books'\|'Media', section, imageUrl, inStock, hot?, description?, createdAt }`.

## §1.12 Live Stream

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/streams/current` | The single most-recent `is_live=true` stream, or `null`. |
| `GET` | `/api/streams` | `{ data: Stream[] }` newest first. |

`Stream = { id, title, startsAt, endsAt, isLive, muxPlaybackId, thumbnailUrl, viewerCount, ... }`. **`muxStreamKey` is NEVER in GET responses** — only returned once on admin POST. Use `muxPlaybackId` to play HLS via Mux.

**Chat for streams** reuses Supabase Realtime channel: `stream:<streamId>:chat`. Subscribe directly — no backend API for stream chat.

## §1.13 AI Assistant (Premium tier-gated)

**Two-phase send pattern** — EventSource is GET-only and can't carry a body, so:

1. `POST /api/ai/conversations/:id/messages` body `{ content }` → returns `{ messageId }` (persists the user message)
2. Open EventSource at `/api/ai/conversations/:id/messages/:messageId/stream` — emits:
   - `event: token data: "<chunk text>"`
   - `event: done data: {"messageId":"...","conversationId":"..."}`
   - `event: error data: "<message>"`

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/ai/conversations` | `{ data: Conversation[] }` with messageCount + lastMessagePreview. |
| `POST` | `/api/ai/conversations` | Body: `{ content, title? }` → `{ conversation, message }`. |
| `GET` | `/api/ai/conversations/:id` | `{ conversation, messages[] }`. |
| `DELETE` | `/api/ai/conversations/:id` | Cascade-deletes messages. |
| `POST` | `/api/ai/conversations/:id/messages` | See above. |
| `GET (SSE)` | `/api/ai/conversations/:id/messages/:messageId/stream` | See above. |
| `POST` | `/api/ai/transcribe` | Body: `{ audioBase64, mimeType?, filename? }` → `{ text }`. 30 MB body limit. 503 if `OPENAI_API_KEY` not configured. |

**Retention:** conversations TTL = 90 days from last activity; daily purge cron at 03:45 UTC. Send → bumps `expires_at = now() + 90 days`. Privacy policy disclosed.

**Note:** AI is **admin-Premium only**. `AIChatScreen` (consumer-side) is hidden — only `AIAssistantScreen` (admin) is reachable.

## §1.14 Sermons

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/sermons?filter=all\|recent\|series\|topics&limit=&cursor=` | `{ sermons, nextCursor }`. |
| `GET` | `/api/sermons/featured` | The current featured sermon (or null). |
| `GET` | `/api/sermons/series` | `{ data: [{ id (slug), name, sermonCount, thumbnailUrl, latestSpeaker, mostRecentAt }] }`. |
| `GET` | `/api/sermons/series/:id/sermons` | `{ seriesName, data: Sermon[] }`. `:id` is the slug returned by `/series`. |
| `GET` | `/api/sermons/pastors` | `{ data: [{ name, sermonCount, thumbnailUrl, mostRecentAt }] }`. |
| `GET` | `/api/sermons/continue-watching` | User-scoped. `{ data: Sermon[] }` with `lastWatchedSeconds + viewUpdatedAt`. Cap 20. |
| `GET` | `/api/sermons/:id` | Single sermon — includes `commentCount + discussionPostCount` (linked Posts). |
| `POST` | `/api/sermons/:id/view` | Bumps `view_count`. Fire-and-forget. |
| `POST` | `/api/sermons/:id/progress` | Body: `{ lastWatchedSeconds, completed? }`. UPSERT into `sermon_views` with `GREATEST()` guard — stale ping can't roll position back. Set `completed: true` when user reaches end. |
| `POST` | `/api/sermons/:id/like` | Toggle like. |

**Sermon comments** are POSTS linked via `linked_sermon_id`. Mobile posts a regular post with `linkedSermonId` set; replies are comments on that post. The sermon's `commentCount` counts comments across all linked posts; `discussionPostCount` counts distinct linked posts.

## §1.15 Bible reader

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/bible?translation=&book=&chapter=&start=&end=` | `{ passages: [{ ref, verse, text }] }`. 1h cache, 60/min throttle, no auth. |
| `GET` | `/api/bible/books?translation=` | `{ books: [{ name, chapters }] }`. |

Translations: `kjv, web, asv, bbe, darby, dra, wbt, ylt`. **ESV is NOT available** — bible-api.com doesn't carry it (copyright). Mobile should fall back gracefully.

## §1.16 Notifications

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/notifications?type=&limit=&offset=&unreadOnly=` | `{ notifications, data, total, limit, offset, unreadCount }`. Optional `?type=<NotificationType>` filters list + total; `unreadCount` is intentionally unfiltered so the badge stays global. |
| `GET` | `/api/notifications/categories` | **Authenticated.** Returns `{ categories: [{ key, label, description, group, defaultPush, defaultEmail, defaultSms, currentPushEnabled, currentInAppEnabled, currentEmailEnabled, isUserSet }] }` — already merged with the caller's prefs so one round-trip renders the prefs screen. `category.key === notification.type` 1:1. |
| `GET` | `/api/notifications/preferences` | Just the explicit prefs rows (subset of categories). |
| `PUT` | `/api/notifications/preferences` | Body: `{ type, pushEnabled?, inAppEnabled?, emailEnabled? }`. |
| `PUT` | `/api/notifications/read-all` | OR `POST` — both supported. |
| `POST` | `/api/notifications/broadcast/:broadcastId/opened` | Fire-and-forget when user taps a push with `data.broadcastId`. Idempotent. Tenant-scoped — returns 404 if broadcast belongs to a different tenant. |
| `POST` | `/api/notifications/register-device` | Body: `{ token, platform: 'ios'\|'android' }`. |

## §1.17 Chat (Premium)

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/channels` | List user's channels. |
| `POST` | `/api/channels` | Create. |
| `GET` | `/api/channels/:id/messages` | Cursor-paginated. |
| `POST` | `/api/channels/:id/messages` | Send. Refuses with 403 if user is muted. |
| `POST` | `/api/chat/messages/:id/flag` | Body: `{ reason }`. Only members of the channel can flag. Idempotent per (message, reporter). |
| `GET/POST` | `/api/messages/conversations[...]` | DM threads. |

## §1.18 Family

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/family/members/:userId` | Member's family. |
| `GET` | `/api/family/tree/:userId` | Full family tree (child-safety relevant). |
| `POST` | `/api/family/request` | Create relationship request. |
| `POST` | `/api/family/requests/:id/accept` / `/decline` | |
| `PUT` | `/api/family/visibility` | |

## §1.19 Events + iCal

| Method | Path | Purpose |
|---|---|---|
| `GET/POST/PATCH/DELETE` | `/api/events[...]` | CRUD. |
| `POST` | `/api/events/:id/rsvp` | |
| `POST` | `/api/events/ical/regenerate-token` | Admin — rotate the per-tenant iCal subscription token. |
| `GET` | `/api/events/ical-public/:tenantId?token=<token>` | **Public, token-authed.** External calendars (Google/Apple/Outlook) subscribe to this URL. |

## §1.20 Misc mobile endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/prayers` | Cursor-paginated. |
| `GET` | `/api/prayers/kpis` | `{ activeCount, answeredThisMonth, prayingMembersLast7d }` for the Care tile. |
| `POST` | `/api/prayers/:id/pray` | Toggle. |
| `GET/POST/PUT/DELETE` | `/api/groups[...]` | `?type=small_group\|discipleship\|ministry\|class\|other` filter on list. |
| `POST` | `/api/volunteer/opportunities/:id/signup` | Gated on `volunteer` profile-completeness set. |
| `POST` | `/api/leaderboard/app-open` | Fire-and-forget streak ping. |
| `POST` | `/api/badges/check` | Returns rich AchievementModal payload. 60s cache per user. |

---

# §2 — Admin Dashboard team section

Admin endpoints. Mobile team should still skim this — most of these have counterparts the mobile shows (e.g. the admin creates an onboarding form here, the mobile fetches and renders it there).

## §2.1 Admin role guards

Required roles (`@RequiresRole(...)`) per major surface:

| Surface | Required role |
|---|---|
| `/api/dashboard/*` | `admin`, `pastor`, `accountant` |
| `/api/reports/*` | `admin`, `pastor`, `accountant` |
| `PUT /api/leaderboard/status` | `admin`, `pastor` |
| `/api/communications/*` (including `/send`) | `admin`, `pastor` |
| `/api/admin/moderation/*` | `admin`, `pastor` |
| `/api/admin/chat/*` and `/api/admin/chat-moderation/*` | `admin`, `pastor` |
| `/api/admin/family/relationships` | `admin`, `pastor` |
| `/api/admin/account-deletions` | `admin`, `pastor` |
| `/api/admin/shop` | `admin`, `pastor` |
| `/api/admin/fundraisers/*` | `admin`, `pastor` |
| `/api/services/*` (services CRUD) | `admin`, `pastor` |
| `/api/streams` POST/PUT/DELETE | `admin`, `pastor` |
| `/api/stripe/checkout/plan-upgrade` | `admin`, `pastor` |
| `GET /api/giving/recurring/all` | `manage_finance` permission |
| `GET /api/tenants/:tenantId/members/*` | `admin`, `pastor`, `accountant` (tenant clamped) |
| `GET /api/tenants/:tenantId/members/export` | `admin`, `pastor` (+ 5/hour throttle + audit row) |
| `POST /api/attendance/bulk` | `admin`, `pastor` |
| `POST /api/giving/transactions/:id/refund` | `manage_finance` |
| `POST /api/giving/batch` | `admin`, `pastor`, `accountant` |

Use the **highest privilege in each row** as your screen gate.

## §2.2 Dashboard KPIs

`GET /api/dashboard/kpis` returns:
```ts
{
  totalMembers, newMembersThisMonth, totalGivingThisMonth, activeGroups,
  totalPrayers, activeVolunteers, pendingPrayers,
  workflowFailures24h, pendingVolunteerVerifications,
  // prior-period values (added round 6)
  totalMembersLastMonth, totalGivingLastMonth,
  avgAttendance, avgAttendanceLastMonth, attendanceToday,
  serviceCapacity,            // null when no active service has capacity set → render "—"
  goalAmount,                 // from tenants.monthly_giving_goal_cents; null when unset
  growthPct,                  // (this - last) / last × 100; null when last = 0
}
```

Cached 30 seconds via Redis. 14 parallel queries on cache miss — recommend not refreshing more often than every 30s.

## §2.3 Reports

`GET /api/reports/kpis` returns:
```ts
{
  avgMonthlyAttendance, ytdGiving, totalMembers, newMembersThisMonth,
  avgMonthlyAttendancePrev, ytdGivingPrev, newMembersPrev,
  attendanceTrend: number[],   // 6-week sparkline of check-in counts (bare numbers, NOT objects)
  growthTrend: number[],       // 6-week sparkline of new-member counts
}
```

`GET /api/reports/engagement`:
```ts
{ inactive, low, medium, high,
  prev: { high, medium, low },        // 60-30 days ago
  trend: number[] }                    // 6-week active-member counts
```

Other reports endpoints:
- `GET /api/reports/giving/by-fund`
- `GET /api/reports/discipleship-funnel`
- `GET /api/reports/year-over-year-giving`
- `POST /api/reports/export?type=members\|giving\|attendance` (returns CSV)

## §2.4 Members directory

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/tenants/:tenantId/members?cursor=&limit=&missingTagIds=<uuid>,<uuid>` | `?missingTagIds=` returns members missing ALL listed tags ("newcomers not yet welcomed" filter). |
| `POST` | `/api/tenants/:tenantId/members/import` | Bulk CSV import. |
| `GET` | `/api/tenants/:tenantId/members/export` | CSV. Throttled 5/hour + audit row. |
| `GET` | `/api/members/:userId/profile` | 360° view. |
| `PUT` | `/api/members/:userId/journey` | Spiritual journey edits. |
| `GET/POST/DELETE` | `/api/members/:userId/notes[...]` | Pastor notes (private/shared). |
| `GET` | `/api/tenants/:tenantId/members/:userId/profile-completeness` | Admin variant of `/me/profile-completeness` — admin sees what a member is missing for volunteer / child-pickup / group-leader. Returns 404 if target user is not a member of the tenant. |

## §2.5 Onboarding form builder

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/onboarding/field-library` | 50+ pre-built fields grouped by category (`spiritual / personal / family / interests / background`). |
| `GET` | `/api/onboarding/form` | Current church's form. |
| `PUT` | `/api/onboarding/form` | Body: `UpdateFormDto { isActive?, welcomeMessage?, fields[] }`. |
| `DELETE` | `/api/onboarding/form` | Soft delete. |
| `GET` | `/api/onboarding/responses` | All members' submitted responses. |
| `GET` | `/api/onboarding/responses/:userId` | Single member's responses. |
| `GET` | `/api/onboarding/stats` | Top interests, top skills, referral sources. |

## §2.6 Services CRUD + auto-attendance config

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/services` | List for the tenant with upcoming-occurrence counts. |
| `POST` | `/api/services` | Body: `CreateServiceDto`. |
| `PATCH` | `/api/services/:id` | Body: `UpdateServiceDto` (any subset). |
| `DELETE` | `/api/services/:id` | Soft-delete (`is_active = false`). |
| `POST` | `/api/services/occurrences/:id/cancel` | Body: `{ reason? }` — holiday/weather cancel. |
| `GET` | `/api/services/occurrences/:id/attendance` | Per-occurrence roster + counts. |

`Service` shape — list/get include all push + slot fields:
```ts
{ id, tenantId, name, dayOfWeek, startTime, endTime,
  latitude, longitude, radiusMeters,
  lateThresholdMinutes, earlyLeaveThresholdMinutes,
  isActive, autoPushEnabled,
  pushMessage, startPushLeadMinutes (0-30), endPushLeadMinutes (0-30, default 3), endPushMessage,
  pastor, location, capacity, tags: string[],
  upcomingOccurrenceCount, createdAt, updatedAt }
```

## §2.7 Attendance bulk + visitors

| Method | Path | Notes |
|---|---|---|
| `POST` | `/api/attendance/bulk` | Body: `{ userIds, serviceId?, eventId? }` — **either** a service id (recurring slot) or event id (one-off). Dedupe key: `(user, service, event, date)`. |
| `POST` | `/api/attendance/visitors` | Same `serviceId`/`eventId` semantics. |
| `GET` | `/api/attendance/services` | (Distinct from `/api/services` — legacy. Stays for back-compat.) |

For the Events page Check-In tab, send `eventId` not `serviceId`.

## §2.8 Communications (Premium)

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/communications/segments` | |
| `POST` | `/api/communications/segments` | |
| `POST` | `/api/communications/segment-preview` | Body: `{ rules }` → matched-count preview. |
| `GET/POST` | `/api/communications/templates` | |
| `POST` | `/api/communications/send` | Headline broadcast endpoint. |
| `POST` | `/api/communications/schedule` | |
| `GET` | `/api/communications/history` | |
| `GET` | `/api/communications/analytics` | `{ totalSent, totalOpened, totalClicked, openRate, clickRate, sentThisMonth, avgRecipients }`. Note: opened/clicked/rate fields currently always 0 — no open/click tracking infra yet; values populate when that pipeline lands. |
| `GET` | `/api/notifications/broadcasts/history` | `{ broadcasts: [...] }` — per-broadcast delivery + open counts (open count populated via `POST /notifications/broadcast/:id/opened` from mobile). |

## §2.9 Moderation

**Cross-tenant content moderation:**

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/admin/moderation` | `{ items: [...], nextCursor, counts: { pending, reviewed, removed } }`. Per-type preview (comment/user/message). |
| `GET` | `/api/admin/moderation/:id` | Single report detail. |
| `POST` | `/api/admin/moderation/:id/resolve` | Body: `{ action, reason? }`. |

`message`-type report previews include `channelId` (added round 6).

**Chat moderation queue** (separate from general moderation):

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/admin/chat-moderation` | `{ flaggedCount, mutedCount, todayResolved, openTickets }` — KPI summary. |
| `GET` | `/api/admin/chat-moderation/flags?status=open\|resolved\|dismissed\|removed` | `{ data: FlaggedMessage[] }`. |
| `POST` | `/api/admin/chat-moderation/flags/:id/dismiss` | |
| `POST` | `/api/admin/chat-moderation/flags/:id/remove` | Hard-deletes the underlying chat_messages row. |
| `POST` | `/api/admin/chat-moderation/mute` | Body: `{ userId, durationMinutes, reason? }`. |
| `GET` | `/api/admin/chat/threads/:channelId/context?aroundMessageId=` | Tenant-scoped. Returns `{ before, target, after }`. Writes a `chat.thread_inspected` audit row. |
| `DELETE` | `/api/admin/chat/messages/:id` | Soft-delete. Tenant-scoped. |

## §2.10 Audit log

`GET /api/admin/audit-log?actionPrefix=&since=&cursor=` returns `{ entries: [...], nextCursor }`.

Row shape:
```ts
{
  id, action,                    // e.g. "post.deleted", "finance.donation_refunded"
  actor: { id, fullName, avatarUrl, roleAtTime },
  target: { id, fullName, avatarUrl } | null,
  resourceType, resourceId,
  summary,                       // human-readable — render this directly
  metadata,                      // action-specific JSON
  createdAt,
}
```

Filter `?actionPrefix=member.` to surface GDPR rows (`member.data_exported`, `member.account_deleted`, `member.profile_extras_viewed`). Filter `?actionPrefix=finance.donation_refunded` for refund history.

`GET /api/users/admin/account-deletions` — GDPR Art. 30 compliance read. `{ data: [{ id, userId, email, fullName, tenantIds, ipAddress, deletedAt }] }`. Cap 500, newest first.

## §2.11 Stripe Connect health + checkout (admin billing)

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/stripe/connect/health` | `{ chargesEnabled, payoutsEnabled, requirementsCurrentlyDue[], nextPayoutEta, disputeCount }` |
| `POST` | `/api/stripe/connect/onboard` | Returns onboarding link for the church admin to set up payment processing. |
| `POST` | `/api/stripe/connect/setup-intent` | Returns `{ clientSecret }` for adding a card via Stripe Elements. |
| `POST` | `/api/giving/transactions/:id/refund` | Body: `{ reason? }`. |

### Admin Stripe billing — Plan upgrade

`POST /api/stripe/checkout/plan-upgrade` (admin/pastor only):

```jsonc
// Request
{ "targetTier": "premium" | "enterprise", "returnUrl": "..." }

// Response
{ "checkoutUrl": "https://checkout.stripe.com/c/pay/..." }
```

All upgrade transitions supported (`standard→premium`, `standard→enterprise`, `premium→enterprise`). Downgrades + same-tier requests refused with 400.

Mobile/admin flow: `window.location = response.checkoutUrl`. After completion, Stripe redirects to `returnUrl`. The `checkout.session.completed` webhook then updates `tenants.tier` (verifies `session.customer === tenants.stripe_billing_customer_id` to block metadata-spoofed upgrades).

`returnUrl` convention: `https://dashboard.shepard.love/settings/billing?checkout=...`.

## §2.12 Sermon stats

`GET /api/sermons/stats` returns:
```ts
{ totalViews, avgWatchSeconds, sermonsThisMonth, seriesActive }
```

`avgWatchSeconds` now returns real data (powered by `sermon_views` table from migration 095).

## §2.13 Admin Shop CRUD

| Method | Path | Notes |
|---|---|---|
| `POST` | `/api/admin/shop` | Body: `CreateShopItemDto` with optional `options[]`. |
| `PATCH` | `/api/admin/shop/:id` | Partial. Passing `options` replaces the option set. |
| `DELETE` | `/api/admin/shop/:id` | Soft-delete (preserves order history; `shop_orders.item_id` is `ON DELETE RESTRICT`). |

## §2.14 Admin Fundraisers

| Method | Path | Notes |
|---|---|---|
| `POST` | `/api/fundraisers` | Create. |
| `PATCH` | `/api/fundraisers/:id` | Update. |
| `POST` | `/api/fundraisers/:id/close` | Sets status `'completed'`. |
| `DELETE` | `/api/fundraisers/:id` | Soft-cancel (status `'cancelled'`). |

## §2.15 Admin Live Streams

| Method | Path | Notes |
|---|---|---|
| `POST` | `/api/streams` | Provisions Mux Live Stream. Returns `{ ...stream, streamKey }` — **only response that includes `streamKey`** (RTMP secret for OBS paste-in). Throttled 5/min/tenant (Mux provisioning costs money). |
| `PUT` | `/api/streams/:id` | Update title/startsAt/endsAt/thumbnailUrl/isLive. |
| `DELETE` | `/api/streams/:id` | Tears down the Mux live stream too — old `streamKey` stops working. |

## §2.16 Admin Workflow Store (Enterprise)

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/workflow-store` | Browse marketplace. |
| `POST` | `/api/workflow-store/publish` | Publish your church's workflow. |
| `POST` | `/api/workflow-store/:id/install` | Install a template. |
| `POST` | `/api/workflow-store/:id/rate` | |
| `POST` | `/api/workflow-store/seed-official` | Seed 22 official templates. |

## §2.17 Workflow executions

| Method | Path | Notes |
|---|---|---|
| `POST` | `/api/workflows/:id/trigger` | Body: `{ targetUserId? }`. **Actually executes** the saved node graph + records execution logs per node. |
| `GET` | `/api/workflows/:id/executions` | Per-workflow execution list. |
| `GET` | `/api/workflows/executions/admin?status=failed&since=` | Tenant-wide failure dashboard. |

## §2.18 Volunteer verification queue

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/volunteer/hours/pending` | `{ pending: [...], count }`. |
| `POST` | `/api/volunteer/hours/:id/verify` | |
| `POST` | `/api/volunteer/hours/:id/reject` | |

`pendingVolunteerVerifications` is on `/api/dashboard/kpis` for the tile.

## §2.19 Tasks

`GET /api/tasks?status=&priority=&assignedTo=&linkedType=&linkedId=&overdue=true&dueBefore=<ISO>&cursor=<ISO>` (cursor is also ISO; garbage cursors return 400 not 500).

- `?assignedTo=<userId>` for "My Tasks" tab
- `?overdue=true` → `WHERE due_date < now() AND status != 'completed'`
- `?dueBefore=<ISO-8601>` → `WHERE due_date < $iso`

All filters stack.

## §2.20 Family relationship audit (child safety)

`GET /api/admin/family/relationships?userId=<uuid>` returns `{ relationships: [...] }` — confirmed + inferred relationships with provenance for child-safety audits.

---

# §3 — Cross-cutting

## Error contracts

Stable error codes — clients should hard-match on `code`, not `message`:

| `code` | When | Body |
|---|---|---|
| `TENANT_MISMATCH` | `X-Active-Tenant-Id` header disagrees with JWT | `{ statusCode: 409, code, message, jwtTenantId, headerTenantId }` |
| `PROFILE_INCOMPLETE` | Caller fails a profile-completeness gate | `{ statusCode: 400, code, message, requirementSet, missing: [{field, label}] }` |

The TypeScript shape of `PROFILE_INCOMPLETE` lives in `backend/src/users/profile-completeness.types.ts` — copy into your shared types.

## Rate limits (relevant ones)

| Surface | Limit |
|---|---|
| Global (per-IP default) | Throttled via `CustomThrottlerGuard` |
| `POST /api/attendance/ping` | 30 / min / IP |
| `GET /api/checkin/checkin/child/:code/verify` | 60 / 5 min / (tenant, IP) — generous for real Sunday-pickup load; per-code 3-attempt lockout is the primary brute-force defense |
| `POST /api/streams` | 5 / min / tenant — Mux provisioning costs money |
| `GET /api/bible/*` | 60 / min / IP |
| `GET /api/tenants/:tenantId/members/export` | 5 / hour / tenant + audit row |

## Endpoint envelope keys (current)

| Endpoint | Envelope key |
|---|---|
| `GET /api/posts` (+ saved/archive) | `{ posts, total, limit, offset }` |
| `GET /api/notifications` | `{ notifications, data, total, limit, offset, unreadCount }` (dual-key transition) |
| `GET /api/admin/moderation` | `{ items, nextCursor, counts }` |
| `GET /api/admin/family/relationships` | `{ relationships }` |
| `GET /api/notifications/broadcasts/history` | `{ broadcasts }` |
| `GET /api/volunteer/hours/pending` | `{ pending, count }` |
| `GET /api/admin/audit-log` | `{ entries, nextCursor }` |
| `GET /api/users/admin/account-deletions` | `{ data }` |
| `GET /api/shop`, `/api/streams`, `/api/sermons/series`, `/api/sermons/pastors`, `/api/sermons/continue-watching`, `/api/fundraisers`, `/api/stripe/payment-methods`, `/api/admin/chat-moderation/flags` | `{ data, ... }` |

All NEW endpoints standardize on `{ data, ... }`. Legacy endpoints will migrate when we have a free sprint — we'll ping before any cutover so client normalizers can drop.

## Notification categories

`category.key === notification.type` — 1:1 mapping. Notification types are listed in `backend/src/notifications/notifications.types.ts` (NOTIFICATION_TYPE_KEYS array).

## Audit log conventions

Every admin-impactful write goes through `AuditService.log({ action, resourceType, resourceId, summary, metadata, targetUserId? })`. Action format is `<domain>.<verb>` — examples:

- `post.deleted`, `comment.deleted`
- `service.created`, `service.updated`, `service.deactivated`, `service.occurrence_cancelled`
- `chat.message_removed`, `chat.flag_dismissed`, `chat.flag_removed`, `chat.user_muted`, `chat.thread_inspected`
- `member.data_exported`, `member.account_deleted`, `member.profile_extras_viewed`
- `finance.donation_refunded`
- `tenant.plan_upgrade_initiated`, `tenant.tier_upgraded`
- `stream.created`
- `shop.item_created`, `shop.item_updated`, `shop.item_deleted`, `shop.purchase`
- `sermon.published`, `sermon.updated`, `sermon.deleted`

The audit log viewer renders `summary` directly — backend always writes a sentence the admin can read.

## Retention policy (matches the live privacy page)

| Data | Retention |
|---|---|
| Server access + application logs | 90 days |
| Database backups | 30 days |
| Push notification device tokens | Deleted on logout |
| Auto-attendance raw GPS pings | 90 days (cron at 03:30 UTC daily) |
| AI assistant conversations | 90 days from last message; resets on activity. Cron at 03:45 UTC daily |
| Whisper transcription audio | OpenAI retains 30 days, then deletes |
| Aggregated service-attendance records | 7 years, anonymized after account deletion |
| Donation records | 7 years (US IRS recordkeeping) |
| All other personal data on account deletion | 30 days |

## Deferred work (known follow-ups, not blocking)

Items in the backlog that are real bugs / improvements, not yet shipped:

- **Anthropic stream inside RLS request transaction** → pool starvation under load. Should commit user message then stream outside tx. (M1 round 7)
- **Dashboard 14-query thundering herd on cache miss** → single-flight wrap recommended. (M2 round 7)
- **Reports trend correlated subqueries** → 400-600ms spikes on busy tenants; rewrite with `GROUP BY date_trunc + generate_series`. (M3 round 7)
- **AI conversation list correlated subqueries** → O(N²) on power users; denormalize `message_count` + `last_message_preview` onto `ai_conversations`. (M4 round 7)
- **Stripe Price catalog spam** — every recurring sub creates a new Price/Product. Cache table keyed by (currency, amount, frequency). (H9 round 5)
- **Mux passthrough collision** — prefix with `pvu:` / `post:` so credential rotations don't cross UUID spaces. (H12 round 5)
- **Communications open/click tracking** — fields ship as 0 until pipeline exists.

When any of these land, the master doc gets updated in the same commit.

---

# §4 — User-confirmation items

These are facts the user (Zel) confirmed but flagged "we will be changing them before we fully go live." When any of these change, ping me and I'll do the one-line swap.

| Item | Current | Future change |
|---|---|---|
| Legal entity | "Denzel Christopher Combs, an Indiana sole proprietorship" (in `backend/src/legal/terms.html.ts` + bundled mobile fallback) | Will incorporate as LLC before public launch |
| Governing law / venue | State of Indiana, Marion County | Stays Indiana (unless LLC formed elsewhere) |
| Domain mailboxes | `copyright@`, `privacy@`, `legal@`, `support@shepard.love` — all confirmed monitored | No change planned |
| Server-log + backup retention | Render 90d, Supabase 30d — confirmed per current plan tiers | No change planned |
| NCMEC CyberTipline ESP registration | Terms commits to CSAM reporting via NCMEC — registration pending | Will register at https://report.cybertip.org before App Store / Play Store submission |

---

# Changelog policy

Every backend change ships with an updated section of this document in the SAME commit. The format is always:

1. Brief commit message
2. Updated relevant section(s) here
3. If a contract changed, both teams (mobile + admin) get the change called out in their section AND in §3 cross-cutting
4. Migration number + table changes
5. Adversarial-review fixes (when applicable) called out

**Going forward, this is the single document both teams read.** No more `*_PROMPT.md` / `*_REPLY*.md` / `*_FIXES.md` per-feature docs — they get folded into this one.

---

# Cross-team inbox (sibling project, not in this repo)

Lives at `D:/shepard-team-inbox/` (separate from this backend repo). A
file-watcher daemon ferries requests between the three Shepard Claude
Code sessions on this machine (backend, mobile, admin) without the
human in the middle copy-pasting.

**How a request flows:**
1. Mobile or admin Claude writes a request file to
   `D:/shepard-team-inbox/to-backend/<team>--<slug>.md` per
   `D:/shepard-team-inbox/PROTOCOL.md`
2. The daemon (running in a background terminal — `cd D:/shepard-team-inbox && npm start`)
   sees the new file within ~1 second and spawns a headless
   `claude -p` session inside the backend project
3. That cold-start Claude reads the request, does the work (edits
   code, runs `npx tsc --noEmit`, commits, etc.), and writes a reply
   to `D:/shepard-team-inbox/to-<sender>/<original>--reply.md`
4. The originating team's daemon picks up the reply and spawns their
   Claude with "read the reply and take any follow-up action"

**For interactive sessions** (someone at the keyboard), asking "any
new asks?" prompts Claude to scan `D:/shepard-team-inbox/to-<self>/`
and process pending requests.

**Anything that changes a contract MUST update this document in the
same commit** — that's how the other team finds out without a
follow-up round-trip.

See `D:/shepard-team-inbox/README.md` for setup + `PROTOCOL.md` for
the request/reply file schema.
