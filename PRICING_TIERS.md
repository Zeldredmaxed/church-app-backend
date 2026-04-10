# Shepard — Pricing Tiers & Feature Breakdown

> **For:** Admin Dashboard Team (Next.js) + Mobile App Team (React Native)
> **Purpose:** Use this to build the pricing/plans page. Every feature in the platform is listed below with its tier.
> **Backend enforcement:** Tier gating is enforced server-side. Call `GET /api/tenants/:id/features` on app load to know what to show/hide.

---

## Pricing Overview

| | Standard | Premium | Enterprise |
|---|---|---|---|
| **Price** | $29/mo | $79/mo | $199/mo |
| **Transaction Fee** | 1.3% | 1.0% | 0.5% |
| **Admin Users** | Up to 5 | Unlimited | Unlimited |
| **Storage** | 10 GB | 100 GB | Unlimited |
| **Support** | Email | Priority Email | Dedicated Account Manager |

---

## Standard Plan — $29/month

> Everything a church needs to get started. Core community, giving, events, and member management.

### Community & Social
- Community feed (text + image posts)
- Post likes, comments, and bookmarks
- Comment replies (threaded)
- Stories (24-hour ephemeral content)
- Global feed (cross-church discovery)
- Follow/unfollow members
- Photo gallery
- Announcements (regular + urgent)

### People & Members
- Member directory
- Member profiles (360-degree view with onboarding data, journey, engagement, giving, badges, family)
- Family tree (request/accept with auto-inference for in-laws, shared children, siblings)
- Member tagging system (create tags, assign to members, filter by tag)
- Onboarding forms (custom signup fields from 37-field library + custom fields)
- Onboarding response statistics
- Invitations (email-based church invites)
- Member export (CSV)
- Member KPIs (total, new this month, active)

### Giving & Donations
- Online donations (Stripe Connect)
- Giving funds (general, building, missions, etc.)
- Recurring giving (create, pause, resume, cancel)
- Donor list
- Giving KPIs (total, this month, unique donors)
- Transaction history (member + admin views)
- Stripe Connect onboarding for churches

### Events & Calendar
- Event creation and management (CRUD)
- RSVP system with attendee lists
- Upcoming events widget

### Groups
- Group creation and management
- Group messaging
- Join/leave groups
- Group member lists

### Prayer
- Prayer request wall
- Pray for others (toggle)
- Mark prayers as answered
- Filter: all, mine, answered

### Sermons
- Sermon library (upload audio/video links)
- Series organization
- Featured sermon
- Like and view tracking
- Engagement stats (views, likes)

### Attendance & Check-In
- Service schedule management
- Individual check-in
- Bulk check-in (admin)
- Attendance roster by date
- Visitor tracking
- Attendance KPIs

### Care & Pastoral
- Care case management (create, assign, update, close)
- Care case timeline with notes
- Care case KPIs (new, in progress, resolved)
- Pastor notes on member profiles (private/shared)

### Tasks
- Task management (create, assign, prioritize, due dates)
- Link tasks to care cases, events, or members
- Task KPIs (open, overdue, completed)
- Mark tasks as complete

### Facilities
- Room management
- Room booking with calendar view
- Availability checker (hourly slots)
- Booking approvals

### Volunteers
- Volunteer opportunity listings
- Volunteer signup
- Hour logging
- Schedule view
- Volunteer KPIs

### Notifications
- In-app notifications
- Mark as read

### Moderation
- Post report queue
- Approve/remove reported content

### Feedback
- Submit feedback (feature requests, bug reports, node requests)
- Admin status management

### Admin Dashboard
- KPI dashboard (members, giving, attendance, groups, prayers, volunteers)
- Giving chart (6/12/24 month trends)
- Attendance chart (12-week trend)
- Growth chart (monthly new members)
- Care summary
- Engagement metrics (weekly active with 6-week trend)
- Activity feed (cross-domain)
- Upcoming events widget

