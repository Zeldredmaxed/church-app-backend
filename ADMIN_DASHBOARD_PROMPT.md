# Shepard Admin Dashboard — Frontend Build Prompt

## What Is This Document?

This is a complete specification for building the **Shepard Admin Dashboard** — the desktop web application where church pastors and administrators manage their church. The backend API is fully built and deployed. A React Native mobile app already exists for church members. This document covers everything needed to build the desktop admin dashboard from scratch.

---

## 1. Project Context

**Shepard** is a multi-tenant church management SaaS platform. Each church is a "tenant" with isolated data enforced by PostgreSQL Row-Level Security. The platform has three layers:

1. **Backend API** (NestJS, deployed on Render) — **DONE**
2. **Mobile App** (React Native) — **DONE** (member-facing: feed, chat, giving, notifications)
3. **Admin Dashboard** (Desktop web) — **THIS IS WHAT YOU'RE BUILDING**

The admin dashboard is the church management cockpit. Pastors and admins log in here to:
- See church health at a glance (member count, giving trends, engagement)
- Manage members (invite, assign roles, set permissions)
- Moderate content (posts, comments)
- Track donations and manage Stripe Connect
- Configure church settings
- Manage chat channels

**Backend API base URL:** `https://church-app-backend-27hc.onrender.com/api`
**Swagger docs (dev only):** `/api/docs`
**OpenAPI spec:** `backend/swagger.json`

---

## 2. Recommended Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Framework | **Next.js 14+** (App Router) | SSR where needed, file-based routing, React Server Components |
| Styling | **Tailwind CSS** + **shadcn/ui** | Rapid, consistent UI. shadcn gives you Table, Dialog, Sheet, Command, etc. |
| State / Data | **TanStack Query (React Query)** | Cache management, optimistic updates, pagination hooks |
| Auth | **@supabase/supabase-js** (client) | JWT management, token refresh, session persistence |
| Charts | **Recharts** | Giving trends, engagement graphs |
| Forms | **React Hook Form** + **Zod** | Validation that mirrors backend DTOs |
| Icons | **Lucide React** | Clean, consistent icon set (ships with shadcn) |
| Date handling | **date-fns** | Lightweight, tree-shakeable |

---

## 3. Authentication Flow

The dashboard uses **Supabase JWT tokens**. The flow:

```
1. User enters email + password
2. POST /api/auth/login → { accessToken, refreshToken, expiresAt, user }
3. Store accessToken in memory (NOT localStorage), refreshToken in httpOnly cookie or secure storage
4. user.currentTenantId tells you which church they're viewing
5. If null → show church picker (GET /api/memberships → list of churches)
6. If set → load dashboard for that church
```

### Tenant Switching
```
1. User picks a different church from the switcher
2. POST /api/auth/switch-tenant { tenantId } → { currentTenantId, yourRole }
3. POST /api/auth/refresh { refreshToken } → new { accessToken } with updated tenant claim
4. Reload all dashboard data with the new token
```

### Token Refresh
```
- Before every API call, check if token is near expiry
- POST /api/auth/refresh { refreshToken } → new tokens
- If refresh fails → redirect to login
```

### Every API call must include:
```
Authorization: Bearer <accessToken>
```

---

## 4. Role & Permission System

### Roles (hierarchical)

| Role | Description | Dashboard Access |
|------|-------------|-----------------|
| `admin` | Church owner/lead pastor | **Full access** — bypasses all permission checks |
| `pastor` | Staff pastor | Most features, limited by permissions |
| `accountant` | Financial staff | Finance-only view (requires `manage_finance`) |
| `worship_leader` | Worship team lead | Content + worship management |
| `member` | Regular church member | **No dashboard access** — redirect to mobile app or "no access" page |

### Granular Permissions (stored as JSONB on each membership)

