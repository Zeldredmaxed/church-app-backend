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

    const result = await queryRunner.manager.update(Tag, { id }, updates);
    if (result.affected === 0) throw new NotFoundException('Tag not found');
    return queryRunner.manager.findOneOrFail(Tag, { where: { id } });
  }

  async deleteTag(id: string) {
    const { queryRunner } = this.getRlsContext();
    const result = await queryRunner.manager.delete(Tag, { id });
    if (result.affected === 0) throw new NotFoundException('Tag not found');
  }

  async assignTag(tagId: string, dto: AssignTagDto, assignedBy: string) {
    const { queryRunner } = this.getRlsContext();
    for (const userId of dto.userIds) {
      await queryRunner.query(
        `INSERT INTO public.member_tags (tag_id, user_id, assigned_by)
         VALUES ($1, $2, $3)
         ON CONFLICT (tag_id, user_id) DO NOTHING`,
        [tagId, userId, assignedBy],
      );
    }
    return { assigned: dto.userIds.length };
  }

  async removeTagFromMember(tagId: string, userId: string) {
    const { queryRunner } = this.getRlsContext();
    const result = await queryRunner.manager.delete(MemberTag, { tagId, userId });
    if (result.affected === 0) throw new NotFoundException('Tag assignment not found');
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
