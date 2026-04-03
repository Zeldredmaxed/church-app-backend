# Phase 4, Week 12: Load Testing & Launch Prep — Verification Directive

> **Status:** Implementation Complete  
> **Prerequisite:** Phase 4, Week 11 (GDPR Compliance) verified and approved  
> **Deliverables:** k6 load test scripts (3 scenarios), HealthModule, launch readiness checklist

---

## Architecture Decisions

### 1. k6 for Load Testing (Not Artillery)
We chose k6 for load testing because:
- JavaScript-based scripting — same language as the backend team
- Built-in metrics for p95/p99 latency, error rates, and throughput
- Grafana-native integration for real-time dashboards
- Threshold-based pass/fail — CI/CD gateable
- Low resource footprint — single binary, no Node.js runtime required

### 2. Three Scenario Strategy
Load tests target the three critical usage patterns:

| Scenario | Concurrent Users | Primary Bottleneck |
|----------|------------------|--------------------|
| Sunday Morning (reads) | 5,000 | PostgreSQL RLS query cost, Redis cache hits |
| Crucial Event (writes) | 500 | BullMQ throughput, PG write IOPS, fan-out amplification |
| Chat Load | 1,000 | chat_messages insert rate, notification queue depth |

### 3. Health Check Endpoints
Two-tier health check pattern for production orchestration:

| Endpoint | Type | Checks | Use Case |
|----------|------|--------|----------|
| `GET /health` | Liveness | Process running | Kubernetes liveness probe — restart if dead |
| `GET /health/ready` | Readiness | DB connection alive | Load balancer routing — remove if degraded |

Both endpoints skip rate limiting (`@SkipThrottle()`) to ensure monitoring probes are never blocked.

### 4. HTTP API Load Testing (Not WebSocket)
The k6 scripts test the HTTP API layer, not WebSocket (Supabase Realtime) directly:
- The HTTP API is the bottleneck we control (NestJS → PostgreSQL → Redis)
- Supabase Realtime is a managed service — monitor via Supabase dashboard
- WebSocket load testing can be added later with k6's `k6/ws` module

---

## Files Created / Modified

### New Files
| File | Purpose |
|------|---------|
| `loadtests/helpers.js` | Shared config, auth headers, random content generators |
| `loadtests/scenario-1-sunday-morning.js` | High read load: 5,000 VUs fetching feeds, notifications, search |
| `loadtests/scenario-2-high-write.js` | High write load: 500 VUs creating posts and comments |
| `loadtests/scenario-3-chat-load.js` | Chat load: 1,000 VUs sending/reading messages |
| `backend/src/health/health.controller.ts` | Liveness + readiness probe endpoints |
| `backend/src/health/health.module.ts` | HealthModule |

### Modified Files
| File | Change |
|------|--------|
| `backend/src/app.module.ts` | Added `HealthModule` (now 18 feature modules) |

---

## API Endpoints

### Health Check
| Method | Path | Auth | Rate Limit | Description |
|--------|------|------|------------|-------------|
| `GET` | `/health` | None | Skipped | Liveness probe — process running |
| `GET` | `/health/ready` | None | Skipped | Readiness probe — DB connection alive |

---

## Load Test Execution Guide

### Prerequisites

1. **Staging Environment** — Mirror of production (RDS, Redis, NestJS cluster)
2. **Seed Data** — At least 10,000 posts, 1,000 users, 50 channels with messages
3. **Test JWT Tokens** — Pre-generate tokens for test users with valid tenant contexts
4. **k6 Installed** — `brew install k6` or download from grafana.com/k6

### Running the Tests

```bash
# Install k6
# macOS: brew install k6
# Linux: sudo gpg -k && sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg ...
# Windows: choco install k6

# Scenario 1: Sunday Morning (High Read)
k6 run -e BASE_URL=https://staging.example.com/api \
       -e GRAPHQL_URL=https://staging.example.com/graphql \
       -e JWT_TOKEN=<test_user_jwt> \
       loadtests/scenario-1-sunday-morning.js

# Scenario 2: Crucial Event (High Write)
k6 run -e BASE_URL=https://staging.example.com/api \
       -e JWT_TOKEN=<test_user_jwt> \
       loadtests/scenario-2-high-write.js

# Scenario 3: Chat Load
k6 run -e BASE_URL=https://staging.example.com/api \
       -e JWT_TOKEN=<test_user_jwt> \
       -e CHANNEL_IDS=uuid1,uuid2,uuid3 \
       loadtests/scenario-3-chat-load.js
```

### Monitoring During Tests