| Permission Key | Controls |
|----------------|----------|
| `manage_finance` | View/export donation transactions, Stripe Connect settings |
| `manage_content` | Moderate posts, delete comments, manage feed |
| `manage_members` | Invite members, change roles, remove members |
| `manage_worship` | (Future) Manage service schedules, worship sets |
| `view_analytics` | View dashboard metrics, engagement charts |

**Rule:** `admin` role bypasses ALL permission checks. Every other role must have the specific permission flag set to `true`.

### How to fetch the current user's role and permissions:
```
GET /api/memberships → returns array of { userId, tenantId, role, tenant: {...} }
```
Find the membership where `tenantId` matches the current tenant. The `role` field plus the tenant's tier features determine what UI to show.

For permissions on the current membership, the response from switch-tenant gives you `yourRole`. For the full permission object, fetch members list and find yourself:
```
GET /api/tenants/{tenantId}/members → includes permissions JSONB for each member
```

---

## 5. Tier-Based Feature Gating

The backend returns feature flags via:
```
GET /api/tenants/{id}/features → { tenant: { id, name, slug, tier, tierDisplayName }, features: {...} }
```

**Call this on login and cache the result.** Use it to show/hide UI sections.

| Feature Flag | Standard | Premium | Enterprise |
|-------------|----------|---------|------------|
| `mobileApp` | Yes | Yes | Yes |
| `maxAdminUsers` | 5 | Unlimited (-1) | Unlimited |
| `granularRoles` | No | Yes | Yes |
| `internalFeed` | Yes | Yes | Yes |
| `globalFeed` | Yes | Yes | Yes |
| `videoPostsAllowed` | No | Yes | Yes |
| `search` | No | Yes | Yes |
| `pushNotifications` | No | Yes | Yes |
| `pushNotificationsSegmented` | No | No | Yes |
| `chat` | No | Yes | Yes |
| `videoUploads` | No | Yes | Yes |
| `storageLimit` | 10 GB | 100 GB | Unlimited |
| `transactionFeePercent` | 1.0 | 0.5 | 0 |
| `customBranding` | No | No | Yes |
| `multiSite` | No | No | Yes |
| `apiAccess` | No | No | Yes |

**UI behavior for disabled features:** Show the section in the sidebar but display an upsell card ("Upgrade to Premium to unlock Chat") instead of the feature content. Do NOT hide sections entirely — the user should know what's available at higher tiers.

---

## 6. Application Shell & Navigation

### Layout Structure
```
┌─────────────────────────────────────────────────────┐
│  Top Bar: Church name + logo | Search | Notifications bell | Profile avatar  │
├──────────┬──────────────────────────────────────────┤
│          │                                          │
│ Sidebar  │           Main Content Area              │
│          │                                          │
│ - Dashboard    │                                    │
│ - Members      │                                    │
│ - Content      │                                    │
│ - Giving       │                                    │
│ - Chat         │                                    │
│ - Settings     │                                    │
│          │                                          │
│──────────│                                          │
│ Church   │                                          │
│ Switcher │                                          │
└──────────┴──────────────────────────────────────────┘
```

### Sidebar Navigation Items

| Nav Item | Icon | Route | Required Permission | Tier Gate |
|----------|------|-------|-------------------|-----------|
| Dashboard | `LayoutDashboard` | `/dashboard` | `view_analytics` | None |
| Members | `Users` | `/members` | `manage_members` | None |
| Content | `FileText` | `/content` | `manage_content` | `internalFeed` |
| Giving | `Heart` | `/giving` | `manage_finance` | None |
| Chat | `MessageSquare` | `/chat` | `manage_content` | `chat` |
| Settings | `Settings` | `/settings` | Admin only | None |

**Church Switcher:** At the bottom of the sidebar, show the current church name + tier badge. Clicking opens a dropdown of all churches the user belongs to (from `GET /api/memberships`).

---

## 7. Page-by-Page Specification

---

### 7.1 Login Page (`/login`)

**Layout:** Centered card on a clean background. No sidebar.

**Fields:**
- Email input
- Password input
- "Sign In" button
- "Forgot password?" link (Supabase handles reset flow)

