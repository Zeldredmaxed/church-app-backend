import {
  Controller,
  Get,
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
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
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
    @Query('window') window?: string,
  ) {
    const parsedWindow = Math.min(Math.max(parseInt(window ?? '10', 10) || 10, 1), 50);

    const [target] = await this.dataSource.query(
      `SELECT m.id, m.channel_id, m.user_id, m.content, m.media_url, m.media_type,
              m.created_at, m.deleted_at, m.deleted_by, u.full_name AS author_name
       FROM public.chat_messages m
       LEFT JOIN public.users u ON u.id = m.user_id
       WHERE m.id = $1 AND m.channel_id = $2`,
      [aroundMessageId, channelId],
    );
    if (!target) throw new BadRequestException('Target message not found in channel');

    const before = await this.dataSource.query(
      `SELECT m.id, m.user_id, m.content, m.media_url, m.created_at, m.deleted_at, u.full_name AS author_name
       FROM public.chat_messages m
       LEFT JOIN public.users u ON u.id = m.user_id
       WHERE m.channel_id = $1 AND m.created_at < $2
       ORDER BY m.created_at DESC LIMIT $3`,
      [channelId, target.created_at, parsedWindow],
    );

    const after = await this.dataSource.query(
      `SELECT m.id, m.user_id, m.content, m.media_url, m.created_at, m.deleted_at, u.full_name AS author_name
       FROM public.chat_messages m
       LEFT JOIN public.users u ON u.id = m.user_id
       WHERE m.channel_id = $1 AND m.created_at > $2
       ORDER BY m.created_at ASC LIMIT $3`,
      [channelId, target.created_at, parsedWindow],
    );

    return {
      before: before.reverse(), // ascending order in the response
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