### Reports
- Year-over-year giving comparison
- Discipleship funnel
- Engagement score distribution
- Giving by fund breakdown
- YTD report KPIs
- Data export (members, giving, attendance as CSV)

### Leaderboard & Gamification
- Church leaderboard (check-ins, giving, posts)
- Personal rank tracking
- Daily app open tracking
- Opt-in/opt-out visibility
- Admin toggle (enable/disable for church)

### Badges & Achievements
- Badge definitions (admin creates)
- Auto-award badges based on criteria (attendance, giving, milestones)
- Progress tracking with progress bars
- Manual badge award/revoke
- Badge leaderboard

### Onboarding
- Custom signup form builder (37 pre-built fields + custom)
- Auto-populate member journey from responses
- Response statistics and analytics

### Workflows (Limited)
- 1 workflow
- Up to 5 nodes per workflow
- Manual trigger for testing
- Execution history and logs
- Workflow Store browsing (view templates)

---

## Premium Plan — $79/month

> Everything in Standard, plus growth tools for mid-size churches scaling their ministry.

### All Standard Features, plus:

### Video Content
- Video posts in community feed
- Video uploads (direct to S3/Mux)
- Video sermon uploads with Mux transcoding

### Real-Time Chat
- Private channels
- Public channels
- Direct messages (1-on-1)
- Channel member management

### Push Notifications
- Push notification delivery (OneSignal)

### Advanced Search
- Full-text member search
- Post search

### Granular Admin Roles
- Custom permissions per admin (manage_content, manage_members, manage_finance, manage_communications)
- Accountant role, Worship Leader role, etc.

### AI-Powered Shepherd Assistant
- Natural language queries ("Show me members who haven't attended in 30 days")
- Auto-generated reports from plain English
- Smart suggestions
- Powered by Claude AI

### Communications
- Audience segments (rule-based member targeting)
- Segment preview (matched count)
- Message templates
- Send email (via Resend)
- Send SMS (via Twilio)
- Send push notifications
- Schedule messages for later
- Message history
- Communications analytics

### Workflows (Standard)
- 1 workflow (same as Standard limit)
- Up to 5 nodes per workflow
- Install templates from Workflow Store

---

## Enterprise Plan — $199/month

> Everything in Premium, plus unlimited automation, AI workflow generation, and white-label options.

### All Premium Features, plus:

### Unlimited Workflows
- Unlimited workflows
- Unlimited nodes per workflow
- All 48+ node types
- Inbound webhook triggers

### AI Workflow Generation
- Generate workflows from natural language ("When a new member joins, wait 3 days, send a welcome email, assign to a small group")
- Powered by Claude AI

### Workflow Marketplace
- Publish your own workflow templates
- Install community templates
- Rate templates
- 22 official pre-built templates
- Revenue sharing for published templates (future)

### Segmented Push Notifications
- Targeted push to specific audience segments
- Push + email + SMS combined campaigns

### Geo-Fenced Check-In
- GPS-based auto check-in for members
- Configurable church location + radius
- Distance verification
- Admin configuration panel

### Custom Branding
- White-label the mobile app (your church name, logo, colors)
- Remove "Powered by Shepard" branding

### Multi-Site Support
- Manage multiple church locations from one account
- Per-site analytics and member management

### API Access
- REST API access for custom integrations
- Webhook support for external systems

### Unlimited Storage
- No storage cap for media, documents, and uploads

---

## Feature Comparison Table (for the pricing page)

Use this table directly on your pricing page. Checkmarks for included, dashes for not included, and limits where applicable.