| System | What to Watch | Dashboard |
|--------|---------------|-----------|
| **PostgreSQL** | CPU, memory, IOPS, active connections, slow queries | Supabase Dashboard → Database |
| **Redis** | Memory usage, command throughput, queue length | Redis CLI: `INFO stats`, `LLEN bull:*` |
| **NestJS API** | CPU, memory, request throughput, error rate | `k6` output + container metrics |
| **BullMQ** | Queue depth, processing rate, failed jobs | Bull Board or `redis-cli LLEN` |
| **Supabase Realtime** | WebSocket connections, CPU, memory | Supabase Dashboard → Realtime |

---

## Performance Targets

| Metric | Target | Scenario |
|--------|--------|----------|
| Feed read p95 latency | < 200ms | Sunday Morning |
| Global feed p95 latency | < 200ms | Sunday Morning |
| Notification read p95 latency | < 200ms | Sunday Morning |
| Post create p95 latency | < 500ms | Crucial Event |
| Comment create p95 latency | < 500ms | Crucial Event |
| Message send p95 latency | < 300ms | Chat Load |
| Message read p95 latency | < 200ms | Chat Load |
| Error rate (all scenarios) | < 1% | All |
| Health check latency | < 50ms | Always |

---

## Verification Tests

### Health Check Tests

#### Test 1: Liveness Probe Returns OK
```bash
curl http://localhost:3000/api/health
```
**Expected:** `200 OK` with `{ "status": "ok", "timestamp": "..." }`

#### Test 2: Readiness Probe Returns OK (DB Connected)
```bash
curl http://localhost:3000/api/health/ready
```
**Expected:** `200 OK` with `{ "status": "ok", "database": "connected", "timestamp": "..." }`

#### Test 3: Health Endpoints Skip Rate Limiting
```bash
for i in {1..200}; do
  curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/health
done
```
**Expected:** All 200 return `200 OK`. No `429 Too Many Requests`. Health probes are excluded from throttling.

#### Test 4: Health Endpoints Require No Authentication
```bash
# No Authorization header
curl http://localhost:3000/api/health
curl http://localhost:3000/api/health/ready
```
**Expected:** Both return `200 OK`. Health probes are unauthenticated.

### Load Test Execution Tests

#### Test 5: Scenario 1 — Sunday Morning Passes Thresholds
```bash
k6 run -e BASE_URL=http://localhost:3000/api \
       -e JWT_TOKEN=<jwt> \
       --vus 10 --duration 30s \
       loadtests/scenario-1-sunday-morning.js
```
**Expected:** All thresholds pass (green). Reduce VUs for local testing — full 5,000 VU test runs against staging.

#### Test 6: Scenario 2 — High Write Passes Thresholds
```bash
k6 run -e BASE_URL=http://localhost:3000/api \
       -e JWT_TOKEN=<jwt> \
       --vus 10 --duration 30s \
       loadtests/scenario-2-high-write.js
```
**Expected:** Posts and comments created successfully. `posts_created` and `comments_created` counters > 0.

#### Test 7: Scenario 3 — Chat Load Passes Thresholds
```bash
k6 run -e BASE_URL=http://localhost:3000/api \
       -e JWT_TOKEN=<jwt> \
       -e CHANNEL_IDS=<channel_uuid> \
       --vus 10 --duration 30s \
       loadtests/scenario-3-chat-load.js
```
**Expected:** Messages sent and read successfully. `messages_sent` and `messages_read` counters > 0.

#### Test 8: Rate Limiting Observed Under Load
During any scenario, verify that unauthenticated or over-limit requests return `429`:
```bash
# Rapid-fire without auth — should hit global rate limit
for i in {1..101}; do
  curl -s -o /dev/null -w "%{http_code}\n" \
    http://localhost:3000/api/posts
done
```
**Expected:** Requests after 100 return `429 Too Many Requests`.

---

## Common Bottlenecks & Optimizations

### Bottleneck: Slow RLS Queries
**Symptom:** Feed/notification p95 > 200ms under load  
**Diagnosis:** `EXPLAIN ANALYZE` on slow queries  
**Fix:**
- Add composite indexes on frequently filtered columns (`tenant_id, created_at`)
- Consider materialized views for feed aggregation
- Tune `work_mem` and `shared_buffers` in PostgreSQL

### Bottleneck: Connection Pool Exhaustion
**Symptom:** `too many connections` errors, requests timing out  
**Diagnosis:** Check `SELECT count(*) FROM pg_stat_activity`  
**Fix:**
- Increase TypeORM `extra.max` from 10 to 20-30
- Deploy PgBouncer in transaction mode between NestJS and PostgreSQL
- Scale NestJS instances (each instance opens its own pool)

