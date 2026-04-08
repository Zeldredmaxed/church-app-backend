# Frontend Handoff: Backend Audit Fixes

**Date:** 2026-04-08
**Summary:** A full code audit was performed on the Shepard backend. All identified bugs, security issues, and architecture problems have been fixed. Several changes affect the frontend. This document explains what changed and what the frontend team needs to update.

---

## 1. BREAKING: Tier Names Changed

**What changed:** The backend tier names were inconsistent between the database and the config. They have been unified to match the database.

| Old (config)  | New (everywhere) |
|---------------|------------------|
| `starter`     | *(removed)*      |
| `standard`    | `standard`       |
| `pro`         | `premium`        |
| `enterprise`  | `enterprise`     |

**Frontend action required:**
- Search your codebase for any references to `'starter'` or `'pro'` tier names.
- Replace `'pro'` with `'premium'` everywhere (conditionals, feature gates, display strings, tier badges, upsell modals, etc.).
- Remove any `'starter'` tier handling. The lowest tier is now `'standard'`.
- The `GET /api/tenants/:id/features` response now returns `tier: 'standard' | 'premium' | 'enterprise'` and `tierDisplayName: 'Standard' | 'Premium' | 'Enterprise'`.

---

## 2. BREAKING: Tenant Features Endpoint Now Requires Tenant Context

**What changed:** `GET /api/tenants/:id/features` now applies the RLS interceptor and reads the tenant ID from the user's JWT context (not the URL parameter). This prevents any user from reading any other tenant's features.

**Frontend action required:**
- Ensure the user has called `POST /api/auth/switch-tenant` and `POST /api/auth/refresh` **before** calling `GET /api/tenants/:id/features`.
- If you were passing a tenant ID that differs from the user's current JWT tenant, this will no longer work. The endpoint now uses the JWT's `current_tenant_id`.

---

## 3. NEW: Notification Type `NEW_GLOBAL_POST`

**What changed:** When a user creates a global post, their followers now receive a `NEW_GLOBAL_POST` notification instead of `POST_MENTION`. The notification includes a `preview` field with the first 100 characters of the post.

**Frontend action required:**
- Add a handler for `type: 'NEW_GLOBAL_POST'` in your notification rendering logic.
- The payload shape is:
  ```json
  {
    "type": "NEW_GLOBAL_POST",
    "payload": {
      "postId": "uuid",
      "actorUserId": "uuid",
      "preview": "First 100 chars of post..."
    }
  }
  ```
- Suggested display: "**{actorName}** shared a new post" with the preview text.
- The push notification title is `"New Post"` and the body is the preview text.

---

## 4. Transaction Status Now Updates (Was Always "pending")

**What changed:** The Stripe webhook handler was only logging events and never updating the database. All donations were stuck as `status: 'pending'` forever. This is now fixed:
- `payment_intent.succeeded` -> `status: 'succeeded'`
- `payment_intent.payment_failed` -> `status: 'failed'`
- `charge.refunded` -> `status: 'refunded'`

**Frontend action required:**
- If your donation history UI was hardcoded or only showed "pending", update it to display all four statuses: `pending`, `succeeded`, `failed`, `refunded`.
- Consider adding status-specific styling (green for succeeded, red for failed, yellow for pending, gray for refunded).
- If you were polling for status changes, they will now actually resolve.

---

## 5. Platform Fees Are Now Tier-Aware

**What changed:** The platform fee was hardcoded at 1%. It now varies by tier:
- `standard`: 1.0%
- `premium`: 0.5%
- `enterprise`: 0%

**Frontend action required:**
- If you display the platform fee to users (e.g., in donation confirmation), fetch it from the `GET /api/tenants/:id/features` response: `features.transactionFeePercent`.
- Do **not** hardcode 1%.

---

## 6. Global Posts Now Support Media and Visibility

**What changed:** `POST /api/posts/global` previously ignored `mediaUrl`, `mediaType`, and `visibility` from the request body. These fields are now respected.

**Frontend action required:**
- If your global post creation form already sends these fields, no change needed -- they'll now work.
- If your global post form intentionally hides media/visibility controls, no change needed.
- If you want to enable image/video uploads for global posts, the backend now supports it.

---

## 7. Posts Can Have `tenantId: null`

**What changed:** The `tenantId` field on posts is now explicitly nullable. Global posts have `tenantId: null`.

**Frontend action required:**
- If you have TypeScript types for posts, update `tenantId` from `string` to `string | null`.
- Guard against `null` when using `tenantId` for routing, filtering, or grouping.

---

## 8. CORS Is Now Configured

**What changed:** The backend now has explicit CORS configuration. In production, only origins listed in the `CORS_ORIGINS` environment variable are allowed.

**Frontend action required:**
- **Tell the backend/DevOps team your production frontend URL(s)** so they can add them to `CORS_ORIGINS` (comma-separated).
- Example: `CORS_ORIGINS=https://app.shepard.com,https://admin.shepard.com`
- In development, all origins are allowed (no action needed).

---

## 9. Swagger UI Disabled in Production

**What changed:** Swagger docs at `/api/docs` are no longer available in production. They remain accessible in development/staging.

**Frontend action required:**
- Use a non-production environment to access Swagger docs.
- The `swagger.json` file is still generated in development and committed to the repo at `backend/swagger.json`.

---

## 10. Invitation Token No Longer in Production Responses

**What changed:** `POST /api/invitations` no longer returns the `token` field in production. In development, it's still included for testing.

**Frontend action required:**
- If you were reading the `token` from the create-invitation response for any purpose (e.g., copy-to-clipboard, direct link generation), this will be `undefined` in production.
- The invitation flow should rely on email delivery of the token. No frontend change needed if you weren't using the token from the response.

---

## 11. Giving Pagination Limit Capped at 100

**What changed:** The `limit` query parameter on `GET /api/giving/transactions` and `GET /api/tenants/:id/transactions` is now clamped to 1-100. Values above 100 are reduced to 100.

**Frontend action required:**
- If you were requesting more than 100 transactions at once, you'll need to paginate.

---

## 12. Health Readiness Returns 503 When Degraded

**What changed:** `GET /api/health/ready` now returns HTTP 503 (instead of 200) when the database is disconnected.

**Frontend action required:**
- If you have health check monitoring, ensure it treats 503 from `/api/health/ready` as "unhealthy" (most monitoring tools do this by default).

---

## 13. Permissions DTO Now Validates Boolean Types

**What changed:** `PATCH /api/memberships/:id/permissions` now strictly validates that permission values are booleans. Sending `"true"` (string) or `1` (number) will return a 400 error.

**Frontend action required:**
- Ensure permission toggle values are sent as `true`/`false` booleans, not strings or numbers.
  ```json
  { "permissions": { "manage_finance": true, "manage_content": false } }
  ```

---

## No Frontend Changes Needed For

These were backend-only fixes with no API contract changes:
- Cold start feed double-query removal (performance fix)
- Shared Supabase admin service (internal refactor)
- RLS null-assertion safety (crash prevention)
- Redis connection cleanup on shutdown
- SSL certificate verification in production
- Migration 005 transaction wrapping
- Package.json dependency cleanup
- Mux webhook video processing (sets `videoMuxPlaybackId` automatically)
- Stripe Connect `account.updated` webhook (updates tenant `stripeAccountStatus` automatically)