| Feature | Standard | Premium | Enterprise |
|---------|----------|---------|------------|
| **Community & Social** | | | |
| Community Feed (text + image) | Yes | Yes | Yes |
| Video Posts | - | Yes | Yes |
| Stories (24h) | Yes | Yes | Yes |
| Comments & Replies | Yes | Yes | Yes |
| Likes & Bookmarks | Yes | Yes | Yes |
| Global Feed | Yes | Yes | Yes |
| Follow System | Yes | Yes | Yes |
| Photo Gallery | Yes | Yes | Yes |
| Announcements | Yes | Yes | Yes |
| **People & Members** | | | |
| Member Directory | Yes | Yes | Yes |
| 360-Degree Member Profiles | Yes | Yes | Yes |
| Family Tree | Yes | Yes | Yes |
| Tags & Segments | Yes | Yes | Yes |
| Custom Onboarding Forms | Yes | Yes | Yes |
| Member Export (CSV) | Yes | Yes | Yes |
| Full-Text Member Search | - | Yes | Yes |
| Granular Admin Permissions | - | Yes | Yes |
| **Giving & Donations** | | | |
| Online Donations (Stripe) | Yes | Yes | Yes |
| Recurring Giving | Yes | Yes | Yes |
| Multiple Giving Funds | Yes | Yes | Yes |
| Giving Reports & KPIs | Yes | Yes | Yes |
| Donor Management | Yes | Yes | Yes |
| Transaction Fee | 1.3% | 1.0% | 0.5% |
| **Events & Groups** | | | |
| Events + RSVP | Yes | Yes | Yes |
| Groups + Messaging | Yes | Yes | Yes |
| **Sermons** | | | |
| Sermon Library | Yes | Yes | Yes |
| Series & Featured | Yes | Yes | Yes |
| Engagement Tracking | Yes | Yes | Yes |
| Video Sermon Upload | - | Yes | Yes |
| **Prayer** | | | |
| Prayer Wall | Yes | Yes | Yes |
| Pray / Answered | Yes | Yes | Yes |
| **Communication** | | | |
| In-App Notifications | Yes | Yes | Yes |
| Push Notifications | - | Yes | Yes |
| Email Campaigns (Resend) | - | Yes | Yes |
| SMS Campaigns (Twilio) | - | Yes | Yes |
| Audience Segments | - | Yes | Yes |
| Scheduled Messages | - | Yes | Yes |
| Segmented Push | - | - | Yes |
| **Real-Time Chat** | | | |
| Private/Public Channels | - | Yes | Yes |
| Direct Messages | - | Yes | Yes |
| **Attendance** | | | |
| Check-In System | Yes | Yes | Yes |
| Bulk Check-In | Yes | Yes | Yes |
| Attendance Roster | Yes | Yes | Yes |
| Visitor Tracking | Yes | Yes | Yes |
| Geo-Fenced Auto Check-In | - | - | Yes |
| **Care & Tasks** | | | |
| Care Case Management | Yes | Yes | Yes |
| Task Management | Yes | Yes | Yes |
| Pastor Notes | Yes | Yes | Yes |
| **Facilities** | | | |
| Room Booking | Yes | Yes | Yes |
| Availability Calendar | Yes | Yes | Yes |
| **Volunteers** | | | |
| Volunteer Management | Yes | Yes | Yes |
| Hour Logging | Yes | Yes | Yes |
| Schedule View | Yes | Yes | Yes |
| **Badges & Leaderboard** | | | |
| Badges & Achievements | Yes | Yes | Yes |
| Auto-Award Rules | Yes | Yes | Yes |
| Progress Tracking | Yes | Yes | Yes |
| Leaderboard | Yes | Yes | Yes |
| **AI Features** | | | |
| Shepherd AI Assistant | - | Yes | Yes |
| AI Workflow Generation | - | - | Yes |
| **Workflows & Automation** | | | |
| Workflows | 1 (5 nodes) | 1 (5 nodes) | Unlimited |
| Workflow Store (Browse) | Yes | Yes | Yes |
| Install Templates | - | Yes | Yes |
| Publish Templates | - | - | Yes |
| Webhook Triggers | - | - | Yes |
| **Reports & Analytics** | | | |
| Dashboard KPIs | Yes | Yes | Yes |
| Giving Charts | Yes | Yes | Yes |
| Attendance Charts | Yes | Yes | Yes |
| Growth Charts | Yes | Yes | Yes |
| Engagement Metrics | Yes | Yes | Yes |
| YoY Giving Reports | Yes | Yes | Yes |
| Discipleship Funnel | Yes | Yes | Yes |
| Data Export | Yes | Yes | Yes |
| **Moderation** | | | |
| Content Moderation Queue | Yes | Yes | Yes |
| **Admin** | | | |
| Admin Users | Up to 5 | Unlimited | Unlimited |
| Storage | 10 GB | 100 GB | Unlimited |
| Custom Branding | - | - | Yes |
| Multi-Site | - | - | Yes |
| API Access | - | - | Yes |

