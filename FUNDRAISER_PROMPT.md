# Fundraiser System — Backend Endpoints for Frontend Teams

> **Date:** April 11, 2026
> **From:** Backend Team
> **For:** Admin Dashboard (Next.js) + Mobile App (React Native)
> **Tier:** Premium and Enterprise only (creating fundraisers). All members can browse and donate.

---

## Overview

Churches can now create crowdfunding-style fundraisers with goals, deadlines, categories, and images. Members browse, donate (via Stripe), and bookmark fundraisers. Anonymous donations are supported. All fundraiser donations are included in year-end tax statements automatically.

### Key Concepts

- **Amounts are in cents** — `targetAmount: 1364300` = $13,643.00. Divide by 100 for display.
- **Anonymous donations** — donor name is hidden on the backers list but still tracked internally for tax receipts.
- **Auto-completion** — when `raisedAmount >= targetAmount`, the DB trigger automatically sets `status: 'completed'`.
- **Stripe flow** — same as regular giving. `POST /donate` returns a `clientSecret` → confirm with Stripe SDK on the frontend.
- **Tax receipts** — `GET /giving/statements/:userId?year=` now includes fundraiser donations alongside regular giving.

---

## 1. List Fundraisers

### GET /api/fundraisers?category=&status=&search=&page=1&limit=20

All query params are optional. Defaults to `status=active`, page 1, limit 20.

```json
{
  "data": [
    {
      "id": "uuid",
      "title": "Next Generation Scholars",
      "organization": "New Birth Church",
      "category": "Education",
      "targetAmount": 1364300,
      "raisedAmount": 341100,
      "backerCount": 23,
      "imageUrl": "https://s3.amazonaws.com/.../scholars.jpg",
      "daysLeft": 45,
      "endsAt": "2026-05-26T00:00:00Z",
      "status": "active",
      "isBookmarked": true,
      "createdAt": "2026-03-01T00:00:00Z"
    }
  ],
  "total": 16,
  "page": 1
}
```

**Filter options:**
- `category` — `Education`, `Fundraising`, `Disaster`, `Health`, `Community`, `Missions`
- `status` — `draft`, `active`, `paused`, `completed`, `cancelled` (default: `active`)
- `search` — case-insensitive title search
- `page` / `limit` — pagination (max 100 per page)

---

## 2. Fundraiser Detail

### GET /api/fundraisers/:id

```json
{
  "id": "uuid",
  "tenantId": "uuid",
  "title": "Next Generation Scholars",
  "overview": "Providing scholarships for youth in our community who are pursuing higher education. Every dollar goes directly to tuition assistance...",
  "organization": "New Birth Church",
  "category": "Education",
  "targetAmount": 1364300,
  "raisedAmount": 341100,
  "currency": "USD",
  "backerCount": 23,
  "imageUrl": "https://s3.amazonaws.com/.../scholars.jpg",
  "status": "active",
  "daysLeft": 45,
  "startsAt": "2026-03-01T00:00:00Z",
  "endsAt": "2026-05-26T00:00:00Z",
  "isBookmarked": false,
  "createdAt": "2026-03-01T00:00:00Z",
  "updatedAt": "2026-04-10T00:00:00Z",
  "createdBy": {
    "id": "uuid",
    "fullName": "Pastor James",
    "avatarUrl": "https://..."
  },
  "recentBackers": [
    {
      "id": "donation-uuid",
      "donor": {
        "id": "user-uuid",
        "fullName": "Sarah Johnson",
        "avatarUrl": "https://..."
      },
      "amount": 5000,
      "message": "God bless this ministry!",
      "anonymous": false,
      "createdAt": "2026-04-10T14:30:00Z"
    },
    {
      "id": "donation-uuid",
      "donor": {
        "id": null,
        "fullName": "Anonymous",
        "avatarUrl": null
      },
      "amount": 10000,
      "message": null,
      "anonymous": true,
      "createdAt": "2026-04-09T10:00:00Z"
    }
  ]
}
```

**Notes:**
- `recentBackers` returns the 10 most recent succeeded donations
- Anonymous donors show `fullName: "Anonymous"` and `id: null`
- `daysLeft` is 0 if the fundraiser has passed its deadline