**API calls:**
```
POST /api/auth/login
Body: { email, password }
Response: { accessToken, refreshToken, expiresAt, user: { id, email, currentTenantId } }
```

**After login:**
- If `user.currentTenantId` exists → navigate to `/dashboard`
- If null → show church picker overlay, then `POST /api/auth/switch-tenant` + `POST /api/auth/refresh`

**Error states:**
- 401 → "Invalid email or password"
- 429 → "Too many attempts. Please wait a minute." (rate limited to 5/min)

---

### 7.2 Dashboard Overview (`/dashboard`)

**Purpose:** At-a-glance church health metrics. The first thing an admin sees.

**Required permission:** `view_analytics` (admin always has access)

**Layout:** Grid of metric cards + charts

**Sections:**

#### Top Row — Key Metrics (4 cards)
| Card | Data Source | Display |
|------|-----------|---------|
| Total Members | `GET /api/tenants/{id}/members` — use the `total` from response | Large number + trend arrow |
| Pending Invitations | `GET /api/invitations` — count where `isExpired === false` | Number with "View" link |
| Donations This Month | `GET /api/tenants/{id}/transactions` — sum `amount` where `status === 'succeeded'` and `createdAt` is current month | Dollar amount |
| Active Channels | `GET /api/channels` — count | Number |

#### Middle Row — Giving Chart
- Line chart showing donation totals over the last 12 months
- Data: `GET /api/tenants/{id}/transactions` (paginate through all, group by month client-side)
- Use Recharts `<LineChart>` or `<AreaChart>`
- Show platform fee percentage from tier features

#### Bottom Row — Recent Activity
- **Recent Posts** — `GET /api/posts?limit=5` — show author avatar, content preview, timestamp
- **Recent Donations** — `GET /api/tenants/{id}/transactions?limit=5` — show amount, status badge, date

---

### 7.3 Members Page (`/members`)

**Required permission:** `manage_members`

**Layout:** Table with toolbar

**Toolbar:**
- Search input (client-side filter, or use `GET /api/search/members?q=...` if tier allows search)
- "Invite Member" button → opens invite dialog
- Role filter dropdown (All, Admin, Pastor, Accountant, Worship Leader, Member)

**Members Table:**
```
GET /api/tenants/{tenantId}/members?limit=20&cursor=...
```

| Column | Field | Notes |
|--------|-------|-------|
| Avatar + Name | `avatarUrl`, `fullName` | Fallback to initials if no avatar |
| Email | `email` | |
| Role | `role` | Badge with color coding |
| Joined | `createdAt` | Relative time ("3 days ago") |
| Actions | — | Dropdown: Change Role, Edit Permissions, Remove |

**Pagination:** Cursor-based. Show "Load More" button at bottom.

**Invite Dialog:**
```
POST /api/invitations
Body: { email, role }
```
- Email input
- Role dropdown: Admin, Pastor, Member (only these 3 can be invited)
- "Send Invitation" button
- Error: 409 if already a member or pending invitation exists

**Change Role Dialog:**
```
PATCH /api/tenants/{tenantId}/members/{userId}/role
Body: { role }
```
- Dropdown with all 5 roles (admin, pastor, accountant, worship_leader, member)
- Note: `accountant` and `worship_leader` only available if tier has `granularRoles === true`

**Edit Permissions Dialog (Premium+ tiers only):**
```
PATCH /api/tenants/{tenantId}/members/{userId}/permissions
Body: { permissions: { manage_finance: true, manage_content: false, ... } }
```
- 5 toggle switches, one per permission
- Only visible when `features.granularRoles === true`
- Disabled for `admin` role (always has all permissions)

**Remove Member:**
```
DELETE /api/tenants/{tenantId}/members/{userId}
```
- Confirmation dialog: "Remove {name} from {churchName}?"

---

### 7.4 Content / Posts Page (`/content`)

**Required permission:** `manage_content`

**Layout:** Feed-style list with moderation controls

