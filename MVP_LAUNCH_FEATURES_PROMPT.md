# MVP Launch Features — New Backend Endpoints for Frontend Teams

> **Date:** April 10, 2026
> **From:** Backend Team
> **For:** Admin Dashboard (Next.js) + Mobile App (React Native)
> **Priority:** These are launch-critical features. Integrate before MVP release.

---

## 1. Cash/Check Batch Entry (Admin Dashboard Only)

Churches receive 30-60% of donations via cash and check envelopes. Admins need to record these manually after each service.

### POST /api/giving/batch — Record a batch of offline donations

```json
// Request
{
  "name": "Sunday 4/13 Morning Service",
  "items": [
    { "donorId": "uuid", "amount": 100.00, "method": "check", "checkNumber": "1042", "fundId": "uuid", "notes": "Tithe" },
    { "donorId": "uuid", "amount": 50.00, "method": "cash", "fundId": "uuid" },
    { "amount": 20.00, "method": "cash" }
  ]
}
```

- `donorId` is optional — omit for anonymous cash
- `method`: `cash` or `check`
- `checkNumber`: optional, for check entries
- `fundId`: optional — defaults to general fund
- `date`: optional ISO date — defaults to today

```json
// Response 201
{
  "batchId": "uuid",
  "name": "Sunday 4/13 Morning Service",
  "totalAmount": 170.00,
  "itemCount": 3,
  "status": "committed",
  "createdAt": "2026-04-13T..."
}
```

### GET /api/giving/batches — List past batches (audit trail)

```json
{
  "batches": [
    {
      "id": "uuid",
      "name": "Sunday 4/13 Morning Service",
      "totalAmount": 170.00,
      "itemCount": 3,
      "status": "committed",
      "createdByName": "Marcus Johnson",
      "committedAt": "2026-04-13T...",
      "createdAt": "2026-04-13T..."
    }
  ]
}
```

### Recommended UI

```
┌──────────────────────────────────────────────────┐
│  Record Offline Donations                        │
│                                                  │
│  Batch Name: [Sunday 4/13 Morning Service    ]   │
│                                                  │
│  ┌──────────┬─────────┬────────┬──────┬───────┐ │
│  │ Donor    │ Amount  │ Method │ Fund │ Check#│ │
│  ├──────────┼─────────┼────────┼──────┼───────┤ │
│  │ [Search] │ [$100]  │ [Check]│ [Gen]│ [1042]│ │
│  │ [Search] │ [$50]   │ [Cash] │ [Gen]│       │ │
│  │ Anonymous│ [$20]   │ [Cash] │      │       │ │
│  │          │         │        │      │ [+Add]│ │
│  └──────────┴─────────┴────────┴──────┴───────┘ │
│                                                  │
│  Total: $170.00 (3 items)                        │
│                                                  │
│  [Submit Batch]                                  │
└──────────────────────────────────────────────────┘
```

---

## 2. Tax-Ready Giving Statements (Admin Dashboard Only)

IRS requires annual contribution statements for tax deductions. Admins generate these per donor.

### GET /api/giving/statements/:userId?year=2025

```json
{
  "churchName": "New Birth Test",
  "year": 2025,
  "donor": {
    "fullName": "Marcus Johnson",
    "email": "marcus.johnson@demo.shepard.app"
  },
  "donations": [
    { "date": "2025-01-15T...", "amount": 500.00, "currency": "usd", "fundName": "General Fund", "method": "online" },
    { "date": "2025-02-10T...", "amount": 500.00, "currency": "usd", "fundName": "General Fund", "method": "check" }
  ],
  "totalAmount": 6000.00,
  "donationCount": 12,
  "byFund": [
    { "fund": "General Fund", "total": 5400.00 },
    { "fund": "Building Fund", "total": 600.00 }
  ],
  "taxStatement": "No goods or services were provided in exchange for these contributions. New Birth Test is a tax-exempt organization under Section 501(c)(3) of the Internal Revenue Code. Your contributions are tax-deductible to the extent allowed by law."
}
```

### Recommended UI

Build a printable/PDF statement page. The backend returns structured data — render it as:

```
┌───────────────────────────────────────────────┐
│          NEW BIRTH TEST CHURCH                │
│     Annual Contribution Statement             │
│              Year: 2025                       │
│                                               │
│  Donor: Marcus Johnson                        │
│  Email: marcus.johnson@demo.shepard.app       │
│                                               │
│  Date         Amount    Fund         Method   │
│  ──────────   ───────   ──────────   ──────── │
│  01/15/2025   $500.00   General      Online   │
│  02/10/2025   $500.00   General      Check    │
│  ...          ...       ...          ...      │
│                                               │
│  TOTAL: $6,000.00 (12 contributions)          │
│                                               │
│  By Fund:                                     │
│    General Fund: $5,400.00                    │
│    Building Fund: $600.00                     │
│                                               │
│  ─────────────────────────────────────────    │
│  No goods or services were provided in        │
│  exchange for these contributions. New Birth  │
│  Test is a tax-exempt organization under      │
│  Section 501(c)(3)...                         │
│                                               │
│  [Print]  [Download PDF]                      │
└───────────────────────────────────────────────┘
```

