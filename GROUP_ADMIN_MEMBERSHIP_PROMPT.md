# Shepard Mobile — Group Admin Membership & Join Requests

## What this is

The backend now treats groups as **closed by default**: non-members request to join, admins review and approve/deny, and admins can also add members directly. This doc covers everything the mobile app needs to wire up — user-side request flow + admin-side review screen.

**Backend origin:** `https://church-app-backend-27hc.onrender.com` — endpoints live under `/api/...`. `EXPO_PUBLIC_API_URL` should be the origin only (no `/api` suffix); call sites already prefix `/api/` in path strings.

**Auth context required:** all endpoints below require `Authorization: Bearer <jwt>`.

---

## Who counts as an "admin"

For every endpoint marked **admin-only** below, the caller passes the check if **either** is true:

1. They have role `admin` or `pastor` in the group's tenant (read this from `/api/auth/session` → `memberships[].role`)
2. They are the group's `created_by` user

Anyone else gets `403 Forbidden`. Cross-tenant calls return `404 Not Found` (we don't leak the existence of groups in other tenants).

The mobile UI should hide admin controls (the "+ Add Member" button, the requests inbox) for users who are neither.

---

## ⚠️ Breaking change — `POST /groups/:id/join`

The semantics changed. Previously this endpoint added the caller immediately and returned `{ joined: true }`. Now it creates a **pending request** and returns:

```ts
type JoinResponse =
  | { status: 'pending'; requestId: string }
  | { status: 'already_member' }
```

If the user already has a pending request, the same `requestId` is returned (idempotent — calling join twice doesn't error).

The user is **not in the group** until an admin approves the request. The mobile UI must reflect this — see "Group screen states" below.

### Request body (optional)

```ts
POST /api/groups/:groupId/join
{
  "message": "Hi, I'd love to join this group because..."  // optional, max 500 chars
}
```

The message is shown to the admin in the requests inbox. Empty body is fine.

---

## User flow — requesting to join + status

### When viewing a group's detail screen

`GET /api/groups/:id` now returns:

```ts
{
  id, tenantId, name, description, imageUrl,
  memberCount, isMember,
  pendingRequestStatus: 'pending' | null,   // ← new
  createdAt
}
```

Render the join button based on these fields:

| `isMember` | `pendingRequestStatus` | Button |
|---|---|---|
| `true`   | —         | "Open group" / navigate into messages |
| `false`  | `'pending'` | "Request pending" (disabled, with "Withdraw" subtext) |
| `false`  | `null`    | "Request to join" (active) |

### Withdrawing your own request

```ts
DELETE /api/groups/:groupId/join-requests/me
→ { withdrawn: true }
```

After this, `pendingRequestStatus` flips back to `null` and the user can request again.

### Handling each response

```ts
async function joinGroup(groupId: string, message?: string) {
  const res = await apiClient.post(`/api/groups/${groupId}/join`, { message });

  if (res.status === 'already_member') {
    // Shouldn't normally happen if your isMember check is fresh,
    // but safe to handle: just navigate into the group.
    return navigate(`/groups/${groupId}`);
  }

  // status === 'pending'
  showToast('Request sent — waiting for admin approval');
  // Re-fetch the group so pendingRequestStatus updates the UI button
}
```

---

## Admin flow — direct add

When an admin views a group they manage, show a **"+ Add Member"** affordance. Tapping it opens a member picker (you can reuse the existing tenant member search). On select:

```ts
POST /api/groups/:groupId/members
{ "userId": "<target-user-uuid>" }
→ 201 { added: true }
```

This is **idempotent**: adding a user who's already a member returns 201 silently. If the user had a pending request, it's auto-marked approved as a side effect — no need to also call the approve endpoint.

### Removing a member

```ts
DELETE /api/groups/:groupId/members/:userId
→ 200 { removed: true }
```

Errors:
- `404` if the user wasn't a member
- `403` if the caller isn't an admin of this group

(Members can also remove themselves with the existing `DELETE /api/groups/:id/leave` — that one needs no admin check.)

---

## Admin flow — reviewing pending requests

### Listing requests

```ts
GET /api/groups/:groupId/join-requests
   ?status=pending   // 'pending' | 'approved' | 'denied' | 'all', default 'pending'
   &limit=20         // default 20, max 100
   &cursor=<lastRequestId>

→ {
  requests: [
    {
      id: "uuid",
      userId: "uuid",
      user: { id, fullName, avatarUrl, email },
      status: "pending",
      message: "the requester's note, or null",
      requestedAt: "ISO timestamp",
      reviewedAt: null,
      reviewedBy: null,
      deniedReason: null
    },
    ...
  ],
  nextCursor: "uuid" | null
}
```

For the requests inbox, default to `?status=pending`. Show a small badge with the count on the group's settings screen so admins know to check.

### Approving

```ts
POST /api/groups/:groupId/join-requests/:requestId/approve
→ 200 { approved: true, userId: "uuid" }
```

Adds the user to `group_members` and marks the request `approved`. After this, the user's `isMember` flips to true on their next group fetch.

### Denying

```ts
POST /api/groups/:groupId/join-requests/:requestId/deny
{ "reason": "We're keeping this group small for now." }   // optional, max 500 chars
→ 200 { denied: true }
```

The denial reason is stored on the request and visible to the user if you choose to surface it (we currently don't have a "my denied requests" endpoint; ask if needed). After deny, the request count goes down and the user can re-request later — a denied request doesn't block future ones.

### Errors to expect

| Status | Cause | UI handling |
|---|---|---|
| `403` | Caller isn't a tenant admin/pastor or the group creator | Hide admin controls upstream so this is rare |
| `404` | Group, request, or target user doesn't exist | Toast "Not found", re-fetch the request list |
| `409` | Request is already approved or denied (someone else acted) | Re-fetch the list — refresh the inbox |

The 409 case is real: if two admins open the inbox simultaneously and both tap approve, the second one gets `409 "Request is already approved"`. Treat this as a benign race — silently re-fetch.

---

## Endpoint reference (cheat sheet)

| Method | Path | Who | Purpose |
|---|---|---|---|
| `POST` | `/api/groups/:id/join` | any tenant member | Create pending join request |
| `DELETE` | `/api/groups/:id/join-requests/me` | requester | Withdraw own pending request |
| `DELETE` | `/api/groups/:id/leave` | member | Leave the group |
| `POST` | `/api/groups/:id/members` | admin/creator | Direct-add a user |
| `DELETE` | `/api/groups/:id/members/:userId` | admin/creator | Remove a member |
| `GET` | `/api/groups/:id/join-requests` | admin/creator | List join requests |
| `POST` | `/api/groups/:id/join-requests/:requestId/approve` | admin/creator | Approve → adds member |
| `POST` | `/api/groups/:id/join-requests/:requestId/deny` | admin/creator | Deny with optional `{ reason }` |
| `GET` | `/api/groups/:id` | any tenant member | Now returns `pendingRequestStatus` |

---

## UI screens you'll need

### 1. Group detail (existing — small change)
Replace the join button logic with the three-state table from "User flow" above. The new field is `pendingRequestStatus` on the `GET /api/groups/:id` response.

### 2. Group settings — admin section (new)
Visible only when the user is a group admin (admin/pastor role OR `group.createdBy === currentUser.id`).

Two affordances:
- **+ Add Member** — opens member picker → `POST /groups/:id/members`
- **Pending Requests** (with count badge) → opens the requests inbox

### 3. Requests inbox (new)
- List from `GET /groups/:id/join-requests?status=pending`
- Each row: avatar, full name, requested-at relative time, the optional message
- Two buttons per row: **Approve** / **Deny**
- Tapping Deny opens a small sheet for the optional reason, then submit
- Pull-to-refresh (or refetch on focus) since requests come in over time

### 4. (Optional) Tabs for approved/denied history
If admins want history, add tabs: Pending | Approved | Denied. Use the `?status=` query param. Lower priority — pending is the main view.

---

## Notifications

Currently the backend does **not** send a push notification when:
- A user requests to join a group (admin should be notified)
- An admin approves/denies a request (requester should be notified)

This is deliberate — the device-token registration flow is still being wired (see [MOBILE_BUGFIX_PROMPT.md](MOBILE_BUGFIX_PROMPT.md) Bug 3). Once push registration is solid, the mobile team can ask the backend to add `GROUP_JOIN_REQUEST` / `GROUP_JOIN_APPROVED` / `GROUP_JOIN_DENIED` notification types — wiring takes ~30 min on the backend side.

In the meantime, admins discover requests by opening the group settings (the count badge on "Pending Requests" provides the in-app signal).

---

## Test checklist

User flow:
- [ ] Open a group you're not a member of → see "Request to join"
- [ ] Tap → button changes to "Request pending"; group screen reflects this on re-open
- [ ] Tap "Withdraw" → back to "Request to join"
- [ ] Re-request → admin sees it in their inbox

Admin flow (log in as admin/pastor or group creator):
- [ ] Open group settings → "+ Add Member" + "Pending Requests" appear
- [ ] "+ Add Member" → search → select → user is now a member; member count goes up by 1
- [ ] Pending request from another user appears in the inbox
- [ ] Approve → user is now in the members list, request disappears from pending
- [ ] Deny → request disappears from pending; if you switch to "Denied" tab (if implemented), it shows there with the reason

Auth/edge cases:
- [ ] Non-admin member: admin controls hidden
- [ ] Non-admin attempting to call `POST /groups/:id/members` directly: returns 403
- [ ] Two admins racing on the same approve: one succeeds, the other gets 409 → silently re-fetches
- [ ] User with denied request can request again → creates a new pending request
