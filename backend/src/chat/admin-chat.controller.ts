import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  Body,
  ParseUUIDPipe,
  UseGuards,
  UseInterceptors,
  HttpCode,
  HttpStatus,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, IsUUID, IsInt, Min, Max, IsIn } from 'class-validator';
import { DataSource } from 'typeorm';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RoleGuard, RequiresRole } from '../common/guards/role.guard';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SupabaseJwtPayload } from '../common/types/jwt-payload.type';
import { AuditService } from '../audit/audit.service';

class RemoveChatMessageDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

class MuteUserDto {
  @IsUUID()
  userId: string;

  @IsInt()
  @Min(1)
  @Max(60 * 24 * 365)
  durationMinutes: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

/**
 * Admin moderation for chat (direct + private + public channels) and
 * group messages. Branched out of the user-facing ChatController so
 * (1) the role guard applies cleanly at the controller and (2) the
 * routes are visibly admin-scoped in Swagger.
 */
@ApiTags('Admin Chat Moderation')
@ApiBearerAuth()
@Controller('admin/chat')
@UseGuards(JwtAuthGuard, RoleGuard)
@RequiresRole('admin', 'pastor')
@UseInterceptors(RlsContextInterceptor)
export class AdminChatController {
  constructor(
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
  ) {}

  @Get('threads/:channelId/context')
  @ApiOperation({
    summary: 'Read message context around a reported message',
    description:
      'Returns the messages immediately before and after the target message id so an admin can review a reported DM/group message in context. Bypasses the channel-membership rule that the user-facing GET /channels/:id/messages enforces.',
  })
  @ApiResponse({
    status: 200,
    description: '{ before: Message[], target: Message, after: Message[] }',
  })
  @ApiResponse({ status: 404, description: 'Channel or message not found' })
  async getThreadContext(
    @Param('channelId', ParseUUIDPipe) channelId: string,
    @Query('aroundMessageId', ParseUUIDPipe) aroundMessageId: string,
    @CurrentUser() user: SupabaseJwtPayload,
    @Query('window') window?: string,
  ) {
    const tenantId = user.app_metadata?.current_tenant_id;
    if (!tenantId) throw new BadRequestException('No tenant context');

    const parsedWindow = Math.min(Math.max(parseInt(window ?? '10', 10) || 10, 1), 50);

    // Cross-tenant guard. chat_messages doesn't carry tenant_id, so we
    // join chat_channels and require c.tenant_id = caller's tenant.
    // Without this an admin of church A could read pastoral DMs from
    // church B by guessing / harvesting channel UUIDs.
    const [target] = await this.dataSource.query(
      `SELECT m.id, m.channel_id, m.user_id, m.content, m.media_url, m.media_type,
              m.created_at, m.deleted_at, m.deleted_by, u.full_name AS author_name
       FROM public.chat_messages m
       JOIN public.chat_channels c ON c.id = m.channel_id
       LEFT JOIN public.users u ON u.id = m.user_id
       WHERE m.id = $1 AND m.channel_id = $2 AND c.tenant_id = $3`,
      [aroundMessageId, channelId, tenantId],
    );
    if (!target) throw new BadRequestException('Target message not found in channel');

    const before = await this.dataSource.query(
      `SELECT m.id, m.user_id, m.content, m.media_url, m.created_at, m.deleted_at, u.full_name AS author_name
       FROM public.chat_messages m
       JOIN public.chat_channels c ON c.id = m.channel_id
       LEFT JOIN public.users u ON u.id = m.user_id
       WHERE m.channel_id = $1 AND c.tenant_id = $4 AND m.created_at < $2
       ORDER BY m.created_at DESC LIMIT $3`,
      [channelId, target.created_at, parsedWindow, tenantId],
    );

    const after = await this.dataSource.query(
      `SELECT m.id, m.user_id, m.content, m.media_url, m.created_at, m.deleted_at, u.full_name AS author_name
       FROM public.chat_messages m
       JOIN public.chat_channels c ON c.id = m.channel_id
       LEFT JOIN public.users u ON u.id = m.user_id
       WHERE m.channel_id = $1 AND c.tenant_id = $4 AND m.created_at > $2
       ORDER BY m.created_at ASC LIMIT $3`,
      [channelId, target.created_at, parsedWindow, tenantId],
    );

    // Audit trail — admins reading pastoral DMs leaves a paper trail.
    await this.audit.log({
      action: 'chat.thread_inspected',
      resourceType: 'channel',
      resourceId: channelId,
      summary: 'Admin viewed chat thread context for moderation',
      metadata: { aroundMessageId, windowSize: parsedWindow },
    });

    return {
      before: before.reverse(),
      target,
      after,
    };
  }

