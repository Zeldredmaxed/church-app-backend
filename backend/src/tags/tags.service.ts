import { Injectable, NotFoundException, InternalServerErrorException, ConflictException } from '@nestjs/common';
import { rlsStorage } from '../common/storage/rls.storage';
import { Tag } from './entities/tag.entity';
import { MemberTag } from './entities/member-tag.entity';
import { CreateTagDto } from './dto/create-tag.dto';
import { UpdateTagDto } from './dto/update-tag.dto';
import { AssignTagDto } from './dto/assign-tag.dto';

@Injectable()
export class TagsService {
  private getRlsContext() {
    const ctx = rlsStorage.getStore();
    if (!ctx) throw new InternalServerErrorException('RLS context unavailable');
    return ctx;
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
    try {
      const tag = queryRunner.manager.create(Tag, {
        tenantId: currentTenantId!,
        name: dto.name,
        color: dto.color,
        grantsRole: dto.grantsRole ?? null,
      });
      return await queryRunner.manager.save(Tag, tag);
    } catch (err: any) {
      if (err.code === '23505') {
        throw new ConflictException('A tag with this name already exists');
      }
      throw err;
    }
  }

  async updateTag(id: string, dto: UpdateTagDto) {
    const { queryRunner } = this.getRlsContext();
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
    return queryRunner.manager.findOneOrFail(Tag, { where: { id } });
  }

  async deleteTag(id: string) {
    const { queryRunner } = this.getRlsContext();
    const result = await queryRunner.manager.delete(Tag, { id });
    if (result.affected === 0) throw new NotFoundException('Tag not found');
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

    // Fetch the tag's grants_role once — applies to every user in this batch.
    const [tag] = await queryRunner.query(
      `SELECT grants_role FROM public.tags WHERE id = $1`,
      [tagId],
    );
    if (!tag) throw new NotFoundException('Tag not found');
    const grantsRole: string | null = tag.grants_role ?? null;

    for (const userId of dto.userIds) {
      await queryRunner.query(
        `INSERT INTO public.member_tags (tag_id, user_id, assigned_by)
         VALUES ($1, $2, $3)
         ON CONFLICT (tag_id, user_id) DO NOTHING`,
        [tagId, userId, assignedBy],
      );

      if (grantsRole) {
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
  async removeTagFromMember(tagId: string, userId: string): Promise<{ removed: boolean }> {
    const { queryRunner, currentTenantId } = this.getRlsContext();

    const [tag] = await queryRunner.query(
      `SELECT grants_role FROM public.tags WHERE id = $1`,
      [tagId],
    );
    const grantsRole: string | null = tag?.grants_role ?? null;

    const result = await queryRunner.manager.delete(MemberTag, { tagId, userId });
    const removed = (result.affected ?? 0) > 0;

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
        await queryRunner.query(
          `UPDATE public.tenant_memberships
           SET role = 'member'
           WHERE tenant_id = $1 AND user_id = $2 AND role = $3`,
          [currentTenantId, userId, grantsRole],
        );
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
