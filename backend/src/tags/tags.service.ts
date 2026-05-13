import { Injectable, NotFoundException, InternalServerErrorException, ConflictException } from '@nestjs/common';
import { rlsStorage } from '../common/storage/rls.storage';
import { Tag } from './entities/tag.entity';
import { MemberTag } from './entities/member-tag.entity';
import { CreateTagDto } from './dto/create-tag.dto';
import { UpdateTagDto } from './dto/update-tag.dto';
import { AssignTagDto } from './dto/assign-tag.dto';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class TagsService {
  constructor(private readonly audit: AuditService) {}

  private getRlsContext() {
    const ctx = rlsStorage.getStore();
    if (!ctx) throw new InternalServerErrorException('RLS context unavailable');
    return ctx;
  }

  private async resolveName(userId: string): Promise<string> {
    const ctx = this.getRlsContext();
    const [row] = await ctx.queryRunner.query(
      `SELECT full_name FROM public.users WHERE id = $1`,
      [userId],
    );
    return row?.full_name ?? 'Someone';
  }

  async getTags() {
    const { queryRunner } = this.getRlsContext();
    const rows = await queryRunner.query(`
      SELECT t.*,
        (SELECT COUNT(*)::int FROM public.member_tags mt WHERE mt.tag_id = t.id) AS member_count
      FROM public.tags t
      ORDER BY t.name ASC
    `);
    return rows.map((r: any) => ({
      id: r.id,
      tenantId: r.tenant_id,
      name: r.name,
      color: r.color,
      grantsRole: r.grants_role ?? null,
      memberCount: Number(r.member_count ?? 0),
      createdAt: r.created_at,
    }));
  }

  async createTag(dto: CreateTagDto, userId: string) {
    const { queryRunner, currentTenantId } = this.getRlsContext();
    let saved: Tag;
    try {
      const tag = queryRunner.manager.create(Tag, {
        tenantId: currentTenantId!,
        name: dto.name,
        color: dto.color,
        grantsRole: dto.grantsRole ?? null,
      });
      saved = await queryRunner.manager.save(Tag, tag);
    } catch (err: any) {
      if (err.code === '23505') {
        throw new ConflictException('A tag with this name already exists');
      }
      throw err;
    }

    const actorName = await this.resolveName(userId);
    await this.audit.log({
      action: 'tag.created',
      resourceType: 'tag',
      resourceId: saved.id,
      summary: `${actorName} created tag "${saved.name}"${saved.grantsRole ? ` (grants ${saved.grantsRole})` : ''}`,
      metadata: {
        name: saved.name,
        color: saved.color,
        grantsRole: saved.grantsRole,
      },
    });

    return saved;
  }

  async updateTag(id: string, dto: UpdateTagDto) {
    const { queryRunner, userId } = this.getRlsContext();

    // Capture the pre-update state so the audit diff is meaningful.
    const before = await queryRunner.manager.findOne(Tag, { where: { id } });
    if (!before) throw new NotFoundException('Tag not found');

    const updates: any = {};
    if (dto.name !== undefined) updates.name = dto.name;
    if (dto.color !== undefined) updates.color = dto.color;
    // grantsRole supports explicit null to clear the grant. Note: this does
    // NOT retroactively demote existing assignees — clearing the config means
    // future un-assignments won't trigger a role check, but anyone already
    // promoted via this tag keeps their current tenant_memberships.role.
    if (dto.grantsRole !== undefined) updates.grantsRole = dto.grantsRole;

    const result = await queryRunner.manager.update(Tag, { id }, updates);
    if (result.affected === 0) throw new NotFoundException('Tag not found');
    const after = await queryRunner.manager.findOneOrFail(Tag, { where: { id } });

    const actorName = await this.resolveName(userId);
    await this.audit.log({
      action: 'tag.updated',
      resourceType: 'tag',
      resourceId: id,
      summary: `${actorName} updated tag "${after.name}"`,
      metadata: {
        before: { name: before.name, color: before.color, grantsRole: before.grantsRole },
        after: { name: after.name, color: after.color, grantsRole: after.grantsRole },
        changedFields: Object.keys(updates),
      },
    });

    return after;
  }

  async deleteTag(id: string) {
    const { queryRunner, userId } = this.getRlsContext();

    const before = await queryRunner.manager.findOne(Tag, { where: { id } });
    if (!before) throw new NotFoundException('Tag not found');

    const result = await queryRunner.manager.delete(Tag, { id });
    if (result.affected === 0) throw new NotFoundException('Tag not found');

    const actorName = await this.resolveName(userId);
    await this.audit.log({
      action: 'tag.deleted',
      resourceType: 'tag',
      resourceId: id,
      summary: `${actorName} deleted tag "${before.name}"`,
      metadata: {
        name: before.name,
        color: before.color,
        grantsRole: before.grantsRole,
      },
    });
  }

  /**
   * Assign a tag to N users. Idempotent — re-assigning is a no-op. If the
   * tag has grants_role set, each user's tenant_memberships.role is updated
   * to that role. Tag-granted role overwrites the current role unconditionally
   * (the model is intentionally simple — no role hierarchy logic).
   *
   * All writes happen inside the request transaction (RLS interceptor opens
   * one), so either every assignment + role upsert commits, or nothing does.
   */
  async assignTag(tagId: string, dto: AssignTagDto, assignedBy: string) {
    const { queryRunner, currentTenantId } = this.getRlsContext();

    // Fetch the tag once — applies to every user in this batch.
    const [tag] = await queryRunner.query(
      `SELECT name, grants_role FROM public.tags WHERE id = $1`,
      [tagId],
    );
    if (!tag) throw new NotFoundException('Tag not found');
    const grantsRole: string | null = tag.grants_role ?? null;
    const tagName: string = tag.name;
    const actorName = await this.resolveName(assignedBy);

    for (const userId of dto.userIds) {
      // Was the user already in the tag? Affects whether we emit
      // tag.member_added (real net-new) vs skip (idempotent re-assign).
      const [existing] = await queryRunner.query(
        `SELECT 1 FROM public.member_tags WHERE tag_id = $1 AND user_id = $2`,
        [tagId, userId],
      );
      const wasAlreadyMember = !!existing;

      await queryRunner.query(
        `INSERT INTO public.member_tags (tag_id, user_id, assigned_by)
         VALUES ($1, $2, $3)
         ON CONFLICT (tag_id, user_id) DO NOTHING`,
        [tagId, userId, assignedBy],
      );

      let priorRole: string | null = null;
      if (grantsRole) {
        const [m] = await queryRunner.query(
          `SELECT role FROM public.tenant_memberships
            WHERE tenant_id = $1 AND user_id = $2`,
          [currentTenantId, userId],
        );
        priorRole = m?.role ?? null;
        // Only update if the user is actually a member of this tenant.
        // Filtering by tenant_id + user_id means a no-op for non-members
        // (e.g., stale UI calling with someone who left the church).
        await queryRunner.query(
          `UPDATE public.tenant_memberships
           SET role = $1
           WHERE tenant_id = $2 AND user_id = $3`,
          [grantsRole, currentTenantId, userId],
        );
      }

      const targetName = await this.resolveName(userId);

      if (!wasAlreadyMember) {
        await this.audit.log({
          action: 'tag.member_added',
          resourceType: 'tag',
          resourceId: tagId,
          targetUserId: userId,
          summary: `${actorName} added ${targetName} to tag "${tagName}"`,
          metadata: { tagName, grantsRole },
        });
      }

      // member.role_changed only fires when there was an actual change.
      // priorRole !== grantsRole skips redundant audit rows for re-assigns
      // of users already at the granted role.
      if (grantsRole && priorRole && priorRole !== grantsRole) {
        await this.audit.log({
          action: 'member.role_changed',
          resourceType: 'user',
          resourceId: userId,
          targetUserId: userId,
          summary: `${actorName} changed ${targetName}'s role from ${priorRole} to ${grantsRole} via tag "${tagName}"`,
          metadata: {
            from: priorRole,
            to: grantsRole,
            via: 'tag',
            tagId,
            tagName,
          },
        });
      }
    }

    return { assigned: dto.userIds.length };
  }

  /**
   * Remove a user from a tag. Idempotent — removing someone who isn't tagged
   * is a no-op (no 404).
   *
   * If the tag granted a role:
   *   1. Check whether the user has another tag granting the same role.
   *   2. If yes → leave their tenant_memberships.role alone.
   *   3. If no AND their current role matches the grant → demote to 'member'.
   *
   * Step (3)'s "current role matches" guard is a foot-gun mitigation: if
   * something else gave them a different role (manual promotion, another
   * tag granting a different role), we don't clobber it.
   */
  /**
   * Reconciler — fix tag-granted role drift that can happen during a
   * deploy window (where a member_tags row gets inserted by the old code
   * path before the new tenant_memberships role-upsert is live). Or any
   * other case where the role didn't land in lock-step with the tag.
   *
   * Conservative policy: ONLY promote users from 'member'. Never
   * demote, never overwrite a user who's already privileged (admin /
   * pastor / accountant / worship_leader / moderator). This way running
   * the reconciler is always safe and never undoes a manual assignment.
   *
   * If a user has multiple tags granting different roles, deterministic
   * priority: admin > pastor > moderator. That's the intuitive ordering
   * of authority and avoids surprising "alphabetical wins" behavior.
   */
  async reconcileRoles(): Promise<{ upgraded: Array<{ userId: string; toRole: string }> }> {
    const { queryRunner, currentTenantId } = this.getRlsContext();

    const rows = await queryRunner.query(
      `
      WITH user_grants AS (
        SELECT DISTINCT mt.user_id, t.grants_role
        FROM public.member_tags mt
        JOIN public.tags t ON t.id = mt.tag_id
        WHERE t.tenant_id = $1 AND t.grants_role IS NOT NULL
      ),
      ranked AS (
        SELECT user_id, grants_role,
          ROW_NUMBER() OVER (
            PARTITION BY user_id
            ORDER BY CASE grants_role
              WHEN 'admin' THEN 1
              WHEN 'pastor' THEN 2
              WHEN 'moderator' THEN 3
              ELSE 99
            END
          ) AS rn
        FROM user_grants
      ),
      target AS (
        SELECT user_id, grants_role FROM ranked WHERE rn = 1
      )
      UPDATE public.tenant_memberships tm
      SET role = tgt.grants_role
      FROM target tgt
      WHERE tm.tenant_id = $1
        AND tm.user_id = tgt.user_id
        AND tm.role = 'member'
      RETURNING tm.user_id, tgt.grants_role AS new_role
      `,
      [currentTenantId],
    );

    const upgraded: Array<{ userId: string; toRole: string }> = rows.map((r: any) => ({
      userId: r.user_id,
      toRole: r.new_role,
    }));

    const actorName = await this.resolveName(this.getRlsContext().userId);
    await this.audit.log({
      action: 'tag.reconcile_roles_ran',
      resourceType: 'tag',
      summary: `${actorName} ran the tag-role reconciler — ${upgraded.length} member(s) upgraded`,
      metadata: {
        upgradedCount: upgraded.length,
        upgradedUserIds: upgraded.map(u => u.userId),
        upgrades: upgraded,
      },
    });

    return { upgraded };
  }

  async removeTagFromMember(tagId: string, userId: string): Promise<{ removed: boolean }> {
    const { queryRunner, currentTenantId, userId: actorId } = this.getRlsContext();

    const [tag] = await queryRunner.query(
      `SELECT name, grants_role FROM public.tags WHERE id = $1`,
      [tagId],
    );
    const grantsRole: string | null = tag?.grants_role ?? null;
    const tagName: string = tag?.name ?? '(unknown)';

    const result = await queryRunner.manager.delete(MemberTag, { tagId, userId });
    const removed = (result.affected ?? 0) > 0;

    let roleDemoted: { from: string; to: 'member' } | null = null;

    if (removed && grantsRole) {
      // Does the user still hold this role via another tag in this tenant?
      const [other] = await queryRunner.query(
        `SELECT 1
         FROM public.member_tags mt
         JOIN public.tags t ON t.id = mt.tag_id
         WHERE mt.user_id = $1
           AND t.tenant_id = $2
           AND t.grants_role = $3
         LIMIT 1`,
        [userId, currentTenantId, grantsRole],
      );

      if (!other) {
        // Demote only if their current role matches the grant — protects
        // any role set by another path from being clobbered.
        const demoteResult = await queryRunner.query(
          `UPDATE public.tenant_memberships
           SET role = 'member'
           WHERE tenant_id = $1 AND user_id = $2 AND role = $3
           RETURNING $3 AS from_role`,
          [currentTenantId, userId, grantsRole],
        );
        if (demoteResult.length > 0) {
          roleDemoted = { from: grantsRole, to: 'member' };
        }
      }
    }

    if (removed) {
      const actorName = await this.resolveName(actorId);
      const targetName = await this.resolveName(userId);
      await this.audit.log({
        action: 'tag.member_removed',
        resourceType: 'tag',
        resourceId: tagId,
        targetUserId: userId,
        summary: `${actorName} removed ${targetName} from tag "${tagName}"`,
        metadata: { tagName, grantsRole },
      });

      if (roleDemoted) {
        await this.audit.log({
          action: 'member.role_changed',
          resourceType: 'user',
          resourceId: userId,
          targetUserId: userId,
          summary: `${actorName} changed ${targetName}'s role from ${roleDemoted.from} to ${roleDemoted.to} via tag "${tagName}" removal`,
          metadata: {
            from: roleDemoted.from,
            to: roleDemoted.to,
            via: 'tag_removal',
            tagId,
            tagName,
          },
        });
      }
    }

    return { removed };
  }

  async getMemberTags(userId: string) {
    const { queryRunner } = this.getRlsContext();
    const rows = await queryRunner.query(
      `SELECT t.id, t.name, t.color
       FROM public.member_tags mt
       JOIN public.tags t ON t.id = mt.tag_id
       WHERE mt.user_id = $1
       ORDER BY t.name ASC`,
      [userId],
    );
    return rows.map((r: any) => ({
      id: r.id,
      name: r.name,
      color: r.color,
    }));
  }

  async getTagMembers(tagId: string, limit: number, cursor?: string) {
    const { queryRunner } = this.getRlsContext();
    const params: any[] = [tagId, limit + 1];
    let sql = `
      SELECT u.id AS user_id, u.full_name, u.avatar_url, u.email, mt.assigned_at
      FROM public.member_tags mt
      JOIN public.users u ON u.id = mt.user_id
      WHERE mt.tag_id = $1
    `;
    if (cursor) {
      params.push(cursor);
      sql += ` AND u.id > $${params.length}`;
    }
    sql += ` ORDER BY u.full_name ASC LIMIT $2`;

    const rows = await queryRunner.query(sql, params);
    const hasMore = rows.length > limit;
    const members = hasMore ? rows.slice(0, limit) : rows;

    return {
      members: members.map((r: any) => ({
        userId: r.user_id,
        fullName: r.full_name,
        avatarUrl: r.avatar_url,
        email: r.email,
        assignedAt: r.assigned_at,
      })),
      nextCursor: hasMore ? members[members.length - 1].userId : null,
    };
  }
}
