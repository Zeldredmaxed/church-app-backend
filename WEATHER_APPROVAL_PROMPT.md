# Backend Update: Weather Check + Pastor Approval Gate Workflow Nodes

> **Date:** April 9, 2026
> **From:** Backend Team
> **For:** Admin Dashboard Team (Next.js) + Mobile App Team (React Native)

---

## What Was Added

Two new workflow node types that work together to let pastors automate weather-based decisions with a human approval step.

1. **Weather Check** — a condition node that fetches live weather and branches the workflow based on temperature or conditions
2. **Pastor Approval Gate** — a delay node that pauses a workflow, notifies the pastor via notification/email/SMS, and waits for them to approve or deny before continuing

---

## Admin Dashboard — What You Need to Build

### 1. Add Weather Check to the Workflow Builder Palette

This is a **condition node** (same category as "Has Tag?", "Attendance Check", etc.). It goes in the amber/yellow section of the node palette.

**Node metadata from `GET /api/workflows/node-types`:**

```json
{
  "type": "weather_check",
  "category": "condition",
  "label": "Weather Check",
  "description": "Branch based on current weather (temperature, conditions). Uses church location.",
  "icon": "CloudSun",
  "color": "amber",
  "configFields": [
    { "key": "condition", "label": "Condition", "type": "select", "options": ["temp_above", "temp_below", "temp_between", "is_raining", "is_snowing", "is_stormy"], "required": true },
    { "key": "tempThreshold", "label": "Temperature (F)", "type": "number", "required": false, "placeholder": "95" },
    { "key": "tempMin", "label": "Min Temp (F) — for between", "type": "number", "required": false },
    { "key": "tempMax", "label": "Max Temp (F) — for between", "type": "number", "required": false },
    { "key": "latitude", "label": "Latitude (leave blank for church location)", "type": "number", "required": false },
    { "key": "longitude", "label": "Longitude (leave blank for church location)", "type": "number", "required": false }
  ]
}
```

**Config panel UI when the pastor clicks this node:**

```
┌──────────────────────────────────────────────┐
│  ☁ Weather Check                             │
│                                              │
│  Condition:  [temp_above        ▾]           │
│                                              │
│  Temperature (°F):  [95           ]          │
│                                              │
│  ── Advanced (optional) ──                   │
│  Min Temp (for "between"):  [     ]          │
│  Max Temp (for "between"):  [     ]          │
│  Latitude:   [leave blank = church location] │
│  Longitude:  [leave blank = church location] │
│                                              │
│  ℹ Uses your church's geo-location from      │
│    Settings > Check-In Configuration.        │
│    No API key needed.                        │
└──────────────────────────────────────────────┘
```

**Condition options — show human-readable labels:**

| Value | Display Label | When to show temp field |
|-------|--------------|------------------------|
| `temp_above` | Temperature is above | Yes — single threshold |
| `temp_below` | Temperature is below | Yes — single threshold |
| `temp_between` | Temperature is between | Yes — min + max fields |
| `is_raining` | It's raining | No — hide temp fields |
| `is_snowing` | It's snowing | No — hide temp fields |
| `is_stormy` | Thunderstorm/severe weather | No — hide temp fields |

**Branch outputs:** Like all condition nodes, this has a TRUE and FALSE output. Wire them to different downstream actions.

**Execution output (visible in execution logs):**

```json
{
  "tempF": 97.2,
  "weatherCode": 0,
  "isRaining": false,
  "isSnowing": false,
  "isStormy": false,
  "condition": "temp_above",
  "conditionMet": true
}
```

---

### 2. Add Pastor Approval Gate to the Workflow Builder Palette

This is a **delay node** (same category as "Wait", "Wait Until Date", etc.). It goes in the purple section of the node palette.

**Node metadata:**

```json
{
  "type": "approval_gate",
  "category": "delay",
  "label": "Pastor Approval",
  "description": "Pause and ask the pastor to approve before continuing. Sends notification, email, and SMS.",
  "icon": "ShieldCheck",
  "color": "purple",
  "configFields": [
    { "key": "message", "label": "Approval Question", "type": "text", "required": true, "placeholder": "Should we cancel Sunday service due to weather?" },
    { "key": "notifyVia", "label": "Notify Via", "type": "select", "options": ["notification", "email", "sms", "all"], "required": true },
    { "key": "timeoutHours", "label": "Auto-expire after (hours)", "type": "number", "required": false, "placeholder": "24" },
    { "key": "timeoutAction", "label": "If no response", "type": "select", "options": ["continue", "cancel"], "required": false }
  ]
}
```

**Config panel UI:**

