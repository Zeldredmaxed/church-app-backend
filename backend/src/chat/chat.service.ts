import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { rlsStorage } from '../common/storage/rls.storage';
import { ChatChannel } from './entities/chat-channel.entity';
import { ChannelMember } from './entities/channel-member.entity';
import { ChatMessage } from './entities/chat-message.entity';
import { CreateChannelDto } from './dto/create-channel.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { NotificationType } from '../notifications/notifications.types';

@Injectable()
export class ChatService {
  constructor(
    @InjectQueue('notifications') private readonly notificationsQueue: Queue,
  ) {}

  /** Returns the RLS context, throwing 400 if no tenant is set in the JWT. */
  private requireTenantContext() {
    const ctx = rlsStorage.getStore();
    if (!ctx) {
      throw new BadRequestException('RLS context unavailable');
    }
    if (!ctx.currentTenantId) {
      throw new BadRequestException(
        'No tenant context. Call POST /api/auth/switch-tenant then POST /api/auth/refresh first.',
      );
    }
    return ctx;
  }

  /**
   * Creates a chat channel within the current tenant.
   * RLS INSERT policy enforces:
   *   - tenant_id matches JWT
   *   - created_by matches authenticated user
   *   - public/private channels require admin/pastor role
   *   - direct channels: any tenant member
   *
   * After creation, automatically adds the creator as a channel member.
   */
  async createChannel(dto: CreateChannelDto, userId: string): Promise<ChatChannel> {
    const { queryRunner, currentTenantId } = this.requireTenantContext();

    const channel = queryRunner.manager.create(ChatChannel, {
      tenantId: currentTenantId!,
      name: dto.name ?? null,
      type: dto.type,
      createdBy: userId,
    });

    const saved = await queryRunner.manager.save(ChatChannel, channel);

    // Auto-add the creator as a channel member
    await queryRunner.manager.save(
      ChannelMember,
      queryRunner.manager.create(ChannelMember, {
        channelId: saved.id,
        userId,
      }),
    );

    return saved;
  }

  /**
   * Returns channels accessible to the authenticated user in the current tenant.
   * RLS SELECT policy handles visibility (public = all, private/direct = members only).
   */
  async getChannels(): Promise<ChatChannel[]> {
    const { queryRunner } = this.requireTenantContext();
    return queryRunner.manager.find(ChatChannel, {
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Adds a user to a channel.
   * RLS INSERT policy on channel_members enforces:
   *   - Public: user can add themselves
   *   - Direct: creator or existing member can add the other participant
   *   - Private: admin/pastor only
   *
   * Catches PG unique violation (23505) for duplicate membership — idempotent.
   */
  async addMember(channelId: string, targetUserId: string): Promise<ChannelMember> {
    const { queryRunner } = rlsStorage.getStore()!;

    // Verify channel exists and is accessible (RLS enforced)
    const channel = await queryRunner.manager.findOne(ChatChannel, {
      where: { id: channelId },
    });
    if (!channel) {
      throw new NotFoundException('Channel not found');
    }

    try {
      const member = queryRunner.manager.create(ChannelMember, {
        channelId,
        userId: targetUserId,
      });
      return await queryRunner.manager.save(ChannelMember, member);
    } catch (err: any) {
      if (err.code === '23505') {
        // Already a member — return existing membership (idempotent)
        return queryRunner.manager.findOneOrFail(ChannelMember, {
          where: { channelId, userId: targetUserId },
        });
      }
      throw err;
    }
  }

  /**
   * Sends a message to a channel.
   * RLS INSERT policy on chat_messages enforces:
   *   - user_id matches authenticated user
   *   - user has access to the channel
   *
   * Dispatches NEW_MESSAGE notification to other channel members
   * for private and direct channels.
   */
  async sendMessage(
    channelId: string,
    dto: SendMessageDto,
    userId: string,
  ): Promise<ChatMessage> {
    const { queryRunner, currentTenantId } = this.requireTenantContext();

    // Verify channel exists and is accessible (RLS enforced)
    const channel = await queryRunner.manager.findOne(ChatChannel, {
      where: { id: channelId },
    });
    if (!channel) {
      throw new NotFoundException('Channel not found');
    }

    const message = queryRunner.manager.create(ChatMessage, {
      channelId,
      userId,
      content: dto.content,
    });
    const saved = await queryRunner.manager.save(ChatMessage, message);

    // Dispatch push notifications for private/direct channels.
    // Public channels are too noisy for push — in-app only.
    if (channel.type === 'private' || channel.type === 'direct') {
      // Fetch other channel members (exclude sender)
      const members = await queryRunner.manager.find(ChannelMember, {
        where: { channelId },
      });

      for (const member of members) {
        if (member.userId === userId) continue; // skip sender
        await this.notificationsQueue.add('notification', {
          type: NotificationType.NEW_MESSAGE,
          tenantId: currentTenantId!,
          recipientUserId: member.userId,
          actorUserId: userId,
          channelId,
          channelName: channel.name ?? 'Direct Message',
          previewText: dto.content.slice(0, 100),
        });
      }
    }

    return saved;
  }

  /**
   * Returns messages for a channel using cursor-based pagination.
   *
   * Cursor-based pagination is superior to offset-based for chat because:
   *   1. No skipped/duplicated messages when new messages arrive during pagination
   *   2. Consistent performance regardless of how deep the user scrolls
   *   3. Natural fit for "load older messages" UX pattern
   *
   * If `cursor` is provided, returns messages created BEFORE the cursor message.
   * If `cursor` is null, returns the most recent messages.
   */
  async getMessages(
    channelId: string,
    cursor?: string,
    limit: number = 50,
  ): Promise<{ messages: ChatMessage[]; nextCursor: string | null }> {
    const { queryRunner } = rlsStorage.getStore()!;

    // Verify channel exists and is accessible (RLS enforced)
    const channel = await queryRunner.manager.findOne(ChatChannel, {
      where: { id: channelId },
    });
    if (!channel) {
      throw new NotFoundException('Channel not found');
    }

    const qb = queryRunner.manager
      .createQueryBuilder(ChatMessage, 'msg')
      .where('msg.channel_id = :channelId', { channelId })
      .orderBy('msg.created_at', 'DESC')
      .take(limit + 1); // fetch one extra to determine if there are more

    if (cursor) {
      // Get the cursor message's created_at to page from
      const cursorMsg = await queryRunner.manager.findOne(ChatMessage, {
        where: { id: cursor },
        select: ['createdAt'],
      });
      if (cursorMsg) {
        qb.andWhere('msg.created_at < :cursorDate', {
          cursorDate: cursorMsg.createdAt,
        });
      }
    }

    const results = await qb.getMany();

    const hasMore = results.length > limit;
    const messages = hasMore ? results.slice(0, limit) : results;
    const nextCursor = hasMore ? messages[messages.length - 1].id : null;

    return { messages, nextCursor };
  }
}
