import {
  Injectable,
  NotFoundException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { rlsStorage } from '../common/storage/rls.storage';
import { Notification } from './entities/notification.entity';
import { GetNotificationsDto } from './dto/get-notifications.dto';
import { IsNull } from 'typeorm';

export interface PaginatedNotifications {
  notifications: Notification[];
  total: number;
  limit: number;
  offset: number;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  /**
   * Returns paginated notifications for the authenticated user.
   * RLS SELECT policy ensures only the recipient's own notifications are visible,
   * scoped to the current tenant.
   */
  async getNotifications(query: GetNotificationsDto): Promise<PaginatedNotifications> {
    const { queryRunner } = this.getRlsContext();
    const limit = query.limit ?? 20;
    const offset = query.offset ?? 0;

    const where: Record<string, unknown> = {};
    if (query.unreadOnly) {
      where.readAt = IsNull();
    }

    const [notifications, total] = await queryRunner.manager.findAndCount(Notification, {
      where,
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });

    return { notifications, total, limit, offset };
  }

  /**
   * Marks a notification as read.
   * RLS UPDATE policy ensures the caller can only update their own notifications.
   * Returns 404 if the notification doesn't exist, belongs to another user,
   * or is in another tenant — same ambiguous error pattern used throughout.
   */
  async markAsRead(notificationId: string): Promise<Notification> {
    const { queryRunner } = this.getRlsContext();

    const result = await queryRunner.manager.update(
      Notification,
      { id: notificationId },
      { readAt: new Date() },
    );

    if (result.affected === 0) {
      throw new NotFoundException('Notification not found');
    }

    const updated = await queryRunner.manager.findOne(Notification, {
      where: { id: notificationId },
    });

    this.logger.log(`Notification ${notificationId} marked as read`);
    return updated!;
  }

  private getRlsContext() {
    const context = rlsStorage.getStore();
    if (!context) {
      throw new InternalServerErrorException(
        'RLS context unavailable. Ensure RlsContextInterceptor is applied.',
      );
    }
    return context;
  }
}
