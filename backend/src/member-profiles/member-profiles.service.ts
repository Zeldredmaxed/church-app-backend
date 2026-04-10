import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UpdateJourneyDto } from './dto/update-journey.dto';
import { CreateNoteDto } from './dto/create-note.dto';
import { FIELD_LIBRARY_MAP } from '../onboarding/onboarding-field-library';

@Injectable()
export class MemberProfilesService {
  private readonly logger = new Logger(MemberProfilesService.name);

  constructor(private readonly dataSource: DataSource) {}

  async getMemberProfile(tenantId: string, memberId: string) {
    const [
      personalInfo,
      tags,
      journey,
      engagement,
      givingHistory,
      activityTimeline,
      notes,
      badges,
      onboarding,
      family,
    ] = await Promise.all([
      this.getPersonalInfo(tenantId, memberId),
      this.getTags(tenantId, memberId),
      this.getJourney(tenantId, memberId),
      this.getEngagement(tenantId, memberId),
      this.getGivingHistory(tenantId, memberId),
      this.getActivityTimeline(tenantId, memberId),
      this.getNotes(tenantId, memberId),
      this.getBadges(tenantId, memberId),
      this.getOnboardingResponses(tenantId, memberId),
      this.getDirectFamily(tenantId, memberId),
    ]);

    if (!personalInfo) {
      throw new NotFoundException('Member not found in this tenant');
    }

    return {
      personalInfo,
      tags,
      journey,
      engagement,
      giving: givingHistory,
      activityTimeline,
      notes,
      badges,
      onboarding,
      family,
    };
  }

  private async getPersonalInfo(tenantId: string, memberId: string) {
    const [row] = await this.dataSource.query(
      `SELECT u.id, u.email, u.full_name, u.avatar_url, u.phone, u.created_at AS joined_at,
        tm.role, tm.permissions
       FROM public.tenant_memberships tm
       JOIN public.users u ON u.id = tm.user_id
       WHERE tm.tenant_id = $1 AND tm.user_id = $2`,
      [tenantId, memberId],
    );

    if (!row) return null;

    return {
      id: row.id,
      email: row.email,
      fullName: row.full_name,
      avatarUrl: row.avatar_url,
      phone: row.phone,
      joinedAt: row.joined_at,
      role: row.role,
      permissions: row.permissions,
    };
  }

  private async getTags(tenantId: string, memberId: string) {
    const rows = await this.dataSource.query(
      `SELECT t.id, t.name, t.color FROM public.member_tags mt
       JOIN public.tags t ON t.id = mt.tag_id
       WHERE mt.user_id = $1 AND t.tenant_id = $2`,
      [memberId, tenantId],
    );

    return rows.map((r: any) => ({
      id: r.id,
      name: r.name,
      color: r.color,
    }));
  }

