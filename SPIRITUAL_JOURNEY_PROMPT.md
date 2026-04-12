# Admin Dashboard — Member Spiritual Journey Integration

> **Date:** April 10, 2026
> **From:** Backend Team
> **For:** Admin Dashboard Team (Next.js)

---

## Overview

Every member has a **spiritual journey record** that tracks their faith milestones, discipleship progress, skills, interests, and bio. This data appears on the member profile page and feeds into the discipleship funnel report.

The journey is automatically created when a member submits onboarding forms, but admins can also view and edit it manually from the member's profile.

---

## Endpoints

### Get Journey (part of 360-degree profile)

```
GET /api/members/:userId/profile
```

The `journey` field in the response contains the spiritual journey data:

```json
{
  "personalInfo": { ... },
  "tags": [ ... ],
  "journey": {
    "id": "uuid",
    "attendedMembersClass": true,
    "membersClassDate": "2026-02-10",
    "isBaptized": true,
    "baptismDate": "2026-03-01",
    "salvationDate": "2020-06-15",
    "discipleshipTrack": "growth",
    "skills": ["Music/Singing", "Teaching"],
    "interests": ["Worship/Music", "Youth Ministry"],
    "bio": "Passionate about worship and serving the community",
    "createdAt": "2026-01-15T...",
    "updatedAt": "2026-04-09T..."
  },
  "engagement": { ... },
  "giving": { ... },
  "onboarding": { ... },
  "family": [ ... ],
  ...
}
```

If the member has no journey record, `journey` will be `null`.

### Update Journey

```
PUT /api/members/:userId/journey
```

All fields are optional — only send what you're changing. The backend upserts (creates if missing, updates if exists).

```json
{
  "attendedMembersClass": true,
  "membersClassDate": "2026-02-10",
  "isBaptized": true,
  "baptismDate": "2026-03-01",
  "salvationDate": "2020-06-15",
  "discipleshipTrack": "growth",
  "skills": ["Music/Singing", "Teaching"],
  "interests": ["Worship/Music", "Youth Ministry"],
  "bio": "Passionate about worship"
}
```

**Response:** Returns the full updated journey object.

---

## Field Reference

### Milestone Toggles

| Field | Type | Description | UI Element |
|-------|------|-------------|------------|
| `attendedMembersClass` | boolean | Has the member completed the new members class? | Toggle/checkbox |
| `membersClassDate` | string (ISO date) | Date they completed the class. Show only when `attendedMembersClass` is true. | Date picker |
| `isBaptized` | boolean | Has the member been baptized? | Toggle/checkbox |
| `baptismDate` | string (ISO date) | Date of baptism. Show only when `isBaptized` is true. | Date picker |
| `salvationDate` | string (ISO date) | Date they accepted Christ (approximate is fine). | Date picker |

### Discipleship Track

| Field | Type | Values | Description |
|-------|------|--------|-------------|
| `discipleshipTrack` | string | `not_started`, `foundations`, `growth`, `leadership`, `completed` | Where the member is in their discipleship journey |

**Display as a progress stepper or dropdown:**

```
○ Not Started  →  ● Foundations  →  ● Growth  →  ○ Leadership  →  ○ Completed
```

| Value | Label | Description |
|-------|-------|-------------|
| `not_started` | Not Started | New member, hasn't begun discipleship |
| `foundations` | Foundations | Learning the basics of faith |
| `growth` | Growth | Deepening faith, regular attendance |
| `leadership` | Leadership | Ready to serve and lead |
| `completed` | Completed | Graduated the discipleship program |

### Skills & Interests (Multi-select)

| Field | Type | Description |
|-------|------|-------------|
| `skills` | string[] | What the member can do (professional/personal talents) |
| `interests` | string[] | What ministry areas they're drawn to |

**Skills options** (use as checkboxes or multi-select chips):
- Music/Singing
- Musical Instrument
- Teaching
- Counseling
- IT/Technology
- Graphic Design
- Video/Photography
- Writing
- Cooking/Baking
- Construction/Handyman
- Medical/Nursing
- Legal
- Financial/Accounting
- Event Planning
- Public Speaking
- Languages/Translation

**Interests options:**
- Worship/Music
- Youth Ministry
- Children's Ministry
- Small Groups
- Outreach/Missions
- Prayer Ministry
- Media/Tech
- Hospitality/Greeting
- Teaching/Bible Study
- Counseling/Care
- Administration
- Men's Ministry
- Women's Ministry
- Senior's Ministry
- Food/Kitchen
- Maintenance/Facilities

These are the same options from the onboarding field library. If the member filled out an onboarding form, these may already be populated.

### Bio

| Field | Type | Description |
|-------|------|-------------|
| `bio` | string | Free-text bio or notes about the member's faith journey |

