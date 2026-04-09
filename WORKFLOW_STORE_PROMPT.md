# Workflow Builder + Marketplace — Admin Dashboard Frontend Prompt

## Overview

The backend has a complete workflow automation engine and marketplace. This document covers everything the admin dashboard frontend needs to build:

1. **Workflow Builder** — drag-and-drop visual editor for creating flows
2. **Workflow Store** — marketplace to browse, buy, and share workflow templates

**Backend API:** `https://church-app-backend-27hc.onrender.com/api`

---

## Part 1: Workflow Builder

### Getting the Node Palette

```
GET /api/workflows/node-types
→ Array of node type definitions
```

Each node type tells the frontend exactly what to render:

```json
{
  "type": "send_email",
  "category": "action",
  "label": "Send Email",
  "description": "Send an email to the member",
  "icon": "Mail",
  "color": "blue",
  "configFields": [
    { "key": "subject", "label": "Subject", "type": "text", "required": true },
    { "key": "body", "label": "Body", "type": "text", "required": true },
    { "key": "templateId", "label": "Or use template", "type": "template", "required": false }
  ]
}
```

### Config Field Type → UI Component Mapping

| `configField.type` | UI Component | Data Source |
|---|---|---|
| `text` | Text input | — |
| `number` | Number input | — |
| `boolean` | Toggle switch | — |
| `date` | Date picker | — |
| `select` | Dropdown (static) | Use `configField.options[]` |
| `tag` | Tag picker dropdown | `GET /api/tags` |
| `group` | Group picker dropdown | `GET /api/groups` |
| `member` | Member search/picker | `GET /api/tenants/{id}/members` |
| `workflow` | Workflow picker | `GET /api/workflows` |
| `template` | Template picker | `GET /api/communications/templates` |
| `badge` | Badge picker | `GET /api/badges` |

### Node Categories (5 colors for the palette)

| Category | Color | Icon Style | Nodes |
|---|---|---|---|
| **Trigger** | Emerald/Green | Circle with lightning | 18 types (entry points) |
| **Action** | Blue | Square with gear | 19 types (do something) |
| **Condition** | Amber/Yellow | Diamond with fork | 10 types (branch logic) |
| **Delay** | Purple | Clock | 3 types (wait) |
| **Filter** | Rose/Red | Funnel | 3 types (stop/continue) |

### Saving a Workflow

```
POST /api/workflows
Content-Type: application/json

{
  "name": "New Member Welcome",
  "description": "Welcomes new members with email and follow-up",
  "triggerType": "new_member",
  "triggerConfig": {},
  "nodes": [
    {
      "id": "node-1",
      "nodeType": "new_member",
      "nodeConfig": {},
      "positionX": 50,
      "positionY": 150,
      "label": "New Member Joins"
    },
    {
      "id": "node-2",
      "nodeType": "send_email",
      "nodeConfig": {
        "subject": "Welcome to our church!",
        "body": "We are so glad you joined us..."
      },
      "positionX": 300,
      "positionY": 150,
      "label": "Welcome Email"
    },
    {
      "id": "node-3",
      "nodeType": "wait_duration",
      "nodeConfig": { "amount": 3, "unit": "days" },
      "positionX": 550,
      "positionY": 150,
      "label": "Wait 3 Days"
    }
  ],
  "connections": [
    { "fromNodeId": "node-1", "toNodeId": "node-2", "branch": "default" },
    { "fromNodeId": "node-2", "toNodeId": "node-3", "branch": "default" }
  ]
}
```

**Node IDs** are client-side temporary IDs (e.g., `node-1`, `node-2`). The backend maps them to real UUIDs on save.

**Connections** use `branch`:
- `"default"` — normal flow
- `"true"` — condition was true
- `"false"` — condition was false

### Loading a Workflow for Editing

```
GET /api/workflows/:id
→ {
    id, name, description, triggerType, triggerConfig, isActive,
    nodes: [{ id, nodeType, nodeConfig, positionX, positionY, label }],
    connections: [{ id, fromNodeId, toNodeId, branch }],
    nodeCount, connectionCount, createdAt
  }
```

### Workflow CRUD

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/workflows` | List all workflows |
| POST | `/api/workflows` | Create |
| GET | `/api/workflows/:id` | Get with nodes + connections |
| PUT | `/api/workflows/:id` | Update (replace nodes/connections) |
| DELETE | `/api/workflows/:id` | Delete |
| PUT | `/api/workflows/:id/toggle` | Enable/disable `{ isActive }` |
| POST | `/api/workflows/:id/trigger` | Test run `{ targetUserId? }` |

### Execution History

```
GET /api/workflows/:id/executions?limit=20&cursor=...
→ { data: [{ id, status, targetUserId, startedAt, completedAt }], nextCursor }
```

```
GET /api/workflows/executions/:executionId
→ { ...execution, logs: [{ nodeId, nodeType, nodeLabel, status, error, executedAt }] }
```

### Tier Limits

| Tier | Max Workflows | Max Nodes | AI Generation |
|---|---|---|---|
| Standard | 1 | 5 | No |
| Premium | 1 | 5 | No |
| Enterprise | Unlimited | Unlimited | Yes |

Show an upgrade prompt when limits are hit. Everyone can use the builder.

### AI Generation (Enterprise)

```
POST /api/workflows/generate
{ "prompt": "Create a welcome flow that emails new members, waits 3 days, then texts a follow-up" }

