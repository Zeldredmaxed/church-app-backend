import {
  Injectable,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { DataSource } from 'typeorm';
import { rlsStorage } from '../common/storage/rls.storage';
import { ChatChannel } from './entities/chat-channel.entity';
import { ChannelMember } from './entities/channel-member.entity';
import { ChatMessage } from './entities/chat-message.entity';
import { SendMessageDto } from './dto/send-message.dto';
import { NotificationType } from '../notifications/notifications.types';

@Injectable()
export class ConversationService {
  private readonly logger = new Logger(ConversationService.name);

  constructor(
    private readonly dataSource: DataSource,
    @InjectQueue('notifications') private readonly notificationsQueue: Queue,
  ) {}

  private getRlsContext() {
    const ctx = rlsStorage.getStore();
    if (!ctx) throw new InternalServerErrorException('RLS context unavailable');
    if (!ctx.currentTenantId) {
      throw new BadRequestException('No tenant context. Call POST /api/auth/switch-tenant first.');
    }
    return ctx;
  }

  /**
   * List all DM conversations for the authenticated user.
   * Returns each conversation with the other participant's info and the last message.
   */
  async listConversations(userId: string) {
    const { currentTenantId } = this.getRlsContext();

    const rows = await this.dataSource.query(
      `SELECT
         ch.id,
         ch.updated_at,
         -- The other participant (not me)
         u.id AS participant_id,
         u.full_name AS participant_name,
         u.avatar_url AS participant_avatar,
         u.is_online AS participant_is_online,
         u.last_seen_at AS participant_last_seen_at,
         -- Last message preview
         lm.content AS last_message_content,
         lm.media_type AS last_message_media_type,
         lm.created_at AS last_message_at,
         lm.user_id AS last_message_sender_id,
         -- Unread count: messages from other user after my last_read_at
         (SELECT COUNT(*)::int FROM public.chat_messages
          WHERE channel_id = ch.id AND user_id != $1
            AND created_at > COALESCE(cm.last_read_at, '1970-01-01')
         ) AS unread_count
       FROM public.chat_channels ch
       JOIN public.channel_members cm ON cm.channel_id = ch.id AND cm.user_id = $1
       JOIN public.channel_members cm2 ON cm2.channel_id = ch.id AND cm2.user_id != $1
       JOIN public.users u ON u.id = cm2.user_id
       LEFT JOIN LATERAL (
         SELECT content, media_type, created_at, user_id
         FROM public.chat_messages
         WHERE channel_id = ch.id
         ORDER BY created_at DESC
         LIMIT 1
       ) lm ON true
       WHERE ch.tenant_id = $2 AND ch.type = 'direct'
       ORDER BY COALESCE(lm.created_at, ch.updated_at) DESC`,
      [userId, currentTenantId],
    );

    return rows.map((r: any) => ({
      id: r.id,
      participant: {
        id: r.participant_id,
        fullName: r.participant_name,
        avatarUrl: r.participant_avatar,
        isOnline: r.participant_is_online ?? false,
        lastSeenAt: r.participant_last_seen_at,
      },
      lastMessage: r.last_message_content != null ? {
        content: r.last_message_content,
        mediaType: r.last_message_media_type,
        senderId: r.last_message_sender_id,
        createdAt: r.last_message_at,
      } : null,
      unreadCount: r.unread_count ?? 0,
      updatedAt: r.updated_at,
    }));
  }

  /**
   * Get or create a DM conversation with a participant.
   * If a direct channel already exists between the two users, return it.
   * Otherwise, create a new one.
   */
  async getOrCreateConversation(userId: string, participantId: string) {
    const { queryRunner, currentTenantId } = this.getRlsContext();

    if (userId === participantId) {
      throw new BadRequestException('Cannot create a conversation with yourself.');
    }

    // Check if a direct channel already exists between these two users
    const existing = await this.dataSource.query(
      `SELECT ch.id, ch.updated_at
       FROM public.chat_channels ch
       JOIN public.channel_members cm1 ON cm1.channel_id = ch.id AND cm1.user_id = $1
       JOIN public.channel_members cm2 ON cm2.channel_id = ch.id AND cm2.user_id = $2
       WHERE ch.tenant_id = $3 AND ch.type = 'direct'
       LIMIT 1`,
      [userId, participantId, currentTenantId],
    );

    let conversationId: string;
    if (existing.length > 0) {
      conversationId = existing[0].id;
    } else {
      // Create a new direct channel
      const channel = queryRunner.manager.create(ChatChannel, {
        tenantId: currentTenantId!,
        name: null,
        type: 'direct',
        createdBy: userId,
      });
      const saved = await queryRunner.manager.save(ChatChannel, channel);
      conversationId = saved.id;

      // Add both users as members
      await queryRunner.manager.save(ChannelMember, [
        queryRunner.manager.create(ChannelMember, { channelId: saved.id, userId }),
        queryRunner.manager.create(ChannelMember, { channelId: saved.id, userId: participantId }),
      ]);

      this.logger.log(`DM conversation created: ${saved.id} between ${userId} and ${participantId}`);
    }

    // Fetch participant info with presence
    const [participant] = await this.dataSource.query(
      `SELECT id, full_name, avatar_url, is_online, last_seen_at FROM public.users WHERE id = $1`,
      [participantId],
    );

    if (!participant) throw new NotFoundException('Participant not found');

    return {
      id: conversationId,
      participant: {
        id: participant.id,
        fullName: participant.full_name,
        avatarUrl: participant.avatar_url,
        isOnline: participant.is_online ?? false,
        lastSeenAt: participant.last_seen_at,
      },
      updatedAt: existing[0]?.updated_at ?? new Date().toISOString(),
    };
  }

  /**
   * Get messages in a conversation.
   * Returns in chronological order (oldest first) for chat UI rendering.
   */
  async getMessages(conversationId: string, userId: string) {
    const { currentTenantId } = this.getRlsContext();

    // Verify user is a member of this conversation
    const membership = await this.dataSource.query(
      `SELECT 1 FROM public.channel_members WHERE channel_id = $1 AND user_id = $2`,
      [conversationId, userId],
    );
    if (membership.length === 0) {
      throw new NotFoundException('Conversation not found');
    }

    const rows = await this.dataSource.query(
      `SELECT id, channel_id, user_id, content, media_url, media_type, created_at
       FROM public.chat_messages
       WHERE channel_id = $1
       ORDER BY created_at ASC`,
      [conversationId],
    );

    // Mark conversation as read (update last_read_at — resets unread count)
    this.dataSource.query(
      `UPDATE public.channel_members SET last_read_at = now() WHERE channel_id = $1 AND user_id = $2`,
      [conversationId, userId],
    ).catch(err => this.logger.warn(`Failed to update last_read_at: ${err.message}`));

    return rows.map((r: any) => ({
      id: r.id,
      conversationId: r.channel_id,
      senderId: r.user_id,
      content: r.content,
      mediaUrl: r.media_url,
      mediaType: r.media_type,
      createdAt: r.created_at,
    }));
  }

  /**
   * Send a message in a conversation.
   */
  async sendMessage(conversationId: string, dto: SendMessageDto, userId: string) {
    const { queryRunner, currentTenantId } = this.getRlsContext();

    // Verify channel exists and user is a member
    const channel = await queryRunner.manager.findOne(ChatChannel, {
      where: { id: conversationId },
    });
    if (!channel) throw new NotFoundException('Conversation not found');

    const membership = await queryRunner.query(
      `SELECT 1 FROM public.channel_members WHERE channel_id = $1 AND user_id = $2`,
      [conversationId, userId],
    );
    if (membership.length === 0) {
      throw new NotFoundException('Conversation not found');
    }

    // Validate content
    const hasContent = dto.content && dto.content.trim().length > 0;
    const hasMedia = dto.mediaUrl && dto.mediaUrl.trim().length > 0;
    if (!hasContent && !hasMedia) {
      throw new BadRequestException('A message must have either text content or a media attachment.');
    }
    if (hasMedia && !dto.mediaType) {
      throw new BadRequestException('mediaType is required when mediaUrl is provided.');
    }

    const message = queryRunner.manager.create(ChatMessage, {
      channelId: conversationId,
      userId,
      content: hasContent ? dto.content!.trim() : null,
      mediaUrl: hasMedia ? dto.mediaUrl! : null,
      mediaType: hasMedia ? dto.mediaType! : null,
    });
    const saved = await queryRunner.manager.save(ChatMessage, message);

    // Update channel's updated_at for conversation ordering
    await queryRunner.manager.update(ChatChannel, { id: conversationId }, { updatedAt: new Date() });

    // Send push notification to the other participant
    const members = await queryRunner.manager.find(ChannelMember, {
      where: { channelId: conversationId },
    });
    const previewText = hasContent
      ? dto.content!.slice(0, 100)
      : dto.mediaType === 'audio' ? '🎤 Voice note' : `📎 ${dto.mediaType ?? 'Media'}`;

    for (const member of members) {
      if (member.userId === userId) continue;
      await this.notificationsQueue.add('notification', {
        type: NotificationType.NEW_MESSAGE,
        tenantId: currentTenantId!,
        recipientUserId: member.userId,
        actorUserId: userId,
        channelId: conversationId,
        channelName: 'Direct Message',
        previewText,
      });
    }

    this.logger.log(`DM sent: ${saved.id} in conversation ${conversationId} by ${userId}`);

    return {
      id: saved.id,
      conversationId: saved.channelId,
      senderId: saved.userId,
      content: saved.content,
      mediaUrl: saved.mediaUrl,
      mediaType: saved.mediaType,
      createdAt: saved.createdAt,
    };
  }
}