---

## 3. Backers List (Paginated)

### GET /api/fundraisers/:id/backers?page=1&limit=50

```json
{
  "data": [
    {
      "id": "donation-uuid",
      "donor": {
        "id": "user-uuid",
        "fullName": "Sarah Johnson",
        "avatarUrl": "https://..."
      },
      "amount": 5000,
      "message": "Praying for this cause!",
      "anonymous": false,
      "createdAt": "2026-04-10T14:30:00Z"
    },
    {
      "id": "donation-uuid",
      "donor": {
        "id": null,
        "fullName": "Anonymous",
        "avatarUrl": null
      },
      "amount": 2500,
      "message": null,
      "anonymous": true,
      "createdAt": "2026-04-09T10:00:00Z"
    }
  ],
  "total": 23,
  "page": 1
}
```

---

## 4. Donate to a Fundraiser

### POST /api/fundraisers/:id/donate

```json
// Request
{
  "amount": 10000,
  "message": "Keep up the great work!",
  "anonymous": false,
  "paymentMethodId": "pm_xxx"
}

// Response 201
{
  "donationId": "uuid",
  "clientSecret": "pi_xxx_secret_xxx",
  "status": "requires_confirmation"
}
```

**Fields:**
- `amount` — in cents. Minimum 100 ($1.00).
- `message` — optional, max 200 chars. Shown on backers list.
- `anonymous` — `true` hides donor name on backers list. Still tracked for tax receipts.
- `paymentMethodId` — optional Stripe payment method ID

**Frontend flow (same as regular giving):**
```
1. User enters amount, optional message, anonymous toggle
2. POST /api/fundraisers/:id/donate → get clientSecret
3. confirmPayment(clientSecret) with Stripe SDK
4. Stripe webhook fires → backend updates donation status to 'succeeded'
5. DB trigger auto-updates fundraiser raised_amount and backer_count
6. If raised_amount >= target_amount → status auto-set to 'completed'
```

**Validation errors (400):**
- Fundraiser not active: `"This fundraiser is not currently accepting donations."`
- Fundraiser expired: `"This fundraiser has ended."`
- No Stripe account: `"This church has not set up payment processing."`
- Amount < $1.00: class-validator catches this

---

## 5. Toggle Bookmark

### POST /api/fundraisers/:id/bookmark

```json
// Response 200 — toggled ON
{ "bookmarked": true }

// Response 200 — toggled OFF
{ "bookmarked": false }
```

This is a toggle — call it once to bookmark, call again to unbookmark. No request body needed.

---

## 6. Create Fundraiser (Admin Only)

### POST /api/fundraisers

```json
// Request
{
  "title": "Next Generation Scholars",
  "overview": "Providing scholarships for youth in our community...",
  "category": "Education",
  "targetAmount": 1364300,
  "endsAt": "2026-05-26T00:00:00Z",
  "imageUrl": "https://s3.amazonaws.com/.../scholars.jpg",
  "status": "active"
}

// Response 201
{
  "id": "uuid",
  "tenantId": "uuid",
  "createdBy": "user-uuid",
  "title": "Next Generation Scholars",
  "overview": "Providing scholarships...",
  "category": "Education",
  "targetAmount": 1364300,
  "raisedAmount": 0,
  "currency": "USD",
  "imageUrl": "https://...",
  "status": "active",
  "startsAt": "2026-04-11T00:00:00Z",
  "endsAt": "2026-05-26T00:00:00Z",
  "backerCount": 0,
  "createdAt": "2026-04-11T...",
  "updatedAt": "2026-04-11T..."
}
```

**Validation:**
- `title` — required, max 200 chars
- `overview` — required, max 2000 chars
- `category` — required, one of: `Education`, `Fundraising`, `Disaster`, `Health`, `Community`, `Missions`
- `targetAmount` — required, integer in cents, minimum 100
- `endsAt` — required, must be in the future
- `imageUrl` — optional, valid URL (use presigned upload pipeline first)
- `status` — optional, `draft` or `active` (default: `active`)
- **Tier gate:** Returns 403 if church is on Standard plan