  @Delete('messages/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Soft-delete a chat message (moderation)',
    description:
      'Sets deleted_at / deleted_by / deleted_reason. Message stays in the table so a future investigation can read the content; render queries filter deleted_at IS NULL. Audits chat.message_removed.',
  })
  @ApiResponse({ status: 200, description: '{ deleted: true }' })
  @ApiResponse({ status: 404, description: 'Message not found or already deleted' })
  async removeMessage(
    @Param('id', ParseUUIDPipe) messageId: string,
    @Body() dto: RemoveChatMessageDto,
    @CurrentUser() user: SupabaseJwtPayload,
  ) {
    const tenantId = user.app_metadata?.current_tenant_id;
    if (!tenantId) throw new BadRequestException('No tenant context');

    // Resolve the message with its tenant via the channel — chat_messages
    // doesn't carry tenant_id, but chat_channels does.
    const [msg] = await this.dataSource.query(
      `SELECT m.id, m.user_id, m.content, c.tenant_id
       FROM public.chat_messages m
       JOIN public.chat_channels c ON c.id = m.channel_id
       WHERE m.id = $1 AND m.deleted_at IS NULL`,
      [messageId],
    );
    if (!msg) throw new BadRequestException('Message not found or already deleted');

    // Cross-tenant guard: admin of A cannot delete a message in channel B.
    if (msg.tenant_id !== tenantId) {
      throw new BadRequestException('Message is in a different tenant');
    }

    await this.dataSource.query(
      `UPDATE public.chat_messages
       SET deleted_at = now(), deleted_by = $2, deleted_reason = $3
       WHERE id = $1`,
      [messageId, user.sub, dto.reason ?? null],
    );

    const [actor] = await this.dataSource.query(
      `SELECT full_name FROM public.users WHERE id = $1`,
      [user.sub],
    );

    await this.audit.log({
      action: 'chat.message_removed',
      resourceType: 'message',
      resourceId: messageId,
      targetUserId: msg.user_id,
      summary: `${actor?.full_name ?? 'Admin'} removed a chat message`,
      metadata: {
        reason: dto.reason ?? null,
        contentPreview: (msg.content ?? '').slice(0, 200),
      },
    });

    return { deleted: true };
  }
}

// ─── Moderation queue ─────────────────────────────────────────────
//
// Separate controller so the queue routes live under /api/admin/chat-moderation
// (matches the mobile contract) while the legacy /api/admin/chat/threads and
// /api/admin/chat/messages routes above stay where the existing frontend
// expects them.

@ApiTags('Admin Chat Moderation')
@ApiBearerAuth()
@Controller('admin/chat-moderation')
@UseGuards(JwtAuthGuard, RoleGuard)
@RequiresRole('admin', 'pastor')
@UseInterceptors(RlsContextInterceptor)
export class AdminChatModerationController {
  constructor(
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
  ) {}

  private requireTenant(user: SupabaseJwtPayload): string {
    const tenantId = user.app_metadata?.current_tenant_id;
    if (!tenantId) throw new BadRequestException('No tenant context');
    return tenantId;
  }

