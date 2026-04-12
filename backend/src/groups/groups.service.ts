import { Injectable, NotFoundException, InternalServerErrorException, ForbiddenException } from '@nestjs/common';
import { rlsStorage } from '../common/storage/rls.storage';
import { Group } from './entities/group.entity';
import { GroupMember } from './entities/group-member.entity';
import { GroupMessage } from './entities/group-message.entity';
import { CreateGroupDto } from './dto/create-group.dto';
import { UpdateGroupDto } from './dto/update-group.dto';
import { SendGroupMessageDto } from './dto/send-group-message.dto';

@Injectable()
export class GroupsService {
  private getRlsContext() {
    const ctx = rlsStorage.getStore();
    if (!ctx) throw new InternalServerErrorException('RLS context unavailable');
    return ctx;
  }

  private async assertMember(groupId: string, userId: string) {
    const { queryRunner } = this.getRlsContext();
    const rows = await queryRunner.query(
      `SELECT 1 FROM public.group_members WHERE group_id = $1 AND user_id = $2 LIMIT 1`,
      [groupId, userId],
    );
    if (!rows.length) {
      throw new ForbiddenException('You must be a member of this group');
    }
  }

  async getGroups(userId: string, limit: number, cursor?: string) {
    const { queryRunner } = this.getRlsContext();
    const params: any[] = [userId, limit + 1];
    let sql = `
      SELECT g.*,
        (SELECT COUNT(*)::int FROM public.group_members WHERE group_id = g.id) AS member_count,
        EXISTS(SELECT 1 FROM public.group_members WHERE group_id = g.id AND user_id = $1) AS is_member
      FROM public.groups g
    `;

    if (cursor) {
      params.push(cursor);
      sql += ` WHERE g.id < $${params.length}`;
    }

    sql += ` ORDER BY g.created_at DESC LIMIT $2`;

    const rows = await queryRunner.query(sql, params);
    const hasMore = rows.length > limit;
    const groups = hasMore ? rows.slice(0, limit) : rows;

    return {
      groups: groups.map((r: any) => this.mapGroup(r)),
      nextCursor: hasMore ? groups[groups.length - 1].id : null,
    };
  }

  async getGroup(id: string, userId: string) {
    const { queryRunner } = this.getRlsContext();
    const rows = await queryRunner.query(
      `SELECT g.*,
        (SELECT COUNT(*)::int FROM public.group_members WHERE group_id = g.id) AS member_count,
        EXISTS(SELECT 1 FROM public.group_members WHERE group_id = g.id AND user_id = $2) AS is_member
      FROM public.groups g WHERE g.id = $1`,
      [id, userId],
    );
    if (!rows.length) throw new NotFoundException('Group not found');
    return this.mapGroup(rows[0]);
  }

  async createGroup(dto: CreateGroupDto, userId: string) {
    const { queryRunner, currentTenantId } = this.getRlsContext();
    const group = queryRunner.manager.create(Group, {
      tenantId: currentTenantId!,
      name: dto.name,
      description: dto.description ?? null,
      imageUrl: dto.imageUrl ?? null,
      createdBy: userId,
    });
    const saved = await queryRunner.manager.save(Group, group);

    // Auto-add creator as a member
    await queryRunner.query(
      `INSERT INTO public.group_members (group_id, user_id) VALUES ($1, $2)`,
      [saved.id, userId],
    );

    return saved;
  }

  async joinGroup(groupId: string, userId: string) {
    const { queryRunner } = this.getRlsContext();
    await queryRunner.query(
      `INSERT INTO public.group_members (group_id, user_id)
       VALUES ($1, $2)
       ON CONFLICT (group_id, user_id) DO NOTHING`,
      [groupId, userId],
    );
    return { joined: true };
  }

  async leaveGroup(groupId: string, userId: string) {
    const { queryRunner } = this.getRlsContext();
    const rows = await queryRunner.query(
      `DELETE FROM public.group_members WHERE group_id = $1 AND user_id = $2 RETURNING user_id`,
      [groupId, userId],
    );
    if (!rows.length) {
      throw new ForbiddenException('You are not a member of this group');
    }
    return { left: true };
  }