**Image upload flow:**
```
1. POST /api/media/presigned-url { fileName: "fundraiser.jpg", contentType: "image/jpeg", fileSize: 245000 }
2. PUT the file to the returned presigned URL
3. Use the publicUrl in the imageUrl field when creating the fundraiser
```

---

## 7. Update Fundraiser (Admin Only)

### PATCH /api/fundraisers/:id

All fields optional. Only include what you want to change.

```json
// Request — update goal and extend deadline
{
  "targetAmount": 2000000,
  "endsAt": "2026-06-30T00:00:00Z"
}

// Request — pause a fundraiser
{
  "status": "paused"
}

// Request — cancel a fundraiser
{
  "status": "cancelled"
}

// Response 200 — full updated fundraiser object
```

**Updatable fields:** `title`, `overview`, `category`, `targetAmount`, `endsAt`, `imageUrl`, `status`

**Status transitions:**
- `draft` → `active` (publish)
- `active` → `paused` (temporarily stop donations)
- `paused` → `active` (resume)
- `active` / `paused` → `cancelled` (cancel — consider notifying donors)
- `active` → `completed` (auto-set by trigger when goal reached, or manual)

---

## 8. Tax Receipts (Updated)

### GET /api/giving/statements/:userId?year=2025

The giving statement now includes fundraiser donations automatically:

```json
{
  "churchName": "New Birth Church",
  "year": 2025,
  "donor": { "fullName": "Marcus Johnson", "email": "marcus@..." },
  "donations": [
    { "date": "2025-01-15T...", "amount": 500.00, "currency": "usd", "fundName": "General Fund", "method": "online" }
  ],
  "fundraiserDonations": [
    { "date": "2025-03-20T...", "amount": 5000, "fundraiserTitle": "Next Generation Scholars", "category": "Education" },
    { "date": "2025-06-15T...", "amount": 2500, "fundraiserTitle": "Disaster Relief Fund", "category": "Disaster" }
  ],
  "totalAmount": 13500,
  "givingTotal": 6000,
  "fundraiserTotal": 7500,
  "donationCount": 15,
  "byFund": [
    { "fund": "General Fund", "total": 5400 },
    { "fund": "Building Fund", "total": 600 },
    { "fund": "Fundraiser: Next Generation Scholars", "total": 5000 },
    { "fund": "Fundraiser: Disaster Relief Fund", "total": 2500 }
  ],
  "taxStatement": "No goods or services were provided in exchange for these contributions..."
}
```

**New fields:**
- `fundraiserDonations` — separate array of fundraiser donations with title and category
- `givingTotal` — regular giving total only
- `fundraiserTotal` — fundraiser donations total only
- `totalAmount` — combined grand total (giving + fundraiser)
- `byFund` — now includes fundraiser entries prefixed with "Fundraiser: "

**Note:** Anonymous fundraiser donations are still included in the donor's own tax receipt — the anonymous flag only hides their name from the public backers list.

---

## 9. Recommended UI — Mobile App

### Fundraiser List Screen

```
┌──────────────────────────────────┐
│  Fundraisers              [🔍]   │
│                                  │
│  [All] [Education] [Health] ...  │
│                                  │
│  ┌────────────────────────────┐  │
│  │ ┌──────────────────────┐  │  │
│  │ │     📷 Hero Image     │  │  │
│  │ └──────────────────────┘  │  │
│  │ Next Generation Scholars  │  │
│  │ New Birth Church          │  │
│  │                           │  │
│  │ ████████░░░░░  25%        │  │
│  │ $3,411 raised of $13,643 │  │
│  │ 23 backers · 45 days left│  │
│  │                    [🔖]   │  │
│  └────────────────────────────┘  │
│                                  │
│  ┌────────────────────────────┐  │
│  │ ┌──────────────────────┐  │  │
│  │ │     📷 Hero Image     │  │  │
│  │ └──────────────────────┘  │  │
│  │ Disaster Relief Fund      │  │
│  │ New Birth Church          │  │
│  │                           │  │
│  │ ██████████████░  92%      │  │
│  │ $9,200 raised of $10,000 │  │
│  │ 67 backers · 12 days left│  │
│  │                    [🔖]   │  │
│  └────────────────────────────┘  │
└──────────────────────────────────┘
```