  @Get()
  @ApiOperation({
    summary: 'Chat moderation KPI summary',
    description:
      'Counts open flags, currently-muted users, and items resolved today. Powers the mobile moderation dashboard card.',
  })
  @ApiResponse({
    status: 200,
    description: '{ flaggedCount, mutedCount, todayResolved, openTickets }',
  })
  async getSummary(@CurrentUser() user: SupabaseJwtPayload) {
    const tenantId = this.requireTenant(user);

    const [row] = await this.dataSource.query(
      `SELECT
         COALESCE((SELECT COUNT(*)::int FROM public.chat_message_flags
                    WHERE tenant_id = $1 AND status = 'open'), 0) AS flagged_count,
         COALESCE((SELECT COUNT(*)::int FROM public.chat_user_mutes
                    WHERE tenant_id = $1 AND expires_at > now()), 0) AS muted_count,
         COALESCE((SELECT COUNT(*)::int FROM public.chat_message_flags
                    WHERE tenant_id = $1
                      AND status != 'open'
                      AND resolved_at >= date_trunc('day', now())), 0) AS today_resolved`,
      [tenantId],
    );

    const flaggedCount = row?.flagged_count ?? 0;

    return {
      flaggedCount,
      mutedCount: row?.muted_count ?? 0,
      todayResolved: row?.today_resolved ?? 0,
      openTickets: flaggedCount,
    };
  }

  @Get('flags')
  @ApiOperation({
    summary: 'List flagged chat messages',
    description:
      'Returns the moderation queue ordered newest-first. `status` filter defaults to "open"; pass "resolved" to see dismissed + removed history.',
  })
  @ApiResponse({ status: 200, description: '{ data: FlaggedMessage[] }' })
  async listFlags(
    @CurrentUser() user: SupabaseJwtPayload,
    @Query('status') status?: string,
  ) {
    const tenantId = this.requireTenant(user);

    let statusClause: string;
    if (!status || status === 'open') {
      statusClause = `f.status = 'open'`;
    } else if (status === 'resolved') {
      statusClause = `f.status IN ('dismissed','removed')`;
    } else if (status === 'dismissed' || status === 'removed') {
      statusClause = `f.status = '${status}'`;
    } else {
      throw new BadRequestException('status must be open, resolved, dismissed, or removed');
    }

    const rows = await this.dataSource.query(
      `SELECT
         f.id,
         f.message_id,
         f.reporter_id,
         f.reason,
         f.status,
         f.created_at,
         m.content      AS message_content,
         m.user_id      AS author_id,
         m.deleted_at   AS message_deleted_at,
         au.full_name   AS author_name,
         c.id           AS channel_id,
         c.name         AS channel_name
       FROM public.chat_message_flags f
       LEFT JOIN public.chat_messages m  ON m.id = f.message_id
       LEFT JOIN public.users         au ON au.id = m.user_id
       LEFT JOIN public.chat_channels c  ON c.id = m.channel_id
       WHERE f.tenant_id = $1 AND ${statusClause}
       ORDER BY f.created_at DESC
       LIMIT 200`,
      [tenantId],
    );

    const data = rows.map((r: any) => ({
      id: r.id,
      messageId: r.message_id,
      content: (r.message_content ?? '').slice(0, 280),
      authorId: r.author_id,
      authorName: r.author_name,
      channelId: r.channel_id,
      channelName: r.channel_name ?? 'Direct Message',
      reporterId: r.reporter_id,
      reason: r.reason,
      status: r.status,
      createdAt: r.created_at,
    }));

    return { data };
  }

  @Post('flags/:id/dismiss')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Dismiss a flag (no action taken)' })
  @ApiResponse({ status: 200, description: '{ dismissed: true }' })
  async dismissFlag(
    @Param('id', ParseUUIDPipe) flagId: string,
    @CurrentUser() user: SupabaseJwtPayload,
  ) {
    const tenantId = this.requireTenant(user);

    const [flag] = await this.dataSource.query(
      `SELECT id, status, message_id FROM public.chat_message_flags
       WHERE id = $1 AND tenant_id = $2`,
      [flagId, tenantId],
    );
    if (!flag) throw new NotFoundException('Flag not found');
    if (flag.status !== 'open') {
      throw new BadRequestException(`Flag is already ${flag.status}`);
    }

    await this.dataSource.query(
      `UPDATE public.chat_message_flags
         SET status = 'dismissed', resolved_at = now(), resolved_by = $2
       WHERE id = $1`,
      [flagId, user.sub],
    );

    await this.audit.log({
      action: 'chat.flag_dismissed',
      resourceType: 'message',
      resourceId: flag.message_id,
      summary: 'Admin dismissed a chat message flag',
      metadata: { flagId },
    });

    return { dismissed: true };
  }