→ {
    "message": "Workflow generated successfully.",
    "suggestedWorkflow": {
      "name": "...",
      "triggerType": "new_member",
      "nodes": [...],
      "connections": [...]
    }
  }
```

Load the response into the builder canvas for review before saving.

---

## Part 2: Workflow Store (Marketplace)

### Browse Templates (Public, No Auth)

```
GET /api/workflow-store?category=onboarding&sort=popular&search=welcome
→ [
    {
      "id": "uuid",
      "name": "New Member Welcome Flow",
      "description": "Automatically welcomes new members...",
      "category": "onboarding",
      "tags": ["new-member", "email", "sms"],
      "triggerType": "new_member",
      "priceCents": 200,
      "isOfficial": true,
      "installCount": 47,
      "avgRating": 4.8,
      "ratingCount": 12,
      "publisherName": "Shepard Official"
    }
  ]
```

**Sort options:** `popular`, `newest`, `rating`, `price_low`, `price_high`

**Categories:**
```
GET /api/workflow-store/categories
→ ["general", "onboarding", "engagement", "giving", "care", "events", "volunteers", "communications", "reports", "spiritual_growth"]
```

### Template Detail

```
GET /api/workflow-store/:id
→ {
    ...template,
    nodes: [...],          // Full node definitions
    connections: [...],    // Full connection graph
  }
```

Use this to render a read-only preview of the workflow in the builder canvas.

### Install a Template

```
POST /api/workflow-store/:id/install
Authorization: Bearer <token>

→ {
    "templateId": "uuid",
    "workflowId": "uuid",   // The new workflow created in your church
    "message": "Template installed successfully"
  }
```

This copies the template into the church's workflows. They can then edit it.

### Rate a Template

```
POST /api/workflow-store/:id/rate
Authorization: Bearer <token>

{ "rating": 5, "review": "Great flow, saved us hours of setup!" }
```

### Publish Your Own

```
POST /api/workflow-store/publish
Authorization: Bearer <token>