  private async getJourney(tenantId: string, memberId: string) {
    const [row] = await this.dataSource.query(
      `SELECT * FROM public.member_journeys WHERE tenant_id = $1 AND user_id = $2`,
      [tenantId, memberId],
    );

    if (!row) return null;

    return {
      id: row.id,
      attendedMembersClass: row.attended_members_class,
      membersClassDate: row.members_class_date,
      isBaptized: row.is_baptized,
      baptismDate: row.baptism_date,
      salvationDate: row.salvation_date,
      discipleshipTrack: row.discipleship_track,
      skills: row.skills ?? [],
      interests: row.interests ?? [],
      bio: row.bio,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private async getEngagement(tenantId: string, memberId: string) {
    const [row] = await this.dataSource.query(
      `SELECT
        (SELECT COUNT(*)::int FROM public.posts WHERE author_id = $2 AND tenant_id = $1 AND created_at >= now() - interval '30 days') AS posts,
        (SELECT COUNT(*)::int FROM public.comments WHERE author_id = $2 AND tenant_id = $1 AND created_at >= now() - interval '30 days') AS comments,
        (SELECT COUNT(*)::int FROM public.check_ins WHERE user_id = $2 AND tenant_id = $1 AND checked_in_at >= now() - interval '30 days') AS check_ins,
        (SELECT COUNT(*)::int FROM public.post_likes WHERE user_id = $2 AND tenant_id = $1 AND created_at >= now() - interval '30 days') AS likes`,
      [tenantId, memberId],
    );

    const posts = row.posts ?? 0;
    const comments = row.comments ?? 0;
    const checkIns = row.check_ins ?? 0;
    const likes = row.likes ?? 0;
    const totalScore = posts * 3 + comments * 2 + checkIns * 2 + likes * 1;

    let level: string;
    if (totalScore === 0) level = 'inactive';
    else if (totalScore <= 5) level = 'low';
    else if (totalScore <= 15) level = 'medium';
    else level = 'high';

    return {
      posts,
      comments,
      checkIns,
      likes,
      totalScore,
      level,
    };
  }

  private async getGivingHistory(tenantId: string, memberId: string) {
    const [recentTransactions, totals] = await Promise.all([
      this.dataSource.query(
        `SELECT id, amount, currency, status, created_at
         FROM public.transactions
         WHERE tenant_id = $1 AND user_id = $2
         ORDER BY created_at DESC LIMIT 20`,
        [tenantId, memberId],
      ),
      this.dataSource.query(
        `SELECT COALESCE(SUM(amount), 0)::float AS total_given,
          COUNT(*)::int AS donation_count
         FROM public.transactions
         WHERE tenant_id = $1 AND user_id = $2 AND status = 'succeeded'`,
        [tenantId, memberId],
      ),
    ]);

    const totalsRow = totals[0];

    return {
      recentTransactions: recentTransactions.map((r: any) => ({
        id: r.id,
        amount: r.amount,
        currency: r.currency,
        status: r.status,
        createdAt: r.created_at,
      })),
      totalGiven: totalsRow.total_given,
      donationCount: totalsRow.donation_count,
    };
  }

  private async getActivityTimeline(tenantId: string, memberId: string) {
    const rows = await this.dataSource.query(
      `(SELECT 'check_in' AS type, id, 'Checked in' AS description, checked_in_at AS occurred_at FROM public.check_ins WHERE user_id = $2 AND tenant_id = $1 ORDER BY checked_in_at DESC LIMIT 5)
       UNION ALL
       (SELECT 'post' AS type, id, LEFT(content, 80) AS description, created_at FROM public.posts WHERE author_id = $2 AND tenant_id = $1 ORDER BY created_at DESC LIMIT 5)
       UNION ALL
       (SELECT 'comment' AS type, id, LEFT(content, 80) AS description, created_at FROM public.comments WHERE author_id = $2 AND tenant_id = $1 ORDER BY created_at DESC LIMIT 5)
       UNION ALL
       (SELECT 'donation' AS type, id, 'Donated $' || amount AS description, created_at FROM public.transactions WHERE user_id = $2 AND tenant_id = $1 AND status = 'succeeded' ORDER BY created_at DESC LIMIT 5)
       UNION ALL
       (SELECT 'prayer' AS type, id, LEFT(content, 80) AS description, created_at FROM public.prayers WHERE author_id = $2 AND tenant_id = $1 ORDER BY created_at DESC LIMIT 5)
       ORDER BY occurred_at DESC LIMIT 20`,
      [tenantId, memberId],
    );

    return rows.map((r: any) => ({
      type: r.type,
      id: r.id,
      description: r.description,
      occurredAt: r.occurred_at,
    }));
  }

  private async getBadges(tenantId: string, memberId: string) {
    const rows = await this.dataSource.query(
      `SELECT b.id, b.name, b.description, b.icon, b.color, b.tier, b.category,
        mb.awarded_at, mb.awarded_reason
       FROM public.member_badges mb
       JOIN public.badges b ON b.id = mb.badge_id
       WHERE mb.user_id = $2 AND mb.tenant_id = $1
       ORDER BY b.display_order, mb.awarded_at DESC`,
      [tenantId, memberId],
    );

    return rows.map((r: any) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      icon: r.icon,
      color: r.color,
      tier: r.tier,
      category: r.category,
      awardedAt: r.awarded_at,
      awardedReason: r.awarded_reason,
    }));
  }

  private async getDirectFamily(tenantId: string, memberId: string) {
    const rows = await this.dataSource.query(
      `SELECT fc.id, fc.related_user_id, fc.relationship, fc.relationship_label, fc.is_inferred,
              u.full_name, u.avatar_url
       FROM public.family_connections fc
       JOIN public.users u ON u.id = fc.related_user_id
       WHERE fc.tenant_id = $1 AND fc.user_id = $2 AND fc.status = 'accepted'
       ORDER BY fc.relationship, fc.relationship_label`,
      [tenantId, memberId],
    );

    return rows.map((r: any) => ({
      userId: r.related_user_id,
      fullName: r.full_name,
      avatarUrl: r.avatar_url,
      relationship: r.relationship,
      relationshipLabel: r.relationship_label,
      isInferred: r.is_inferred,
    }));
  }

  private async getOnboardingResponses(tenantId: string, memberId: string) {
    const [row] = await this.dataSource.query(
      `SELECT r.responses, r.submitted_at, f.fields AS form_fields, f.welcome_message
       FROM public.onboarding_responses r
       LEFT JOIN public.onboarding_forms f ON f.id = r.form_id
       WHERE r.tenant_id = $1 AND r.user_id = $2`,
      [tenantId, memberId],
    );

    if (!row) return null;

    const rawResponses: Record<string, any> = row.responses ?? {};

    // Resolve each answer with its field metadata so the frontend can render labels + types
    const resolvedAnswers = Object.entries(rawResponses).map(([key, value]) => {
      const libraryDef = FIELD_LIBRARY_MAP[key];
      return {
        key,
        label: libraryDef?.label ?? key,
        type: libraryDef?.type ?? 'text',
        category: libraryDef?.category ?? 'custom',
        value,
      };
    });

    return {
      submittedAt: row.submitted_at,
      answers: resolvedAnswers,
    };
  }