  @Post('flags/:id/remove')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Remove the flagged chat message',
    description:
      'Hard-deletes the chat_messages row (ON DELETE CASCADE cleans up any sibling flag rows on this message), marks this flag as resolved with status=removed, and audits.',
  })
  @ApiResponse({ status: 200, description: '{ removed: true }' })
  async removeFlag(
    @Param('id', ParseUUIDPipe) flagId: string,
    @CurrentUser() user: SupabaseJwtPayload,
  ) {
    const tenantId = this.requireTenant(user);

    const [row] = await this.dataSource.query(
      `SELECT f.id, f.status, f.message_id, m.user_id AS author_id, m.content,
              c.tenant_id AS channel_tenant_id
         FROM public.chat_message_flags f
         LEFT JOIN public.chat_messages m  ON m.id = f.message_id
         LEFT JOIN public.chat_channels c  ON c.id = m.channel_id
        WHERE f.id = $1 AND f.tenant_id = $2`,
      [flagId, tenantId],
    );
    if (!row) throw new NotFoundException('Flag not found');
    if (row.status !== 'open') {
      throw new BadRequestException(`Flag is already ${row.status}`);
    }

    // Cross-tenant guard: even though we filter on f.tenant_id, the
    // underlying message must also belong to this tenant (defense in
    // depth — a message could in theory live under a different tenant's
    // channel if a flag row were ever inserted incorrectly).
    if (row.channel_tenant_id && row.channel_tenant_id !== tenantId) {
      throw new BadRequestException('Message is in a different tenant');
    }

    // Delete the message first; ON DELETE CASCADE will null out the
    // message_id FK is not configured — we use CASCADE so sibling flags
    // disappear with it. Mark this flag as removed BEFORE the delete so
    // the resolved_by record survives the cascade.
    await this.dataSource.query(
      `UPDATE public.chat_message_flags
         SET status = 'removed', resolved_at = now(), resolved_by = $2
       WHERE id = $1`,
      [flagId, user.sub],
    );

    if (row.message_id) {
      // Restrict the delete to the resolved tenant — even though RLS is
      // bypassed by service-role, this defends against the (unlikely)
      // case where the flag's tenant_id was wrong.
      await this.dataSource.query(
        `DELETE FROM public.chat_messages
           WHERE id = $1
             AND channel_id IN (SELECT id FROM public.chat_channels WHERE tenant_id = $2)`,
        [row.message_id, tenantId],
      );
    }

    await this.audit.log({
      action: 'chat.flag_removed',
      resourceType: 'message',
      resourceId: row.message_id,
      targetUserId: row.author_id,
      summary: 'Admin removed a flagged chat message',
      metadata: {
        flagId,
        contentPreview: (row.content ?? '').slice(0, 200),
      },
    });

    return { removed: true };
  }

  @Post('mute')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Mute a user from sending chat messages',
    description:
      'Inserts a chat_user_mutes row with expires_at = now() + durationMinutes. ChatService.sendMessage refuses to insert when an unexpired mute row exists for the (tenant, user).',
  })
  @ApiResponse({ status: 200, description: '{ muted: true, expiresAt }' })
  async muteUser(
    @Body() dto: MuteUserDto,
    @CurrentUser() user: SupabaseJwtPayload,
  ) {
    const tenantId = this.requireTenant(user);

    if (dto.userId === user.sub) {
      throw new BadRequestException('You cannot mute yourself');
    }

    // Sanity check: target must be a tenant member.
    const [member] = await this.dataSource.query(
      `SELECT 1 FROM public.tenant_memberships
        WHERE tenant_id = $1 AND user_id = $2`,
      [tenantId, dto.userId],
    );
    if (!member) throw new BadRequestException('User is not a member of this tenant');

    const [row] = await this.dataSource.query(
      `INSERT INTO public.chat_user_mutes
         (tenant_id, user_id, muted_by, reason, expires_at)
       VALUES ($1, $2, $3, $4, now() + ($5 || ' minutes')::interval)
       RETURNING id, expires_at`,
      [tenantId, dto.userId, user.sub, dto.reason ?? null, String(dto.durationMinutes)],
    );

    await this.audit.log({
      action: 'chat.user_muted',
      resourceType: 'user',
      resourceId: dto.userId,
      targetUserId: dto.userId,
      summary: `Admin muted user from chat for ${dto.durationMinutes} minutes`,
      metadata: {
        muteId: row.id,
        durationMinutes: dto.durationMinutes,
        reason: dto.reason ?? null,
        expiresAt: row.expires_at,
      },
    });

    return { muted: true, expiresAt: row.expires_at };
  }
}