```
┌──────────────────────────────────────────────┐
│  🛡 Pastor Approval Gate                     │
│                                              │
│  Approval Question:                          │
│  ┌────────────────────────────────────────┐  │
│  │ Should we cancel Sunday service due    │  │
│  │ to extreme weather?                    │  │
│  └────────────────────────────────────────┘  │
│                                              │
│  Notify Via:  [All (notification + email + SMS) ▾] │
│                                              │
│  Auto-expire after:  [24] hours              │
│                                              │
│  If no response:  [Cancel workflow  ▾]       │
│                                              │
│  ℹ All admins and pastors will be notified.  │
│    The workflow pauses until someone          │
│    approves or denies.                       │
└──────────────────────────────────────────────┘
```

**Important UX note:** Unlike other delay nodes that have a single output, the approval gate only has ONE output (the "continue" path). If denied, the workflow simply cancels — there's no "denied" branch to wire. Make this clear to the pastor in the builder.

---

### 3. Build the Approval Management View

When a workflow hits an approval gate, it pauses. Admins need a way to see pending approvals and act on them.

**Option A — Dedicated "Pending Approvals" section in the Workflows page:**

```
┌──────────────────────────────────────────────────────┐
│  Pending Approvals (2)                               │
├──────────────────────────────────────────────────────┤
│  🛡 Should we cancel Sunday service due to weather?  │
│  Workflow: "Winter Weather Alert"                    │
│  Triggered: 10 minutes ago                           │
│  Expires: in 23 hours                                │
│                                                      │
│  [✓ Approve]    [✗ Deny]                             │
├──────────────────────────────────────────────────────┤
│  🛡 Should we send the new member welcome package?   │
│  Workflow: "New Member Onboarding"                   │
│  Triggered: 2 hours ago                              │
│  Expires: in 22 hours                                │
│                                                      │
│  [✓ Approve]    [✗ Deny]                             │
└──────────────────────────────────────────────────────┘
```

**How to get pending approvals:**

There's no dedicated endpoint — query paused executions and filter for approval gates:

```typescript
// Get all paused executions for this church
const executions = await api.get('/workflows/executions?status=paused');

// Filter for ones with approval pending
const pendingApprovals = executions.filter(
  exec => exec.triggerData?._approval?.pending === true
);
```

Or, look for `workflow_approval` notifications in `GET /api/notifications` — each one contains the `executionId` for the approve/deny buttons.

**Approve:**
```
POST /api/workflows/executions/:executionId/approve
```
Returns: `{ "status": "approved", "message": "Workflow resumed" }`

**Deny:**
```
POST /api/workflows/executions/:executionId/deny
```
Returns: `{ "status": "denied", "message": "Workflow cancelled" }`

Both endpoints require JWT auth. No request body needed.

**Option B — Inline in notifications:**

The approval gate sends a `workflow_approval` notification to all admins. You could render these notifications with approve/deny buttons inline:

```json
{
  "type": "workflow_approval",
  "payload": {
    "title": "Approval Required",
    "body": "Should we cancel Sunday service due to extreme weather?",
    "executionId": "uuid",
    "workflowId": "uuid",
    "message": "Should we cancel Sunday service due to extreme weather?",
    "timeoutAction": "cancel",
    "expiresAt": "2026-04-10T06:00:00Z"
  }
}
```

When the admin clicks Approve/Deny in the notification, call the corresponding endpoint.

---

### 4. Show Weather Data in Execution Logs

When viewing a workflow execution's step-by-step log, the weather check node output should display nicely:

```
Step 3: Weather Check — ✓ Condition Met (TRUE branch)
  Current Temperature: 97.2°F
  Condition: Temperature above 95°F
  Raining: No | Snowing: No | Stormy: No
```

The execution log entry for a weather check:
```json
{
  "nodeId": "uuid",
  "status": "success",
  "outputData": {
    "tempF": 97.2,
    "weatherCode": 0,
    "isRaining": false,
    "isSnowing": false,
    "isStormy": false,
    "condition": "temp_above",
    "conditionMet": true
  }
}
```

---

## Mobile App — What You Need to Build

### 1. Approval Notification with Action Buttons

When a workflow hits an approval gate, all admins/pastors receive a notification of type `workflow_approval`. The mobile app needs to render this with approve/deny action buttons.

**Notification payload:**

```json
{
  "type": "workflow_approval",
  "payload": {
    "title": "Approval Required",
    "body": "Should we cancel Sunday service due to extreme weather?",
    "executionId": "exec-uuid",
    "workflowId": "workflow-uuid",
    "message": "Should we cancel Sunday service due to extreme weather?",
    "timeoutAction": "cancel",
    "expiresAt": "2026-04-10T06:00:00Z"
  }
}
```

**Render in the notification list:**