---

## Recommended UI — Journey Tab on Member Profile

```
┌─────────────────────────────────────────────────────────────┐
│  Spiritual Journey                               [Edit ✏]  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Discipleship Track                                         │
│  ● Not Started  →  ● Foundations  →  ◉ Growth  →  ○ Leadership  →  ○ Completed │
│                                                             │
│  Milestones                                                 │
│  ┌──────────────────────┐  ┌──────────────────────┐        │
│  │ ✅ Salvation          │  │ ✅ Baptized           │        │
│  │ June 15, 2020        │  │ March 1, 2026        │        │
│  └──────────────────────┘  └──────────────────────┘        │
│  ┌──────────────────────┐                                   │
│  │ ✅ Members Class      │                                   │
│  │ February 10, 2026    │                                   │
│  └──────────────────────┘                                   │
│                                                             │
│  Skills                                                     │
│  [Music/Singing] [Teaching]                                 │
│                                                             │
│  Interests                                                  │
│  [Worship/Music] [Youth Ministry]                           │
│                                                             │
│  Bio                                                        │
│  "Passionate about worship and serving the community"       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Edit Mode

When the admin clicks "Edit", the section becomes editable:

```
┌─────────────────────────────────────────────────────────────┐
│  Edit Spiritual Journey                    [Save] [Cancel]  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Discipleship Track:  [Growth           ▾]                  │
│                                                             │
│  ☑ Accepted Christ    Date: [2020-06-15    ]                │
│  ☑ Baptized           Date: [2026-03-01    ]                │
│  ☑ Members Class      Date: [2026-02-10    ]                │
│                                                             │
│  Skills (select all that apply):                            │
│  ☑ Music/Singing  ☑ Teaching  ☐ Counseling  ☐ IT/Tech      │
│  ☐ Graphic Design  ☐ Video  ☐ Writing  ☐ Cooking           │
│  ☐ Construction  ☐ Medical  ☐ Legal  ☐ Financial            │
│  ☐ Event Planning  ☐ Public Speaking  ☐ Languages           │
│                                                             │
│  Interests (select all that apply):                         │
│  ☑ Worship/Music  ☑ Youth Ministry  ☐ Children's Ministry   │
│  ☐ Small Groups  ☐ Outreach/Missions  ☐ Prayer Ministry    │
│  ☐ Media/Tech  ☐ Hospitality  ☐ Teaching/Bible Study       │
│  ☐ Counseling/Care  ☐ Administration  ☐ Men's Ministry     │
│  ☐ Women's Ministry  ☐ Senior's Ministry  ☐ Food/Kitchen   │
│  ☐ Maintenance/Facilities                                  │
│                                                             │
│  Bio:                                                       │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ Passionate about worship and serving the community     │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Save Example

```typescript
// Only send changed fields
const response = await api.put(`/members/${userId}/journey`, {
  discipleshipTrack: 'leadership',
  skills: ['Music/Singing', 'Teaching', 'Public Speaking'],
});
// response = full updated journey object
```

---

## Discipleship Funnel Report Integration

The journey data feeds directly into `GET /api/reports/funnel`, which returns:

```json
{
  "visitors": 89,
  "regular": 187,
  "members": 156,
  "leaders": 23
}
```

The `discipleshipTrack` values map to funnel stages. When an admin updates a member's track from "growth" to "leadership", the funnel report automatically reflects the change.

---

## Auto-Population from Onboarding

If the member filled out an onboarding form during signup, these journey fields are auto-populated:

| Onboarding Field | Journey Field |
|-----------------|---------------|
| `is_saved` = true | `salvationDate` = signup date |
| `salvation_date` | `salvationDate` |
| `is_baptized` | `isBaptized` |
| `baptism_date` | `baptismDate` |
| `interests` | `interests` |
| `skills` | `skills` |
| `faith_journey` | `discipleshipTrack` (mapped: "Just exploring"→"not_started", "New believer"→"foundations", "Growing in faith"→"growth", "Mature believer"→"leadership", "Ready to lead/serve"→"leadership") |

The admin can override any auto-populated values by editing the journey.

---

## Quick Checklist

- [ ] Show `journey` data on the member profile page (read from `GET /members/:userId/profile`)
- [ ] Handle `journey: null` — show "No journey data yet" with an "Initialize" button
- [ ] Build the milestone cards (salvation, baptism, members class) with toggle + date
- [ ] Build discipleship track stepper/dropdown with 5 stages
- [ ] Build skills and interests multi-select using the option lists above
- [ ] Build bio text area
- [ ] Wire "Save" to `PUT /members/:userId/journey` — send only changed fields
- [ ] Show success toast on save