**Implementation:**
- Category filter chips across the top (horizontal scroll)
- Search icon opens search bar, calls API with `search` param
- Bookmark icon (🔖) calls `POST /fundraisers/:id/bookmark`
- Progress bar: `(raisedAmount / targetAmount) * 100`
- Format amounts: `(amount / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })`
- Tap card → navigate to detail screen

### Fundraiser Detail Screen

```
┌──────────────────────────────────┐
│  [←]  Next Generation Scholars   │
│                                  │
│  ┌────────────────────────────┐  │
│  │                            │  │
│  │       📷 Hero Image        │  │
│  │                            │  │
│  └────────────────────────────┘  │
│                                  │
│  Education · New Birth Church    │
│                                  │
│  ████████░░░░░░  25%             │
│  $3,411 raised of $13,643       │
│  23 backers · 45 days left       │
│                                  │
│  ─────────────────────────────── │
│                                  │
│  Providing scholarships for      │
│  youth in our community who are  │
│  pursuing higher education...    │
│                                  │
│  ─────────────────────────────── │
│                                  │
│  Recent Backers:                 │
│  ┌────────────────────────────┐  │
│  │ 👤 Sarah Johnson    $50   │  │
│  │ "God bless this ministry!" │  │
│  ├────────────────────────────┤  │
│  │ 👤 Anonymous        $100  │  │
│  ├────────────────────────────┤  │
│  │ 👤 Marcus Johnson   $25   │  │
│  │ "Praying for you all"     │  │
│  └────────────────────────────┘  │
│  [View All 23 Backers]           │
│                                  │
│  ┌────────────────────────────┐  │
│  │      [💜 Donate Now]       │  │
│  └────────────────────────────┘  │
│  [🔖 Bookmark]                   │
└──────────────────────────────────┘
```

**Implementation:**
- "View All Backers" opens a modal/sheet with paginated `GET /fundraisers/:id/backers`
- "Donate Now" navigates to the donation screen
- Bookmark toggle at the bottom

### Donation Screen

```
┌──────────────────────────────────┐
│  [←]  Donate                     │
│                                  │
│  Next Generation Scholars        │
│  $3,411 of $13,643 raised       │
│                                  │
│  Amount:                         │
│  ┌────────────────────────────┐  │
│  │  $  [        50.00       ] │  │
│  └────────────────────────────┘  │
│  Minimum: $1.00                  │
│                                  │
│  [$25]  [$50]  [$100]  [$250]    │
│                                  │
│  Message (optional):             │
│  ┌────────────────────────────┐  │
│  │ Keep up the great work!    │  │
│  └────────────────────────────┘  │
│  0/200 characters                │
│                                  │
│  ┌────────────────────────────┐  │
│  │ ○ Donate anonymously       │  │
│  │   Your name won't appear   │  │
│  │   on the backers list      │  │
│  └────────────────────────────┘  │
│                                  │
│  ┌────────────────────────────┐  │
│  │    💳 Payment Method       │  │
│  │    Visa ····4242           │  │
│  │    [Change]                │  │
│  └────────────────────────────┘  │
│                                  │
│  ┌────────────────────────────┐  │
│  │     [Donate $50.00]        │  │
│  └────────────────────────────┘  │
│                                  │
│  Your donation is tax-deductible │
│  and will appear on your annual  │
│  giving statement.               │
└──────────────────────────────────┘
```

**Implementation:**
```typescript
// 1. User fills in amount, message, anonymous toggle
// 2. Convert display dollars to cents
const amountCents = Math.round(parseFloat(amountInput) * 100);

// 3. POST /api/fundraisers/:id/donate
const { clientSecret } = await api.post(`/fundraisers/${id}/donate`, {
  amount: amountCents,
  message: messageInput || undefined,
  anonymous: isAnonymous,
});

// 4. Confirm payment with Stripe SDK
const { error } = await confirmPayment(clientSecret, {
  paymentMethodType: 'Card',
});

if (error) {
  // Show error to user
} else {
  // Navigate to success screen
  // Refetch fundraiser detail to see updated totals
}
```

### Donation Success Screen

