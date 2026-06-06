import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { rlsStorage } from '../common/storage/rls.storage';
import { AuditService } from '../audit/audit.service';
import { CreateChallengeDto } from './dto/create-challenge.dto';
import { UpdateChallengeDto } from './dto/update-challenge.dto';
import { ChallengeTaskInput, UpdateChallengeTaskDto } from './dto/challenge-task.dto';
import { CompleteTaskDto } from './dto/complete-task.dto';

@Injectable()
export class ChallengesService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
  ) {}

  private getRlsContext() {
    const ctx = rlsStorage.getStore();
    if (!ctx) throw new InternalServerErrorException('RLS context unavailable');
    return ctx;
  }

  private async actorName(userId: string): Promise<string> {
    const { queryRunner } = this.getRlsContext();
    const [r] = await queryRunner.query(`SELECT full_name FROM public.users WHERE id = $1`, [userId]);
    return r?.full_name ?? 'Admin';
  }

  /**
   * Normalize a DATE value to a 'YYYY-MM-DD' string. node-postgres parses
   * `date` columns into JS Date objects at the process-local midnight of the
   * calendar date, so we read the local components back out (round-trips
   * regardless of server timezone). Plain strings are passed through.
   */
  private toDateString(d: string | Date | null): string | null {
    if (d == null) return null;
    if (typeof d === 'string') return d.slice(0, 10);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  /** Tenant-local "today" (YYYY-MM-DD) bucketed by tenants.timezone. */
  private async tenantToday(tenantId: string): Promise<string> {
    const { queryRunner } = this.getRlsContext();
    const [r] = await queryRunner.query(
      `SELECT to_char((now() AT TIME ZONE timezone)::date, 'YYYY-MM-DD') AS today
       FROM public.tenants WHERE id = $1`,
      [tenantId],
    );
    if (!r?.today) throw new NotFoundException('Tenant not found');
    return r.today;
  }

  /** Tenant timezone (IANA name like "America/New_York"). */
  private async tenantTimezone(tenantId: string): Promise<string> {
    const { queryRunner } = this.getRlsContext();
    const [r] = await queryRunner.query(
      `SELECT timezone FROM public.tenants WHERE id = $1`,
      [tenantId],
    );
    if (!r?.timezone) throw new NotFoundException('Tenant not found');
    return r.timezone;
  }

  /**
   * Compute the UTC ISO timestamp at which a task unlocks, given the
   * enrollment's anchor date + the task's day_index + the tenant's
   * timezone. Used for the `unlocksAt` field on locked Task responses
   * (powers the "Unlocks in N hours" chip on mobile) and the
   * TASK_LOCKED error payload.
   *
   * Math: enrollment.started_on + (dayIndex - 1) days, at 00:00:00
   * in the tenant's timezone, converted to a UTC instant. Postgres
   * `(date::timestamp AT TIME ZONE 'America/...')` does exactly this
   * — interprets the naive midnight as being in the named TZ and
   * returns the corresponding timestamptz. DST-safe (Postgres uses
   * the IANA TZ database).
   */
  private async unlocksAtFor(
    startedOn: string | Date,
    dayIndex: number,
    tenantTimezone: string,
  ): Promise<string | null> {
    const { queryRunner } = this.getRlsContext();
    const startedOnStr = this.toDateString(startedOn);
    if (!startedOnStr) return null;
    const [r] = await queryRunner.query(
      `SELECT (($1::date + ($2::int - 1) * INTERVAL '1 day')::date::timestamp
              AT TIME ZONE $3) AS unlocks_at`,
      [startedOnStr, dayIndex, tenantTimezone],
    );
    if (!r?.unlocks_at) return null;
    return new Date(r.unlocks_at).toISOString();
  }

  // ───────────────────────── mappers ─────────────────────────

  private mapChallenge(r: any) {
    return {
      id: r.id,
      tenantId: r.tenant_id,
      title: r.title,
      description: r.description,
      coverImageUrl: r.cover_image_url,
      category: r.category,
      durationDays: r.duration_days,
      startsOn: this.toDateString(r.starts_on),
      isPublished: r.is_published,
      createdBy: r.created_by,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      taskCount: r.task_count != null ? Number(r.task_count) : undefined,
      enrolledCount: r.enrolled_count != null ? Number(r.enrolled_count) : undefined,
    };
  }

  private mapTask(r: any) {
    return {
      id: r.id,
      challengeId: r.challenge_id,
      dayIndex: r.day_index,
      position: r.position,
      taskType: r.task_type,
      title: r.title,
      scriptureReference: r.scripture_reference,
      scriptureTranslation: r.scripture_translation,
      body: r.body,
      timerSeconds: r.timer_seconds,
      reflectionPrompt: r.reflection_prompt,
    };
  }

  private mapEnrollment(r: any) {
    return {
      id: r.id,
      challengeId: r.challenge_id,
      userId: r.user_id,
      startedOn: this.toDateString(r.started_on),
      status: r.status,
      completedAt: r.completed_at,
      currentStreak: r.current_streak,
      longestStreak: r.longest_streak,
      lastCompletedDate: this.toDateString(r.last_completed_date),
      // Migration 098 — Faith Walks extensions
      missedCount: r.missed_count ?? 0,
      totalPoints: r.total_points ?? 0,
      badgeTier: (r.badge_tier ?? 'none') as 'none' | 'bronze' | 'silver' | 'gold' | 'mythic',
    };
  }

  // ─────────── Faith Walks helpers (migration 098) ───────────

  /**
   * Points awarded for a completion based on the tenant-local hour.
   * Tiered curve (the user's spec): earlier = more, late = zero.
   *   00-02 → 100   |   03-05 → 90    |   06-08 → 80
   *   09-11 → 70    |   12-14 → 60    |   15-17 → 50
   *   18-20 → 40    |   21-23 → 30    |   late  → 0
   * Tiers (not per-minute) so we never argue over seconds and never
   * award negatives.
   */
  private pointsForHour(hour: number, isLate: boolean): number {
    if (isLate) return 0;
    if (hour < 3) return 100;
    if (hour < 6) return 90;
    if (hour < 9) return 80;
    if (hour < 12) return 70;
    if (hour < 15) return 60;
    if (hour < 18) return 50;
    if (hour < 21) return 40;
    return 30;
  }

  /**
   * Derive medal tier given an enrollment's stats + total task count +
   * whether the viewer is in the top 5 by points on the leaderboard.
   *   Mythic = perfect AND top-5 by points
   *   Gold   = perfect (zero missed, 100% on-time)
   *   Silver = ≥67% on-time
   *   Bronze = ≥33% on-time
   *   None   = otherwise
   * Mythic locks if anyone passes them on the leaderboard, so it's a
   * read-time computation, not a denorm.
   */
  private deriveBadgeTier(
    missedCount: number,
    onTimeCount: number,
    totalTasks: number,
    inTopFiveByPoints: boolean,
  ): 'none' | 'bronze' | 'silver' | 'gold' | 'mythic' {
    if (totalTasks === 0) return 'none';
    // Integer comparison for perfect — float (N/N)*100 happens to be
    // exact 100.0 in IEEE 754 for now, but using integer equality
    // makes the intent obvious and survives any future refactor that
    // introduces fractional counts.
    const perfect = missedCount === 0 && onTimeCount === totalTasks;
    const pct = (onTimeCount / totalTasks) * 100;
    if (perfect && inTopFiveByPoints) return 'mythic';
    if (perfect) return 'gold';
    if (pct >= 67) return 'silver';
    if (pct >= 33) return 'bronze';
    return 'none';
  }

  /**
   * Pull the top-5 user IDs by total_points for a challenge. Used to
   * decide whether the viewer's own enrollment qualifies for Mythic.
   *
   * SERVICE-ROLE BYPASS (documented per CLAUDE.md): this is a
   * cross-user aggregate read. The RLS policy on challenge_enrollments
   * is `user_id = auth.uid()`, so running this through the request
   * queryRunner would return ONLY the viewer — making Mythic trivially
   * granted (1-row top-5 always contains the viewer). Service-role with
   * explicit tenant + challenge pinning in the WHERE is the correct
   * pattern for leaderboard-style work.
   *
   * Ordering matches getLeaderboard's byPoints sort EXACTLY — both
   * paths must agree on top-5 membership or Enrollment.badgeTier
   * can disagree with the leaderboard endpoint. No total_points > 0
   * filter so 0-point users can still be in the top-5 (matches the
   * leaderboard spec: ranked by points, ties by completion count).
   */
  private async topFiveByPointsIds(tenantId: string, challengeId: string): Promise<Set<string>> {
    const rows = await this.dataSource.query(
      `SELECT e.user_id
       FROM public.challenge_enrollments e
       WHERE e.tenant_id = $1
         AND e.challenge_id = $2
         AND e.status != 'abandoned'
       ORDER BY e.total_points DESC,
                (SELECT COUNT(*) FROM public.challenge_task_completions
                 WHERE enrollment_id = e.id) DESC
       LIMIT 5`,
      [tenantId, challengeId],
    );
    return new Set(rows.map((r: any) => r.user_id));
  }

  /**
   * On-time completion count for an enrollment. Used to compute the
   * medal tier from missed_count + on-time pct. Excludes late
   * completions (which score 0 and don't count toward streak either).
   */
  private async onTimeCompletionCount(enrollmentId: string): Promise<number> {
    const { queryRunner } = this.getRlsContext();
    const [r] = await queryRunner.query(
      `SELECT COUNT(*)::int AS n FROM public.challenge_task_completions
       WHERE enrollment_id = $1 AND is_late = false`,
      [enrollmentId],
    );
    return r?.n ?? 0;
  }

  /**
   * Compute the live badge tier for the viewer's own enrollment.
   * Pass the eager-loaded total task count if you have it (else 0
   * will return 'none'). Use sparingly — every call does a LIMIT-5
   * leaderboard probe; only call for the viewer's own enrollment, not
   * for other members shown in lists.
   */
  private async resolveViewerBadgeTier(
    tenantId: string,
    challengeId: string,
    enrollmentId: string,
    userId: string,
    missedCount: number,
    totalTasks: number,
  ): Promise<'none' | 'bronze' | 'silver' | 'gold' | 'mythic'> {
    const onTime = await this.onTimeCompletionCount(enrollmentId);
    const top5 = await this.topFiveByPointsIds(tenantId, challengeId);
    return this.deriveBadgeTier(missedCount, onTime, totalTasks, top5.has(userId));
  }

  // ═══════════════════════ ADMIN (pastor) ═══════════════════════

  async createChallenge(dto: CreateChallengeDto, tenantId: string) {
    const { queryRunner, userId } = this.getRlsContext();
    const [row] = await queryRunner.query(
      `INSERT INTO public.challenges
         (tenant_id, title, description, cover_image_url, category, duration_days, starts_on, is_published, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        tenantId,
        dto.title,
        dto.description ?? null,
        dto.coverImageUrl ?? null,
        dto.category ?? null,
        dto.durationDays,
        dto.startsOn ?? null,
        dto.isPublished ?? false,
        userId,
      ],
    );

    if (dto.tasks?.length) {
      await this.insertTasks(row.id, tenantId, dto.tasks);
    }

    await this.audit.log({
      action: 'challenge.created',
      resourceType: 'challenge',
      resourceId: row.id,
      summary: `${await this.actorName(userId)} created challenge "${row.title}" (${dto.durationDays} days)`,
      metadata: { title: row.title, durationDays: dto.durationDays, isPublished: row.is_published },
    });

    return this.getChallengeAdmin(tenantId, row.id);
  }

  private async insertTasks(challengeId: string, tenantId: string, tasks: ChallengeTaskInput[]) {
    const { queryRunner } = this.getRlsContext();
    for (const t of tasks) {
      this.validateTaskShape(t);
      await queryRunner.query(
        `INSERT INTO public.challenge_tasks
           (challenge_id, tenant_id, day_index, position, task_type, title,
            scripture_reference, scripture_translation, body, timer_seconds, reflection_prompt)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          challengeId,
          tenantId,
          t.dayIndex,
          t.position ?? 0,
          t.taskType,
          t.title ?? null,
          t.scriptureReference ?? null,
          t.scriptureTranslation ?? null,
          t.body ?? null,
          t.timerSeconds ?? null,
          t.reflectionPrompt ?? null,
        ],
      );
    }
  }

  /** Author-time sanity: scripture needs a reference, reflection needs a prompt. */
  private validateTaskShape(t: ChallengeTaskInput | UpdateChallengeTaskDto) {
    if (t.taskType === 'scripture' && !t.scriptureReference && !t.body) {
      throw new BadRequestException('Scripture tasks need a scriptureReference or body');
    }
    if (t.taskType === 'reflection' && !t.reflectionPrompt) {
      throw new BadRequestException('Reflection tasks need a reflectionPrompt');
    }
  }

  async listChallengesAdmin(tenantId: string) {
    const { queryRunner } = this.getRlsContext();
    const rows = await queryRunner.query(
      `SELECT c.*,
        (SELECT COUNT(*)::int FROM public.challenge_tasks t WHERE t.challenge_id = c.id) AS task_count,
        (SELECT COUNT(*)::int FROM public.challenge_enrollments e
           WHERE e.challenge_id = c.id AND e.status != 'abandoned') AS enrolled_count
       FROM public.challenges c
       WHERE c.tenant_id = $1
       ORDER BY c.created_at DESC`,
      [tenantId],
    );
    return { data: rows.map((r: any) => this.mapChallenge(r)) };
  }

  async getChallengeAdmin(tenantId: string, id: string) {
    const { queryRunner } = this.getRlsContext();
    const [c] = await queryRunner.query(
      `SELECT c.*,
        (SELECT COUNT(*)::int FROM public.challenge_tasks t WHERE t.challenge_id = c.id) AS task_count,
        (SELECT COUNT(*)::int FROM public.challenge_enrollments e
           WHERE e.challenge_id = c.id AND e.status != 'abandoned') AS enrolled_count
       FROM public.challenges c
       WHERE c.id = $1 AND c.tenant_id = $2`,
      [id, tenantId],
    );
    if (!c) throw new NotFoundException('Challenge not found');
    const tasks = await queryRunner.query(
      `SELECT * FROM public.challenge_tasks WHERE challenge_id = $1
       ORDER BY day_index ASC, position ASC`,
      [id],
    );
    return { ...this.mapChallenge(c), tasks: tasks.map((t: any) => this.mapTask(t)) };
  }

  async updateChallenge(tenantId: string, id: string, dto: UpdateChallengeDto) {
    const { queryRunner, userId } = this.getRlsContext();
    const columnMap: Record<string, string> = {
      title: 'title',
      description: 'description',
      coverImageUrl: 'cover_image_url',
      category: 'category',
      durationDays: 'duration_days',
      startsOn: 'starts_on',
      isPublished: 'is_published',
    };
    const setClauses: string[] = [];
    const params: any[] = [id, tenantId];
    for (const [key, col] of Object.entries(columnMap)) {
      if ((dto as any)[key] !== undefined) {
        params.push((dto as any)[key]);
        setClauses.push(`${col} = $${params.length}`);
      }
    }
    if (setClauses.length === 0) return this.getChallengeAdmin(tenantId, id);
    setClauses.push('updated_at = now()');
    const rows = await queryRunner.query(
      `UPDATE public.challenges SET ${setClauses.join(', ')}
       WHERE id = $1 AND tenant_id = $2 RETURNING id, title`,
      params,
    );
    if (!rows.length) throw new NotFoundException('Challenge not found');
    await this.audit.log({
      action: 'challenge.updated',
      resourceType: 'challenge',
      resourceId: id,
      summary: `${await this.actorName(userId)} updated challenge "${rows[0].title}"`,
      metadata: { changedFields: Object.keys(dto), title: rows[0].title },
    });
    return this.getChallengeAdmin(tenantId, id);
  }

  async deleteChallenge(tenantId: string, id: string) {
    const { queryRunner, userId } = this.getRlsContext();
    const [before] = await queryRunner.query(
      `SELECT title FROM public.challenges WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId],
    );
    const rows = await queryRunner.query(
      `DELETE FROM public.challenges WHERE id = $1 AND tenant_id = $2 RETURNING id`,
      [id, tenantId],
    );
    if (!rows.length) throw new NotFoundException('Challenge not found');
    await this.audit.log({
      action: 'challenge.deleted',
      resourceType: 'challenge',
      resourceId: id,
      summary: `${await this.actorName(userId)} deleted challenge "${before?.title ?? '(unknown)'}"`,
      metadata: { title: before?.title },
    });
    return { id, deleted: true };
  }

  private async assertChallengeInTenant(tenantId: string, challengeId: string) {
    const { queryRunner } = this.getRlsContext();
    const [c] = await queryRunner.query(
      `SELECT id FROM public.challenges WHERE id = $1 AND tenant_id = $2`,
      [challengeId, tenantId],
    );
    if (!c) throw new NotFoundException('Challenge not found');
  }

  async addTask(tenantId: string, challengeId: string, dto: ChallengeTaskInput) {
    await this.assertChallengeInTenant(tenantId, challengeId);
    this.validateTaskShape(dto);
    const { queryRunner } = this.getRlsContext();
    const [row] = await queryRunner.query(
      `INSERT INTO public.challenge_tasks
         (challenge_id, tenant_id, day_index, position, task_type, title,
          scripture_reference, scripture_translation, body, timer_seconds, reflection_prompt)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        challengeId,
        tenantId,
        dto.dayIndex,
        dto.position ?? 0,
        dto.taskType,
        dto.title ?? null,
        dto.scriptureReference ?? null,
        dto.scriptureTranslation ?? null,
        dto.body ?? null,
        dto.timerSeconds ?? null,
        dto.reflectionPrompt ?? null,
      ],
    );
    return this.mapTask(row);
  }

  async updateTask(tenantId: string, challengeId: string, taskId: string, dto: UpdateChallengeTaskDto) {
    await this.assertChallengeInTenant(tenantId, challengeId);
    const { queryRunner } = this.getRlsContext();
    const columnMap: Record<string, string> = {
      dayIndex: 'day_index',
      position: 'position',
      taskType: 'task_type',
      title: 'title',
      scriptureReference: 'scripture_reference',
      scriptureTranslation: 'scripture_translation',
      body: 'body',
      timerSeconds: 'timer_seconds',
      reflectionPrompt: 'reflection_prompt',
    };
    const setClauses: string[] = [];
    const params: any[] = [taskId, challengeId];
    for (const [key, col] of Object.entries(columnMap)) {
      if ((dto as any)[key] !== undefined) {
        params.push((dto as any)[key]);
        setClauses.push(`${col} = $${params.length}`);
      }
    }
    if (setClauses.length === 0) {
      const [existing] = await queryRunner.query(
        `SELECT * FROM public.challenge_tasks WHERE id = $1 AND challenge_id = $2`,
        [taskId, challengeId],
      );
      if (!existing) throw new NotFoundException('Task not found');
      return this.mapTask(existing);
    }
    setClauses.push('updated_at = now()');
    const rows = await queryRunner.query(
      `UPDATE public.challenge_tasks SET ${setClauses.join(', ')}
       WHERE id = $1 AND challenge_id = $2 RETURNING *`,
      params,
    );
    if (!rows.length) throw new NotFoundException('Task not found');
    return this.mapTask(rows[0]);
  }

  async deleteTask(tenantId: string, challengeId: string, taskId: string) {
    await this.assertChallengeInTenant(tenantId, challengeId);
    const { queryRunner } = this.getRlsContext();
    const rows = await queryRunner.query(
      `DELETE FROM public.challenge_tasks WHERE id = $1 AND challenge_id = $2 RETURNING id`,
      [taskId, challengeId],
    );
    if (!rows.length) throw new NotFoundException('Task not found');
    return { id: taskId, deleted: true };
  }

  /** Replace the entire task set for a challenge (admin builder save). */
  async replaceTasks(tenantId: string, challengeId: string, tasks: ChallengeTaskInput[]) {
    await this.assertChallengeInTenant(tenantId, challengeId);
    const { queryRunner } = this.getRlsContext();
    await queryRunner.query(`DELETE FROM public.challenge_tasks WHERE challenge_id = $1`, [challengeId]);
    if (tasks.length) await this.insertTasks(challengeId, tenantId, tasks);
    return this.getChallengeAdmin(tenantId, challengeId);
  }

  /**
   * Participation dashboard for one challenge. Reads across all enrollees,
   * so it uses the service-role connection (documented cross-user
   * aggregate bypass) with tenant + challenge pinned in the query. The
   * RoleGuard on the controller already restricts this to admin/pastor.
   */
  async getParticipation(tenantId: string, challengeId: string) {
    // Tenant ownership check still goes through RLS (queryRunner).
    await this.assertChallengeInTenant(tenantId, challengeId);

    const [[summary], byDay, topStreaks] = await Promise.all([
      this.dataSource.query(
        `SELECT
           COUNT(*) FILTER (WHERE status != 'abandoned')::int AS enrolled_count,
           COUNT(*) FILTER (WHERE status = 'active')::int     AS active_count,
           COUNT(*) FILTER (WHERE status = 'completed')::int  AS completed_count
         FROM public.challenge_enrollments
         WHERE challenge_id = $1 AND tenant_id = $2`,
        [challengeId, tenantId],
      ),
      this.dataSource.query(
        `SELECT t.day_index,
                COUNT(DISTINCT t.id)::int AS task_count,
                COUNT(comp.id)::int       AS completion_count,
                COUNT(DISTINCT comp.user_id)::int AS member_count
         FROM public.challenge_tasks t
         LEFT JOIN public.challenge_task_completions comp ON comp.task_id = t.id
         WHERE t.challenge_id = $1 AND t.tenant_id = $2
         GROUP BY t.day_index
         ORDER BY t.day_index ASC`,
        [challengeId, tenantId],
      ),
      this.dataSource.query(
        `SELECT e.user_id, u.full_name, u.avatar_url,
                e.current_streak, e.longest_streak, e.status
         FROM public.challenge_enrollments e
         JOIN public.users u ON u.id = e.user_id
         WHERE e.challenge_id = $1 AND e.tenant_id = $2 AND e.status != 'abandoned'
         ORDER BY e.longest_streak DESC, e.current_streak DESC
         LIMIT 20`,
        [challengeId, tenantId],
      ),
    ]);

    const [totalTasksRow] = await this.dataSource.query(
      `SELECT COUNT(*)::int AS total FROM public.challenge_tasks WHERE challenge_id = $1`,
      [challengeId],
    );
    const [totalCompletionsRow] = await this.dataSource.query(
      `SELECT COUNT(*)::int AS total FROM public.challenge_task_completions WHERE task_id IN
         (SELECT id FROM public.challenge_tasks WHERE challenge_id = $1)`,
      [challengeId],
    );

    const enrolled = summary?.enrolled_count ?? 0;
    const totalTasks = totalTasksRow?.total ?? 0;
    const possible = enrolled * totalTasks;
    const avgCompletionPct =
      possible > 0 ? Math.round(((totalCompletionsRow?.total ?? 0) / possible) * 100) : 0;

    return {
      enrolledCount: enrolled,
      activeCount: summary?.active_count ?? 0,
      completedCount: summary?.completed_count ?? 0,
      totalTasks,
      avgCompletionPct,
      completionsByDay: byDay.map((d: any) => ({
        dayIndex: d.day_index,
        taskCount: d.task_count,
        completionCount: d.completion_count,
        memberCount: d.member_count,
      })),
      topStreaks: topStreaks.map((s: any) => ({
        userId: s.user_id,
        fullName: s.full_name,
        avatarUrl: s.avatar_url,
        currentStreak: s.current_streak,
        longestStreak: s.longest_streak,
        status: s.status,
      })),
    };
  }

  // ═══════════════════════ MEMBER ═══════════════════════

  /** Browse published challenges for the tenant, annotated with my enrollment. */
  async browse(tenantId: string, userId: string) {
    const { queryRunner } = this.getRlsContext();
    const rows = await queryRunner.query(
      `SELECT c.*,
        (SELECT COUNT(*)::int FROM public.challenge_tasks t WHERE t.challenge_id = c.id) AS task_count,
        (SELECT COUNT(*)::int FROM public.challenge_enrollments e
           WHERE e.challenge_id = c.id AND e.status != 'abandoned') AS enrolled_count,
        me.id AS my_enrollment_id, me.status AS my_status, me.current_streak AS my_streak
       FROM public.challenges c
       LEFT JOIN public.challenge_enrollments me
         ON me.challenge_id = c.id AND me.user_id = $2
       WHERE c.tenant_id = $1 AND c.is_published = true
       ORDER BY c.created_at DESC`,
      [tenantId, userId],
    );
    return {
      data: rows.map((r: any) => ({
        ...this.mapChallenge(r),
        myEnrollment: r.my_enrollment_id
          ? { id: r.my_enrollment_id, status: r.my_status, currentStreak: r.my_streak }
          : null,
      })),
    };
  }

  async getChallengeMember(tenantId: string, userId: string, id: string) {
    const { queryRunner } = this.getRlsContext();
    const [c] = await queryRunner.query(
      `SELECT c.*,
        (SELECT COUNT(*)::int FROM public.challenge_tasks t WHERE t.challenge_id = c.id) AS task_count,
        (SELECT COUNT(*)::int FROM public.challenge_enrollments e
           WHERE e.challenge_id = c.id AND e.status != 'abandoned') AS enrolled_count
       FROM public.challenges c
       WHERE c.id = $1 AND c.tenant_id = $2 AND c.is_published = true`,
      [id, tenantId],
    );
    if (!c) throw new NotFoundException('Challenge not found');
    const [enrollment] = await queryRunner.query(
      `SELECT * FROM public.challenge_enrollments WHERE challenge_id = $1 AND user_id = $2`,
      [id, userId],
    );
    let myEnrollment = enrollment ? this.mapEnrollment(enrollment) : null;
    // Mythic eligibility is leaderboard-dependent; recompute the
    // viewer's own badgeTier at read so it can't go stale when another
    // member passes them on the points board.
    if (myEnrollment) {
      myEnrollment.badgeTier = await this.resolveViewerBadgeTier(
        tenantId, id, enrollment.id, userId, myEnrollment.missedCount, c.task_count ?? 0,
      );
    }
    return {
      ...this.mapChallenge(c),
      myEnrollment,
    };
  }

  async enroll(tenantId: string, userId: string, challengeId: string) {
    const { queryRunner } = this.getRlsContext();
    const [c] = await queryRunner.query(
      `SELECT id, starts_on FROM public.challenges
       WHERE id = $1 AND tenant_id = $2 AND is_published = true`,
      [challengeId, tenantId],
    );
    if (!c) throw new NotFoundException('Challenge not found');

    const today = await this.tenantToday(tenantId);
    // Fixed-cohort challenges anchor day 1 to challenges.starts_on; otherwise
    // the enrollee's day 1 is today (self-paced).
    const startedOn = c.starts_on ?? today;

    const [row] = await queryRunner.query(
      `INSERT INTO public.challenge_enrollments (challenge_id, tenant_id, user_id, started_on)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (challenge_id, user_id) DO UPDATE SET
         status = CASE WHEN public.challenge_enrollments.status = 'abandoned' THEN 'active'
                       ELSE public.challenge_enrollments.status END,
         updated_at = now()
       RETURNING *`,
      [challengeId, tenantId, userId, startedOn],
    );
    return this.mapEnrollment(row);
  }

  async unenroll(tenantId: string, userId: string, challengeId: string) {
    const { queryRunner } = this.getRlsContext();
    const rows = await queryRunner.query(
      `UPDATE public.challenge_enrollments SET status = 'abandoned', updated_at = now()
       WHERE challenge_id = $1 AND user_id = $2 RETURNING id`,
      [challengeId, userId],
    );
    if (!rows.length) throw new NotFoundException('Enrollment not found');
    return { id: rows[0].id, status: 'abandoned' };
  }

  /** day_index for an enrollment given tenant-local today (1-based, clamped). */
  private dayIndexFor(startedOn: string | Date, today: string, durationDays: number): number {
    const start = this.toDateString(startedOn);
    const diff = Math.floor(
      (Date.parse(today + 'T00:00:00Z') - Date.parse(start + 'T00:00:00Z')) / 86400000,
    );
    return diff + 1; // may be <1 (not started) or >durationDays (finished); caller clamps
  }

  /**
   * Tasks for a given day of a challenge, annotated with my completion +
   * gating booleans + unlocksAt timestamp (migration 098).
   *
   * Pass `currentDayIndex` (tenant-local "today" mapped to the
   * enrollment's day) so isLocked/isLate are server-authoritative.
   *
   * Pass `enrollmentStartedOn` + `tenantTimezone` to populate
   * `unlocksAt` (UTC ISO) on locked tasks — powers mobile's "Unlocks
   * in N hours" chip. When either is null, unlocksAt comes back null.
   */
  private async tasksForDay(
    challengeId: string,
    userId: string,
    dayIndex: number,
    currentDayIndex: number | null = null,
    enrollmentStartedOn: string | Date | null = null,
    tenantTimezone: string | null = null,
  ) {
    const { queryRunner } = this.getRlsContext();
    const rows = await queryRunner.query(
      `SELECT t.*,
              comp.id AS completion_id, comp.completed_at, comp.reflection_text,
              comp.seconds_spent, comp.timer_satisfied,
              comp.is_late, comp.points_earned
       FROM public.challenge_tasks t
       LEFT JOIN public.challenge_task_completions comp
         ON comp.task_id = t.id AND comp.user_id = $2
       WHERE t.challenge_id = $1 AND t.day_index = $3
       ORDER BY t.position ASC`,
      [challengeId, userId, dayIndex],
    );

    // Compute unlocksAt once for the whole day (all rows share the
    // same dayIndex, so they share the same unlock instant). Skip the
    // SQL entirely if we don't have the inputs or the day isn't locked.
    let unlocksAt: string | null = null;
    if (
      enrollmentStartedOn != null &&
      tenantTimezone != null &&
      currentDayIndex != null &&
      dayIndex > currentDayIndex
    ) {
      unlocksAt = await this.unlocksAtFor(enrollmentStartedOn, dayIndex, tenantTimezone);
    }

    return rows.map((r: any) => {
      const isCompleted = r.completion_id != null;
      // Per the mobile spec:
      //   isLocked = dayIndex > currentLocalDayIndex AND not completed
      //   isLate   = dayIndex < currentLocalDayIndex AND not completed
      // Once completed, both flags are false (the deed is done).
      const isLocked = currentDayIndex != null && dayIndex > currentDayIndex && !isCompleted;
      const isLate   = currentDayIndex != null && dayIndex < currentDayIndex && !isCompleted;
      return {
        ...this.mapTask(r),
        isLocked,
        isLate,
        // unlocksAt only meaningful when isLocked === true. null
        // otherwise (mobile uses it to render "Unlocks in N hours").
        unlocksAt: isLocked ? unlocksAt : null,
        completion: isCompleted
          ? {
              id: r.completion_id,
              completedAt: r.completed_at,
              reflectionText: r.reflection_text,
              secondsSpent: r.seconds_spent,
              timerSatisfied: r.timer_satisfied,
              isLate: !!r.is_late,
              pointsEarned: r.points_earned ?? 0,
            }
          : null,
      };
    });
  }

  /** Today's to-do across all of my active enrollments, grouped by challenge. */
  async getTodayAll(tenantId: string, userId: string) {
    const { queryRunner } = this.getRlsContext();
    const today = await this.tenantToday(tenantId);
    const enrollments = await queryRunner.query(
      `SELECT e.*, c.title, c.cover_image_url, c.duration_days
       FROM public.challenge_enrollments e
       JOIN public.challenges c ON c.id = e.challenge_id
       WHERE e.user_id = $1 AND e.tenant_id = $2 AND e.status = 'active'
       ORDER BY e.created_at ASC`,
      [userId, tenantId],
    );

    // Look up tenant TZ once for the loop — needed to compute
    // unlocksAt timestamps on locked tasks.
    const tenantTz = await this.tenantTimezone(tenantId);

    const data = [];
    for (const e of enrollments) {
      const rawDay = this.dayIndexFor(e.started_on, today, e.duration_days);
      const started = rawDay >= 1;
      const finished = rawDay > e.duration_days;
      const dayIndex = Math.min(Math.max(rawDay, 1), e.duration_days);
      // Pass rawDay + startedOn + tz so isLocked/isLate/unlocksAt are
      // server-authoritative on every task row.
      const tasks = started && !finished
        ? await this.tasksForDay(e.challenge_id, userId, rawDay, rawDay, e.started_on, tenantTz)
        : [];
      const enrollment = this.mapEnrollment(e);
      // Resolve live badge tier for the viewer's own enrollment (Mythic
      // depends on the leaderboard so it can't trust the denormalized
      // value alone).
      enrollment.badgeTier = await this.resolveViewerBadgeTier(
        tenantId, e.challenge_id, e.id, userId, enrollment.missedCount, await this.totalTaskCount(e.challenge_id),
      );
      data.push({
        challenge: {
          id: e.challenge_id,
          title: e.title,
          coverImageUrl: e.cover_image_url,
          durationDays: e.duration_days,
        },
        enrollment,
        dayIndex,
        started,
        finished,
        tasks,
      });
    }
    return { date: today, data };
  }

  /** Total task count for a challenge (used by badge tier derivation). */
  private async totalTaskCount(challengeId: string): Promise<number> {
    const { queryRunner } = this.getRlsContext();
    const [r] = await queryRunner.query(
      `SELECT COUNT(*)::int AS n FROM public.challenge_tasks WHERE challenge_id = $1`,
      [challengeId],
    );
    return r?.n ?? 0;
  }

  async getChallengeToday(tenantId: string, userId: string, challengeId: string) {
    const { queryRunner } = this.getRlsContext();
    // Filter abandoned — consistent with getDay/completeTask. Without
    // this filter, an unenrolled user could still pull today's tasks.
    const [e] = await queryRunner.query(
      `SELECT e.*, c.duration_days FROM public.challenge_enrollments e
       JOIN public.challenges c ON c.id = e.challenge_id
       WHERE e.challenge_id = $1 AND e.user_id = $2 AND e.status != 'abandoned'`,
      [challengeId, userId],
    );
    if (!e) throw new BadRequestException('Not enrolled in this challenge');
    const today = await this.tenantToday(tenantId);
    const tenantTz = await this.tenantTimezone(tenantId);
    const rawDay = this.dayIndexFor(e.started_on, today, e.duration_days);
    const started = rawDay >= 1;
    const finished = rawDay > e.duration_days;
    const tasks = started && !finished
      ? await this.tasksForDay(challengeId, userId, rawDay, rawDay, e.started_on, tenantTz)
      : [];
    const enrollment = this.mapEnrollment(e);
    enrollment.badgeTier = await this.resolveViewerBadgeTier(
      tenantId, challengeId, e.id, userId, enrollment.missedCount, await this.totalTaskCount(challengeId),
    );
    return {
      date: today,
      dayIndex: Math.min(Math.max(rawDay, 1), e.duration_days),
      started,
      finished,
      enrollment,
      tasks,
    };
  }

  async getDay(tenantId: string, userId: string, challengeId: string, dayIndex: number) {
    await this.assertEnrolled(challengeId, userId);
    // Compute the enrollment's current day so isLocked/isLate are correct.
    const { queryRunner } = this.getRlsContext();
    const [e] = await queryRunner.query(
      `SELECT started_on, c.duration_days FROM public.challenge_enrollments e
       JOIN public.challenges c ON c.id = e.challenge_id
       WHERE e.challenge_id = $1 AND e.user_id = $2`,
      [challengeId, userId],
    );
    // Reject out-of-range dayIndex with a real 400 rather than silently
    // returning an empty tasks array (which mobile would render as a
    // blank "Day 99999" page).
    if (dayIndex < 1 || dayIndex > e.duration_days) {
      throw new BadRequestException(
        `Day ${dayIndex} is out of range — this plan has ${e.duration_days} day(s).`,
      );
    }
    const today = await this.tenantToday(tenantId);
    const tenantTz = await this.tenantTimezone(tenantId);
    const currentDay = this.dayIndexFor(e.started_on, today, e.duration_days);
    const tasks = await this.tasksForDay(
      challengeId, userId, dayIndex, currentDay, e.started_on, tenantTz,
    );
    return { dayIndex, tasks };
  }

  private async assertEnrolled(challengeId: string, userId: string) {
    const { queryRunner } = this.getRlsContext();
    const [e] = await queryRunner.query(
      `SELECT id FROM public.challenge_enrollments
       WHERE challenge_id = $1 AND user_id = $2 AND status != 'abandoned'`,
      [challengeId, userId],
    );
    if (!e) throw new BadRequestException('Not enrolled in this challenge');
    return e.id as string;
  }

  /**
   * Complete a task. Validates task-type requirements, applies the
   * Faith Walks gating rules (migration 098):
   *   - Future days (dayIndex > today): 400 TASK_LOCKED
   *   - Past missed days (dayIndex < today): accept, mark isLate,
   *     award 0 points, do NOT bump streak, clear any matching
   *     missed_tasks row.
   *   - Today: accept, award tier-based points, bump streak.
   */
  async completeTask(tenantId: string, userId: string, taskId: string, dto: CompleteTaskDto) {
    const { queryRunner } = this.getRlsContext();

    const [task] = await queryRunner.query(
      `SELECT * FROM public.challenge_tasks WHERE id = $1 AND tenant_id = $2`,
      [taskId, tenantId],
    );
    if (!task) throw new NotFoundException('Task not found');

    const [enrollment] = await queryRunner.query(
      `SELECT e.*, c.duration_days FROM public.challenge_enrollments e
       JOIN public.challenges c ON c.id = e.challenge_id
       WHERE e.challenge_id = $1 AND e.user_id = $2 AND e.status != 'abandoned'`,
      [task.challenge_id, userId],
    );
    if (!enrollment) throw new BadRequestException('Not enrolled in this challenge');

    // ── boundary validation per task type ──
    if (task.task_type === 'reflection' && !dto.reflectionText?.trim()) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'REFLECTION_REQUIRED',
        message: 'This reflection task requires a written response.',
      });
    }
    if (task.task_type === 'scripture' && task.timer_seconds && task.timer_seconds > 0) {
      // Server-authoritative timer gate. Both fields are required and
      // both must affirm: secondsSpent must be a number >= timerSeconds
      // AND timerSatisfied must be true. Missing fields are treated as
      // not-satisfied (a buggy or malicious client that omits both can't
      // silently bypass the gate).
      const enoughTime = typeof dto.secondsSpent === 'number' && dto.secondsSpent >= task.timer_seconds;
      const affirmed = dto.timerSatisfied === true;
      if (!affirmed || !enoughTime) {
        throw new BadRequestException({
          statusCode: 400,
          code: 'TIMER_NOT_SATISFIED',
          message: `Keep reading — this task unlocks after ${task.timer_seconds}s.`,
          requiredSeconds: task.timer_seconds,
        });
      }
    }

    const today = await this.tenantToday(tenantId);
    const currentDayIndex = this.dayIndexFor(enrollment.started_on, today, enrollment.duration_days);

    // ── Faith Walks gating (migration 098) ──
    // Future day: hard-stop with TASK_LOCKED. Payload carries both
    // unlocksOn (YYYY-MM-DD, kept for back-compat) and unlocksAt
    // (UTC ISO timestamp, used by mobile's "Unlocks in N hours" chip).
    if (task.day_index > currentDayIndex) {
      const tenantTz = await this.tenantTimezone(tenantId);
      const [u] = await queryRunner.query(
        `SELECT
           to_char(($1::date + ($2::int - 1) * INTERVAL '1 day')::date, 'YYYY-MM-DD') AS unlocks_on,
           (($1::date + ($2::int - 1) * INTERVAL '1 day')::date::timestamp AT TIME ZONE $3) AS unlocks_at`,
        [this.toDateString(enrollment.started_on), task.day_index, tenantTz],
      );
      throw new BadRequestException({
        statusCode: 400,
        code: 'TASK_LOCKED',
        message: "This task isn't unlocked yet.",
        unlocksOn: u?.unlocks_on,
        unlocksAt: u?.unlocks_at ? new Date(u.unlocks_at).toISOString() : null,
      });
    }

    // Past-day completion → late; today's → on-time. Late means:
    //   - is_late = true on the completion row
    //   - points_earned = 0
    //   - no streak bump
    //   - no completion_pct bump (excluded from on-time count)
    const isLate = task.day_index < currentDayIndex;

    // Tenant-local hour for points tier. Late = 0 points regardless.
    const [hourRow] = await queryRunner.query(
      `SELECT EXTRACT(HOUR FROM (now() AT TIME ZONE timezone))::int AS hour
       FROM public.tenants WHERE id = $1`,
      [tenantId],
    );
    const localHour = hourRow?.hour ?? 12;
    const pointsEarned = this.pointsForHour(localHour, isLate);

    // Insert/upsert the completion. ON CONFLICT updates everything
    // EXCEPT is_late/points_earned — those are set on first insert and
    // shouldn't flip if the user edits their reflection text later.
    //
    // RETURNING (xmax = 0) AS inserted is the canonical Postgres trick
    // to distinguish "newly inserted" from "existing row updated" in
    // an ON CONFLICT clause. xmax is 0 on a fresh INSERT, non-zero on
    // an UPDATE. We gate the side-effects (total_points bump, streak
    // update, missed_count decrement, completion status flip) on this
    // flag so re-POSTing a completion (double-tap, retry, reflection
    // edit) doesn't double-count points or drift missed_count.
    //
    // We also return the EXISTING is_late/points_earned so the response
    // reports the truth — not what would have been awarded had this
    // been a fresh completion.
    const [upsertResult] = await queryRunner.query(
      `INSERT INTO public.challenge_task_completions
         (enrollment_id, task_id, user_id, tenant_id, completed_on,
          reflection_text, seconds_spent, timer_satisfied, is_late, points_earned)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (enrollment_id, task_id) DO UPDATE SET
         reflection_text = EXCLUDED.reflection_text,
         seconds_spent   = EXCLUDED.seconds_spent,
         timer_satisfied = EXCLUDED.timer_satisfied
       RETURNING (xmax = 0) AS inserted, is_late AS row_is_late, points_earned AS row_points_earned`,
      [
        enrollment.id,
        taskId,
        userId,
        tenantId,
        today,
        dto.reflectionText?.trim() || null,
        dto.secondsSpent ?? null,
        dto.timerSatisfied ?? true,
        isLate,
        pointsEarned,
      ],
    );
    const wasInserted: boolean = upsertResult.inserted === true;
    // Use the row's stored values for the response (so re-completions
    // report what the user actually got, not what they'd get fresh).
    const effectiveIsLate: boolean = !!upsertResult.row_is_late;
    const effectivePointsEarned: number = upsertResult.row_points_earned ?? 0;

    // ── Side-effects only fire on a fresh insert. Re-POSTs are no-ops
    // for points/streak/missed_count drift. ──

    // Late completion → clear the matching missed_tasks row + decrement
    // missed_count. Couple the decrement to whether the DELETE actually
    // removed a row (defends against repeat-decrement if the dedupe row
    // was already gone).
    if (wasInserted && isLate) {
      const deleted = await queryRunner.query(
        `WITH d AS (
           DELETE FROM public.challenge_enrollment_missed_tasks
           WHERE enrollment_id = $1 AND task_id = $2
           RETURNING 1
         )
         UPDATE public.challenge_enrollments
         SET missed_count = GREATEST(missed_count - (SELECT COUNT(*)::int FROM d), 0),
             updated_at = now()
         WHERE id = $1
         RETURNING missed_count`,
        [enrollment.id, taskId],
      );
      // Note: GREATEST floor protects against rare drift (e.g. cron
      // didn't pick up the task yet but user is completing it late);
      // the COUNT-coupled subquery means a repeat decrement after the
      // dedupe row is gone resolves to 0 anyway.
      void deleted;
    }

    // Streak only moves on FRESH on-time completions. Re-POSTs are no-ops.
    let streak: { current_streak: number; longest_streak: number; last_completed_date: any };
    if (wasInserted && !isLate) {
      const [s] = await queryRunner.query(
        `WITH calc AS (
           SELECT CASE
                    WHEN last_completed_date = $2::date THEN current_streak
                    WHEN last_completed_date = $2::date - 1 THEN current_streak + 1
                    ELSE 1
                  END AS new_streak
           FROM public.challenge_enrollments WHERE id = $1
         )
         UPDATE public.challenge_enrollments e SET
           current_streak = calc.new_streak,
           longest_streak = GREATEST(e.longest_streak, calc.new_streak),
           last_completed_date = $2::date,
           updated_at = now()
         FROM calc
         WHERE e.id = $1
         RETURNING e.current_streak, e.longest_streak, e.last_completed_date`,
        [enrollment.id, today],
      );
      streak = s;
    } else {
      // Late OR repeat completion: don't touch streak; reflect current values.
      streak = {
        current_streak: enrollment.current_streak,
        longest_streak: enrollment.longest_streak,
        last_completed_date: enrollment.last_completed_date,
      };
    }

    // total_points bump ONLY on fresh insert (gated by wasInserted).
    // Re-POSTs are intentional no-ops here — the row already has its
    // points stored from the first insert, and we don't want a refresh
    // or reflection edit to farm more points.
    if (wasInserted) {
      await queryRunner.query(
        `UPDATE public.challenge_enrollments
         SET total_points = total_points + $2, updated_at = now()
         WHERE id = $1`,
        [enrollment.id, pointsEarned],
      );
    }

    // Flip to completed when every task in the plan has a completion row.
    const [counts] = await queryRunner.query(
      `SELECT
         (SELECT COUNT(*)::int FROM public.challenge_tasks WHERE challenge_id = $1) AS total,
         (SELECT COUNT(*)::int FROM public.challenge_task_completions WHERE enrollment_id = $2) AS done`,
      [task.challenge_id, enrollment.id],
    );
    let status = enrollment.status;
    if (counts.total > 0 && counts.done >= counts.total) {
      await queryRunner.query(
        `UPDATE public.challenge_enrollments
         SET status = 'completed', completed_at = COALESCE(completed_at, now()), updated_at = now()
         WHERE id = $1`,
        [enrollment.id],
      );
      status = 'completed';
    }

    // Re-read enrollment to get the updated missed_count + total_points
    // for the response payload (mobile renders the medal ribbon off this).
    const [updated] = await queryRunner.query(
      `SELECT * FROM public.challenge_enrollments WHERE id = $1`,
      [enrollment.id],
    );
    const mappedEnrollment = this.mapEnrollment(updated);
    mappedEnrollment.badgeTier = await this.resolveViewerBadgeTier(
      tenantId, task.challenge_id, enrollment.id, userId, mappedEnrollment.missedCount, counts.total,
    );

    return {
      recorded: true,
      taskId,
      completedOn: today,
      // Report the row's actual stored values, not the just-computed ones.
      // On re-POST these reflect what the user originally got, not a
      // fresh recomputation against the current hour.
      isLate: effectiveIsLate,
      pointsEarned: effectivePointsEarned,
      enrollment: {
        ...mappedEnrollment,
        status,
        currentStreak: streak.current_streak,
        longestStreak: streak.longest_streak,
        lastCompletedDate: this.toDateString(streak.last_completed_date),
      },
      progress: { completedTaskCount: counts.done, totalTaskCount: counts.total },
    };
  }

  // ─────────────────── Leaderboard (migration 098) ───────────────────

  /**
   * Per-challenge leaderboard with both orderings + the viewer's own
   * ranks. Filters out users blocked by or blocking the viewer. Cache
   * is the responsibility of the caller (mobile wraps in useQuery
   * with staleTime: 60s).
   *
   * SERVICE-ROLE BYPASS (documented per CLAUDE.md): this is a
   * cross-user aggregate read. The SELECT policies on
   * challenge_enrollments and challenge_task_completions are both
   * `user_id = auth.uid()`, so the request queryRunner would return
   * ONLY the viewer's own enrollment + completion count of 0 for
   * every other user. Service-role with tenant + challenge pinned in
   * the WHERE is the correct pattern. user_blocks is also queried
   * service-role so both directions of block (viewer blocked X, X
   * blocked viewer) are visible — the RLS policy on user_blocks is
   * `blocker_id = auth.uid()` and would hide the reciprocal direction.
   *
   * Tenant scope is enforced by the explicit `e.tenant_id = $1`
   * pin (the tenantId argument comes from the verified JWT —
   * never from user-controlled input), so no cross-tenant data
   * can leak.
   */
  async getLeaderboard(tenantId: string, viewerId: string, challengeId: string, limit: number = 50) {
    // Validate the challenge belongs to this tenant via the RLS path
    // (cheap viewer-scoped read; gives a friendlier 404 than the
    // service-role query returning [] for an out-of-tenant challenge).
    const { queryRunner } = this.getRlsContext();
    const [c] = await queryRunner.query(
      `SELECT id FROM public.challenges WHERE id = $1 AND tenant_id = $2`,
      [challengeId, tenantId],
    );
    if (!c) throw new NotFoundException('Challenge not found');

    const cap = Math.min(Math.max(limit, 1), 100);

    // Service-role: pull enrollments + completion counts (both kinds).
    // on_time_count drives badge tier derivation honestly; using the
    // full completed count would inflate medals for users who only have
    // late completions.
    const rows = await this.dataSource.query(
      `SELECT
         e.id           AS enrollment_id,
         e.user_id,
         e.total_points,
         e.missed_count,
         e.current_streak,
         e.badge_tier,
         u.full_name,
         u.avatar_url,
         (SELECT COUNT(*)::int FROM public.challenge_task_completions
          WHERE enrollment_id = e.id) AS completed_task_count,
         (SELECT COUNT(*)::int FROM public.challenge_task_completions
          WHERE enrollment_id = e.id AND is_late = false) AS on_time_count
       FROM public.challenge_enrollments e
       JOIN public.users u ON u.id = e.user_id
       WHERE e.challenge_id = $1
         AND e.tenant_id = $2
         AND e.status != 'abandoned'
         AND NOT EXISTS (
           SELECT 1 FROM public.user_blocks ub
           WHERE (ub.blocker_id = $3 AND ub.blocked_id = e.user_id)
              OR (ub.blocker_id = e.user_id AND ub.blocked_id = $3)
         )`,
      [challengeId, tenantId, viewerId],
    );

    // Compute total task count once for medal derivation.
    const totalTasks = await this.totalTaskCount(challengeId);

    // Sort copies — same source data, two orderings. Tie-breakers
    // per the spec:
    //   byCompletion → ties resolved by higher totalPoints
    //   byPoints     → ties resolved by higher completedTaskCount
    const byCompletion = [...rows].sort((a, b) => {
      const dc = (b.completed_task_count ?? 0) - (a.completed_task_count ?? 0);
      return dc !== 0 ? dc : (b.total_points ?? 0) - (a.total_points ?? 0);
    });
    const byPoints = [...rows].sort((a, b) => {
      const dp = (b.total_points ?? 0) - (a.total_points ?? 0);
      return dp !== 0 ? dp : (b.completed_task_count ?? 0) - (a.completed_task_count ?? 0);
    });

    // Top-5 by points = Mythic eligibility set. MUST match the ordering
    // used by topFiveByPointsIds (called by /today, /:id, /complete) or
    // Enrollment.badgeTier disagrees with the leaderboard endpoint.
    const top5Ids = new Set(byPoints.slice(0, 5).map((r: any) => r.user_id));

    const toEntry = (rank: number, r: any) => ({
      rank,
      userId: r.user_id,
      fullName: r.full_name,
      avatarUrl: r.avatar_url,
      completedTaskCount: r.completed_task_count ?? 0,
      totalPoints: r.total_points ?? 0,
      badgeTier: this.deriveBadgeTier(
        r.missed_count ?? 0,
        r.on_time_count ?? 0,
        totalTasks,
        top5Ids.has(r.user_id),
      ),
      isMe: r.user_id === viewerId,
    });

    // Ranks are 1-indexed. Capped by `limit`.
    const byCompletionEntries = byCompletion.slice(0, cap).map((r, i) => toEntry(i + 1, r));
    const byPointsEntries     = byPoints.slice(0, cap).map((r, i) => toEntry(i + 1, r));

    // myRanks: viewer's position in the FULL sort (not capped by limit).
    const myByCompletionIdx = byCompletion.findIndex((r: any) => r.user_id === viewerId);
    const myByPointsIdx     = byPoints.findIndex((r: any) => r.user_id === viewerId);

    return {
      byCompletion: byCompletionEntries,
      byPoints: byPointsEntries,
      myRanks: {
        byCompletion: myByCompletionIdx === -1 ? null : myByCompletionIdx + 1,
        byPoints:     myByPointsIdx === -1     ? null : myByPointsIdx + 1,
      },
    };
  }

  // ─────────── Missed-day cron sweep (migration 098) ───────────

  /**
   * Sweeps a single tenant. For every active enrollment, finds tasks
   * whose anchored day is in the past, are NOT completed, and haven't
   * already been counted as missed (via the dedupe table). Increments
   * enrollments.missed_count and inserts a dedupe row. Idempotent.
   * Service-role (called from the scheduler, not from a request).
   */
  async sweepMissedTasksForTenant(tenantId: string): Promise<{ tenantId: string; tasksMissed: number; enrollmentsTouched: number }> {
    // Use the service-role DataSource (cron has no JWT context).
    const today = (await this.dataSource.query(
      `SELECT to_char((now() AT TIME ZONE timezone)::date, 'YYYY-MM-DD') AS today
       FROM public.tenants WHERE id = $1`,
      [tenantId],
    ))[0]?.today;
    if (!today) return { tenantId, tasksMissed: 0, enrollmentsTouched: 0 };

    // Find (enrollment, task) pairs where:
    //   - the task's anchored date (enrollment.started_on + (day_index - 1)) < today
    //   - there's no completion row for that pair
    //   - there's no dedupe row already
    const missed = await this.dataSource.query(
      `SELECT e.id AS enrollment_id, t.id AS task_id
       FROM public.challenge_enrollments e
       JOIN public.challenges c ON c.id = e.challenge_id
       JOIN public.challenge_tasks t ON t.challenge_id = c.id
       WHERE e.tenant_id = $1
         AND e.status = 'active'
         AND (e.started_on + (t.day_index - 1) * INTERVAL '1 day')::date < $2::date
         AND NOT EXISTS (
           SELECT 1 FROM public.challenge_task_completions ctc
           WHERE ctc.enrollment_id = e.id AND ctc.task_id = t.id
         )
         AND NOT EXISTS (
           SELECT 1 FROM public.challenge_enrollment_missed_tasks m
           WHERE m.enrollment_id = e.id AND m.task_id = t.id
         )`,
      [tenantId, today],
    );

    if (missed.length === 0) return { tenantId, tasksMissed: 0, enrollmentsTouched: 0 };

    // Insert dedupe rows + bump missed_count per enrollment in one txn.
    // Group by enrollment to do one UPDATE per enrollment instead of N.
    const perEnrollment = new Map<string, number>();
    for (const row of missed) {
      perEnrollment.set(row.enrollment_id, (perEnrollment.get(row.enrollment_id) ?? 0) + 1);
    }

    // Insert all dedupe rows.
    const values = missed.map((_: any, i: number) => `($${i * 3 + 1}, $${i * 3 + 2}, $${i * 3 + 3})`).join(',');
    const params = missed.flatMap((r: any) => [r.enrollment_id, r.task_id, tenantId]);
    await this.dataSource.query(
      `INSERT INTO public.challenge_enrollment_missed_tasks (enrollment_id, task_id, tenant_id)
       VALUES ${values}
       ON CONFLICT (enrollment_id, task_id) DO NOTHING`,
      params,
    );

    // Bump missed_count per enrollment.
    for (const [enrollmentId, count] of perEnrollment.entries()) {
      await this.dataSource.query(
        `UPDATE public.challenge_enrollments
         SET missed_count = missed_count + $2, updated_at = now()
         WHERE id = $1`,
        [enrollmentId, count],
      );
    }

    return { tenantId, tasksMissed: missed.length, enrollmentsTouched: perEnrollment.size };
  }

  /**
   * Service-role helper for the scheduler — find tenants whose local
   * time is currently in the just-past-midnight window (00:00-00:59).
   * The scheduler runs hourly globally; on each fire we identify
   * tenants that just crossed local midnight and sweep them.
   */
  async findTenantsAtMidnight(): Promise<string[]> {
    const rows = await this.dataSource.query(
      `SELECT id FROM public.tenants
       WHERE EXTRACT(HOUR FROM (now() AT TIME ZONE timezone)) = 0`,
    );
    return rows.map((r: any) => r.id);
  }

  /** My progress on a challenge: per-day completion + streaks. */
  async getProgress(tenantId: string, userId: string, challengeId: string) {
    const { queryRunner } = this.getRlsContext();
    const [e] = await queryRunner.query(
      `SELECT e.*, c.duration_days FROM public.challenge_enrollments e
       JOIN public.challenges c ON c.id = e.challenge_id
       WHERE e.challenge_id = $1 AND e.user_id = $2`,
      [challengeId, userId],
    );
    if (!e) throw new BadRequestException('Not enrolled in this challenge');

    const today = await this.tenantToday(tenantId);
    const days = await queryRunner.query(
      `SELECT t.day_index,
              COUNT(DISTINCT t.id)::int AS total,
              COUNT(comp.id)::int       AS completed
       FROM public.challenge_tasks t
       LEFT JOIN public.challenge_task_completions comp
         ON comp.task_id = t.id AND comp.user_id = $2
       WHERE t.challenge_id = $1
       GROUP BY t.day_index
       ORDER BY t.day_index ASC`,
      [challengeId, userId],
    );
    const [totals] = await queryRunner.query(
      `SELECT
         (SELECT COUNT(*)::int FROM public.challenge_tasks WHERE challenge_id = $1) AS total,
         (SELECT COUNT(*)::int FROM public.challenge_task_completions WHERE enrollment_id = $2) AS done`,
      [challengeId, e.id],
    );
    const totalTasks = totals?.total ?? 0;
    const doneTasks = totals?.done ?? 0;

    // Recompute the viewer's badge tier so Mythic doesn't go stale
    // between leaderboard shifts. Same pattern as getTodayAll +
    // getChallengeToday + getChallengeMember.
    const mappedEnrollment = this.mapEnrollment(e);
    mappedEnrollment.badgeTier = await this.resolveViewerBadgeTier(
      tenantId, challengeId, e.id, userId, mappedEnrollment.missedCount, totalTasks,
    );

    return {
      enrollment: mappedEnrollment,
      dayIndex: Math.min(Math.max(this.dayIndexFor(e.started_on, today, e.duration_days), 1), e.duration_days),
      totalDays: e.duration_days,
      completedTaskCount: doneTasks,
      totalTaskCount: totalTasks,
      completionPct: totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0,
      currentStreak: e.current_streak,
      longestStreak: e.longest_streak,
      days: days.map((d: any) => ({
        dayIndex: d.day_index,
        total: d.total,
        completed: d.completed,
        isComplete: d.completed >= d.total && d.total > 0,
      })),
    };
  }
}
