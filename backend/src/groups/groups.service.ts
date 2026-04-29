import { Injectable, NotFoundException, InternalServerErrorException, ForbiddenException, ConflictException, BadRequestException } from '@nestjs/common';
import { rlsStorage } from '../common/storage/rls.storage';
import { Group } from './entities/group.entity';
import { GroupMember } from './entities/group-member.entity';
import { GroupMessage } from './entities/group-message.entity';
import { GroupJoinRequest } from './entities/group-join-request.entity';
import { CreateGroupDto } from './dto/create-group.dto';
import { UpdateGroupDto } from './dto/update-group.dto';
import { SendGroupMessageDto } from './dto/send-group-message.dto';
import { JoinRequestDto, DenyRequestDto } from './dto/join-request.dto';

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

  /**
   * Throws 403 unless the caller is a tenant admin/pastor in the group's
   * tenant or is the group's creator. Returns the group's tenant_id +
   * created_by so callers can avoid a second lookup.
   */
  private async assertGroupAdmin(groupId: string, userId: string): Promise<{ tenantId: string; createdBy: string }> {
    const { queryRunner, currentTenantId } = this.getRlsContext();
    const [group] = await queryRunner.query(
      `SELECT tenant_id, created_by FROM public.groups WHERE id = $1`,
      [groupId],
    );
    if (!group) throw new NotFoundException('Group not found');
    if (group.tenant_id !== currentTenantId) {
      // Group belongs to another tenant — caller's JWT is wrong tenant.
      throw new NotFoundException('Group not found');
    }

    if (group.created_by === userId) {
      return { tenantId: group.tenant_id, createdBy: group.created_by };
    }
    const [membership] = await queryRunner.query(
      `SELECT role FROM public.tenant_memberships WHERE tenant_id = $1 AND user_id = $2`,
      [group.tenant_id, userId],
    );
    if (membership && (membership.role === 'admin' || membership.role === 'pastor')) {
      return { tenantId: group.tenant_id, createdBy: group.created_by };
    }
    throw new ForbiddenException('Only the group creator or a tenant admin/pastor can do that.');
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
        EXISTS(SELECT 1 FROM public.group_members WHERE group_id = g.id AND user_id = $2) AS is_member,
        (SELECT status FROM public.group_join_requests
          WHERE group_id = g.id AND user_id = $2 AND status = 'pending'
          LIMIT 1) AS pending_request_status
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

  /**
   * Non-admin entry point: creates a pending join request that an admin
   * must approve. If the caller is already a member, returns the
   * already_member status without creating a request.
   */
  async requestToJoin(groupId: string, userId: string, dto: JoinRequestDto) {
    const { queryRunner, currentTenantId } = this.getRlsContext();

    // Verify the group exists and is in the caller's tenant (RLS handles cross-tenant).
    const [group] = await queryRunner.query(
      `SELECT tenant_id FROM public.groups WHERE id = $1`,
      [groupId],
    );
    if (!group) throw new NotFoundException('Group not found');

    // Already a member?
    const [member] = await queryRunner.query(
      `SELECT 1 FROM public.group_members WHERE group_id = $1 AND user_id = $2`,
      [groupId, userId],
    );
    if (member) {
      return { status: 'already_member' as const };
    }

    // Already has a pending request? Return the existing one (idempotent).
    const [existing] = await queryRunner.query(
      `SELECT id FROM public.group_join_requests
       WHERE group_id = $1 AND user_id = $2 AND status = 'pending'`,
      [groupId, userId],
    );
    if (existing) {
      return { status: 'pending' as const, requestId: existing.id };
    }

    const [created] = await queryRunner.query(
      `INSERT INTO public.group_join_requests (group_id, user_id, tenant_id, message)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [groupId, userId, currentTenantId, dto.message ?? null],
    );

    return { status: 'pending' as const, requestId: created.id };
  }

  /**
   * Admin entry point: directly add a user to the group, no request needed.
   * If the user has a pending request, mark it approved as a side-effect.
   */
  async addMember(groupId: string, targetUserId: string, callerId: string) {
    await this.assertGroupAdmin(groupId, callerId);
    const { queryRunner } = this.getRlsContext();

    // Verify target user exists (avoid silent FK error → 500)
    const [target] = await queryRunner.query(
      `SELECT 1 FROM public.users WHERE id = $1`,
      [targetUserId],
    );
    if (!target) throw new NotFoundException('User not found');

    await queryRunner.query(
      `INSERT INTO public.group_members (group_id, user_id)
       VALUES ($1, $2)
       ON CONFLICT (group_id, user_id) DO NOTHING`,
      [groupId, targetUserId],
    );

    // Resolve any pending request from this user as approved.
    await queryRunner.query(
      `UPDATE public.group_join_requests
       SET status = 'approved', reviewed_at = now(), reviewed_by = $3
       WHERE group_id = $1 AND user_id = $2 AND status = 'pending'`,
      [groupId, targetUserId, callerId],
    );

    return { added: true };
  }

  async removeMember(groupId: string, targetUserId: string, callerId: string) {
    await this.assertGroupAdmin(groupId, callerId);
    const { queryRunner } = this.getRlsContext();

    const rows = await queryRunner.query(
      `DELETE FROM public.group_members WHERE group_id = $1 AND user_id = $2 RETURNING user_id`,
      [groupId, targetUserId],
    );
    if (!rows.length) throw new NotFoundException('User is not a member of this group');
    return { removed: true };
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

  /**
   * Admin: list join requests for a group, default to pending.
   */
  async getJoinRequests(
    groupId: string,
    callerId: string,
    status: 'pending' | 'approved' | 'denied' | 'all' = 'pending',
    limit = 20,
    cursor?: string,
  ) {
    await this.assertGroupAdmin(groupId, callerId);
    const { queryRunner } = this.getRlsContext();

    const params: any[] = [groupId, limit + 1];
    let sql = `
      SELECT r.id, r.user_id, r.status, r.message, r.requested_at, r.reviewed_at, r.reviewed_by, r.denied_reason,
        u.full_name, u.avatar_url, u.email
      FROM public.group_join_requests r
      JOIN public.users u ON u.id = r.user_id
      WHERE r.group_id = $1
    `;
    if (status !== 'all') {
      params.push(status);
      sql += ` AND r.status = $${params.length}`;
    }
    if (cursor) {
      params.push(cursor);
      sql += ` AND r.id < $${params.length}`;
    }
    sql += ` ORDER BY r.requested_at DESC LIMIT $2`;

    const rows = await queryRunner.query(sql, params);
    const hasMore = rows.length > limit;
    const requests = hasMore ? rows.slice(0, limit) : rows;

    return {
      requests: requests.map((r: any) => ({
        id: r.id,
        userId: r.user_id,
        user: {
          id: r.user_id,
          fullName: r.full_name,
          avatarUrl: r.avatar_url,
          email: r.email,
        },
        status: r.status,
        message: r.message,
        requestedAt: r.requested_at,
        reviewedAt: r.reviewed_at,
        reviewedBy: r.reviewed_by,
        deniedReason: r.denied_reason,
      })),
      nextCursor: hasMore ? requests[requests.length - 1].id : null,
    };
  }

  async approveJoinRequest(groupId: string, requestId: string, callerId: string) {
    await this.assertGroupAdmin(groupId, callerId);
    const { queryRunner } = this.getRlsContext();

    const [request] = await queryRunner.query(
      `SELECT id, user_id, status FROM public.group_join_requests
       WHERE id = $1 AND group_id = $2`,
      [requestId, groupId],
    );
    if (!request) throw new NotFoundException('Request not found');
    if (request.status !== 'pending') {
      throw new ConflictException(`Request is already ${request.status}`);
    }

    // Update the request and add the member (in a single round-trip-ish flow)
    await queryRunner.query(
      `UPDATE public.group_join_requests
       SET status = 'approved', reviewed_at = now(), reviewed_by = $1
       WHERE id = $2`,
      [callerId, requestId],
    );
    await queryRunner.query(
      `INSERT INTO public.group_members (group_id, user_id)
       VALUES ($1, $2)
       ON CONFLICT (group_id, user_id) DO NOTHING`,
      [groupId, request.user_id],
    );

    return { approved: true, userId: request.user_id };
  }

  async denyJoinRequest(
    groupId: string,
    requestId: string,
    callerId: string,
    dto: DenyRequestDto,
  ) {
    await this.assertGroupAdmin(groupId, callerId);
    const { queryRunner } = this.getRlsContext();

    const [request] = await queryRunner.query(
      `SELECT status FROM public.group_join_requests
       WHERE id = $1 AND group_id = $2`,
      [requestId, groupId],
    );
    if (!request) throw new NotFoundException('Request not found');
    if (request.status !== 'pending') {
      throw new ConflictException(`Request is already ${request.status}`);
    }

    await queryRunner.query(
      `UPDATE public.group_join_requests
       SET status = 'denied', reviewed_at = now(), reviewed_by = $1, denied_reason = $2
       WHERE id = $3`,
      [callerId, dto.reason ?? null, requestId],
    );

    return { denied: true };
  }

  /**
   * User: withdraw their own pending request.
   */
  async withdrawMyRequest(groupId: string, userId: string) {
    const { queryRunner } = this.getRlsContext();
    const rows = await queryRunner.query(
      `DELETE FROM public.group_join_requests
       WHERE group_id = $1 AND user_id = $2 AND status = 'pending'
       RETURNING id`,
      [groupId, userId],
    );
    if (!rows.length) throw new NotFoundException('No pending request to withdraw');
    return { withdrawn: true };
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
      throw new BadRequestException('No fields to update');
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
      SELECT gm.user_id, gm.joined_at,
        u.full_name, u.avatar_url, u.email
      FROM public.group_members gm
      JOIN public.users u ON u.id = gm.user_id
      WHERE gm.group_id = $1
    `;

    if (cursor) {
      params.push(cursor);
      sql += ` AND gm.user_id > $${params.length}`;
    }

    sql += ` ORDER BY gm.joined_at DESC LIMIT $2`;

    const rows = await queryRunner.query(sql, params);
    const hasMore = rows.length > limit;
    const members = hasMore ? rows.slice(0, limit) : rows;

    return {
      members: members.map((r: any) => ({
        userId: r.user_id,
        fullName: r.full_name,
        avatarUrl: r.avatar_url,
        email: r.email,
        joinedAt: r.joined_at,
      })),
      nextCursor: hasMore ? members[members.length - 1].user_id : null,
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
      pendingRequestStatus: r.pending_request_status ?? null,
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
