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
    };
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
    return {
      ...this.mapChallenge(c),
      myEnrollment: enrollment ? this.mapEnrollment(enrollment) : null,
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

  /** Tasks for a given day of a challenge, annotated with my completion. */
  private async tasksForDay(challengeId: string, userId: string, dayIndex: number) {
    const { queryRunner } = this.getRlsContext();
    const rows = await queryRunner.query(
      `SELECT t.*,
              comp.id AS completion_id, comp.completed_at, comp.reflection_text,
              comp.seconds_spent, comp.timer_satisfied
       FROM public.challenge_tasks t
       LEFT JOIN public.challenge_task_completions comp
         ON comp.task_id = t.id AND comp.user_id = $2
       WHERE t.challenge_id = $1 AND t.day_index = $3
       ORDER BY t.position ASC`,
      [challengeId, userId, dayIndex],
    );
    return rows.map((r: any) => ({
      ...this.mapTask(r),
      completion: r.completion_id
        ? {
            id: r.completion_id,
            completedAt: r.completed_at,
            reflectionText: r.reflection_text,
            secondsSpent: r.seconds_spent,
            timerSatisfied: r.timer_satisfied,
          }
        : null,
    }));
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

    const data = [];
    for (const e of enrollments) {
      const rawDay = this.dayIndexFor(e.started_on, today, e.duration_days);
      const started = rawDay >= 1;
      const finished = rawDay > e.duration_days;
      const dayIndex = Math.min(Math.max(rawDay, 1), e.duration_days);
      const tasks = started && !finished ? await this.tasksForDay(e.challenge_id, userId, rawDay) : [];
      data.push({
        challenge: {
          id: e.challenge_id,
          title: e.title,
          coverImageUrl: e.cover_image_url,
          durationDays: e.duration_days,
        },
        enrollment: this.mapEnrollment(e),
        dayIndex,
        started,
        finished,
        tasks,
      });
    }
    return { date: today, data };
  }

  async getChallengeToday(tenantId: string, userId: string, challengeId: string) {
    const { queryRunner } = this.getRlsContext();
    const [e] = await queryRunner.query(
      `SELECT e.*, c.duration_days FROM public.challenge_enrollments e
       JOIN public.challenges c ON c.id = e.challenge_id
       WHERE e.challenge_id = $1 AND e.user_id = $2`,
      [challengeId, userId],
    );
    if (!e) throw new BadRequestException('Not enrolled in this challenge');
    const today = await this.tenantToday(tenantId);
    const rawDay = this.dayIndexFor(e.started_on, today, e.duration_days);
    const started = rawDay >= 1;
    const finished = rawDay > e.duration_days;
    const tasks = started && !finished ? await this.tasksForDay(challengeId, userId, rawDay) : [];
    return {
      date: today,
      dayIndex: Math.min(Math.max(rawDay, 1), e.duration_days),
      started,
      finished,
      enrollment: this.mapEnrollment(e),
      tasks,
    };
  }

  async getDay(tenantId: string, userId: string, challengeId: string, dayIndex: number) {
    await this.assertEnrolled(challengeId, userId);
    const tasks = await this.tasksForDay(challengeId, userId, dayIndex);
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
   * Complete a task. Validates task-type requirements (reflection text,
   * scripture read-timer), records the completion, bumps the day-granular
   * streak, and flips the enrollment to 'completed' once every task is done.
   */
  async completeTask(tenantId: string, userId: string, taskId: string, dto: CompleteTaskDto) {
    const { queryRunner } = this.getRlsContext();

    const [task] = await queryRunner.query(
      `SELECT * FROM public.challenge_tasks WHERE id = $1 AND tenant_id = $2`,
      [taskId, tenantId],
    );
    if (!task) throw new NotFoundException('Task not found');

    const [enrollment] = await queryRunner.query(
      `SELECT * FROM public.challenge_enrollments
       WHERE challenge_id = $1 AND user_id = $2 AND status != 'abandoned'`,
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
      const enoughTime = dto.secondsSpent == null || dto.secondsSpent >= task.timer_seconds;
      if (dto.timerSatisfied === false || !enoughTime) {
        throw new BadRequestException({
          statusCode: 400,
          code: 'TIMER_NOT_SATISFIED',
          message: `Keep reading — this task unlocks after ${task.timer_seconds}s.`,
          requiredSeconds: task.timer_seconds,
        });
      }
    }

    const today = await this.tenantToday(tenantId);

    await queryRunner.query(
      `INSERT INTO public.challenge_task_completions
         (enrollment_id, task_id, user_id, tenant_id, completed_on, reflection_text, seconds_spent, timer_satisfied)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (enrollment_id, task_id) DO UPDATE SET
         reflection_text = EXCLUDED.reflection_text,
         seconds_spent   = EXCLUDED.seconds_spent,
         timer_satisfied = EXCLUDED.timer_satisfied`,
      [
        enrollment.id,
        taskId,
        userId,
        tenantId,
        today,
        dto.reflectionText?.trim() || null,
        dto.secondsSpent ?? null,
        dto.timerSatisfied ?? true,
      ],
    );

    // Day-granular streak. Only the first completion of a given local day
    // moves the streak; subsequent same-day completions leave it unchanged.
    const [streak] = await queryRunner.query(
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

    return {
      recorded: true,
      taskId,
      completedOn: today,
      enrollment: {
        id: enrollment.id,
        status,
        currentStreak: streak.current_streak,
        longestStreak: streak.longest_streak,
        lastCompletedDate: streak.last_completed_date,
      },
      progress: { completedTaskCount: counts.done, totalTaskCount: counts.total },
    };
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

    return {
      enrollment: this.mapEnrollment(e),
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
