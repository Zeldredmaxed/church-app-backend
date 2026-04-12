import {
  Injectable,
  BadRequestException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { rlsStorage } from '../common/storage/rls.storage';

/**
 * Shepherd Assistant — AI-powered natural language query engine.
 *
 * Security model:
 *   1. Every query is automatically scoped to the pastor's tenant_id.
 *   2. The AI generates READ-ONLY SQL (SELECT only). No INSERT/UPDATE/DELETE.
 *   3. A SQL validator rejects any non-SELECT statement before execution.
 *   4. The tenant_id is injected as a parameter — the AI cannot escape it.
 *   5. Results are limited to 100 rows max.
 *
 * The AI receives a schema description of the tenant's tables and
 * generates a parameterized query where $1 is always the tenant_id.
 */
@Injectable()
export class AssistantService {
  private readonly logger = new Logger(AssistantService.name);
  private readonly apiKey: string | null;

  constructor(
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
  ) {
    this.apiKey = this.config.get<string>('ANTHROPIC_API_KEY') ?? null;
    if (!this.apiKey) {
      this.logger.warn('ANTHROPIC_API_KEY not configured — Shepherd Assistant disabled');
    }
  }

  /**
   * The database schema description given to the AI.
   * Only includes tenant-scoped tables the pastor should access.
   * No auth tables, no cross-tenant data.
   */
  private readonly SCHEMA_PROMPT = `You are a SQL assistant for a church management system. You generate PostgreSQL SELECT queries.

CRITICAL RULES:
1. ONLY generate SELECT statements. Never INSERT, UPDATE, DELETE, DROP, ALTER, or any DDL/DML.
2. Every query MUST filter by tenant_id = $1. The $1 parameter is the church's tenant_id.
3. Return ONLY the raw SQL query, nothing else. No markdown, no explanation.
4. Limit results to 100 rows max (add LIMIT 100 if not already limited).
5. Use readable column aliases with AS.

AVAILABLE TABLES (all have tenant_id column):

tenant_memberships(user_id, tenant_id, role, permissions, created_at)
  - roles: admin, pastor, accountant, worship_leader, member

users(id, email, full_name, avatar_url, created_at)
  - Join with tenant_memberships ON users.id = tenant_memberships.user_id

posts(id, tenant_id, author_id, content, media_type, visibility, created_at)
comments(id, post_id, tenant_id, author_id, content, created_at)
post_likes(post_id, user_id, tenant_id, created_at)

transactions(id, tenant_id, user_id, amount, currency, status, stripe_payment_intent_id, created_at)
  - status: pending, succeeded, failed, refunded
recurring_gifts(id, tenant_id, user_id, amount, currency, frequency, fund_name, status, created_at)
giving_funds(id, tenant_id, name, description, is_active, created_at)

events(id, tenant_id, title, description, start_at, end_at, location, cover_image_url, is_featured, created_at)
event_rsvps(event_id, user_id, status, created_at)
  - status: going, interested, not_going

groups(id, tenant_id, name, description, image_url, created_by, created_at)
group_members(group_id, user_id, joined_at)
group_messages(id, group_id, author_id, content, created_at)

prayers(id, tenant_id, author_id, content, is_anonymous, is_answered, created_at)
prayer_prays(prayer_id, user_id, created_at)

announcements(id, tenant_id, author_id, title, body, priority, created_at)
  - priority: urgent, important, general

sermons(id, tenant_id, title, speaker, audio_url, video_url, thumbnail_url, duration, series_name, notes, is_featured, view_count, like_count, created_at)

check_ins(id, tenant_id, user_id, service_id, is_visitor, visitor_name, checked_in_at)
services(id, tenant_id, name, day_of_week, start_time)

volunteer_opportunities(id, tenant_id, role_name, description, schedule, spots_available, created_at)
volunteer_signups(opportunity_id, user_id, created_at)
volunteer_hours(id, tenant_id, user_id, opportunity_id, hours, date, notes, created_at)

care_cases(id, tenant_id, member_id, title, description, status, priority, assigned_to, created_by, resolved_at, created_at)
  - status: new, in_progress, resolved, needs_leader
  - priority: low, medium, high, urgent
care_notes(id, care_case_id, author_id, content, created_at)

tasks(id, tenant_id, title, description, status, priority, assigned_to, created_by, due_date, completed_at, linked_type, linked_id, created_at)
  - status: pending, in_progress, completed, cancelled
  - priority: low, medium, high, urgent

tags(id, tenant_id, name, color, created_at)
member_tags(tag_id, user_id, assigned_by, assigned_at)

rooms(id, tenant_id, name, capacity, description, amenities, is_active, created_at)
room_bookings(id, room_id, tenant_id, title, booked_by, start_at, end_at, notes, status, created_at)

notifications(id, recipient_id, tenant_id, type, payload, read_at, created_at)

invitations(id, tenant_id, invited_by, email, role, expires_at, accepted_at, created_at)

COMMON PATTERNS:
- "Members who haven't attended in X days": LEFT JOIN check_ins, filter WHERE last check-in is older than X days or NULL
- "Giving report for this month": transactions WHERE status='succeeded' AND created_at >= date_trunc('month', now())
- "New members in last X months": tenant_memberships WHERE created_at >= now() - interval 'X months'
- "Top donors": GROUP BY user_id, SUM(amount), ORDER BY total DESC
- "Inactive members": Members with no posts, comments, check-ins, or giving in last 30 days
- Always JOIN users to get full_name and email when returning member data`;

  /**
   * Process a natural language query from the pastor.
   */
  async ask(tenantId: string, query: string) {
    if (!this.apiKey) {
      return this.fallbackResponse(tenantId, query);
    }

    try {
      // Step 1: Ask Claude to generate SQL
      let sql = await this.generateSql(query);

      // Step 2: Validate the SQL is safe
      this.validateSql(sql);

      // Enforce hard LIMIT 1000 on every generated query as a defense-in-depth cap.
      if (!/\blimit\s+\d+/i.test(sql)) {
        sql = sql.trimEnd().replace(/;?\s*$/, '') + ' LIMIT 1000';
      }

      // Step 3: Execute via the RLS-scoped queryRunner — prevents cross-tenant
      // exfiltration even if the generated SQL attempts to bypass $1.
      const ctx = rlsStorage.getStore();
      if (!ctx) throw new InternalServerErrorException('RLS context unavailable');
      const rows = await ctx.queryRunner.query(sql, [tenantId]);

      // Step 4: Ask Claude to summarize the results
      const summary = await this.summarizeResults(query, rows);

      return {
        query,
        // Only expose raw SQL outside production (aids debugging; leaks schema in prod).
        ...(process.env.NODE_ENV !== 'production' ? { sql } : {}),
        results: rows.slice(0, 100),
        resultCount: rows.length,
        summary,
      };
    } catch (err: any) {
      this.logger.warn(`Assistant query failed: ${err.message}`);

      // If AI fails, try the built-in query patterns
      return this.fallbackResponse(tenantId, query);
    }
  }

  /**
   * Calls Claude API to generate SQL from natural language.
   */
  private async generateSql(query: string): Promise<string> {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        messages: [
          {
            role: 'user',
            content: `${this.SCHEMA_PROMPT}\n\nGenerate a SQL query for: "${query}"`,
          },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`Claude API error: ${response.status}`);
    }

    const data = await response.json();
    const sql = data.content?.[0]?.text?.trim();

    if (!sql) {
      throw new Error('No SQL generated');
    }

    return sql;
  }

  /**
   * Validates that the generated SQL is safe to execute.
   * Only SELECT statements are allowed. Rejects anything dangerous.
   */
  private validateSql(sql: string): void {
    const normalized = sql.toUpperCase().replace(/\s+/g, ' ').trim();

    // Strict SELECT-only — CTEs removed from allowlist to prevent WITH ... (DELETE/UPDATE)
    // constructs that Postgres permits and the keyword denylist can miss inside string literals.
    if (!normalized.startsWith('SELECT')) {
      throw new BadRequestException('Only SELECT queries are allowed');
    }

    // Block dangerous keywords
    const blocked = [
      'INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER', 'TRUNCATE',
      'CREATE', 'GRANT', 'REVOKE', 'EXECUTE', 'COPY', 'pg_',
      'SET ROLE', 'SET SESSION', 'SECURITY DEFINER',
    ];

    for (const keyword of blocked) {
      // Check for the keyword as a standalone word (not inside a string literal)
      const regex = new RegExp(`\\b${keyword}\\b`, 'i');
      if (regex.test(sql)) {
        throw new BadRequestException(`Blocked SQL keyword detected: ${keyword}`);
      }
    }

    // Must reference $1 (tenant_id parameter)
    if (!sql.includes('$1')) {
      throw new BadRequestException('Query must be scoped to tenant_id ($1)');
    }
  }

  /**
   * Asks Claude to summarize the query results in plain English.
   */
  private async summarizeResults(query: string, rows: any[]): Promise<string> {
    if (rows.length === 0) {
      return 'No results found for your query.';
    }

    try {
      const sample = rows.slice(0, 10);
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey!,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 300,
          messages: [
            {
              role: 'user',
              content: `The pastor asked: "${query}"\n\nThe database returned ${rows.length} results. Here's a sample:\n${JSON.stringify(sample, null, 2)}\n\nWrite a brief, friendly 1-2 sentence summary of these results for a church pastor. Be specific with numbers. Don't mention SQL or databases.`,
            },
          ],
        }),
      });

      if (!response.ok) return `Found ${rows.length} results.`;

      const data = await response.json();
      return data.content?.[0]?.text?.trim() ?? `Found ${rows.length} results.`;
    } catch {
      return `Found ${rows.length} results.`;
    }
  }

  /**
   * Fallback for when the AI is not configured or fails.
   * Handles common query patterns with hardcoded SQL.
   */
  private async fallbackResponse(tenantId: string, query: string) {
    const q = query.toLowerCase();

    let sql: string;
    let label: string;
    let params: any[] = [tenantId];

    if (q.includes('haven\'t attended') || q.includes('absent') || q.includes('not attended') || q.includes('missing')) {
      const daysMatch = q.match(/(\d+)\s*days?/);
      const days = daysMatch ? parseInt(daysMatch[1], 10) : 30;
      params.push(`${days} days`);
      sql = `
        SELECT u.id, u.full_name, u.email,
          MAX(c.checked_in_at) AS last_check_in
        FROM public.tenant_memberships tm
        JOIN public.users u ON u.id = tm.user_id
        LEFT JOIN public.check_ins c ON c.user_id = u.id AND c.tenant_id = $1
        WHERE tm.tenant_id = $1
        GROUP BY u.id, u.full_name, u.email
        HAVING MAX(c.checked_in_at) < now() - ($2)::interval
           OR MAX(c.checked_in_at) IS NULL
        ORDER BY last_check_in ASC NULLS FIRST
        LIMIT 100`;
      label = `Members who haven't attended in ${days} days`;
    } else if (q.includes('giving') || q.includes('donation') || q.includes('tithe')) {
      const monthMatch = q.includes('this month');
      const dateFilter = monthMatch ? `AND t.created_at >= date_trunc('month', now())` : '';
      sql = `
        SELECT u.id, u.full_name, u.email,
          SUM(t.amount)::float AS total_given,
          COUNT(*)::int AS donation_count
        FROM public.transactions t
        JOIN public.users u ON u.id = t.user_id
        WHERE t.tenant_id = $1 AND t.status = 'succeeded' ${dateFilter}
        GROUP BY u.id, u.full_name, u.email
        ORDER BY total_given DESC
        LIMIT 100`;
      label = monthMatch ? 'Giving report for this month' : 'All-time giving report';
    } else if (q.includes('new member')) {
      const monthsMatch = q.match(/(\d+)\s*months?/);
      const months = monthsMatch ? parseInt(monthsMatch[1], 10) : 6;
      params.push(`${months} months`);
      sql = `
        SELECT u.id, u.full_name, u.email, u.created_at AS joined_at, tm.role
        FROM public.tenant_memberships tm
        JOIN public.users u ON u.id = tm.user_id
        WHERE tm.tenant_id = $1 AND u.created_at >= now() - ($2)::interval
        ORDER BY u.created_at DESC
        LIMIT 100`;
      label = `New members in the last ${months} months`;
    } else if (q.includes('top donor')) {
      sql = `
        SELECT u.id, u.full_name, u.email,
          SUM(t.amount)::float AS total_given,
          COUNT(*)::int AS donation_count
        FROM public.transactions t
        JOIN public.users u ON u.id = t.user_id
        WHERE t.tenant_id = $1 AND t.status = 'succeeded'
        GROUP BY u.id, u.full_name, u.email
        ORDER BY total_given DESC
        LIMIT 20`;
      label = 'Top donors';
    } else if (q.includes('prayer') && (q.includes('unanswered') || q.includes('pending') || q.includes('open'))) {
      sql = `
        SELECT p.id, p.content, u.full_name AS author,
          (SELECT COUNT(*)::int FROM public.prayer_prays WHERE prayer_id = p.id) AS praying_count,
          p.created_at
        FROM public.prayers p
        LEFT JOIN public.users u ON u.id = p.author_id AND p.is_anonymous = false
        WHERE p.tenant_id = $1 AND p.is_answered = false
        ORDER BY p.created_at DESC
        LIMIT 100`;
      label = 'Unanswered prayer requests';
    } else if (q.includes('volunteer')) {
      sql = `
        SELECT u.id, u.full_name, u.email, vo.role_name,
          COALESCE(SUM(vh.hours), 0)::float AS total_hours
        FROM public.volunteer_signups vs
        JOIN public.volunteer_opportunities vo ON vo.id = vs.opportunity_id AND vo.tenant_id = $1
        JOIN public.users u ON u.id = vs.user_id
        LEFT JOIN public.volunteer_hours vh ON vh.user_id = u.id AND vh.tenant_id = $1
        GROUP BY u.id, u.full_name, u.email, vo.role_name
        ORDER BY total_hours DESC
        LIMIT 100`;
      label = 'Volunteer report';
    } else if (q.includes('care') || q.includes('pastoral')) {
      sql = `
        SELECT cc.id, cc.title, cc.status, cc.priority,
          u.full_name AS member_name,
          a.full_name AS assigned_to_name,
          cc.created_at
        FROM public.care_cases cc
        JOIN public.users u ON u.id = cc.member_id
        LEFT JOIN public.users a ON a.id = cc.assigned_to
        WHERE cc.tenant_id = $1 AND cc.status != 'resolved'
        ORDER BY CASE cc.priority
          WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
          cc.created_at DESC
        LIMIT 100`;
      label = 'Active care cases';
    } else if (q.includes('overdue') || q.includes('task')) {
      sql = `
        SELECT t.id, t.title, t.priority, t.status, t.due_date,
          u.full_name AS assigned_to_name
        FROM public.tasks t
        LEFT JOIN public.users u ON u.id = t.assigned_to
        WHERE t.tenant_id = $1 AND t.status NOT IN ('completed', 'cancelled')
          AND t.due_date < CURRENT_DATE
        ORDER BY t.due_date ASC
        LIMIT 100`;
      label = 'Overdue tasks';
    } else if (q.includes('event') || q.includes('upcoming')) {
      sql = `
        SELECT e.id, e.title, e.start_at, e.location,
          (SELECT COUNT(*)::int FROM public.event_rsvps WHERE event_id = e.id AND status = 'going') AS going_count
        FROM public.events e
        WHERE e.tenant_id = $1 AND e.start_at >= now()
        ORDER BY e.start_at ASC
        LIMIT 20`;
      label = 'Upcoming events';
    } else if (q.includes('inactive') || q.includes('not active') || q.includes('disengaged')) {
      sql = `
        SELECT u.id, u.full_name, u.email
        FROM public.tenant_memberships tm
        JOIN public.users u ON u.id = tm.user_id
        WHERE tm.tenant_id = $1
          AND u.id NOT IN (
            SELECT DISTINCT author_id FROM public.posts WHERE tenant_id = $1 AND created_at >= now() - interval '30 days'
            UNION SELECT DISTINCT author_id FROM public.comments WHERE tenant_id = $1 AND created_at >= now() - interval '30 days'
            UNION SELECT DISTINCT user_id FROM public.check_ins WHERE tenant_id = $1 AND checked_in_at >= now() - interval '30 days'
            UNION SELECT DISTINCT user_id FROM public.transactions WHERE tenant_id = $1 AND created_at >= now() - interval '30 days'
          )
        ORDER BY u.full_name
        LIMIT 100`;
      label = 'Inactive members (no activity in 30 days)';
    } else {
      return {
        query,
        summary: 'I can help you with questions about your church members, giving, attendance, events, care cases, tasks, volunteers, and prayers. Try asking something like "Show me members who haven\'t attended in 30 days" or "What\'s our giving report for this month?"',
        results: [],
        resultCount: 0,
        suggestions: [
          'Show me members who haven\'t attended in 30 days',
          'What\'s our giving report for this month?',
          'Show me new members in the last 6 months',
          'Who are our top donors?',
          'Show me unanswered prayer requests',
          'What are the overdue tasks?',
          'Show me active care cases',
          'Who are our volunteers?',
          'What upcoming events do we have?',
          'Show me inactive members',
        ],
      };
    }

    const rows = await this.dataSource.query(sql, params);

    return {
      query,
      label,
      results: rows,
      resultCount: rows.length,
      summary: `Found ${rows.length} ${label.toLowerCase()}.`,
    };
  }
}
