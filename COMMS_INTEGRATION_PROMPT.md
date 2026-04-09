# Communications Integration — Admin Dashboard Frontend

## Overview

The backend now supports sending **Email**, **SMS**, and **Push Notifications** from the Communications tab. All three channels are live and wired to real services (Resend, Twilio, OneSignal). This document explains exactly how to integrate them into the admin dashboard.

**Base URL:** `https://church-app-backend-27hc.onrender.com/api`
**Auth:** All endpoints require `Authorization: Bearer <accessToken>`

---

## The Communications Page Flow

```
Communications Tab
├── Send Message (compose + send)
├── Message Templates (save reusable messages)
├── Audience Segments (target specific groups)
├── Message History (sent messages log)
└── Analytics (delivery stats)
```

---

## 1. Sending a Message

This is the core action. The admin composes a message, picks a channel, and hits send.

### UI Components Needed
- **Channel picker:** 3 buttons/tabs — Email, SMS, Push
- **Subject line:** Text input (required for email, optional for SMS/push)
- **Message body:** Textarea (rich text for email, plain text for SMS/push)
- **Segment picker:** Optional dropdown to target a specific audience segment
- **Template picker:** Optional — load a saved template into the compose form
- **Send button:** Dispatches immediately
- **Schedule button:** Opens a date/time picker, then schedules

### Send Immediately
```
POST /api/communications/send
Content-Type: application/json

{
  "channel": "email",          // "email" | "sms" | "push"
  "subject": "Sunday Service Update",  // Required for email. Optional for sms/push.
  "body": "Hey church family! Just a reminder that this Sunday...",
  "segmentId": null,           // Optional UUID — if null, sends to ALL members
  "templateId": null           // Optional UUID — for tracking which template was used
}
```

**Response:**
```json
{
  "id": "uuid",
  "channel": "email",
  "subject": "Sunday Service Update",
  "body": "Hey church family! Just a reminder...",
  "recipientCount": 150,
  "sentBy": "uuid",
  "sentAt": "2026-04-09T...",
  "status": "sent",
  "createdAt": "2026-04-09T..."
}
```

**What happens on the backend:**
- **Email:** Resend sends an HTML email with the church name in the header to every member's email address
- **SMS:** Twilio sends a text message to every member who has a phone number on their profile
- **Push:** OneSignal sends a push notification to every member's registered device

The dispatch is fire-and-forget — the API returns immediately with the message record. Delivery happens asynchronously.

### Schedule for Later
```
POST /api/communications/schedule
Content-Type: application/json

{
  "channel": "email",
  "subject": "Reminder: Easter Service",
  "body": "Don't forget — Easter service is at 9 AM this Sunday!",
  "scheduledFor": "2026-04-20T08:00:00.000Z"
}
```

**Response:** Same shape as send, but `status: "scheduled"` and `sentAt: null`.

**Note:** The scheduler is not yet implemented on the backend — the message is recorded with `scheduled` status but not automatically sent at the scheduled time. This is a Phase 2 feature. For now, show scheduled messages in the history so admins know it's queued.

---

## 2. Channel-Specific UI Notes

### Email
- Show a **subject line** input (required)
- Body should support basic formatting (bold, links, line breaks)
- The backend wraps the body in an HTML template with the church name
- Preview: Show a mock email card with subject + body

### SMS
- **No subject line** needed (hide it or make optional)
- Body has a **160 character limit** indicator (SMS standard)
- Show a warning: "SMS will only be sent to members with a phone number on their profile"
- Show count of members with phone numbers vs total members:
  ```
  GET /api/tenants/{tenantId}/members → check which have phone numbers
  ```

### Push Notification
- **Subject = notification title**, body = notification text
- Both should be short (title: ~50 chars, body: ~100 chars)
- Show a mock phone notification preview
- Push only works for members who have the mobile app installed

---

## 3. Audience Segments

Segments let admins target specific groups instead of blasting everyone.

### List Segments
```
GET /api/communications/segments
→ { "data": [{ "id": "uuid", "name": "New Members", "rules": {...}, "createdAt": "..." }] }
```

### Create Segment
```
POST /api/communications/segments
{ "name": "New Members (Last 90 Days)", "rules": { "joinedWithin": "90d" } }
```