### Bottleneck: BullMQ Queue Backup
**Symptom:** Notification/feed delays, Redis memory growing  
**Diagnosis:** `redis-cli LLEN bull:notifications:wait`  
**Fix:**
- Scale notification workers (increase `concurrency` in processor)
- Add dedicated Redis instance for BullMQ (separate from cache)
- Implement job TTL to drop stale notification jobs

### Bottleneck: Redis Memory Pressure
**Symptom:** Redis OOM errors, eviction warnings  
**Diagnosis:** `redis-cli INFO memory`  
**Fix:**
- Set TTL on cached feed entries
- Use Redis Cluster for horizontal scaling
- Move to ElastiCache or Upstash Pro tier

### Bottleneck: Node.js Event Loop Blocking
**Symptom:** All latencies spike uniformly  
**Diagnosis:** `--prof` flag or `clinic.js` flame graph  
**Fix:**
- Offload CPU-heavy work to BullMQ workers
- Use `worker_threads` for data export (large JSON serialization)
- Scale NestJS cluster (PM2 cluster mode or Kubernetes replicas)

---

## Production Launch Checklist

### Infrastructure
- [ ] PostgreSQL: RDS Multi-AZ with automated backups (7-day retention)
- [ ] PostgreSQL: Read replica for analytics/export queries
- [ ] PgBouncer: Transaction pooling mode, max 100 connections
- [ ] Redis: ElastiCache or Upstash Pro, 2GB+ memory, persistence enabled
- [ ] NestJS: 2+ container instances behind ALB, auto-scaling group
- [ ] S3: Bucket versioning enabled, lifecycle rule for orphaned objects (30-day expiry)
- [ ] CDN: CloudFront in front of S3 for media delivery
- [ ] DNS: Route 53 with health check failover

### Security
- [ ] TLS certificates (ACM) on all endpoints
- [ ] CORS configured: only allow production frontend origin
- [ ] CSP headers: restrict inline scripts, frame ancestors
- [ ] Secrets: All env vars in AWS Secrets Manager or SSM Parameter Store
- [ ] WAF: AWS WAF rules for SQL injection, XSS, rate limiting at edge
- [ ] Stripe webhook secret rotated from test to production
- [ ] Supabase JWT secret is production-grade (not test key)

### Monitoring & Alerting
- [ ] Sentry: Error tracking with source maps uploaded
- [ ] Datadog/Grafana: APM dashboards for latency, throughput, error rate
- [ ] Alerts: PagerDuty/Opsgenie for p95 > 500ms, error rate > 5%, DB CPU > 80%
- [ ] Health checks: ALB health check → `GET /api/health/ready`
- [ ] Log aggregation: CloudWatch Logs or Datadog Logs with structured JSON
- [ ] Uptime monitoring: External ping on `/api/health` every 60s

### Data & Compliance
- [ ] Database migrations: All 11 migrations applied to production DB
- [ ] GDPR: Privacy policy published, cookie consent banner live
- [ ] GDPR: `DELETE /users/me` and `GET /users/me/export` tested in staging
- [ ] Stripe: Production API keys configured, webhook endpoint registered
- [ ] Stripe: Platform terms of service accepted for Connect
- [ ] OneSignal: Production app created, push certificates uploaded
- [ ] Mux: Production environment token, webhook secret configured

### Rollback Plan
- [ ] Database: RDS point-in-time recovery tested
- [ ] Application: Blue/green deployment or rolling update strategy
- [ ] Feature flags: Kill-switch for new features (e.g., disable global feed, disable donations)
- [ ] Runbook: Step-by-step rollback procedure documented
- [ ] On-call rotation: Primary and secondary responders assigned

### Pre-Launch Smoke Test
- [ ] Create a new user account (signup → confirm email → login)
- [ ] Join a church (accept invitation → switch tenant)
- [ ] Create a post and comment on it
- [ ] Send a chat message in a channel
- [ ] Process a test donation ($1.00) through Stripe
- [ ] Verify push notification delivery (OneSignal)
- [ ] Export user data (`GET /users/me/export`)
- [ ] Delete test account (`DELETE /users/me`)
- [ ] Verify health probes (`GET /health`, `GET /health/ready`)

---

## Platform Summary — Final Architecture

### Module Inventory (18 Feature Modules)