// ─── Public: file a flag on a chat message ────────────────────────
//
// Lives under /api/chat/messages/:id/flag so the mobile contract
// matches what the user-facing report UI calls. Tenant-scoped via the
// JWT — we resolve the channel's tenant_id and refuse to flag a message
// in a different tenant.

class CreateFlagDto {
  @IsString()
  @MaxLength(500)
  reason: string;
}

@ApiTags('Chat')
@ApiBearerAuth()
@Controller('chat/messages')
@UseGuards(JwtAuthGuard)
@UseInterceptors(RlsContextInterceptor)
export class ChatMessageFlagController {
  constructor(private readonly dataSource: DataSource) {}

  @Post(':id/flag')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Flag a chat message for moderation',
    description:
      'Creates a chat_message_flags row visible to tenant admins. Idempotent against the (message, reporter) pair while the flag is open — a second call returns the existing flag without erroring.',
  })
  @ApiResponse({ status: 201, description: '{ flagged: true, flagId }' })
  async flagMessage(
    @Param('id', ParseUUIDPipe) messageId: string,
    @Body() dto: CreateFlagDto,
    @CurrentUser() user: SupabaseJwtPayload,
  ) {
    const tenantId = user.app_metadata?.current_tenant_id;
    if (!tenantId) throw new BadRequestException('No tenant context');

    const [msg] = await this.dataSource.query(
      `SELECT m.id, m.channel_id, c.tenant_id
         FROM public.chat_messages m
         JOIN public.chat_channels c ON c.id = m.channel_id
        WHERE m.id = $1`,
      [messageId],
    );
    if (!msg) throw new NotFoundException('Message not found');
    if (msg.tenant_id !== tenantId) {
      throw new BadRequestException('Message is in a different tenant');
    }

    // Channel-membership guard: only members of the channel can flag.
    // Without this, any tenant member could flag any other member's
    // DMs from outside the conversation — a tenant-wide DM surveillance
    // vector (any flagged thread is then visible to admins via
    // getThreadContext).
    const [member] = await this.dataSource.query(
      `SELECT 1 FROM public.channel_members
       WHERE channel_id = $1 AND user_id = $2 LIMIT 1`,
      [msg.channel_id, user.sub],
    );
    if (!member) {
      throw new ForbiddenException('You are not a member of this channel');
    }

    try {
      const [row] = await this.dataSource.query(
        `INSERT INTO public.chat_message_flags
           (tenant_id, message_id, reporter_id, reason)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [tenantId, messageId, user.sub, dto.reason],
      );
      return { flagged: true, flagId: row.id };
    } catch (err: any) {
      // Unique partial index uq_chat_message_flags_open_per_reporter
      // catches double-reports while a flag is open — return the
      // existing flag id so the mobile can treat it as success.
      if (err.code === '23505') {
        const [existing] = await this.dataSource.query(
          `SELECT id FROM public.chat_message_flags
            WHERE message_id = $1 AND reporter_id = $2 AND status = 'open'`,
          [messageId, user.sub],
        );
        return { flagged: true, flagId: existing?.id ?? null };
      }
      throw err;
    }
  }
}