**API:**
```
GET /api/posts?limit=20&offset=0
```

**Each Post Card:**
- Author avatar + name + timestamp
- Post content (text)
- Media preview (image thumbnail or video player if `mediaType !== 'text'`)
- Engagement: like count, comment count
- Actions: "View Comments", "Delete Post"

**Delete Post:**
```
DELETE /api/posts/{id}
```
- Confirmation dialog
- Admin can delete any post; authors can delete their own

**Comments Panel (slide-out or expand):**
```
GET /api/posts/{postId}/comments?limit=20&offset=0
```
- List of comments with author, content, timestamp
- No delete endpoint exists for individual comments — only post deletion cascades

**Create Post (optional — admins may want to post announcements):**
```
POST /api/posts
Body: { content, mediaType?, mediaUrl?, videoMuxPlaybackId?, visibility?, mentions?[] }
```

---

### 7.5 Giving / Donations Page (`/giving`)

**Required permission:** `manage_finance`

**Layout:** Summary cards + transaction table

#### Summary Row (3 cards)
| Card | Calculation |
|------|------------|
| Total Received | Sum of `succeeded` transactions |
| Platform Fees | Total * `features.transactionFeePercent / 100` |
| Pending | Count of `pending` transactions |

#### Stripe Connect Status Banner
```
GET /api/stripe/connect/status
```
- If `status === 'pending'` → Show "Set Up Payment Processing" CTA
- If `status === 'onboarding'` → Show "Complete Stripe Setup" CTA
- If `status === 'active'` → Green badge "Payments Active"
- If `status === 'restricted'` → Yellow warning "Action Required"

**Stripe Onboarding (if not active):**
```
POST /api/stripe/connect/onboard
Body: { refreshUrl: window.location.href, returnUrl: window.location.href + '?setup=complete' }
Response: { url, stripeAccountId }
```
→ Redirect admin to `url` (Stripe-hosted onboarding). They return to `returnUrl` when done.

#### Transactions Table
```
GET /api/tenants/{tenantId}/transactions?limit=20&cursor=...
```

| Column | Field | Notes |
|--------|-------|-------|
| Date | `createdAt` | Formatted date |
| Amount | `amount` + `currency` | e.g., "$100.00 USD" |
| Status | `status` | Badge: green=succeeded, yellow=pending, red=failed, gray=refunded |
| Donor | `userId` | Resolve to name if possible, or show "Anonymous" if null (GDPR erased) |
| Stripe ID | `stripePaymentIntentId` | Truncated, click to copy |

**Pagination:** Cursor-based. "Load More" button.

---

### 7.6 Chat Management (`/chat`)

**Required permission:** `manage_content`
**Tier gate:** `features.chat === true`

**Layout:** Channel list + selected channel messages

**Channels List:**
```
GET /api/channels
```
- Show channel name, type badge (public/private/direct), member count
- "Create Channel" button

**Create Channel Dialog:**
```
POST /api/channels
Body: { name, type: 'public' | 'private' | 'direct' }
```

**Channel Messages (right panel):**
```
GET /api/channels/{id}/messages?limit=50&cursor=...
```
- Message list with author, content, timestamp
- "Load Older" button for cursor pagination
- Send message input at bottom

**Add Member to Channel:**
```
POST /api/channels/{id}/members
Body: { userId }
```

---

### 7.7 Notifications (`/notifications` or top-bar dropdown)

**No specific permission required** — all authenticated users see their own notifications.

**API:**
```
GET /api/notifications?limit=20&offset=0&unreadOnly=true
```

**Notification Types to Handle:**

| Type | Display |
|------|---------|
| `NEW_COMMENT` | "{actor} commented on your post" — link to post |
| `POST_MENTION` | "{actor} mentioned you in a post" — link to post |
| `NEW_GLOBAL_POST` | "{actor} shared a new post" — link to post |
| `NEW_MESSAGE` | "{actor} sent a message in {channelName}" — link to channel |