The `rules` field is a freeform JSON object. The backend doesn't filter by rules yet (it sends to all members regardless). For now, just save the rules as metadata. The segment picker in the compose form shows the segment name.

### Preview Segment Match Count
```
POST /api/communications/segment-preview
{ "rules": { "joinedWithin": "90d" } }
→ { "matchedCount": 42 }
```

Currently returns total member count (rule filtering is future work). Show this number in the UI so the admin knows how many people will receive the message.

---

## 4. Message Templates

Reusable message templates admins can save and load.

### List Templates
```
GET /api/communications/templates
→ { "data": [
    { "id": "uuid", "name": "Weekly Update", "subject": "This Week at Church", "body": "...", "channel": "email", "createdAt": "..." }
  ]}
```

### Create Template
```
POST /api/communications/templates
{
  "name": "Weekly Update",
  "channel": "email",
  "subject": "This Week at {{churchName}}",
  "body": "Hey {{churchName}} family!\n\nHere's what's happening this week..."
}
```

### Using a Template
When the admin selects a template from the picker:
1. Load the template's `subject` and `body` into the compose form
2. Let them edit before sending
3. Pass the `templateId` in the send request for tracking

---

## 5. Message History

Shows all previously sent and scheduled messages.

```
GET /api/communications/history?limit=20&cursor=...
→ {
    "data": [
      {
        "id": "uuid",
        "channel": "email",
        "subject": "Sunday Service Update",
        "body": "Hey church family...",
        "recipientCount": 150,
        "status": "sent",
        "sentAt": "2026-04-09T...",
        "scheduledFor": null,
        "createdAt": "2026-04-09T..."
      }
    ],
    "cursor": "2026-04-08T..."
  }
```

### Table Columns
| Column | Field | Display |
|--------|-------|---------|
| Channel | `channel` | Icon: envelope (email), phone (sms), bell (push) |
| Subject/Title | `subject` | Truncated, or "[No subject]" for SMS |
| Recipients | `recipientCount` | e.g., "150 members" |
| Status | `status` | Badge: green=sent, blue=scheduled, red=failed |
| Sent At | `sentAt` or `scheduledFor` | Relative time |

---

## 6. Analytics

```
GET /api/communications/analytics
→ {
    "totalSent": 47,
    "sentThisMonth": 12,
    "avgRecipients": 142.5
  }
```

Show these as 3 metric cards at the top of the Communications page:
- **Total Messages Sent** — all time
- **Sent This Month** — current month
- **Avg Recipients** — average audience size per message

---

## 7. Phone Number Collection

For SMS to work, members need phone numbers on their profiles. The backend has a `phone` field on users.

### Update Profile (member-facing, in account settings)
```
PATCH /api/users/me
{ "phone": "+15551234567" }
```

### Admin Can See Phone Status in Member List
The member list from `GET /api/tenants/{tenantId}/members` includes user profile data. Check if `phone` is null to show a "no phone" indicator.

Consider adding a banner on the SMS compose screen:
> "42 of 150 members have phone numbers. Members can add their phone number in the mobile app settings."

---

## 8. Complete API Reference

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/communications/segments` | List audience segments |
| POST | `/api/communications/segments` | Create segment `{ name, rules }` |
| POST | `/api/communications/segment-preview` | Preview matched count `{ rules }` |
| GET | `/api/communications/templates` | List message templates |
| POST | `/api/communications/templates` | Create template `{ name, channel, subject?, body }` |
| POST | `/api/communications/send` | Send message now `{ channel, subject?, body, segmentId?, templateId? }` |
| POST | `/api/communications/schedule` | Schedule message `{ ..., scheduledFor }` |
| GET | `/api/communications/history` | Sent message history `?limit=&cursor=` |
| GET | `/api/communications/analytics` | Delivery stats summary |

---

## 9. Environment / Config

The backend handles all API keys server-side. The frontend does NOT need any Resend, Twilio, or OneSignal credentials. Just call the endpoints above — the backend dispatches through the correct service automatically.

**Channels available:**
- `"email"` — always available (every member has an email)
- `"sms"` — only reaches members with phone numbers
- `"push"` — only reaches members with the mobile app installed