```
┌──────────────────────────────────────────┐
│  🛡 Approval Required                    │
│                                          │
│  Should we cancel Sunday service due     │
│  to extreme weather?                     │
│                                          │
│  Expires in 23 hours                     │
│                                          │
│  [✓ Approve]        [✗ Deny]             │
└──────────────────────────────────────────┘
```

**When the pastor taps Approve:**
```typescript
await api.post(`/workflows/executions/${payload.executionId}/approve`);
// Response: { "status": "approved", "message": "Workflow resumed" }
Alert.alert('Approved', 'The workflow will continue.');
```

**When the pastor taps Deny:**
```typescript
await api.post(`/workflows/executions/${payload.executionId}/deny`);
// Response: { "status": "denied", "message": "Workflow cancelled" }
Alert.alert('Denied', 'The workflow has been cancelled.');
```

**After action:** Mark the notification as read and remove the action buttons (show "Approved" or "Denied" badge instead).

**Edge cases:**
- If the approval has already been acted on by another admin (from the dashboard), the endpoint returns `{ "error": "Execution not found or not awaiting approval" }`. Show: "This approval has already been handled."
- If the approval expired, same response. Show: "This approval has expired."
- Check `expiresAt` — if past, grey out the buttons and show "Expired".

### 2. Push Notification (if OneSignal is configured)

If the pastor chose `notifyVia: "all"` or `"notification"`, a push notification will also be sent. Consider making it actionable:

**Push notification content:**
```
Title: "Approval Required"
Body: "Should we cancel Sunday service due to extreme weather?"
```

Tapping the push should deep-link to the notification detail where the approve/deny buttons are.

### 3. SMS and Email

These are handled entirely by the backend — no mobile work needed. The pastor will receive:

**Email:**
```
Subject: "Workflow Approval Required"
Body: "Should we cancel Sunday service due to extreme weather?

This request expires in 24 hours."
```

**SMS:**
```
SHEPARD APPROVAL: Should we cancel Sunday service due to extreme weather? — Expires in 24h
```

The email and SMS don't have approve/deny links (that would require a web portal). They serve as an alert — the pastor then opens the app or dashboard to take action.

---

## Example Workflows Pastors Can Build

### 1. Heat Advisory Alert
```
[Schedule: Every Saturday 6AM]
  → [Weather Check: temp_above 95°F]
    → TRUE:  [Send Push: "Tomorrow's forecast is over 95°F. Stay hydrated and dress cool for service!"]
    → FALSE: (do nothing)
```

### 2. Winter Weather Church Cancellation
```
[Schedule: Every Saturday 8PM]
  → [Weather Check: temp_below 15°F]
    → TRUE:  [Approval Gate: "Cancel Sunday service due to extreme cold?"]
               → (if approved) [Send Push: "Church is cancelled tomorrow due to weather. Stay safe!"]
               → (if denied) workflow ends, church stays open
    → FALSE: [Weather Check: is_stormy]
               → TRUE:  [Approval Gate: "Cancel due to severe storm warning?"]
               → FALSE: (normal weather)
```

### 3. Rainy Day Reminder
```
[Schedule: Every Sunday 6AM]
  → [Weather Check: is_raining]
    → TRUE:  [Send Push: "It's rainy today! Don't forget your umbrella. See you at service! ☔"]
    → FALSE: [Send Push: "Beautiful day for church! See you soon! ☀"]
```

### 4. New Member Approval Flow
```
[Trigger: New Member Joins]
  → [Wait: 1 day]
  → [Approval Gate: "Review new member signup — should we add them to the Welcome Team small group?"]
    → (if approved) [Add to Group: Welcome Team]
                    [Send Email: "Welcome! You've been added to the Welcome Team group."]
    → (if denied) workflow ends
```

---

## Quick Checklist

### Admin Dashboard Team
- [ ] Add `weather_check` to the condition node palette (amber/yellow section)
- [ ] Render config panel: condition dropdown, temperature field, optional lat/lng
- [ ] Conditionally show/hide temp fields based on selected condition
- [ ] Add `approval_gate` to the delay node palette (purple section)
- [ ] Render config panel: message textarea, notify via dropdown, timeout, timeout action
- [ ] Build "Pending Approvals" section (filter paused executions with `_approval.pending`)
- [ ] Wire approve/deny buttons to `POST /workflows/executions/:id/approve` and `/deny`
- [ ] Show weather data nicely in execution log viewer
- [ ] Show approval status in execution log (approved/denied/timed out)

### Mobile App Team
- [ ] Detect `workflow_approval` notification type in notification list
- [ ] Render with approve/deny action buttons + expiration countdown
- [ ] Wire buttons to `POST /workflows/executions/:id/approve` and `/deny`
- [ ] Handle already-acted-on and expired edge cases
- [ ] After action, replace buttons with status badge ("Approved" / "Denied")
- [ ] Deep-link from push notification to the approval notification detail