**Mark as Read:**
```
PATCH /api/notifications/{id}/read
```

**Top Bar Bell:**
- Show unread count badge
- Click opens dropdown with recent notifications
- "View All" links to full `/notifications` page

---

### 7.8 Church Settings (`/settings`)

**Required:** Admin role only

**Tabs:**

#### General Tab
- Church name (read-only for now — no update endpoint exists)
- Church App ID / slug (read-only)
- Tier badge + feature summary
- "View Features" → expand tier feature table

**Data source:** `GET /api/tenants/{id}` and `GET /api/tenants/{id}/features`

#### Billing / Tier Tab
- Current tier with display name
- Feature comparison table (Standard vs Premium vs Enterprise)
- "Upgrade" CTA (link to your pricing page — this is external, not an API call)
- Platform fee percentage

#### Invitations Tab
- Pending invitations list: `GET /api/invitations`
- Each shows: email, role, sent date, expired status
- "Resend" action (delete expired + create new)
- "Revoke" action (not yet implemented — would need a DELETE endpoint)

---

### 7.9 Account / Profile (`/account`)

**No special permission required.**

**Profile Section:**
```
GET /api/users/me → { id, email, fullName, avatarUrl, createdAt }
```

**Edit form:**
```
PATCH /api/users/me
Body: { fullName?, avatarUrl? }
```
- Full name input
- Avatar upload: `POST /api/media/presigned-url` → upload to S3 → save URL via PATCH

**Saved Payment Methods:**
```
POST /api/stripe/connect/setup-intent → { clientSecret }
```
- Use Stripe Elements `<CardElement>` with the clientSecret to save a card
- Display saved cards (requires Stripe.js `listPaymentMethods` client-side)

**Danger Zone:**
- "Export My Data" button → `GET /api/users/me/export` → download as JSON
- "Delete Account" button → confirmation dialog → `DELETE /api/users/me`

---

### 7.10 Search (`/search` or global search bar)

**Tier gate:** `features.search === true`

**Post Search:**
```
GET /api/search/posts?q=...&limit=20&cursor=...
Response: { data: PostSearchResult[], nextCursor }
```

**Member Search:**
```
GET /api/search/members?q=...&limit=20&cursor=...
Response: { results: MemberSearchResult[], nextCursor }
```

**UI:** Global search bar in the top nav. Results displayed in a dropdown or dedicated page with tabs for "Posts" and "Members".

---

## 8. API Quick Reference

### Auth
| Method | Path | Body | Notes |
|--------|------|------|-------|
| POST | `/api/auth/login` | `{email, password}` | Returns tokens |
| POST | `/api/auth/refresh` | `{refreshToken}` | Get new tokens |
| POST | `/api/auth/switch-tenant` | `{tenantId}` | Switch church, then refresh |

