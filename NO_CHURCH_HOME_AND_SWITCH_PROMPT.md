# Mobile Handoff — No Church Home + Change Church / Change Branch

Backend is wired. The guest tenant exists, the church chooser pins it at the top, and the settings → change-church/change-branch flow has atomic endpoints.

---

## 1. The "No Church Home" tenant

A single permanent row in `public.tenants`:

```jsonc
{
  "id": "00000000-0000-0000-0000-000000000001",
  "name": "No Church Home",
  "slug": "no-church-home",
  "tier": "standard",
  "isGuest": true,
  "brandColor": null
}
```

Every existing endpoint that returns tenant info now includes `isGuest`. The frontend's `useIsGuest` hook should read this field — when `true`, hide church-only screens. (Server-side `ChurchOnlyGuard` from the previous round backstops anyone who tries to navigate there directly.)

---

## 2. Church chooser — `GET /api/tenants/public`

Already public (no auth). Now returns extra fields and pins the guest tenant first:

```http
GET /api/tenants/public
GET /api/tenants/public?q=grace        # optional name filter (ILIKE)
```

Response:

```json
[
  {
    "id": "00000000-0000-0000-0000-000000000001",
    "name": "No Church Home",
    "slug": "no-church-home",
    "brandColor": null,
    "isGuest": true,
    "parentTenantId": null,
    "campusName": null
  },
  {
    "id": "tenant-uuid",
    "name": "Grace Community Church",
    "slug": "grace-church",
    "brandColor": "#5B7CFA",
    "isGuest": false,
    "parentTenantId": null,
    "campusName": null
  },
  {
    "id": "campus-uuid",
    "name": "Grace Community Church",
    "slug": "grace-church-10th-st",
    "brandColor": "#5B7CFA",
    "isGuest": false,
    "parentTenantId": "tenant-uuid",
    "campusName": "10th Street Campus"
  },
  ...
]
```

Sort order: `is_guest DESC, name ASC` — guarantees No Church Home is first whether or not a search filter matches it. Limit is 200.

Render hint: when `parentTenantId` is non-null, the row is a campus — group it visually under the matching parent's name. `isParent: true` rows (no parent_tenant_id) are standalone churches OR the parent org of a multi-site.

---

## 3. Self-join — `POST /api/memberships/me/join`

User picks a church → mobile calls this. No invitation token required; it's a public self-join.

```http
POST /api/memberships/me/join
Authorization: Bearer <JWT>
Content-Type: application/json

{ "tenantId": "00000000-0000-0000-0000-000000000001" }
```

Response:

```json
{
  "membership": {
    "userId": "...",
    "tenantId": "...",
    "role": "member"
  },
  "tenant": {
    "id": "...",
    "name": "No Church Home",
    "slug": "no-church-home",
    "tier": "standard",
    "brandColor": null,
    "isGuest": true,
    "campusName": null,
    "parentTenantId": null
  }
}
```

Behavior:
- Idempotent. Re-calling with the same tenantId returns the existing membership and doesn't error.
- Auto-assigns the tenant's "Guest" tag (creates it if missing). For No Church Home this is the permanent marker; for real churches it doubles as the "new attendee" badge admins already use.
- Does NOT switch the active tenant context. After this, the mobile should call `POST /api/auth/switch-tenant` then `POST /api/auth/refresh` to scope the JWT to the new church.

### Signup flow

After Supabase Auth signup completes:
1. Mobile shows the church chooser (`GET /api/tenants/public`) with No Church Home pinned.
2. User taps a row.
3. Mobile calls `POST /api/memberships/me/join` with that tenantId.
4. Mobile calls `POST /api/auth/switch-tenant` + `POST /api/auth/refresh`.
5. User lands in the app.

---

## 4. Change Church / Change Branch — `POST /api/memberships/me/switch-church`

Single atomic endpoint that covers both flows. Used from Settings.

```http
POST /api/memberships/me/switch-church
Authorization: Bearer <JWT>
Content-Type: application/json

{
  "leaveTenantId": "current-tenant-uuid",
  "joinTenantId":  "new-tenant-uuid"
}
```

Response:

```json
{
  "membership": { "userId": "...", "tenantId": "new-tenant-uuid", "role": "member" },
  "tenant":     { ...full tenant object including brandColor/isGuest... },
  "message":    "Switched. Call POST /api/auth/refresh to get a JWT scoped to the new tenant."
}
```

Behavior:
- One transaction: deletes the leave membership (if any), inserts the join membership (idempotent), updates `users.last_accessed_tenant_id`, auto-assigns the Guest tag in the new tenant.
- `400` if `leaveTenantId === joinTenantId`.
- `404` if the join tenant doesn't exist.
- Mobile must still call `POST /api/auth/refresh` afterward — the JWT in hand is stale.

### Change Church (different organizations)

Settings → Change Church → list churches via `GET /api/tenants/public` → user picks one → `POST /api/memberships/me/switch-church` → refresh JWT.

### Change Branch (different campus, same organization)

Settings → Change Branch → list siblings via the next endpoint → user picks one → same `switch-church` call (the endpoint is generic).

---

## 5. Branch list — `GET /api/tenants/:tenantId/branches`

Returns the parent organization + every campus under it. Works whether `:tenantId` is the parent or any of its children.

```http
GET /api/tenants/<any-tenant-in-the-org>/branches
Authorization: Bearer <JWT>
```

Response:

```json
[
  {
    "id": "parent-uuid",
    "name": "Grace Community Church",
    "slug": "grace-church",
    "brandColor": "#5B7CFA",
    "isGuest": false,
    "parentTenantId": null,
    "campusName": null,
    "isParent": true
  },
  {
    "id": "campus-1-uuid",
    "name": "Grace Community Church",
    "slug": "grace-church-10th-st",
    "brandColor": "#5B7CFA",
    "isGuest": false,
    "parentTenantId": "parent-uuid",
    "campusName": "10th Street Campus",
    "isParent": false
  },
  {
    "id": "campus-2-uuid",
    "name": "Grace Community Church",
    "slug": "grace-church-eastside",
    "brandColor": "#5B7CFA",
    "isGuest": false,
    "parentTenantId": "parent-uuid",
    "campusName": "Eastside Campus",
    "isParent": false
  }
]
```

Standalone churches return a single-element array `[ { isParent: true } ]`.

Render hint: a single-element response means there are no branches — hide the "Change Branch" option entirely.

---

## 6. Settings UI

```
Settings
  Account
    Edit Profile
    Change Password
    Delete Account
  Notifications
    ...
  Church
    Current Church  →  Grace Community Church (10th Street Campus)
                       [Change Church]    [Change Branch]
  Privacy
    Blocked Users
    Export My Data
    Privacy Policy
  Legal
    ...
```

**Change Church:** opens church picker (`GET /api/tenants/public`), excludes the user's current tenantId from the list, on tap → `POST /api/memberships/me/switch-church` → refresh JWT → navigate home.

**Change Branch:** opens branch picker (`GET /api/tenants/<current>/branches`), excludes current tenantId, on tap → same `POST /api/memberships/me/switch-church` → refresh JWT → navigate home. If the response is `[]` or `[onlyCurrentTenant]`, hide the button.

**For users currently on No Church Home:** the "Change Church" button is the primary CTA. The "Change Branch" button is hidden (the guest tenant has no parent and no siblings).

---

## 7. What's already in place from prior rounds

- `ChurchOnlyGuard` blocks prayers/fundraisers/giving/sermons/announcements/gallery/volunteer/events/groups when current tenant has `isGuest=true` → returns 403 with `"You must join a church before using this feature"`. Mobile should still hide these UI-side but the backend backstops deep links.
- `author.church` and `tenant.brandColor` on responses (previous handoff).
- The Guest tag — auto-assigned by both `selfJoin` and `switchChurch`, plus the existing signup flow.

---

## 8. Migration summary

Migration 071 is applied — the row exists in prod at id `00000000-0000-0000-0000-000000000001`. The partial unique index from migration 070 guarantees this is the only guest tenant; re-running 071 is a no-op (`ON CONFLICT DO NOTHING`).

All new endpoints type-check clean. Deploys with the next push to `main`.