| Module | Entities | Key Capability |
|--------|----------|----------------|
| AuthModule | — | Supabase Auth (signup, login, refresh, tenant switch) |
| TenantsModule | Tenant | Multi-tenant church management |
| UsersModule | User | Profile CRUD, GDPR delete/export |
| MembershipsModule | TenantMembership | Member management, role updates |
| PostsModule | Post | Church-internal + global posts |
| InvitationsModule | Invitation | Email-based church invitations |
| CommentsModule | Comment | Post comments with notifications |
| NotificationsModule | Notification | In-app + push (OneSignal) notifications |
| MediaModule | — | S3 pre-signed uploads, bulk delete |
| WebhooksModule | — | Mux webhook handler (HMAC verified) |
| FollowsModule | Follow | Social graph (follow/unfollow) |
| FeedModule | — | Redis fan-out global feed (GraphQL) |
| ChatModule | ChatChannel, ChannelMember, ChatMessage | Real-time chat (Supabase Realtime) |
| SearchModule | — | Full-text search (tsvector + GIN) |
| StripeModule | — | Stripe Connect + webhook handler |
| GivingModule | Transaction | Donation flow (PaymentIntents) |
| HealthModule | — | Liveness + readiness probes |
| ThrottlerModule | — | Redis-backed rate limiting |

### Database Tables (12 + auth.users)

| Table | RLS Policies | Indexes |
|-------|-------------|---------|
| tenants | 2 (select, insert) | PK |
| users | 3 (select, update, insert) | PK, email unique, search_vector GIN |
| tenant_memberships | 3 (select, insert, update) | PK, composite unique |
| posts | 4 (select, insert, update, delete) | tenant_id+created_at, author_id, search_vector GIN |
| invitations | 3 (select, insert, delete) | token unique, tenant_id |
| comments | 3 (select, insert, delete) | post_id+created_at, author_id |
| notifications | 2 (select, update) | recipient_id+created_at, read flag |
| follows | 3 (select, insert, delete) | composite unique, following_id |
| chat_channels | 4 (select, insert, update, delete) | tenant_id, type |
| channel_members | 3 (select, insert, delete) | composite PK |
| chat_messages | 2 (select, insert) | channel_id+created_at |
| transactions | 2 (select, insert) | tenant_id, user_id, stripe_pi unique |

### Infrastructure Stack

```
┌─────────────────────────────────────────────────┐
│                   Clients                        │
│  (React Native / Next.js / Stripe.js)           │
└────────────────────┬────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────┐
│              AWS CloudFront (CDN)                │
│         Media delivery + static assets           │
└────────────────────┬────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────┐
│         AWS ALB + WAF (Rate Limiting)           │
│     Health check: GET /api/health/ready          │
└────────────────────┬────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────┐
│        NestJS Cluster (2+ instances)            │
│  ┌─────────┐ ┌──────────┐ ┌──────────────────┐ │
│  │REST API │ │ GraphQL  │ │ BullMQ Workers   │ │
│  │ (48 ep) │ │(globalFd)│ │(notify, fan-out) │ │
│  └────┬────┘ └────┬─────┘ └───────┬──────────┘ │
│       │           │               │              │
│  ┌────▼───────────▼───────────────▼────────┐    │
│  │         @nestjs/throttler               │    │
│  │    (100/min global, 5/min auth)         │    │
│  └─────────────────────────────────────────┘    │
└────────────────────┬────────────────────────────┘
                     │
         ┌───────────┼───────────┐
         │           │           │
┌────────▼───┐ ┌─────▼────┐ ┌───▼──────────┐
│ PostgreSQL │ │  Redis   │ │   AWS S3     │
│ (Supabase) │ │(Upstash/ │ │ (Media)      │
│ + RLS      │ │ElastiCch)│ │              │
│ + PgBouncer│ │+ BullMQ  │ │ + CloudFront │
└────────────┘ └──────────┘ └──────────────┘
       │
┌──────▼─────────────────────────────────────┐
│           External Services                 │
│  Stripe Connect │ Mux Video │ OneSignal    │
│  (Payments)     │ (HLS)     │ (Push)       │
└─────────────────────────────────────────────┘
```

### Security Layers (8-Layer Defense-in-Depth)

| Layer | Mechanism |
|-------|-----------|
| L1 | Rate limiting (Redis + @nestjs/throttler) |
| L2 | Input validation (ValidationPipe whitelist) |
| L3 | UUID validation (ParseUUIDPipe) |
| L4 | JWT authentication (Supabase HS256) |
| L5 | Row-Level Security (PostgreSQL SET LOCAL) |
| L6 | Application role guards (admin checks) |
| L7 | Webhook signature verification (Stripe SDK / HMAC) |
| L8 | SQL parameterization (TypeORM + websearch_to_tsquery) |

---

## Next Steps (Post-Launch)
1. **Observability** — Sentry + OpenTelemetry + Grafana dashboards
2. **Async Data Export** — BullMQ job → S3 → email link for large exports
3. **Audit Log Table** — Regulatory trail for data access/deletion events
4. **WebSocket Load Testing** — k6 `k6/ws` module for Supabase Realtime
5. **Database Sharding** — Citus or Aurora if single-instance becomes a bottleneck
6. **Microservice Extraction** — Feed/social module to standalone Go/Rust service
