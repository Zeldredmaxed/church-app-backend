import {
  Injectable,
  NotFoundException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseAdminService } from '../common/services/supabase-admin.service';
import { rlsStorage } from '../common/storage/rls.storage';
import { MediaService } from '../media/media.service';
import { User } from './entities/user.entity';
import { UserSettings } from './entities/user-settings.entity';
import { LoginStreak } from './entities/login-streak.entity';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateSettingsDto } from './dto/update-settings.dto';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);
  private readonly supabaseAdmin: SupabaseClient;

  constructor(
    private readonly dataSource: DataSource,
    private readonly supabaseAdminService: SupabaseAdminService,
    private readonly mediaService: MediaService,
  ) {
    this.supabaseAdmin = supabaseAdminService.client;
  }

  /**
   * Returns the authenticated user's own profile.
   *
   * Uses the RLS-scoped QueryRunner. The RLS policy
   * "users: select self or same-tenant member" permits `id = auth.uid()`,
   * so querying by the authenticated user's own ID will always succeed.
   *
   * If somehow the row is missing (handle_new_user trigger failed on signup),
   * a NotFoundException is thrown.
   */
  async getMe(userId: string): Promise<User> {
    const { queryRunner } = this.getRlsContext();

    const user = await queryRunner.manager.findOne(User, {
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User profile not found');
    }

    return user;
  }

  /**
   * Updates the authenticated user's own profile (fullName, avatarUrl).
   *
   * Uses the RLS-scoped QueryRunner. The RLS policy
   * "users: update self only" enforces `id = auth.uid()` in both USING and
   * WITH CHECK, making it impossible for this call to affect any other user's
   * row — even if the service code accidentally passed a different id.
   *
   * Returns the full updated profile so the client can update its local state
   * without a separate GET request.
   */
  async updateMe(userId: string, dto: UpdateUserDto): Promise<User> {
    const { queryRunner } = this.getRlsContext();

    // Build partial update — only include fields present in the DTO
    const updates: Partial<User> = {};
    if (dto.fullName !== undefined) updates.fullName = dto.fullName;
    if (dto.avatarUrl !== undefined) updates.avatarUrl = dto.avatarUrl;
    if (dto.gender !== undefined) updates.gender = dto.gender;

    if (Object.keys(updates).length === 0) {
      // Nothing to update — return current profile unchanged
      return this.getMe(userId);
    }

    await queryRunner.manager.update(User, { id: userId }, updates);

    // Re-fetch through the same RLS QueryRunner to return the updated state
    const updated = await queryRunner.manager.findOne(User, {
      where: { id: userId },
    });

    if (!updated) {
      throw new NotFoundException('User profile not found after update');
    }

    return updated;
  }

  /**
   * Permanently deletes the authenticated user's account and all associated data.
   * Implements GDPR Article 17 "Right to Erasure".
   *
   * Deletion order:
   *   1. Fetch user's tenant memberships (needed for S3 cleanup)
   *   2. Delete S3 objects across all tenant namespaces (best-effort)
   *   3. Delete from public.users — ON DELETE CASCADE removes:
   *      posts, comments, chat_messages, notifications, follows,
   *      channel_members, chat_channels, tenant_memberships, invitations
   *   4. transactions.user_id is SET NULL (financial records preserved)
   *   5. Delete from auth.users via Supabase Admin API (revokes access)
   *
   * Uses service-role DataSource (not RLS QueryRunner) because the deletion
   * must operate across tenant boundaries and cascade through all tables.
   */
  async deleteMe(userId: string): Promise<{ deleted: true }> {
    this.logger.log(`Account deletion initiated for user ${userId}`);

    // Step 1: Fetch tenant memberships for S3 cleanup scope
    const memberships = await this.dataSource.manager.query(
      `SELECT tenant_id FROM public.tenant_memberships WHERE user_id = $1`,
      [userId],
    );
    const tenantIds: string[] = memberships.map(
      (m: { tenant_id: string }) => m.tenant_id,
    );

    // Step 2: Delete S3 objects (best-effort — failures logged, not thrown)
    if (tenantIds.length > 0) {
      const deletedCount = await this.mediaService.deleteUserObjects(
        tenantIds,
        userId,
      );
      this.logger.log(
        `Deleted ${deletedCount} S3 objects for user ${userId}`,
      );
    }

    // Step 3: Delete from public.users.
    // ON DELETE CASCADE removes: posts, comments, chat_messages, notifications,
    // follows, channel_members, chat_channels, tenant_memberships, invitations.
    // ON DELETE SET NULL on transactions.user_id preserves financial records.
    const result = await this.dataSource.manager.query(
      `DELETE FROM public.users WHERE id = $1`,
      [userId],
    );

    if (result[1] === 0) {
      throw new NotFoundException('User not found');
    }

    this.logger.log(`Deleted public.users row for user ${userId}`);

    // Step 4: Delete from auth.users via Supabase Admin API.
    // This revokes all sessions and prevents the user from logging in.
    const { error } = await this.supabaseAdmin.auth.admin.deleteUser(userId);
    if (error) {
      // Log but don't throw — the PG row is already gone.
      // The auth.users row will be orphaned but harmless (no public.users to reference).
      this.logger.error(
        `Failed to delete auth.users for ${userId}: ${error.message}`,
      );
    } else {
      this.logger.log(`Deleted auth.users row for user ${userId}`);
    }

    return { deleted: true };
  }

  /**
   * Exports all personal data for the authenticated user.
   * Implements GDPR Article 15 "Right of Access" / data portability.
   *
   * Returns a structured JSON object containing:
   *   - User profile
   *   - Posts authored
   *   - Comments authored
   *   - Chat messages sent
   *   - Transaction/donation history
   *   - Tenant memberships
   *   - Follow relationships
   *
   * Uses the RLS-scoped QueryRunner for profile data, and service-role
   * for the full export (to ensure completeness across tenants).
   */
  async exportData(userId: string): Promise<Record<string, unknown>> {
    this.logger.log(`Data export initiated for user ${userId}`);

    // Use service-role connection (not RLS) to export across all tenants.
    // RLS would only show data for the user's current tenant context.
    const manager = this.dataSource.manager;

    const [profile, posts, comments, messages, transactions, memberships, follows] =
      await Promise.all([
        // Profile
        manager.query(
          `SELECT id, email, full_name, avatar_url, phone, gender, created_at
           FROM public.users WHERE id = $1`,
          [userId],
        ),

        // Posts
        manager.query(
          `SELECT id, tenant_id, content, media_url, media_type, created_at
           FROM public.posts WHERE author_id = $1
           ORDER BY created_at DESC`,
          [userId],
        ),

        // Comments
        manager.query(
          `SELECT id, post_id, content, created_at
           FROM public.comments WHERE author_id = $1
           ORDER BY created_at DESC`,
          [userId],
        ),

        // Chat messages
        manager.query(
          `SELECT id, channel_id, content, created_at
           FROM public.chat_messages WHERE user_id = $1
           ORDER BY created_at DESC`,
          [userId],
        ),

        // Transactions (donations)
        manager.query(
          `SELECT id, tenant_id, amount, currency, status, created_at
           FROM public.transactions WHERE user_id = $1
           ORDER BY created_at DESC`,
          [userId],
        ),

        // Tenant memberships
        manager.query(
          `SELECT tm.tenant_id, t.name AS tenant_name, tm.role, tm.created_at
           FROM public.tenant_memberships tm
           JOIN public.tenants t ON t.id = tm.tenant_id
           WHERE tm.user_id = $1
           ORDER BY tm.created_at DESC`,
          [userId],
        ),

        // Follow relationships
        manager.query(
          `SELECT
             (SELECT json_agg(json_build_object('userId', following_id, 'since', created_at))
              FROM public.follows WHERE follower_id = $1) AS following,
             (SELECT json_agg(json_build_object('userId', follower_id, 'since', created_at))
              FROM public.follows WHERE following_id = $1) AS followers`,
          [userId],
        ),
      ]);

    const exportData = {
      exportedAt: new Date().toISOString(),
      profile: profile[0] ?? null,
      posts,
      comments,
      chatMessages: messages,
      transactions,
      memberships,
      follows: {
        following: follows[0]?.following ?? [],
        followers: follows[0]?.followers ?? [],
      },
    };

    this.logger.log(
      `Data export completed for user ${userId}: ` +
        `${posts.length} posts, ${comments.length} comments, ` +
        `${messages.length} messages, ${transactions.length} transactions`,
    );

    return exportData;
  }

  /**
   * Returns the user's notification settings.
   * If no row exists yet, returns defaults.
   */
  async getSettings(userId: string): Promise<UserSettings> {
    const settings = await this.dataSource.manager.findOne(UserSettings, {
      where: { userId },
    });

    if (!settings) {
      return {
        userId,
        emailNotifications: true,
        pushNotifications: true,
        smsNotifications: false,
        updatedAt: new Date(),
      } as UserSettings;
    }

    return settings;
  }

  /**
   * Upserts the user's notification settings.
   */
  async updateSettings(userId: string, dto: UpdateSettingsDto): Promise<UserSettings> {
    const existing = await this.dataSource.manager.findOne(UserSettings, {
      where: { userId },
    });

    if (existing) {
      if (dto.emailNotifications !== undefined) existing.emailNotifications = dto.emailNotifications;
      if (dto.pushNotifications !== undefined) existing.pushNotifications = dto.pushNotifications;
      if (dto.smsNotifications !== undefined) existing.smsNotifications = dto.smsNotifications;
      return this.dataSource.manager.save(UserSettings, existing);
    }

    const settings = this.dataSource.manager.create(UserSettings, {
      userId,
      emailNotifications: dto.emailNotifications ?? true,
      pushNotifications: dto.pushNotifications ?? true,
      smsNotifications: dto.smsNotifications ?? false,
    });
    return this.dataSource.manager.save(UserSettings, settings);
  }

  /**
   * Returns the user's login streak info.
   * If no row exists yet, returns zero streaks.
   */
  async getStreak(userId: string) {
    const streak = await this.dataSource.manager.findOne(LoginStreak, {
      where: { userId },
    });

    if (!streak) {
      return { currentStreak: 0, longestStreak: 0 };
    }

    return {
      currentStreak: streak.currentStreak,
      longestStreak: streak.longestStreak,
      lastLoginDate: streak.lastLoginDate,
    };
  }

  /**
   * Records a login for streak tracking.
   * If last_login_date is yesterday, increments the streak.
   * If today, no-op. Otherwise resets to 1.
   */
  async recordLogin(userId: string): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO public.login_streaks (user_id, current_streak, longest_streak, last_login_date, updated_at)
       VALUES ($1, 1, 1, CURRENT_DATE, now())
       ON CONFLICT (user_id) DO UPDATE SET
         current_streak = CASE
           WHEN login_streaks.last_login_date = CURRENT_DATE - 1 THEN login_streaks.current_streak + 1
           WHEN login_streaks.last_login_date = CURRENT_DATE THEN login_streaks.current_streak
           ELSE 1
         END,
         longest_streak = GREATEST(
           login_streaks.longest_streak,
           CASE
             WHEN login_streaks.last_login_date = CURRENT_DATE - 1 THEN login_streaks.current_streak + 1
             WHEN login_streaks.last_login_date = CURRENT_DATE THEN login_streaks.current_streak
             ELSE 1
           END
         ),
         last_login_date = CURRENT_DATE,
         updated_at = now()`,
      [userId],
    );
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
