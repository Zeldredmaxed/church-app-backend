# Phase 3, Week 8: Stripe Connect & Giving Flow — Verification Directive

> **Status:** Implementation Complete  
> **Prerequisite:** Phase 3, Week 7 (Members & Search) verified and approved  
> **Deliverables:** Migration 010, StripeModule, GivingModule, Stripe webhook handler

---

## Architecture Decisions

### 1. Standard Connect (Not Express)
We use **Stripe Standard Connect** (`type: 'standard'`), not Express Connect. Reasons:
- Churches manage their own Stripe dashboard (payouts, disputes, reporting)
- No platform liability for KYC — Stripe handles it directly with the church
- Churches can disconnect and retain their Stripe account
- Lower platform compliance burden

### 2. Application Fee Model (1%)
The platform takes a 1% `application_fee_amount` on each donation. This is:
- Transparent to the donor (they see the full amount)
- Automatically deducted by Stripe before the transfer
- Visible in both the platform and connected account's Stripe dashboard
- Configurable per-tenant in future phases

### 3. PaymentIntent API (Not Charges API)
We use the modern `PaymentIntents` API with `transfer_data.destination`:
- Supports SCA (Strong Customer Authentication) required in EU
- The payment is created on the platform account and transferred to the destination
- `client_secret` is returned to the frontend for Stripe.js/Elements confirmation
- The donor's card is charged on the platform, with automatic transfer to the church

### 4. Transaction Status Lifecycle
```
pending → succeeded  (via payment_intent.succeeded webhook)
pending → failed     (via payment_intent.payment_failed webhook)
succeeded → refunded (via charge.refunded webhook)
```
Week 8 creates the `pending` record and logs webhook events. Week 9 will wire the status updates.

### 5. Webhook Signature Verification via Stripe SDK
Unlike the custom HMAC implementation for Mux webhooks, the Stripe webhook uses the **official Stripe SDK** `constructEvent()` method. This is safer because:
- Stripe manages the signature algorithm and tolerances
- No custom crypto code to maintain
- Automatic handling of timestamp validation

### 6. Dual RLS on Transactions
The SELECT policy is intentionally broad — it allows both:
- **Donor view:** `user_id = auth.uid()` (a user sees their own donations)
- **Admin view:** `tenant_id = current_tenant_id AND role = 'admin'` (admins see all tenant donations)

No UPDATE/DELETE policies for `authenticated` role — transaction status is only modified by the service role (webhook processor). This prevents users from tampering with payment records.

---

## Files Created / Modified

### New Files
| File | Purpose |
|------|---------|
| `migrations/010_stripe_giving.sql` | Stripe columns on tenants, transactions table with RLS |
| `backend/src/stripe/stripe.service.ts` | Core Stripe SDK wrapper (accounts, payment intents, webhooks) |
| `backend/src/stripe/stripe-connect.controller.ts` | Connect onboarding + status endpoints |
| `backend/src/stripe/stripe-webhook.controller.ts` | Webhook handler with SDK signature verification |
| `backend/src/stripe/dto/onboard-connect.dto.ts` | OnboardConnectDto (refreshUrl, returnUrl) |
| `backend/src/stripe/stripe.module.ts` | Module — exports StripeService |
| `backend/src/giving/entities/transaction.entity.ts` | Transaction TypeORM entity |
| `backend/src/giving/dto/donate.dto.ts` | DonateDto (amount, currency) |
| `backend/src/giving/giving.service.ts` | Donation logic + transaction queries |
| `backend/src/giving/giving.controller.ts` | REST API — donate, my transactions, tenant transactions |
| `backend/src/giving/giving.module.ts` | Module — imports StripeModule |

### Modified Files
| File | Change |
|------|--------|
| `backend/src/tenants/entities/tenant.entity.ts` | Added `stripeAccountStatus` column |
| `backend/src/app.module.ts` | Added `StripeModule`, `GivingModule`, `Transaction` entity |

---

## Environment Variables Required

```env
# Stripe
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

---

## API Endpoints

### Stripe Connect
| Method | Path | Auth | RLS | Description |
|--------|------|------|-----|-------------|
| `POST` | `/stripe/connect/onboard` | JWT | Yes | Initiate Connect onboarding (admin only) |
| `GET` | `/stripe/connect/status` | JWT | Yes | Get Connect status (admin only) |

### Giving
| Method | Path | Auth | RLS | Description |
|--------|------|------|-----|-------------|
| `POST` | `/giving/donate` | JWT | Yes | Create a donation PaymentIntent |
| `GET` | `/giving/transactions` | JWT | Yes | User's donation history |
| `GET` | `/tenants/:id/transactions` | JWT | Yes | Tenant's all transactions (admin) |

### Webhook
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/webhooks/stripe` | Stripe signature | Receive Stripe events |

---

## Verification Tests

### Test 1: Migration 010 — Stripe Columns on Tenants
```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'tenants'
  AND column_name IN ('stripe_account_id', 'stripe_account_status')
ORDER BY column_name;
```
**Expected:** 2 rows — `stripe_account_id` (text), `stripe_account_status` (text)

### Test 2: Transactions Table Exists with Constraints
```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'transactions'
ORDER BY ordinal_position;
```
**Expected:** 8 columns: id, tenant_id, user_id, amount, currency, stripe_payment_intent_id, status, created_at

### Test 3: RLS Policies on Transactions
```sql
SELECT policyname, cmd FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'transactions'
ORDER BY policyname;
```
**Expected:** 2 policies — SELECT (own or admin), INSERT (own donation). No UPDATE/DELETE.

