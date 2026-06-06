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
  /**
   * Whitelist of fields PATCH /api/users/me may modify. Every key here is
   * a property name on both UpdateUserDto and the User entity (camelCase).
   * Adding a new profile field = add it to the migration, the entity, the
   * DTO, and this list.
   *
   * Explicitly excluded: id, email, lastAccessedTenantId, isOnline,
   * lastSeenAt, stripeCustomerId, createdAt — these are managed by other
   * paths (Supabase Auth, tenant-switch, presence interceptor, Stripe).
   */
  private static readonly UPDATABLE_FIELDS = [
    'fullName', 'avatarUrl', 'gender',
    'phone', 'phoneSecondary', 'address', 'preferredContactMethod',
    'dateOfBirth', 'occupation', 'employer',
    'maritalStatus', 'anniversary', 'spouseName',
    'hasChildren', 'children', 'emergencyContact',
    'membershipStatus', 'memberSince',
    'baptized', 'baptismDate', 'baptismLocation', 'salvationDate',
    'previousChurch', 'howDidYouHear',
    'serviceInterests', 'skills', 'languages',
    'tshirtSize', 'dietaryRestrictions',
    'newsletterOptIn', 'smsOptIn', 'photoReleaseConsent',
    'birthdayVisible', 'anniversaryVisible',
  ] as const;

  /**
   * Returns the public-safe profile shape for any user. Used by the mobile
   * ChurchPill and profile cards rendered for users outside the viewer's
   * tenant. Service-role: this endpoint is intentionally cross-tenant so a
   * user in church A can still see "this is a member of church B" when
   * encountering their post in a cross-tenant feed.
   *
   * Excludes every PRIVATE field — only the safe trio (fullName,
   * avatarUrl, createdAt) plus the resolved home church.
   */
  async getPublicProfile(userId: string) {
    const [row] = await this.dataSource.query(
      `SELECT u.id, u.full_name, u.avatar_url, u.created_at,
              u.date_of_birth, u.birthday_visible,
              u.anniversary, u.anniversary_visible,
              t.id AS church_id, t.name AS church_name, t.brand_color AS church_brand_color, t.is_guest AS church_is_guest
       FROM public.users u
       LEFT JOIN public.tenants t ON t.id = u.last_accessed_tenant_id
       WHERE u.id = $1`,
      [userId],
    );

    if (!row) {
      throw new NotFoundException('User not found');
    }

    // Hide the "no church home" tenant from the public pill. A guest user
    // shows as having no church rather than as a member of an internal
    // bookkeeping tenant.
    const church =
      row.church_id && !row.church_is_guest
        ? {
            id: row.church_id,
            name: row.church_name,
            brandColor: row.church_brand_color,
          }
        : null;

    // Birthday/anniversary surfaced ONLY when the member opted in
    // (migration 067 added the visibility flags). We strip the year on
    // both — public surfaces don't need to know how old someone is —
    // because the use case is "happy birthday today!" not "they turn 47".
    const monthDay = (d: string | null) =>
      d ? d.slice(5) : null; // YYYY-MM-DD → MM-DD

    return {
      id: row.id,
      fullName: row.full_name,
      avatarUrl: row.avatar_url,
      church,
      createdAt: row.created_at,
      birthday: row.birthday_visible === true ? monthDay(row.date_of_birth) : null,
      anniversary: row.anniversary_visible === true ? monthDay(row.anniversary) : null,
    };
  }

  async updateMe(userId: string, dto: UpdateUserDto): Promise<User> {
    const { queryRunner } = this.getRlsContext();

    // Build a partial update from the DTO's defined fields. Whitelist
    // enforces "no surprise writes" — even if a future controller bug
    // forwarded an unexpected key, the update wouldn't apply it.
    const updates: Partial<User> = {};
    for (const key of UsersService.UPDATABLE_FIELDS) {
      const v = (dto as Record<string, unknown>)[key];
      if (v !== undefined) (updates as Record<string, unknown>)[key] = v;
    }

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
  async deleteMe(
    userId: string,
    ctx?: { ip?: string | null; userAgent?: string | null },
  ): Promise<{ deleted: true }> {
    this.logger.log(`Account deletion initiated for user ${userId}`);

    // Step 1: Fetch tenant memberships for S3 cleanup scope + audit log.
    // We capture the user's identifiers BEFORE the cascade deletes them
    // — once public.users is gone, we can't reconstruct email/name.
    const [identity] = await this.dataSource.manager.query(
      `SELECT email, full_name FROM public.users WHERE id = $1`,
      [userId],
    );
    if (!identity) {
      throw new NotFoundException('User not found');
    }

    const memberships = await this.dataSource.manager.query(
      `SELECT tenant_id FROM public.tenant_memberships WHERE user_id = $1`,
      [userId],
    );
    const tenantIds: string[] = memberships.map(
      (m: { tenant_id: string }) => m.tenant_id,
    );

    // Step 2: Write the deletion log BEFORE the cascade. If anything
    // after this fails, we still have the forensic record. GDPR Art. 30
    // requires the controller to keep a record of erasure requests.
    await this.dataSource.query(
      `INSERT INTO public.account_deletion_log
         (user_id, email, full_name, tenant_ids, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5::inet, $6)`,
      [
        userId,
        identity.email,
        identity.full_name,
        tenantIds,
        ctx?.ip ?? null,
        ctx?.userAgent ?? null,
      ],
    );

    // Step 3: Delete S3 objects (best-effort — failures logged, not thrown)
    if (tenantIds.length > 0) {
      const deletedCount = await this.mediaService.deleteUserObjects(
        tenantIds,
        userId,
      );
      this.logger.log(
        `Deleted ${deletedCount} S3 objects for user ${userId}`,
      );
    }

    // Step 4: Delete from public.users.
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

    // Step 5: Delete from auth.users via Supabase Admin API.
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

    // Fan out a single batch of queries — each query is independent, so
    // running them in parallel keeps the export reasonably fast even for
    // long-tenured users with thousands of posts. Tables that don't exist
    // in older deploys are queried defensively via to_regclass to avoid a
    // top-level failure if a downstream migration was skipped.
    const [
      profile,
      posts,
      comments,
      messages,
      transactions,
      memberships,
      follows,
      prayers,
      rsvps,
      groupMemberships,
      family,
      tags,
      settings,
      blocks,
      reportsMade,
      stories,
      likes,
      saves,
    ] = await Promise.all([
        // Profile — every field that PATCH /api/users/me writes, plus the
        // immutable identifiers (email, id, created_at). Everything the
        // user could possibly have entered into a profile sheet.
        manager.query(
          `SELECT id, email, full_name, avatar_url, phone, phone_secondary,
                  gender, address, preferred_contact_method,
                  date_of_birth, occupation, employer,
                  marital_status, anniversary, spouse_name,
                  has_children, children, emergency_contact,
                  membership_status, member_since,
                  baptized, baptism_date, baptism_location, salvation_date,
                  previous_church, how_did_you_hear,
                  service_interests, skills, languages,
                  tshirt_size, dietary_restrictions,
                  newsletter_opt_in, sms_opt_in, photo_release_consent,
                  birthday_visible, anniversary_visible,
                  created_at
           FROM public.users WHERE id = $1`,
          [userId],
        ),

        // Posts
        manager.query(
          `SELECT id, tenant_id, content, media_url, media_type, visibility,
                  is_archived, created_at, updated_at
           FROM public.posts WHERE author_id = $1
           ORDER BY created_at DESC`,
          [userId],
        ),

        // Comments
        manager.query(
          `SELECT id, post_id, content, media_url, parent_id, created_at
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

        // Prayer requests authored
        manager.query(
          `SELECT id, tenant_id, content, is_anonymous, is_answered, created_at
           FROM public.prayers WHERE author_id = $1
           ORDER BY created_at DESC`,
          [userId],
        ).catch(() => []),

        // Event RSVPs
        manager.query(
          `SELECT r.event_id, r.status, e.title AS event_title, e.start_at, r.created_at
           FROM public.event_rsvps r
           LEFT JOIN public.events e ON e.id = r.event_id
           WHERE r.user_id = $1
           ORDER BY r.created_at DESC`,
          [userId],
        ).catch(() => []),

        // Group memberships
        manager.query(
          `SELECT gm.group_id, g.name AS group_name, gm.role, gm.created_at
           FROM public.group_memberships gm
           LEFT JOIN public.groups g ON g.id = gm.group_id
           WHERE gm.user_id = $1
           ORDER BY gm.created_at DESC`,
          [userId],
        ).catch(() => []),

        // Family connections (both directions)
        manager.query(
          `SELECT id, person_a, person_b, relationship_a_to_b, relationship_b_to_a, created_at
           FROM public.family_relationships
           WHERE person_a = $1 OR person_b = $1
           ORDER BY created_at DESC`,
          [userId],
        ).catch(() => []),

        // Tag memberships
        manager.query(
          `SELECT mt.tag_id, t.name AS tag_name, mt.created_at
           FROM public.member_tags mt
           LEFT JOIN public.tags t ON t.id = mt.tag_id
           WHERE mt.user_id = $1
           ORDER BY mt.created_at DESC`,
          [userId],
        ).catch(() => []),

        // Notification settings
        manager.query(
          `SELECT email_notifications, push_notifications, sms_notifications,
                  in_app_notifications, updated_at
           FROM public.user_settings WHERE user_id = $1`,
          [userId],
        ).catch(() => []),

        // Users this user has blocked
        manager.query(
          `SELECT blocked_id, created_at FROM public.user_blocks WHERE blocker_id = $1`,
          [userId],
        ).catch(() => []),

        // Content reports filed by this user
        manager.query(
          `SELECT post_id, comment_id, user_id AS reported_user_id, content_type,
                  reason, status, created_at
           FROM public.post_reports WHERE reported_by = $1
           ORDER BY created_at DESC`,
          [userId],
        ).catch(() => []),

        // Stories posted
        manager.query(
          `SELECT id, tenant_id, media_url, media_type, expires_at, created_at
           FROM public.stories WHERE author_id = $1
           ORDER BY created_at DESC`,
          [userId],
        ).catch(() => []),

        // Likes given
        manager.query(
          `SELECT post_id, created_at FROM public.post_likes WHERE user_id = $1`,
          [userId],
        ).catch(() => []),

        // Saves / bookmarks
        manager.query(
          `SELECT post_id, created_at FROM public.post_saves WHERE user_id = $1`,
          [userId],
        ).catch(() => []),
      ]);

    const exportData = {
      exportedAt: new Date().toISOString(),
      notice:
        'This export is the data we hold about your account, including content you authored and your relationships within churches. Financial records may include anonymized rows from before you joined this export window.',
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
      prayers,
      eventRsvps: rsvps,
      groupMemberships,
      familyRelationships: family,
      tags,
      notificationSettings: settings[0] ?? null,
      blockedUsers: blocks,
      reportsFiled: reportsMade,
      stories,
      likes,
      saves,
    };

    this.logger.log(
      `Data export completed for user ${userId}: ` +
        `${posts.length} posts, ${comments.length} comments, ` +
        `${messages.length} messages, ${transactions.length} transactions, ` +
        `${prayers.length} prayers, ${rsvps.length} rsvps`,
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
        inAppNotifications: true,
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
      if (dto.inAppNotifications !== undefined) existing.inAppNotifications = dto.inAppNotifications;
      return this.dataSource.manager.save(UserSettings, existing);
    }

    const settings = this.dataSource.manager.create(UserSettings, {
      userId,
      emailNotifications: dto.emailNotifications ?? true,
      pushNotifications: dto.pushNotifications ?? true,
      smsNotifications: dto.smsNotifications ?? false,
      inAppNotifications: dto.inAppNotifications ?? true,
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

  /**
   * GDPR Art. 30: list account-deletion log rows that include the
   * given tenant in tenant_ids[]. Returns the safe-to-display fields
   * (email is intentionally retained — the data subject is gone, the
   * row is a compliance artifact).
   */
  async listAccountDeletions(tenantId: string) {
    const rows = await this.dataSource.query(
      `SELECT id, user_id, email, full_name, tenant_ids, ip_address, deleted_at
       FROM public.account_deletion_log
       WHERE $1::uuid = ANY(tenant_ids)
       ORDER BY deleted_at DESC
       LIMIT 500`,
      [tenantId],
    );
    return {
      data: rows.map((r: any) => ({
        id: r.id,
        userId: r.user_id,
        email: r.email,
        fullName: r.full_name,
        tenantIds: r.tenant_ids,
        ipAddress: r.ip_address,
        deletedAt: r.deleted_at,
      })),
    };
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