```
┌──────────────────────────────────┐
│                                  │
│           ✅                      │
│                                  │
│     Thank you for your           │
│     generous donation!           │
│                                  │
│     $50.00 to                    │
│     Next Generation Scholars     │
│                                  │
│     Your donation is             │
│     tax-deductible and will      │
│     appear on your annual        │
│     giving statement.            │
│                                  │
│  [View Fundraiser]  [Back Home]  │
│                                  │
└──────────────────────────────────┘
```

---

## 10. Recommended UI — Admin Dashboard

### Fundraiser Management Page

```
┌──────────────────────────────────────────────────┐
│  Fundraisers                     [+ New]          │
│                                                  │
│  [Active (4)] [Draft (1)] [Completed (2)] [All]  │
│                                                  │
│  ┌──────────────────────────────────────────────┐│
│  │ Next Generation Scholars          Education  ││
│  │ $3,411 / $13,643 (25%)           45 days    ││
│  │ 23 backers                                   ││
│  │ Status: ● Active                 [Edit] [⋯] ││
│  ├──────────────────────────────────────────────┤│
│  │ Disaster Relief Fund              Disaster   ││
│  │ $9,200 / $10,000 (92%)           12 days    ││
│  │ 67 backers                                   ││
│  │ Status: ● Active                 [Edit] [⋯] ││
│  ├──────────────────────────────────────────────┤│
│  │ Youth Camp 2026                  Community   ││
│  │ $0 / $5,000 (0%)                 Draft      ││
│  │ 0 backers                                    ││
│  │ Status: ○ Draft                  [Edit] [⋯] ││
│  └──────────────────────────────────────────────┘│
│                                                  │
│  The [⋯] menu offers: Pause, Cancel, View Backers│
└──────────────────────────────────────────────────┘
```

### Create/Edit Fundraiser Form

```
┌──────────────────────────────────────────────────┐
│  Create New Fundraiser                           │
│                                                  │
│  Title *                                         │
│  ┌──────────────────────────────────────────────┐│
│  │ Next Generation Scholars                     ││
│  └──────────────────────────────────────────────┘│
│  0/200 characters                                │
│                                                  │
│  Category *                                      │
│  ┌──────────────────────────────────────────────┐│
│  │ Education                               ▾   ││
│  └──────────────────────────────────────────────┘│
│  Options: Education, Fundraising, Disaster,      │
│           Health, Community, Missions            │
│                                                  │
│  Overview *                                      │
│  ┌──────────────────────────────────────────────┐│
│  │ Providing scholarships for youth in our      ││
│  │ community who are pursuing higher education. ││
│  │ Every dollar goes directly to tuition...     ││
│  └──────────────────────────────────────────────┘│
│  0/2000 characters                               │
│                                                  │
│  Goal Amount * (USD)                             │
│  ┌──────────────────────────────────────────────┐│
│  │ $ 13,643.00                                  ││
│  └──────────────────────────────────────────────┘│
│  Stored as cents — multiply by 100 before POST   │
│                                                  │
│  Deadline *                                      │
│  ┌──────────────────────────────────────────────┐│
│  │ 📅 May 26, 2026                             ││
│  └──────────────────────────────────────────────┘│
│  Must be in the future                           │
│                                                  │
│  Hero Image                                      │
│  ┌──────────────────────────────────────────────┐│
│  │  [📷 Upload Image]                           ││
│  │  Max 5MB · JPEG, PNG, or WebP                ││
│  └──────────────────────────────────────────────┘│
│  Upload via POST /api/media/presigned-url first  │
│                                                  │
│  Save as:                                        │
│  (●) Active — start accepting donations now      │
│  (○) Draft — save without publishing             │
│                                                  │
│  [Create Fundraiser]                             │
└──────────────────────────────────────────────────┘
```

**Implementation notes:**
```typescript
// Convert dollars to cents before sending
const targetAmountCents = Math.round(parseFloat(goalInput) * 100);

// Image upload flow
const { presignedUrl, publicUrl } = await api.post('/media/presigned-url', {
  fileName: 'fundraiser-hero.jpg',
  contentType: 'image/jpeg',
  fileSize: file.size,
});
await fetch(presignedUrl, { method: 'PUT', body: file });

// Create fundraiser
await api.post('/fundraisers', {
  title,
  overview,
  category,
  targetAmount: targetAmountCents,
  endsAt: new Date(deadline).toISOString(),
  imageUrl: publicUrl,
  status: isDraft ? 'draft' : 'active',
});
```