  async getMessages(groupId: string, userId: string, limit: number, cursor?: string) {
    await this.assertMember(groupId, userId);
    const { queryRunner } = this.getRlsContext();
    const params: any[] = [groupId, limit + 1];
    let sql = `
      SELECT m.id, m.group_id, m.author_id, m.content, m.created_at,
        u.id AS author_user_id, u.full_name AS author_full_name, u.avatar_url AS author_avatar_url
      FROM public.group_messages m
      JOIN public.users u ON u.id = m.author_id
      WHERE m.group_id = $1
    `;

    if (cursor) {
      params.push(cursor);
      sql += ` AND m.id < $${params.length}`;
    }

    sql += ` ORDER BY m.created_at DESC LIMIT $2`;

    const rows = await queryRunner.query(sql, params);
    const hasMore = rows.length > limit;
    const messages = hasMore ? rows.slice(0, limit) : rows;

    return {
      messages: messages.map((r: any) => this.mapMessage(r)),
      nextCursor: hasMore ? messages[messages.length - 1].id : null,
    };
  }

  async updateGroup(groupId: string, dto: UpdateGroupDto) {
    const { queryRunner } = this.getRlsContext();
    const sets: string[] = [];
    const params: any[] = [groupId];

    if (dto.name !== undefined) {
      params.push(dto.name);
      sets.push(`name = $${params.length}`);
    }
    if (dto.description !== undefined) {
      params.push(dto.description);
      sets.push(`description = $${params.length}`);
    }
    if (dto.imageUrl !== undefined) {
      params.push(dto.imageUrl);
      sets.push(`image_url = $${params.length}`);
    }

    if (sets.length === 0) {
      throw new NotFoundException('No fields to update');
    }

    const rows = await queryRunner.query(
      `UPDATE public.groups SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
      params,
    );
    if (!rows.length) throw new NotFoundException('Group not found');
    return this.mapGroup(rows[0]);
  }

  async deleteGroup(groupId: string) {
    const { queryRunner } = this.getRlsContext();
    const rows = await queryRunner.query(
      `DELETE FROM public.groups WHERE id = $1 RETURNING id`,
      [groupId],
    );
    if (!rows.length) throw new NotFoundException('Group not found');
    return { deleted: true };
  }

  async getGroupMembers(groupId: string, limit: number, cursor?: string) {
    const { queryRunner } = this.getRlsContext();
    const params: any[] = [groupId, limit + 1];
    let sql = `
      SELECT gm.id, gm.user_id, gm.joined_at,
        u.full_name, u.avatar_url, u.email
      FROM public.group_members gm
      JOIN public.users u ON u.id = gm.user_id
      WHERE gm.group_id = $1
    `;

    if (cursor) {
      params.push(cursor);
      sql += ` AND gm.id < $${params.length}`;
    }

    sql += ` ORDER BY gm.joined_at DESC LIMIT $2`;

    const rows = await queryRunner.query(sql, params);
    const hasMore = rows.length > limit;
    const members = hasMore ? rows.slice(0, limit) : rows;

    return {
      members: members.map((r: any) => ({
        id: r.id,
        userId: r.user_id,
        fullName: r.full_name,
        avatarUrl: r.avatar_url,
        email: r.email,
        joinedAt: r.joined_at,
      })),
      nextCursor: hasMore ? members[members.length - 1].id : null,
    };
  }

  async sendMessage(groupId: string, dto: SendGroupMessageDto, userId: string) {
    await this.assertMember(groupId, userId);
    const { queryRunner } = this.getRlsContext();
    const message = queryRunner.manager.create(GroupMessage, {
      groupId,
      authorId: userId,
      content: dto.content,
    });
    return queryRunner.manager.save(GroupMessage, message);
  }

  private mapGroup(r: any) {
    return {
      id: r.id,
      tenantId: r.tenant_id,
      name: r.name,
      description: r.description,
      imageUrl: r.image_url,
      memberCount: Number(r.member_count ?? 0),
      isMember: r.is_member === true || r.is_member === 't',
      createdAt: r.created_at,
    };
  }

  private mapMessage(r: any) {
    return {
      id: r.id,
      groupId: r.group_id,
      authorId: r.author_id,
      author: {
        id: r.author_user_id,
        fullName: r.author_full_name,
        avatarUrl: r.author_avatar_url,
      },
      content: r.content,
      createdAt: r.created_at,
    };
  }
}