Use `window.print()` or a library like `react-to-print` for the Print button. For PDF, use `html2pdf.js` or similar client-side library.

---

## 3. Child Check-in Safety (Both Teams)

Secure check-in for children's ministry with security codes, guardian linking, and medical alerts.

### POST /api/checkin/child — Check in a child

```json
// Request
{
  "childId": "uuid",         // optional if child has a user account
  "childName": "Timmy Johnson",  // for children without accounts
  "guardianId": "uuid",      // required — the parent checking them in
  "serviceId": "uuid"        // optional
}

// Response 201
{
  "checkInId": "uuid",
  "securityCode": "4821",
  "checkedInAt": "2026-04-13T09:15:00Z",
  "childName": "Timmy Johnson",
  "childId": "uuid",
  "guardianId": "uuid",
  "medicalAlerts": [
    { "id": "uuid", "type": "allergy", "description": "Peanut allergy - severe", "severity": "critical" },
    { "id": "uuid", "type": "medical", "description": "Asthma - has inhaler in bag", "severity": "high" }
  ],
  "labelData": {
    "childName": "Timmy Johnson",
    "securityCode": "4821",
    "serviceName": null,
    "checkedInAt": "2026-04-13T09:15:00Z",
    "hasAlerts": true,
    "alertCount": 2
  }
}
```

**The `securityCode` is the 4-digit number printed on both the child's name tag and the guardian's pickup slip. They must match for pickup.**

**The `labelData` object contains everything needed to print a thermal label.**

### GET /api/checkin/child/:securityCode/verify — Verify pickup

```json
// GET /api/checkin/child/4821/verify

// Valid code
{
  "valid": true,
  "childName": "Timmy Johnson",
  "guardianName": "Marcus Johnson",
  "checkedInAt": "2026-04-13T09:15:00Z",
  "authorizedPickups": [
    { "name": "Marcus Johnson", "relationship": "Guardian (checked in)" },
    { "name": "Sarah Williams", "relationship": "Mother" },
    { "name": "Robert Anderson", "relationship": "Grandfather" }
  ]
}

// Invalid code
{ "valid": false, "message": "Invalid security code or no check-in found for today" }
```

### Medical Alerts CRUD

```
GET    /api/members/:userId/medical-alerts     — List alerts
POST   /api/members/:userId/medical-alerts     — Add alert
DELETE /api/members/:userId/medical-alerts/:id  — Remove alert
```

**POST body:**
```json
{
  "alertType": "allergy",       // allergy | medical | dietary | behavioral | other
  "description": "Peanut allergy - carry EpiPen",
  "severity": "critical"        // low | medium | high | critical
}
```

### Recommended UI — Admin Dashboard

**Check-in Kiosk View:**
```
┌──────────────────────────────────────────────┐
│  Children's Check-In                         │
│                                              │
│  Parent: [Search member...          ]        │
│                                              │
│  Children:                                   │
│  ┌────────────────────────────────────────┐  │
│  │ ☑ Timmy Johnson (age 5)               │  │
│  │   ⚠ ALLERGY: Peanut (CRITICAL)       │  │
│  │   ⚠ MEDICAL: Asthma - inhaler in bag │  │
│  ├────────────────────────────────────────┤  │
│  │ ☑ Megan Johnson (age 3)               │  │
│  │   No medical alerts                   │  │
│  └────────────────────────────────────────┘  │
│                                              │
│  Service: [Sunday Morning Worship  ▾]        │
│                                              │
│  [Check In Selected Children]                │
│                                              │
│  ── After check-in: ──                       │
│  Security Code: 4821                         │
│  [Print Name Tag]  [Print Pickup Slip]       │
└──────────────────────────────────────────────┘
```

**Label data for thermal printer (child name tag):**
```
┌─────────────────────────────┐
│  TIMMY JOHNSON              │
│  Service: Sunday Morning    │
│  Room: Children's Wing      │
│  ─────────────────────────  │
│  CODE: 4821                 │
│  ⚠ ALLERGY ALERT            │
│  9:15 AM  4/13/2026         │
└─────────────────────────────┘
```

**Label data for parent pickup slip:**
```
┌─────────────────────────────┐
│  PICKUP SLIP                │
│  Child: Timmy Johnson       │
│  CODE: 4821                 │
│  Present this slip to       │
│  pick up your child.        │
└─────────────────────────────┘
```

### Mobile App — Pickup Verification

Children's ministry volunteers use their phone to verify pickups:

```
┌──────────────────────────────────┐
│  Verify Pickup                   │
│                                  │
│  Security Code: [4][8][2][1]     │
│                                  │
│  [Verify]                        │
│                                  │
│  ── Result: ──                   │
│  ✅ VERIFIED                      │
│  Child: Timmy Johnson            │
│  Checked in by: Marcus Johnson   │
│                                  │
│  Authorized Pickups:             │
│  • Marcus Johnson (Guardian)     │
│  • Sarah Williams (Mother)       │
│  • Robert Anderson (Grandfather) │
│                                  │
│  ⚠ MEDICAL ALERTS:              │
│  • Peanut allergy (CRITICAL)     │
│  • Asthma - inhaler in bag       │
└──────────────────────────────────┘
```

---

## 4. Apple Pay / Google Pay (Both Teams)

**Backend change:** Already done. PaymentIntents now use `automatic_payment_methods: { enabled: true }` which enables card, Apple Pay, Google Pay, and Link automatically.

**Frontend change:** If you're using Stripe Elements `<PaymentElement>`, it automatically shows Apple Pay / Google Pay buttons when available on the device. No code change needed — it just works.

If you're using the older `<CardElement>`, switch to `<PaymentElement>` to get wallet support.

---

## 5. iCal Calendar Feed (Admin Dashboard)

Members can subscribe to church events in Google Calendar / Apple Calendar.

### GET /api/events/ical/:tenantId — Public iCal feed (no auth)

Returns a `.ics` file with `Content-Type: text/calendar`.

**How to use in the dashboard:**

Show a "Subscribe to Calendar" button that copies the URL:

```
Calendar Subscription URL:
https://your-render-domain.onrender.com/api/events/ical/6cfdebb0-29cc-42aa-96fc-44e21b2a9c71

[Copy URL]  [Open in Google Calendar]
```

The "Open in Google Calendar" link:
```
https://calendar.google.com/calendar/r?cid=https://your-render-domain.onrender.com/api/events/ical/TENANT_ID
```

---

## 6. CSV Member Import (Admin Dashboard Only)

Churches switching from another system need to import their existing member list.

### POST /api/tenants/:tenantId/members/import

```json
// Request
{
  "members": [
    { "email": "john@example.com", "fullName": "John Smith", "phone": "+15551234567", "role": "member" },
    { "email": "jane@example.com", "fullName": "Jane Doe", "role": "member" },
    { "email": "pastor@example.com", "fullName": "Pastor Dave", "role": "pastor" }
  ]
}

// Response 200
{
  "created": 2,
  "skipped": 1,
  "total": 3,
  "errors": ["jane@example.com: already exists"]
}
```

**Recommended UI:**

```
┌───────────────────────────────────────────────┐
│  Import Members                               │
│                                               │
│  Upload a CSV file with member information.   │
│                                               │
│  [Choose CSV File]  members.csv (245 rows)    │
│                                               │
│  Column Mapping:                              │
│  Email:     [Column B ▾]  (required)          │
│  Full Name: [Column A ▾]                      │
│  Phone:     [Column C ▾]                      │
│  Role:      [Column D ▾]  (default: member)   │
│                                               │
│  Preview (first 5 rows):                      │
│  ┌────────────────────────┬─────────────────┐ │
│  │ john@example.com       │ John Smith      │ │
│  │ jane@example.com       │ Jane Doe        │ │
│  │ ...                    │ ...             │ │
│  └────────────────────────┴─────────────────┘ │
│                                               │
│  [Import 245 Members]                         │
└───────────────────────────────────────────────┘
```

Parse the CSV client-side (use `papaparse`), map columns, then POST the array to the backend.

---

## New Endpoints Summary

| Method | Path | Auth | Feature |
|--------|------|------|---------|
| POST | `/giving/batch` | JWT | Record cash/check batch |
| GET | `/giving/batches` | JWT | List past batches |
| GET | `/giving/statements/:userId?year=` | JWT | Generate giving statement |
| POST | `/checkin/child` | JWT | Check in child with security code |
| GET | `/checkin/child/:code/verify` | JWT | Verify pickup code |
| GET | `/members/:userId/medical-alerts` | JWT | List medical alerts |
| POST | `/members/:userId/medical-alerts` | JWT | Add medical alert |
| DELETE | `/members/:userId/medical-alerts/:id` | JWT | Remove alert |
| GET | `/events/ical/:tenantId` | PUBLIC | iCal calendar feed |
| POST | `/tenants/:tenantId/members/import` | JWT | CSV member import |

---

## Checklist

### Admin Dashboard
- [ ] Build batch entry form for cash/check donations
- [ ] Build giving statement viewer with print/PDF
- [ ] Build children's check-in kiosk view with security codes
- [ ] Build medical alerts management on member profile
- [ ] Add "Subscribe to Calendar" button with iCal URL
- [ ] Build CSV import UI with column mapping
- [ ] Apple Pay / Google Pay: switch to `<PaymentElement>` if using `<CardElement>`

### Mobile App
- [ ] Build pickup verification screen (enter code → see child info + authorized pickups)
- [ ] Show medical alerts on child profiles
- [ ] Apple Pay / Google Pay: `<PaymentElement>` handles this automatically
