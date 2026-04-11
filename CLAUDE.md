# Shepard — Church Management SaaS Platform

## Tech Stack
- **Backend:** NestJS (TypeScript) with TypeORM
- **Database:** PostgreSQL via Supabase (Row-Level Security enforced)
- **Auth:** Supabase Auth (JWT with `app_metadata.current_tenant_id`)
- **Payments:** Stripe Connect (Standard accounts, platform fee via `application_fee_amount`)
- **Queue:** BullMQ with Redis (Upstash)
- **Push Notifications:** Expo Push SDK + OneSignal (legacy)
- **Cache:** Redis (Upstash) via custom CacheService
- **Hosting:** Render (auto-deploy from `main` branch)
- **Icons:** Hugeicons (5,100+ free stroke-rounded icons)

## Architecture

### Multi-Tenant RLS Pattern
Every authenticated request goes through `RlsContextInterceptor` which:
1. Creates a dedicated QueryRunner (single DB connection)
2. Opens a transaction
3. Sets `SET LOCAL role = 'authenticated'` and `SET LOCAL "request.jwt.claims" = '<jwt>'`
4. Services access via `rlsStorage.getStore()` → `{ queryRunner, currentTenantId }`

**Rules:**
- Use `queryRunner` for all tenant-scoped data access (RLS enforced)
- Use `this.dataSource` (service role) ONLY for system operations: notifications processor, badge auto-award, presence updates, cross-tenant admin queries
- Always document WHY when bypassing RLS

### Schema Management
- `synchronize: false` — NEVER let TypeORM alter tables
- All schema changes via numbered migration files: `migrations/NNN_description.sql`
- Apply migrations via direct `pg` client connection (psql not installed)
- Current migration count: 048

### Database Connection
- Host: `db.fymcroumzokahctpsvaq.supabase.co`
- Port: 5432
- User: postgres
- Password: `04291992Ddcc...` (the three dots are part of the password)
- Test tenant: `6cfdebb0-29cc-42aa-96fc-44e21b2a9c71` (New Birth Test)
- Admin user: Zel (`3c5e2c6f-7caf-4f48-8a3e-3acdc5e4c2b6`, `zeldred72@gmail.com`)

## Code Conventions

### Service Pattern
```typescript
@Injectable()
export class ExampleService {
  constructor(private readonly dataSource: DataSource) {}

  private getRlsContext() {
    const ctx = rlsStorage.getStore();
    if (!ctx) throw new InternalServerErrorException('RLS context unavailable');
    return ctx;
  }

  async getData() {
    const { queryRunner, currentTenantId } = this.getRlsContext();
    // Use queryRunner.query() or queryRunner.manager for tenant-scoped queries
  }
}
```

### Controller Pattern
- Always use `@UseGuards(JwtAuthGuard)` for authenticated endpoints
- Use `@UseGuards(RoleGuard)` + `@RequiresRole('admin', 'pastor')` for admin-only endpoints
- Use `@UseInterceptors(RlsContextInterceptor)` for tenant-scoped endpoints
- Use `@RequiresTier('featureName')` for tier-gated features
- Static routes BEFORE parameterized routes (NestJS matching order)
- Use `ParseUUIDPipe` on all UUID route params

### SQL Queries
- Always use parameterized queries: `$1, $2` — NEVER string interpolation
- Use `::int` cast on COUNT results to avoid string returns
- Use `COALESCE` for nullable aggregations
- Use `ON CONFLICT DO NOTHING` for idempotent upserts

### Notification Pattern
```typescript
await this.notificationsQueue.add('notification', {
  type: 'notification_type',
  tenantId,
  recipientUserId,
  actorUserId,
  previewText: content.slice(0, 100),
});
```

### Commit Messages
- Format: `type: description` (feat, fix, perf, docs, chore)
- Always end with: `Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>`
- Use HEREDOC format for multi-line commit messages

## Project Structure
```
backend/src/
  auth/           — Supabase auth, JWT, session, tenant switching
  tenants/        — Tenant CRUD, campus management, features endpoint
  memberships/    — Tenant memberships, roles, permissions
  users/          — User profiles, settings, presence
  posts/          — Social feed posts (internal + global)
  comments/       — Threaded comments with media
  notifications/  — Expo push, device tokens, preferences, broadcast
  chat/           — Channels + DM conversations
  giving/         — Stripe donations, batches, tax statements
  fundraisers/    — Crowdfunding with Stripe
  events/         — Events, RSVP, iCal feed
  groups/         — Small groups, messaging
  badges/         — 246 platform badges + custom church badges
  family/         — Family tree with inference engine
  checkin/        — Service check-in, child safety
  prayers/        — Prayer wall
  sermons/        — Sermon library
  volunteer/      — Opportunities, signups, hours
  workflows/      — Automation engine (48+ node types)
  storage/        — Per-tenant storage tracking
  stripe/         — Connect onboarding, webhooks
  common/
    guards/       — JwtAuth, SuperAdmin, Tier, Role
    interceptors/ — RLS context, Presence
    services/     — CacheService, SupabaseAdmin
    config/       — Tier features config
```

## Tier System
- **Standard** ($29/mo): Basic features, 1.3% fee, 10GB storage
- **Premium** ($79/mo): Chat, video, AI assistant, 1.0% fee, 100GB
- **Enterprise** ($199/mo): Multi-site, custom branding, API, 0.5% fee, unlimited

## Testing & Verification
- Compile check: `cd backend && npx tsc --noEmit`
- No test framework configured yet (pre-launch)
- Verify migrations by running SQL via `node -e` with pg client

## Important Notes
- The Supabase `handle_new_user` trigger creates `public.users` rows — inserting directly requires UPDATE after to set names
- `auth.users` FK constraint means seed data needs stub entries in `auth.users` first
- Badge icons are Hugeicons names in kebab-case (e.g., `hand-prayer`), converted to PascalCase + `Icon` suffix on frontend
- Fundraiser amounts are in CENTS (divide by 100 for display)
- The `is_channel_member()` SECURITY DEFINER function prevents RLS recursion on chat policies