### Tenants
| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/tenants/{id}` | Tenant details |
| GET | `/api/tenants/{id}/features` | Tier + feature flags |

### Users
| Method | Path | Body | Notes |
|--------|------|------|-------|
| GET | `/api/users/me` | — | Current user profile |
| PATCH | `/api/users/me` | `{fullName?, avatarUrl?}` | Update profile |
| GET | `/api/users/me/export` | — | GDPR data export |
| DELETE | `/api/users/me` | — | GDPR account deletion |

### Memberships
| Method | Path | Body / Params | Notes |
|--------|------|--------------|-------|
| GET | `/api/memberships` | — | All churches user belongs to |
| POST | `/api/memberships` | `{email, role}` | Add member by email |
| GET | `/api/tenants/{id}/members` | `?cursor=&limit=` | List members |
| PATCH | `/api/tenants/{id}/members/{userId}/role` | `{role}` | Change role |
| PATCH | `/api/tenants/{id}/members/{userId}/permissions` | `{permissions: {...}}` | Update permissions |
| DELETE | `/api/tenants/{id}/members/{userId}` | — | Remove member |

### Invitations
| Method | Path | Body | Notes |
|--------|------|------|-------|
| GET | `/api/invitations` | — | Pending invitations |
| POST | `/api/invitations` | `{email, role}` | Send invitation |

### Posts
| Method | Path | Body / Params | Notes |
|--------|------|--------------|-------|
| GET | `/api/posts` | `?limit=&offset=&authorId=` | List posts |
| POST | `/api/posts` | `{content, mediaType?, ...}` | Create post |
| GET | `/api/posts/{id}` | — | Single post |
| PATCH | `/api/posts/{id}` | `{content?, visibility?}` | Update post |
| DELETE | `/api/posts/{id}` | — | Delete post |

### Comments
| Method | Path | Body / Params | Notes |
|--------|------|--------------|-------|
| GET | `/api/posts/{postId}/comments` | `?limit=&offset=` | List comments |
| POST | `/api/posts/{postId}/comments` | `{content}` | Create comment |

### Notifications
| Method | Path | Params | Notes |
|--------|------|--------|-------|
| GET | `/api/notifications` | `?limit=&offset=&unreadOnly=` | List notifications |
| PATCH | `/api/notifications/{id}/read` | — | Mark read |

### Media
| Method | Path | Body | Notes |
|--------|------|------|-------|
| POST | `/api/media/presigned-url` | `{filename, contentType}` | Get S3 upload URL |

### Chat
| Method | Path | Body / Params | Notes |
|--------|------|--------------|-------|
| GET | `/api/channels` | — | List channels |
| POST | `/api/channels` | `{name?, type}` | Create channel |
| POST | `/api/channels/{id}/members` | `{userId}` | Add member |
| GET | `/api/channels/{id}/messages` | `?cursor=&limit=` | Get messages |
| POST | `/api/channels/{id}/messages` | `{content}` | Send message |

### Search
| Method | Path | Params | Notes |
|--------|------|--------|-------|
| GET | `/api/search/posts` | `?q=&cursor=&limit=` | Search posts |
| GET | `/api/search/members` | `?q=&cursor=&limit=` | Search members |

### Stripe / Giving
| Method | Path | Body | Notes |
|--------|------|------|-------|
| POST | `/api/stripe/connect/onboard` | `{refreshUrl, returnUrl}` | Start Stripe Connect |
| GET | `/api/stripe/connect/status` | — | Onboarding status |
| POST | `/api/stripe/connect/setup-intent` | — | Save payment method |
| POST | `/api/giving/donate` | `{amount, currency?}` | Create donation |
| GET | `/api/giving/transactions` | `?cursor=&limit=` | My donations |
| GET | `/api/tenants/{id}/transactions` | `?cursor=&limit=` | Tenant donations (admin) |

### Health
| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/health` | Liveness |
| GET | `/api/health/ready` | Readiness (DB check) |

---

## 9. Key Implementation Notes

### Error Handling Pattern
All API errors follow this shape:
```json
{ "statusCode": 400, "message": "Description", "error": "Bad Request" }
```
Common codes: 400 (validation), 401 (auth), 403 (forbidden), 404 (not found), 409 (conflict), 429 (rate limit).

### Pagination Patterns
Two patterns are used:
1. **Offset-based** (posts, comments, notifications): `?limit=20&offset=0`
2. **Cursor-based** (members, transactions, messages, search): `?limit=20&cursor=<lastItemId>`
   - Response includes `nextCursor: string | null` — null means no more pages

### Date Handling
All timestamps are ISO 8601 strings from the API. Parse with `new Date()` or `date-fns`.

### Image Upload Flow
1. `POST /api/media/presigned-url { filename: "photo.jpg", contentType: "image/jpeg" }`
2. Response: `{ uploadUrl, fileKey }`
3. `PUT uploadUrl` with raw file body and `Content-Type` header
4. Use the `fileKey` as the `mediaUrl` or `avatarUrl` in subsequent API calls

### Real-time (Future Enhancement)
Supabase Realtime can be used for live chat messages and notifications. For MVP, polling every 30 seconds is sufficient for notifications. Chat should poll every 5 seconds when a channel is open.

