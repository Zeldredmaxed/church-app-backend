import {
  Injectable,
  ConflictException,
  BadRequestException,
  NotFoundException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Follow } from './entities/follow.entity';
import { User } from '../users/entities/user.entity';

export interface FollowListResult {
  users: Array<{ id: string; fullName: string | null; avatarUrl: string | null }>;
  total: number;
  limit: number;
  offset: number;
}

@Injectable()
export class FollowsService {
  private readonly logger = new Logger(FollowsService.name);

  constructor(private readonly dataSource: DataSource) {}

  /**
   * Creates a follow relationship.
   *
   * Uses service-role connection because follows are platform-wide (not tenant-scoped).
   * The RLS INSERT policy enforces that follower_id = auth.uid(), but since we
   * derive follower_id from the verified JWT, the service-role bypass is safe.
   * The DB CHECK constraint prevents self-follows.
   */
  async follow(followerId: string, followingId: string): Promise<{ message: string }> {
    if (followerId === followingId) {
      throw new BadRequestException('You cannot follow yourself');
    }

    // Verify target user exists
    const targetUser = await this.dataSource.manager.findOne(User, {
      where: { id: followingId },
    });
    if (!targetUser) {
      throw new NotFoundException('User not found');
    }

    try {
      await this.dataSource.manager.save(
        Follow,
        this.dataSource.manager.create(Follow, {
          followerId,
          followingId,
        }),
      );
    } catch (error: any) {
      // Unique constraint violation — already following
      if (error.code === '23505') {
        throw new ConflictException('You are already following this user');
      }
      throw error;
    }

    this.logger.log(`User ${followerId} followed ${followingId}`);
    return { message: 'Followed successfully' };
  }

  /**
   * Removes a follow relationship.
   * Only the follower can unfollow (derived from JWT sub).
   */
  async unfollow(followerId: string, followingId: string): Promise<{ message: string }> {
    const result = await this.dataSource.manager.delete(Follow, {
      followerId,
      followingId,
    });

    if (result.affected === 0) {
      throw new NotFoundException('You are not following this user');
    }

    this.logger.log(`User ${followerId} unfollowed ${followingId}`);
    return { message: 'Unfollowed successfully' };
  }

  /**
   * Returns paginated list of users who follow the specified user.
   */
  async getFollowers(
    userId: string,
    limit = 20,
    offset = 0,
  ): Promise<FollowListResult> {
    const [follows, total] = await this.dataSource.manager.findAndCount(Follow, {
      where: { followingId: userId },
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });

    const users = await this.resolveUsers(follows.map(f => f.followerId));
    return { users, total, limit, offset };
  }

  /**
   * Returns paginated list of users the specified user is following.
   */
  async getFollowing(
    userId: string,
    limit = 20,
    offset = 0,
  ): Promise<FollowListResult> {
    const [follows, total] = await this.dataSource.manager.findAndCount(Follow, {
      where: { followerId: userId },
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });

    const users = await this.resolveUsers(follows.map(f => f.followingId));
    return { users, total, limit, offset };
  }

  /**
   * Batch-resolves user profiles for a list of user IDs.
   * Returns only public-safe fields (id, fullName, avatarUrl).
   */
  private async resolveUsers(
    userIds: string[],
  ): Promise<Array<{ id: string; fullName: string | null; avatarUrl: string | null }>> {
    if (userIds.length === 0) return [];

    const users = await this.dataSource.manager
      .createQueryBuilder(User, 'u')
      .select(['u.id', 'u.fullName', 'u.avatarUrl'])
      .where('u.id IN (:...ids)', { ids: userIds })
      .getMany();

    // Preserve the original order from the follows query
    const userMap = new Map(users.map(u => [u.id, u]));
    return userIds
      .map(id => userMap.get(id))
      .filter((u): u is User => u !== undefined)
      .map(u => ({ id: u.id, fullName: u.fullName, avatarUrl: u.avatarUrl }));
  }
}