  async getNotes(tenantId: string, memberId: string) {
    const rows = await this.dataSource.query(
      `SELECT n.*, u.full_name AS author_name, u.email AS author_email
       FROM public.member_notes n
       LEFT JOIN public.users u ON u.id = n.author_id
       WHERE n.tenant_id = $1 AND n.member_id = $2
       ORDER BY n.created_at DESC`,
      [tenantId, memberId],
    );

    return rows.map((r: any) => ({
      id: r.id,
      memberId: r.member_id,
      authorId: r.author_id,
      authorName: r.author_name,
      authorEmail: r.author_email,
      content: r.content,
      isPrivate: r.is_private,
      createdAt: r.created_at,
    }));
  }

  async updateJourney(tenantId: string, memberId: string, dto: UpdateJourneyDto) {
    const fields: string[] = [];
    const values: any[] = [tenantId, memberId];
    let idx = 3;

    if (dto.attendedMembersClass !== undefined) { fields.push(`attended_members_class = $${idx++}`); values.push(dto.attendedMembersClass); }
    if (dto.membersClassDate !== undefined) { fields.push(`members_class_date = $${idx++}`); values.push(dto.membersClassDate); }
    if (dto.isBaptized !== undefined) { fields.push(`is_baptized = $${idx++}`); values.push(dto.isBaptized); }
    if (dto.baptismDate !== undefined) { fields.push(`baptism_date = $${idx++}`); values.push(dto.baptismDate); }
    if (dto.salvationDate !== undefined) { fields.push(`salvation_date = $${idx++}`); values.push(dto.salvationDate); }
    if (dto.discipleshipTrack !== undefined) { fields.push(`discipleship_track = $${idx++}`); values.push(dto.discipleshipTrack); }
    if (dto.skills !== undefined) { fields.push(`skills = $${idx++}`); values.push(dto.skills); }
    if (dto.interests !== undefined) { fields.push(`interests = $${idx++}`); values.push(dto.interests); }
    if (dto.bio !== undefined) { fields.push(`bio = $${idx++}`); values.push(dto.bio); }

    // Build the SET clause for the upsert
    const setClauses = fields.length > 0
      ? fields.join(', ') + ', updated_at = now()'
      : 'updated_at = now()';

    // Build INSERT columns and values dynamically
    const insertCols = ['tenant_id', 'user_id'];
    const insertVals = ['$1', '$2'];

    if (dto.attendedMembersClass !== undefined) { insertCols.push('attended_members_class'); }
    if (dto.membersClassDate !== undefined) { insertCols.push('members_class_date'); }
    if (dto.isBaptized !== undefined) { insertCols.push('is_baptized'); }
    if (dto.baptismDate !== undefined) { insertCols.push('baptism_date'); }
    if (dto.salvationDate !== undefined) { insertCols.push('salvation_date'); }
    if (dto.discipleshipTrack !== undefined) { insertCols.push('discipleship_track'); }
    if (dto.skills !== undefined) { insertCols.push('skills'); }
    if (dto.interests !== undefined) { insertCols.push('interests'); }
    if (dto.bio !== undefined) { insertCols.push('bio'); }

    // Generate matching $N placeholders for the insert values
    let insertIdx = 3;
    for (let i = 2; i < insertCols.length; i++) {
      insertVals.push(`$${insertIdx++}`);
    }

    const [row] = await this.dataSource.query(
      `INSERT INTO public.member_journeys (${insertCols.join(', ')})
       VALUES (${insertVals.join(', ')})
       ON CONFLICT (tenant_id, user_id) DO UPDATE SET ${setClauses}
       RETURNING *`,
      values,
    );

    return {
      id: row.id,
      tenantId: row.tenant_id,
      userId: row.user_id,
      attendedMembersClass: row.attended_members_class,
      membersClassDate: row.members_class_date,
      isBaptized: row.is_baptized,
      baptismDate: row.baptism_date,
      salvationDate: row.salvation_date,
      discipleshipTrack: row.discipleship_track,
      skills: row.skills ?? [],
      interests: row.interests ?? [],
      bio: row.bio,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async addNote(tenantId: string, memberId: string, dto: CreateNoteDto, authorId: string) {
    const [row] = await this.dataSource.query(
      `INSERT INTO public.member_notes (tenant_id, member_id, author_id, content, is_private)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [tenantId, memberId, authorId, dto.content, dto.isPrivate ?? true],
    );

    return {
      id: row.id,
      tenantId: row.tenant_id,
      memberId: row.member_id,
      authorId: row.author_id,
      content: row.content,
      isPrivate: row.is_private,
      createdAt: row.created_at,
    };
  }

  async deleteNote(tenantId: string, noteId: string) {
    const result = await this.dataSource.query(
      `DELETE FROM public.member_notes WHERE id = $1 AND tenant_id = $2 RETURNING id`,
      [noteId, tenantId],
    );

    if (result.length === 0) throw new NotFoundException('Note not found');
    return { deleted: true };
  }
}