### Token Storage
- **accessToken:** Store in memory (React state/context). Never localStorage.
- **refreshToken:** httpOnly cookie (if you control the domain) or encrypted secure storage.
- Attach to every request via an Axios/fetch interceptor.

### Tenant Context
Almost every API call is scoped to the user's current tenant via their JWT. You don't need to pass `tenantId` in most requests — the backend reads it from the token. The exceptions are:
- `GET /api/tenants/{id}/members` — pass the tenant ID in the URL
- `GET /api/tenants/{id}/transactions` — pass the tenant ID in the URL
- `GET /api/tenants/{id}/features` — pass the tenant ID in the URL

---

## 10. File Structure Suggestion

```
shepard-admin/
├── app/
│   ├── (auth)/
│   │   └── login/page.tsx
│   ├── (dashboard)/
│   │   ├── layout.tsx            ← Shell with sidebar + top bar
│   │   ├── dashboard/page.tsx    ← Overview
│   │   ├── members/page.tsx
│   │   ├── content/page.tsx
│   │   ├── giving/page.tsx
│   │   ├── chat/page.tsx
│   │   ├── notifications/page.tsx
│   │   ├── settings/page.tsx
│   │   └── account/page.tsx
│   ├── layout.tsx                ← Root layout (providers)
│   └── page.tsx                  ← Redirect to /dashboard or /login
├── components/
│   ├── ui/                       ← shadcn components (Button, Table, Dialog, etc.)
│   ├── sidebar.tsx
│   ├── top-bar.tsx
│   ├── church-switcher.tsx
│   ├── notification-bell.tsx
│   ├── tier-badge.tsx
│   ├── upsell-card.tsx           ← "Upgrade to unlock" placeholder
│   └── status-badge.tsx          ← Reusable status pill (succeeded/pending/failed)
├── lib/
│   ├── api.ts                    ← Axios/fetch instance with auth interceptor
│   ├── supabase.ts               ← Supabase client init
│   ├── auth-context.tsx          ← Auth provider (tokens, user, tenant)
│   ├── feature-context.tsx       ← Tier features provider
│   └── hooks/
│       ├── use-members.ts        ← React Query hook for members
│       ├── use-transactions.ts
│       ├── use-posts.ts
│       ├── use-notifications.ts
│       └── use-channels.ts
├── tailwind.config.ts
├── next.config.ts
└── package.json
```

---

## 11. Design Guidelines

- **Color palette:** Clean, professional. White/gray backgrounds. Use the church's brand color (if enterprise tier + custom branding) for accents; otherwise default to a calm blue or teal.
- **Typography:** Inter or system font stack. 14px base for tables, 16px for body text.
- **Spacing:** Consistent 4px grid (Tailwind default).
- **Cards:** Rounded corners (8px), subtle shadow, white background.
- **Tables:** Striped rows, sticky headers, responsive (horizontal scroll on small screens).
- **Empty states:** Every section needs an empty state with an icon, message, and CTA.
  - Members: "No members yet. Invite your first member."
  - Giving: "Set up Stripe to start receiving donations."
  - Posts: "No posts yet. Members can create posts from the mobile app."
- **Loading states:** Skeleton loaders for cards and tables. Never show blank screens.
- **Toast notifications:** Use shadcn's `<Toaster>` for success/error feedback on mutations.

---

## 12. MVP Scope (Build This First)

For the initial release, focus on these pages in order:

1. **Login** — gate everything behind auth
2. **Dashboard overview** — the "wow" moment when an admin logs in
3. **Members** — the most-used admin feature (invite, roles)
4. **Giving** — money matters, pastors need to see donations
5. **Content moderation** — post feed with delete capability
6. **Settings** — church info, tier details

### Phase 2 (after MVP):
- Chat management
- Full search
- Notification center (beyond the top-bar bell)
- Analytics charts with date range pickers
- GDPR export/delete self-service
- Saved payment methods management