{
  "name": "Our Custom Welcome Flow",
  "description": "How Grace Church welcomes new members...",
  "category": "onboarding",
  "tags": ["custom", "welcome"],
  "priceCents": 500,
  "workflowId": "uuid-of-existing-workflow"
}
```

### My Templates

```
GET /api/workflow-store/my/published    → templates I've published
GET /api/workflow-store/my/installed    → templates I've bought/installed
```

### Seed Official Templates (call once)

```
POST /api/workflow-store/seed-official
```

Seeds the 22 official Shepard templates. Idempotent — safe to call multiple times.

---

## Part 3: UI Layout Suggestions

### Workflow Builder Page (`/workflows`)

```
┌─────────────────────────────────────────────────────────┐
│ Workflows                            [+ New] [Store 🏪] │
├─────────────────────────────────────────────────────────┤
│ ┌─────────┐ ┌─────────┐ ┌─────────┐                    │
│ │ Welcome │ │ Inactive│ │ Giving  │  ... workflow cards  │
│ │ Flow    │ │ Alert   │ │ Thanks  │                      │
│ │ ✅ Active│ │ ⏸ Off  │ │ ✅ Active│                     │
│ └─────────┘ └─────────┘ └─────────┘                    │
└─────────────────────────────────────────────────────────┘
```

### Workflow Editor (full-screen builder)

```
┌──────────────────────────────────────────────────────────┐
│ ← Back  │ Welcome Flow        │ [Test ▶] [Save] [Toggle]│
├──────────┬───────────────────────────────────────────────┤
│ PALETTE  │                                               │
│          │     ┌──────┐    ┌──────┐    ┌──────┐         │
│ Triggers │     │ New  │───→│ Send │───→│ Wait │         │
│ ▸ New    │     │Member│    │Email │    │3 days│         │
│ ▸ Check  │     └──────┘    └──────┘    └──┬───┘         │
│          │                                 │             │
│ Actions  │                           ┌────┴────┐        │
│ ▸ Email  │                           │ Check   │        │
│ ▸ SMS    │                           │Attended?│        │
│ ▸ Push   │                           └──┬──┬──┘        │
│ ▸ Tag    │                         Yes  │  │  No       │
│          │                      ┌───────┘  └───────┐    │
│ Conditns │                      │ Assign  │ │Create │    │
│ ▸ Has Tag│                      │"Active" │ │Care   │    │
│ ▸ Attend │                      │  Tag    │ │Case   │    │
│          │                      └─────────┘ └───────┘    │
│ Delays   │                                               │
│ ▸ Wait   │                                               │
│          │                                               │
│ Filters  │                                               │
│ ▸ By Tag │                                               │
├──────────┴───────────────────────────────────────────────┤
│ Execution History: 12 runs │ 10 completed │ 1 failed    │
└──────────────────────────────────────────────────────────┘
```

### Workflow Store Page

```
┌──────────────────────────────────────────────────────────┐
│ Workflow Store                    🔍 Search...           │
├──────────┬───────────────────────────────────────────────┤
│ Filters  │                                               │
│          │ ┌──────────────┐ ┌──────────────┐            │
│ Category │ │ New Member   │ │ Inactive     │            │
│ ○ All    │ │ Welcome Flow │ │ Member Alert │            │
│ ● Onboard│ │              │ │              │            │
│ ○ Engage │ │ ⭐ 4.8 (12)  │ │ ⭐ 4.5 (8)   │            │
│ ○ Giving │ │ 47 installs  │ │ 31 installs  │            │
│ ○ Care   │ │              │ │              │            │
│ ○ Events │ │ $2.00  [Get] │ │ $2.00  [Get] │            │
│          │ │ 🏅 Official   │ │ 🏅 Official   │            │
│ Price    │ └──────────────┘ └──────────────┘            │
│ ○ All    │                                               │
│ ○ Free   │ ┌──────────────┐ ┌──────────────┐            │
│ ○ Paid   │ │ Grace Church │ │ Birthday     │            │
│          │ │ Welcome v2   │ │ Greeting     │            │
│ Sort By  │ │              │ │              │            │
│ Popular ▾│ │ ⭐ 4.2 (3)   │ │ ⭐ 5.0 (1)   │            │
│          │ │ 5 installs   │ │ FREE   [Get] │            │
│          │ │ $5.00  [Get] │ │ 🏅 Official   │            │
│          │ └──────────────┘ └──────────────┘            │
└──────────┴───────────────────────────────────────────────┘
```

### Template Detail Modal

When clicking a template card:
- Show workflow name, description, tags
- Read-only preview of the workflow graph (use the same builder canvas, just non-interactive)
- Rating stars + review count
- Install count
- Price + "Install" button
- Publisher name (or "Shepard Official")
- List of node types used in this workflow

---

## Part 4: Complete API Reference

### Workflow Builder

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/workflows/node-types` | Yes | Node palette data |
| GET | `/workflows` | Yes | List my workflows |
| POST | `/workflows` | Yes | Create workflow |
| GET | `/workflows/:id` | Yes | Full workflow + nodes |
| PUT | `/workflows/:id` | Yes | Update workflow |
| DELETE | `/workflows/:id` | Yes | Delete workflow |
| PUT | `/workflows/:id/toggle` | Yes | Enable/disable |
| POST | `/workflows/:id/trigger` | Yes | Manual test run |
| GET | `/workflows/:id/executions` | Yes | Execution history |
| GET | `/workflows/executions/:id` | Yes | Execution detail + logs |
| POST | `/workflows/executions/:id/cancel` | Yes | Cancel execution |
| POST | `/workflows/generate` | Yes | AI generate (Enterprise) |

### Workflow Store

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/workflow-store` | No | Browse templates |
| GET | `/workflow-store/categories` | No | List categories |
| GET | `/workflow-store/:id` | No | Template detail |
| POST | `/workflow-store/publish` | Yes | Publish your workflow |
| DELETE | `/workflow-store/:id/unpublish` | Yes | Remove listing |
| POST | `/workflow-store/:id/install` | Yes | Buy/install template |
| POST | `/workflow-store/:id/rate` | Yes | Rate + review |
| GET | `/workflow-store/my/published` | Yes | My published templates |
| GET | `/workflow-store/my/installed` | Yes | My installed templates |
| POST | `/workflow-store/seed-official` | No | Seed 22 official templates |

### Inbound Webhooks

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/webhooks/workflows/:workflowId` | No | Receive external webhook |

---

## Part 5: Key Implementation Notes

### Connection Rendering
- Default connections: straight or bezier curves
- Condition branches: draw two lines from the condition node
  - "True" branch (green/right) goes to the success path
  - "False" branch (red/down) goes to the failure path
- Use the `branch` field to determine which output port to connect from

### Node Positioning
- Nodes are positioned absolutely using `positionX` and `positionY`
- Default spacing: 250px horizontal between nodes
- Condition branches: offset Y by ±100px for true/false paths
- Drag to reposition — send updated positions on save

### The framer-motion component you already have
The n8n-workflow-block component you shared is a great starting point. Extend it:
- Replace the hardcoded node templates with data from `GET /api/workflows/node-types`
- Add a left sidebar palette grouped by category
- Add node config panels (click a node → show its configFields as a form)
- Add connection drawing between nodes
- Add the save/load/test/toggle toolbar