### Backers Detail View (Admin)

```
┌──────────────────────────────────────────────────┐
│  Backers — Next Generation Scholars              │
│  23 backers · $3,411.00 raised                   │
│                                                  │
│  ┌────────┬──────────────┬────────┬────────────┐│
│  │ Donor  │ Amount       │ Anon?  │ Date       ││
│  ├────────┼──────────────┼────────┼────────────┤│
│  │ Sarah  │ $50.00       │ No     │ Apr 10     ││
│  │        │ "God bless!" │        │            ││
│  ├────────┼──────────────┼────────┼────────────┤│
│  │ Anon.  │ $100.00      │ Yes    │ Apr 9      ││
│  ├────────┼──────────────┼────────┼────────────┤│
│  │ Marcus │ $25.00       │ No     │ Apr 8      ││
│  │        │ "Praying"    │        │            ││
│  └────────┴──────────────┴────────┴────────────┘│
│                                                  │
│  Page 1 of 1   [← Prev] [Next →]                │
└──────────────────────────────────────────────────┘
```

**Note for admin:** Even anonymous donations show donor info to admins in their backend data. The anonymous flag only hides the donor from the public-facing backers list (the API response already handles this — anonymous donors return `fullName: "Anonymous"`).

---

## 11. Endpoint Summary

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/fundraisers` | JWT | List fundraisers (filters, search, pagination) |
| GET | `/fundraisers/:id` | JWT | Fundraiser detail + recent backers |
| GET | `/fundraisers/:id/backers` | JWT | Paginated backers list |
| POST | `/fundraisers/:id/donate` | JWT | Create Stripe donation |
| POST | `/fundraisers/:id/bookmark` | JWT | Toggle bookmark on/off |
| POST | `/fundraisers` | JWT + Premium | Create fundraiser (admin) |
| PATCH | `/fundraisers/:id` | JWT + Premium | Update fundraiser (admin) |

---

## 12. Display Helpers

```typescript
// Convert cents to display currency
function formatCents(cents: number): string {
  return (cents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
  });
}

// Progress percentage
function progressPercent(raised: number, target: number): number {
  if (target === 0) return 0;
  return Math.min(100, Math.round((raised / target) * 100));
}

// Days left
// Already computed by backend as `daysLeft`, but if you need to recalculate:
function daysLeft(endsAt: string): number {
  const diff = new Date(endsAt).getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

// Status badge color
const STATUS_COLORS = {
  draft: 'gray',
  active: 'green',
  paused: 'yellow',
  completed: 'blue',
  cancelled: 'red',
};
```

---

## 13. Checklist

### Mobile App
- [ ] Build FundraiserListScreen with category filter chips and search
- [ ] Build FundraiserDetailScreen with progress bar, overview, recent backers
- [ ] Build DonationScreen with amount input, preset buttons, message, anonymous toggle
- [ ] Build DonationSuccessScreen
- [ ] Build BackersModal/Sheet with paginated list
- [ ] Implement bookmark toggle on list and detail screens
- [ ] Format all amounts from cents to dollars (`amount / 100`)
- [ ] Stripe payment confirmation flow (same pattern as regular giving)
- [ ] Handle fundraiser status states (show "Ended", "Paused", "Goal Reached" badges)

### Admin Dashboard
- [ ] Build FundraiserManagementPage with status tab filters
- [ ] Build CreateFundraiserForm with validation and image upload
- [ ] Build EditFundraiserForm (same form, pre-filled)
- [ ] Build BackersDetailView with pagination
- [ ] Add status actions: Pause, Resume, Cancel (via PATCH status)
- [ ] Show fundraiser progress bars and KPI cards
- [ ] Only show fundraiser management if `features.multiSite` tier is premium+
- [ ] Format all amounts from cents to dollars

### Tier Gating (Both Teams)
- [ ] Check `tenant.tier !== 'standard'` before showing "Create Fundraiser" button
- [ ] All members can browse and donate regardless of tier
- [ ] Show upgrade prompt if standard tier admin tries to create a fundraiser
