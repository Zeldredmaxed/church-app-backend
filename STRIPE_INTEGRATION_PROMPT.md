# Stripe Connect Integration — Admin Dashboard Prompt

> **Date:** April 10, 2026
> **From:** Backend Team
> **For:** Admin Dashboard Team (Next.js)
> **Status:** Backend is fully built. No backend changes needed. This is a frontend wiring guide.

---

## Overview

Stripe Connect lets each church receive donations directly to their own Stripe account. The platform takes a tier-based fee (1.3% Standard / 1.0% Premium / 0.5% Enterprise). The full flow is:

1. **Church admin connects Stripe** (one-time onboarding)
2. **Members donate** via the app — money goes to the church's Stripe account minus the platform fee
3. **Webhooks** update transaction statuses automatically

---

## Environment Variables Needed on Render

Add these to your Render service environment:

| Variable | Where to get it | Notes |
|----------|----------------|-------|
| `STRIPE_SECRET_KEY` | [Stripe Dashboard](https://dashboard.stripe.com/apikeys) → Secret key | Starts with `sk_test_` (test) or `sk_live_` (production) |
| `STRIPE_WEBHOOK_SECRET` | Stripe Dashboard → Developers → Webhooks → Signing secret | Starts with `whsec_` |

**For testing:** Use the test mode keys (`sk_test_...`). Switch to live keys (`sk_live_...`) when going to production.

**Frontend also needs:**

| Variable | Notes |
|----------|-------|
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Starts with `pk_test_` or `pk_live_` — from the same Stripe Dashboard page |

---

## The Three Stripe Flows

### Flow 1: Church Onboarding (Admin connects Stripe)

This is the "Set Up Payments" button in the admin settings.

```
Admin clicks "Connect Stripe"
    → Frontend calls POST /api/stripe/connect/onboard
    → Backend creates Stripe Connect account + returns redirect URL
    → Frontend redirects admin to Stripe's hosted onboarding
    → Admin fills in bank details, identity, etc. on Stripe's site
    → Stripe redirects back to your returnUrl
    → Frontend calls GET /api/stripe/connect/status to check result
```

#### Step 1: Show the "Connect Stripe" Button

On the Settings > Payments page (or a dedicated Stripe setup section), check the current status:

```typescript
// On page load
const status = await api.get('/stripe/connect/status');
```

**Response:**

```json
// Not started
{ "status": "pending", "chargesEnabled": false, "payoutsEnabled": false, "detailsSubmitted": false }

// In progress (admin started but didn't finish)
{ "status": "onboarding", "chargesEnabled": false, "payoutsEnabled": false, "detailsSubmitted": false }

// Restricted (submitted but Stripe needs more info)
{ "status": "restricted", "chargesEnabled": false, "payoutsEnabled": false, "detailsSubmitted": true }

// Active (ready to accept payments!)
{ "status": "active", "chargesEnabled": true, "payoutsEnabled": true, "detailsSubmitted": true }
```

**Render based on status:**

```
┌──────────────────────────────────────────────────────┐
│  Payment Processing                                  │
│                                                      │
│  Status: ● Not Connected                             │
│                                                      │
│  Connect your Stripe account to start receiving      │
│  donations from your members.                        │
│                                                      │
│  [Connect Stripe →]                                  │
│                                                      │
│  Platform fee: 1.3% (Standard plan)                  │
│  Upgrade to Premium for 1.0% or Enterprise for 0.5%  │
└──────────────────────────────────────────────────────┘
```

Or if active:

```
┌──────────────────────────────────────────────────────┐
│  Payment Processing                                  │
│                                                      │
│  Status: ✅ Active                                    │
│  Charges: ✅ Enabled                                  │
│  Payouts: ✅ Enabled                                  │
│                                                      │
│  Your church is ready to receive donations.           │
│  Platform fee: 1.3% per transaction                  │
│                                                      │
│  [View Stripe Dashboard ↗]                           │
└──────────────────────────────────────────────────────┘
```

#### Step 2: Initiate Onboarding

When the admin clicks "Connect Stripe":

```typescript
const response = await api.post('/stripe/connect/onboard', {
  refreshUrl: `${window.location.origin}/settings/payments`,  // if link expires
  returnUrl: `${window.location.origin}/settings/payments?stripe=complete`,  // after done
});

// response = { url: "https://connect.stripe.com/setup/...", stripeAccountId: "acct_..." }

// Redirect the admin to Stripe's hosted onboarding
window.location.href = response.url;
```

#### Step 3: Handle Return

When Stripe redirects back to your `returnUrl`, check the status:

```typescript
// On page load, if URL has ?stripe=complete
if (searchParams.get('stripe') === 'complete') {
  const status = await api.get('/stripe/connect/status');
  if (status.chargesEnabled) {
    showToast('Stripe connected successfully! You can now receive donations.');
  } else {
    showToast('Almost done — Stripe may need a few more details. Check your email.');
  }
}
```

---

### Flow 2: Member Makes a Donation

This is the giving/donation page where members enter an amount and pay.

```
Member enters amount + selects fund
    → Frontend calls POST /api/giving/donate
    → Backend creates Stripe PaymentIntent (routes to church's connected account)
    → Backend returns clientSecret
    → Frontend uses Stripe.js to collect card + confirm payment
    → Stripe webhook fires → backend updates transaction to "succeeded"
```

#### Step 1: Install Stripe.js

```bash
npm install @stripe/stripe-js @stripe/react-stripe-js
```

#### Step 2: Initialize Stripe

```typescript
// lib/stripe.ts
import { loadStripe } from '@stripe/stripe-js';

export const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!);
```

#### Step 3: Create PaymentIntent

```typescript
// When member clicks "Give"
const response = await api.post('/giving/donate', {
  amount: 100.00,      // dollars (not cents)
  currency: 'usd',
  fundId: 'uuid',      // optional — defaults to general fund
});

// response = { clientSecret: "pi_xxx_secret_xxx", transactionId: "uuid" }
```

**Error cases:**
- `400 "This church has not set up payment processing"` — Stripe not connected
- `400 "Payment processing is not yet active"` — Onboarding incomplete

#### Step 4: Confirm Payment with Stripe Elements

```tsx
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { stripePromise } from '@/lib/stripe';

function DonationForm({ clientSecret }: { clientSecret: string }) {
  return (
    <Elements stripe={stripePromise} options={{ clientSecret }}>
      <CheckoutForm />
    </Elements>
  );
}

function CheckoutForm() {
  const stripe = useStripe();
  const elements = useElements();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;

    const { error } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: `${window.location.origin}/giving/thank-you`,
      },
    });

    if (error) {
      alert(error.message);
    }
    // If no error, Stripe redirects to return_url
  };

  return (
    <form onSubmit={handleSubmit}>
      <PaymentElement />
      <button type="submit" disabled={!stripe}>Donate</button>
    </form>
  );
}
```

#### Step 5: Thank You Page

After payment, Stripe redirects to your `return_url` with query params:
- `?payment_intent=pi_xxx` — the PaymentIntent ID
- `?payment_intent_client_secret=pi_xxx_secret_xxx`
- `?redirect_status=succeeded` or `failed`

```typescript
// giving/thank-you page
const status = searchParams.get('redirect_status');
if (status === 'succeeded') {
  // Show success message, confetti, etc.
} else {
  // Show error
}
```

The backend automatically updates the transaction status via webhook — you don't need to call any API after payment.

---

### Flow 3: Save Payment Method (Optional)

Lets members save a card for future donations (one-click giving).

```typescript
// Create SetupIntent
const { clientSecret } = await api.post('/stripe/connect/setup-intent');

// Use Stripe.js to collect and save card
const { error } = await stripe.confirmCardSetup(clientSecret, {
  payment_method: {
    card: cardElement,
  },
});
```

---

## Webhook Setup

For payment status updates to work, you need to register a webhook in Stripe:

1. Go to [Stripe Dashboard → Developers → Webhooks](https://dashboard.stripe.com/webhooks)
2. Click "Add endpoint"
3. URL: `https://your-render-domain.onrender.com/api/webhooks/stripe`
4. Events to listen for:
   - `payment_intent.succeeded`
   - `payment_intent.payment_failed`
   - `account.updated`
   - `charge.refunded`
5. Copy the **Signing secret** (`whsec_...`) and add it as `STRIPE_WEBHOOK_SECRET` on Render

**For local testing:** Use the [Stripe CLI](https://stripe.com/docs/stripe-cli):
```bash
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```

---

## Giving Funds

The donation form should let members choose a fund. Existing funds:

```
GET /api/giving/funds
```

```json
[
  { "id": "uuid", "name": "General Fund", "description": "General church operations" },
  { "id": "uuid", "name": "Building Fund", "description": "Facility improvements" },
  { "id": "uuid", "name": "Missions Fund", "description": "Mission projects" },
  { "id": "uuid", "name": "Youth Ministry", "description": "Youth programs" }
]
```

Pass the selected fund as `fundId` in the donation request. If omitted, it goes to the general fund.

---

## Platform Fee Display

Show the current platform fee on the settings page:

```typescript
const features = await api.get(`/tenants/${tenantId}/features`);
// features.transactionFeePercent = 1.3 (Standard) / 1.0 (Premium) / 0.5 (Enterprise)
```

Display:
```
Platform fee: 1.3% per transaction
On a $100 donation, $1.30 goes to Shepard, $98.70 goes to your church.

Want a lower fee? Upgrade to Premium (1.0%) or Enterprise (0.5%).
```

---

## API Reference Summary

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/stripe/connect/onboard` | JWT (admin) | Start Stripe onboarding → returns redirect URL |
| GET | `/stripe/connect/status` | JWT (admin) | Check onboarding status |
| POST | `/stripe/connect/setup-intent` | JWT | Create SetupIntent (save card) |
| POST | `/giving/donate` | JWT | Create donation → returns clientSecret |
| GET | `/giving/funds` | JWT | List giving funds |
| GET | `/giving/transactions` | JWT | Member's donation history |
| GET | `/tenants/:id/transactions` | JWT (manage_finance) | All tenant transactions |
| GET | `/giving/kpis` | JWT | Giving KPI cards |
| GET | `/giving/donors` | JWT | Unique donor list |
| GET | `/giving/recurring` | JWT | My recurring gifts |
| GET | `/giving/recurring/all` | JWT | All tenant recurring gifts (admin) |
| POST | `/webhooks/stripe` | Webhook (signature) | Stripe event handler (no JWT) |

---

## Testing Checklist

### Setup
- [ ] Add `STRIPE_SECRET_KEY` (test key: `sk_test_...`) to Render env vars
- [ ] Add `STRIPE_WEBHOOK_SECRET` to Render env vars
- [ ] Add `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (test key: `pk_test_...`) to your Next.js env
- [ ] Register webhook endpoint in Stripe Dashboard

### Onboarding Flow
- [ ] "Connect Stripe" button calls `POST /stripe/connect/onboard`
- [ ] Admin is redirected to Stripe's hosted onboarding
- [ ] After completing, return URL shows success
- [ ] `GET /stripe/connect/status` returns `{ status: "active", chargesEnabled: true }`

### Donation Flow
- [ ] Donation form calls `POST /giving/donate` with amount + fund
- [ ] Stripe Elements renders payment form using returned `clientSecret`
- [ ] Test card `4242 4242 4242 4242` (any future expiry, any CVC) succeeds
- [ ] Transaction appears in giving history after webhook fires
- [ ] Test card `4000 0000 0000 0002` triggers decline — error shown to user

### Stripe Test Cards
| Card Number | Result |
|-------------|--------|
| `4242 4242 4242 4242` | Success |
| `4000 0000 0000 0002` | Decline |
| `4000 0000 0000 3220` | Requires 3D Secure |

Use any future expiry date and any 3-digit CVC.