---

## How to Gate Features in Frontend Code

On app load, fetch the tenant's features:

```typescript
// Call once on login/app start
const features = await api.get(`/tenants/${tenantId}/features`);

// Store in context/state, then conditionally render:
if (!features.chat) hideElement('ChatTab');
if (!features.videoPostsAllowed) disableButton('VideoUpload');
if (!features.aiAssistant) hideElement('AssistantButton');
if (!features.workflows) hideElement('WorkflowsNav');
if (!features.search) hideElement('MemberSearch');
if (!features.pushNotifications) hideElement('PushSettings');
if (!features.granularRoles) hideElement('PermissionsTab');
if (!features.customBranding) hideElement('BrandingSettings');
if (!features.multiSite) hideElement('MultiSiteNav');
if (!features.apiAccess) hideElement('APIKeysPage');
```

The full feature flags object returned by the backend:

```json
{
  "tier": "premium",
  "mobileApp": true,
  "maxAdminUsers": -1,
  "granularRoles": true,
  "internalFeed": true,
  "globalFeed": true,
  "videoPostsAllowed": true,
  "search": true,
  "pushNotifications": true,
  "pushNotificationsSegmented": false,
  "chat": true,
  "videoUploads": true,
  "storageLimit": 100,
  "transactionFeePercent": 1.0,
  "aiAssistant": true,
  "workflows": true,
  "maxWorkflows": 1,
  "maxWorkflowNodes": 5,
  "customBranding": false,
  "multiSite": false,
  "apiAccess": false
}
```

---

## Upsell Prompts

When a user tries to access a gated feature, show an upsell banner instead of hiding it completely. Suggested copy:

| Feature | Upsell Text |
|---------|-------------|
| Video Posts | "Upgrade to Premium to share video content with your congregation" |
| Chat | "Upgrade to Premium to enable real-time messaging for your church" |
| Member Search | "Upgrade to Premium for full-text member search" |
| Push Notifications | "Upgrade to Premium to send push notifications to your members" |
| AI Assistant | "Upgrade to Premium to unlock the AI-powered Shepherd Assistant" |
| Communications | "Upgrade to Premium to send email, SMS, and push campaigns" |
| Granular Roles | "Upgrade to Premium for custom admin permissions" |
| Unlimited Workflows | "Upgrade to Enterprise for unlimited workflow automation" |
| AI Workflow Generation | "Upgrade to Enterprise to generate workflows with AI" |
| Geo Check-In | "Upgrade to Enterprise for GPS-based automatic check-in" |
| Custom Branding | "Upgrade to Enterprise to white-label the app with your church brand" |
| Multi-Site | "Upgrade to Enterprise to manage multiple church locations" |
| API Access | "Upgrade to Enterprise for REST API access and custom integrations" |

---

## Notes for Frontend Implementation

1. **Don't hide Standard features behind a paywall UI** — Standard includes the vast majority of functionality. The pricing page should make Standard feel complete, not stripped.

2. **Premium is the growth tier** — Position it as "when you're ready to scale." Video, chat, push, AI assistant, and communications are the key differentiators.

3. **Enterprise is for large churches** — Unlimited automation, AI generation, white-label, multi-site. These are features that only churches with 500+ members typically need.

4. **Transaction fee is a big differentiator** — 1.3% vs 1.0% vs 0.5% adds up fast for churches with significant giving. Highlight this for churches doing $10K+/month in donations.

5. **Free trial** — Consider offering 14-day Premium trial for all new signups so churches can experience the full platform before choosing a tier.