### Test 4: Amount Must Be Positive
```sql
INSERT INTO public.transactions (tenant_id, user_id, amount, currency, stripe_payment_intent_id)
VALUES ('...', '...', 0, 'usd', 'pi_test_zero');
```
**Expected:** `ERROR: violates check constraint` — amount must be > 0

### Test 5: Status Check Constraint
```sql
INSERT INTO public.transactions (tenant_id, user_id, amount, currency, stripe_payment_intent_id, status)
VALUES ('...', '...', 10, 'usd', 'pi_test_status', 'cancelled');
```
**Expected:** `ERROR: violates check constraint` — only pending/succeeded/failed/refunded

### Test 6: Connect Onboarding (Admin Only)
```bash
# As tenant admin
curl -X POST /stripe/connect/onboard \
  -H "Authorization: Bearer <admin_jwt>" \
  -d '{"refreshUrl": "http://localhost:3000/onboard", "returnUrl": "http://localhost:3000/dashboard"}'
```
**Expected:** `200 OK` with `{ url: "https://connect.stripe.com/...", stripeAccountId: "acct_..." }`. Tenant's `stripe_account_id` is saved.

### Test 7: Connect Onboarding (Non-Admin — Rejected)
```bash
curl -X POST /stripe/connect/onboard \
  -H "Authorization: Bearer <member_jwt>" \
  -d '{"refreshUrl": "...", "returnUrl": "..."}'
```
**Expected:** `400 Bad Request` — "Only tenant admins can manage Stripe Connect"

### Test 8: Connect Onboarding Is Idempotent
Call `POST /stripe/connect/onboard` twice for the same tenant.
**Expected:** Second call reuses the existing `stripe_account_id` and returns a fresh `AccountLink` URL. No duplicate Stripe accounts created.

### Test 9: Donation Creates PaymentIntent
```bash
curl -X POST /giving/donate \
  -H "Authorization: Bearer <member_jwt>" \
  -d '{"amount": 100, "currency": "usd"}'
```
**Expected:**
1. `201 Created` with `{ clientSecret: "pi_...secret_...", transactionId: "uuid" }`
2. Transaction record in DB with `status = 'pending'`
3. Stripe PaymentIntent created with `application_fee_amount` = 100 cents (1% of $100)
4. `transfer_data.destination` = tenant's Stripe account ID

### Test 10: Donation Rejected Without Active Stripe Account
```bash
# Tenant has no Stripe account (stripe_account_id is NULL)
curl -X POST /giving/donate -d '{"amount": 50, "currency": "usd"}'
```
**Expected:** `400 Bad Request` — "This church has not set up payment processing"

### Test 11: Donation Rejected for Non-Active Stripe Status
```bash
# Tenant has stripe_account_status = 'onboarding'
curl -X POST /giving/donate -d '{"amount": 50, "currency": "usd"}'
```
**Expected:** `400 Bad Request` — "payment processing is not yet active"

### Test 12: User Sees Own Transactions Only
```bash
# User A creates a donation
# User B queries GET /giving/transactions
```
**Expected:** User B sees 0 transactions from User A. RLS filters by `user_id = JWT.sub`.

### Test 13: Admin Sees All Tenant Transactions
```bash
# Admin queries GET /tenants/<tenantId>/transactions
```
**Expected:** Admin sees all donations to the tenant (from all users).

### Test 14: Stripe Webhook — Valid Signature Accepted
```bash
# Use Stripe CLI to send a test event:
stripe trigger payment_intent.succeeded --webhook-endpoint http://localhost:3000/api/webhooks/stripe
```
**Expected:** `200 OK` with `{ received: true }`. Event type logged.

### Test 15: Stripe Webhook — Invalid Signature Rejected
```bash
curl -X POST /webhooks/stripe \
  -H "stripe-signature: invalid" \
  -d '{"type": "payment_intent.succeeded"}'
```
**Expected:** `401 Unauthorized` — "Invalid webhook signature"

### Test 16: Stripe Webhook — Missing Signature Header
```bash
curl -X POST /webhooks/stripe \
  -d '{"type": "payment_intent.succeeded"}'
```
**Expected:** `401 Unauthorized` — "Missing stripe-signature header"

### Test 17: Unique stripe_payment_intent_id Constraint
Two transactions with the same `stripe_payment_intent_id` cannot exist.
**Expected:** Second INSERT fails with PG unique violation (23505).

---

## Security Considerations

1. **No card data touches our servers** — Stripe.js collects card details directly in an iframe. Our backend only receives the PaymentIntent's `client_secret`.
2. **PCI DSS compliance** — implicitly handled by Stripe's tokenization. We never see, store, or process raw card numbers.
3. **Webhook authenticity** — Stripe SDK `constructEvent()` with `whsec_` secret. Replay protection via timestamp tolerance.
4. **Financial record immutability** — No UPDATE/DELETE RLS policies on transactions. Status changes only via service-role webhook processor.
5. **Platform fee transparency** — `application_fee_amount` is visible in both platform and connected account dashboards.

---

## Next Steps (Phase 3 continued)
1. **Stripe Webhook Wiring** — Update transaction status on `payment_intent.succeeded/failed` + tenant status on `account.updated`
2. **Donation Receipts** — Email receipts via Resend SDK triggered by `payment_intent.succeeded`
3. **Admin Dashboard Metrics** — Total giving, donor count, average donation, monthly trends
4. **Post Reactions/Likes** — Lightweight engagement layer
5. **Church Feed API** — Tenant-scoped feed with cursor-based pagination
