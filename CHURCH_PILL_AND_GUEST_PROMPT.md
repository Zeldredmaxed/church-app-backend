# Mobile Handoff — ChurchPill, Brand Color, Guest Tenant

Backend is wired for the four asks. Field names + payloads below.

---

## 1. Per-user church on posts + a new public-profile endpoint

### Post author objects now include `church`

**Every** post response surface (`GET /api/posts`, `GET /api/posts/:id`, `GET /api/posts/saved`, `GET /api/posts/archive`, the campus feed) now stamps the author with their home church:

```jsonc
{
  "author": {
    "id": "user-uuid",
    "fullName": "Jane Doe",
    "avatarUrl": "https://...",
    "church": {
      "id": "tenant-uuid",
      "name": "Grace Church",
      "brandColor": "#5B7CFA"   // null if not set
    }                            // entire church object is null if user has no home tenant
                                 // or is on the guest tenant
  }
}
```

"Home church" = the author's `last_accessed_tenant_id`. This is "where the author hangs out," not "the tenant this post was posted into" — which is the right semantics for the ChurchPill (cross-church global posts still stamp the author with their actual church).

Guest-tenant authors return `church: null` so the pill simply isn't rendered for them.

### New public-profile endpoint

```http
GET /api/users/:userId/public-profile
Authorization: Bearer <JWT>
```

Returns the safe-to-display fields for any user, including their home church:

```json
{
  "id": "user-uuid",
  "fullName": "Jane Doe",
  "avatarUrl": "https://...",
  "church": {
    "id": "tenant-uuid",
    "name": "Grace Church",
    "brandColor": "#5B7CFA"
  },
  "createdAt": "2026-01-12T..."
}
```

Use this for profile cards rendered for users outside your own tenant (follower lists, search results, comment author taps).

---

## 2. Tenant brand color

New column `brandColor: string | null` (single hex `#RRGGBB`) on every tenant response shape:
- `GET /api/tenants/me/features` → `tenant.brandColor`
- `GET /api/tenants/:id/profile` → top-level `brandColor`
- `GET /api/memberships` → each `tenant.brandColor`
- Post author objects (above) → `author.church.brandColor`
- Public profile (above) → `church.brandColor`
- Tenant creation/registration response → `tenant.brandColor`

The hash-the-name fallback should be kept as-is. Prefer `tenant.brandColor` when truthy; otherwise fall back to the hash. Once a church sets their real color via the admin dashboard, this column flips and the pill updates everywhere immediately.

DB-side validation: hex format enforced via `CHECK (brand_color ~* '^#[0-9A-Fa-f]{6}$')`. Three-digit (`#ABC`), 8-digit alpha (`#AABBCCDD`), and `rgb()`/named colors will all be rejected.

---

## 3. Guest tenant flag — `isGuest`

Every tenant response now also includes `isGuest: boolean`:

```json
{
  "tenant": {
    "id": "guest-tenant-uuid",
    "name": "No Church Home",
    "isGuest": true,
    "brandColor": null,
    ...
  }
}
```

Flip your `useIsGuest` hook to read this from the active tenant context. There's a partial unique index on the table that enforces "at most one row with `is_guest = true`" — you can't accidentally fork the no-home state.

**To create the guest tenant** (one-time, from your admin script or migration): insert a `tenants` row with `is_guest = true`, `name = 'No Church Home'` (or whatever you want users to see in their tenant switcher). When a new user signs up without a church, set their `last_accessed_tenant_id` to this row's id.

---

## 4. Server-side enforcement on church-only routes

A new global `ChurchOnlyGuard` refuses to serve church-only endpoints when the caller's JWT current tenant has `is_guest = true`. Applied at the class level on:

- `POST/GET /api/prayers/*`
- `POST/GET /api/fundraisers/*`
- `POST/GET /api/giving/*` (donations, funds, batches)
- `POST/GET /api/sermons/*`
- `POST/GET /api/announcements/*`
- `POST/GET /api/gallery/*`
- `POST/GET /api/volunteer/*`
- `POST/GET /api/events/*` (iCal public feed is excluded — no JWT, guard passes through)
- `POST/GET /api/groups/*`

Response when a guest hits any of these:

```http
HTTP/1.1 403 Forbidden
{ "statusCode": 403, "message": "You must join a church before using this feature", "error": "Forbidden" }
```

Mobile should still hide these screens on the home tabs (cleaner UX than firing a request to get a 403), but deep links, history navigation, and rogue clients now all hit a server-side wall.

**Not gated** (intentional — these work for guests too):
- Auth + session management
- Profile editing + settings + push tokens
- Notifications inbox
- Tenant switching + memberships list (they need to be able to *join* a church!)
- Public legal pages (`/api/legal/*`)
- Account deletion + data export

---

## Summary

| Field | Where it lives | Default | Frontend action |
|---|---|---|---|
| `tenant.brandColor` | Every tenant response | `null` | Prefer over name-hash when truthy |
| `tenant.isGuest` | Every tenant response | `false` | Drive `useIsGuest` from this |
| `author.church` | Every post author shape + public profile | `null` for guests / no-home users | Render ChurchPill when non-null |
| `ChurchOnlyGuard` | Global, opt-in via `@ChurchOnly()` | Enforces server-side | UX hides; server backstops |

Migration 070 is applied to prod. Backend type-check is clean. Deploys with the next push to `main`.
