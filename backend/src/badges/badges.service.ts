import { Injectable, NotFoundException, InternalServerErrorException, ConflictException, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { DataSource } from 'typeorm';
import { rlsStorage } from '../common/storage/rls.storage';
import { CacheService } from '../common/services/cache.service';
import { Badge } from './entities/badge.entity';
import { CreateBadgeDto } from './dto/create-badge.dto';
import { UpdateBadgeDto } from './dto/update-badge.dto';
import { AwardBadgeDto } from './dto/award-badge.dto';

/**
 * Curated icon catalog for badge creation.
 * These are Hugeicons icon names (kebab-case) from @hugeicons/core-free-icons.
 * The mobile app converts to PascalCase + "Icon" suffix for the component import.
 * e.g., "hand-prayer" → HandPrayerIcon
 *
 * Pastors see this catalog when creating a badge. The full 5,100+ Hugeicons library
 * is available on the frontend, but this curated list surfaces the most relevant ones.
 */
const BADGE_ICON_CATALOG = [
  // Faith & Spiritual
  { name: 'hand-prayer', label: 'Praying Hands', category: 'Faith & Spiritual' },
  { name: 'church', label: 'Church', category: 'Faith & Spiritual' },
  { name: 'book-02', label: 'Bible / Book', category: 'Faith & Spiritual' },
  { name: 'fire', label: 'Fire / Holy Spirit', category: 'Faith & Spiritual' },
  { name: 'candle-02', label: 'Candle', category: 'Faith & Spiritual' },
  { name: 'star', label: 'Star', category: 'Faith & Spiritual' },
  { name: 'peace-sign', label: 'Peace', category: 'Faith & Spiritual' },
  { name: 'angel', label: 'Angel', category: 'Faith & Spiritual' },
  { name: 'moon-02', label: 'Moon', category: 'Faith & Spiritual' },
  { name: 'sun-03', label: 'Sun / Light', category: 'Faith & Spiritual' },
  { name: 'sparkles', label: 'Sparkles', category: 'Faith & Spiritual' },
  { name: 'lighthouse', label: 'Lighthouse', category: 'Faith & Spiritual' },

  // Water & Baptism
  { name: 'droplet', label: 'Water Drop', category: 'Water & Baptism' },
  { name: 'water-wave', label: 'Water Wave', category: 'Water & Baptism' },
  { name: 'swimming', label: 'Baptism / Swimming', category: 'Water & Baptism' },
  { name: 'ocean-wave', label: 'Ocean', category: 'Water & Baptism' },

  // Worship & Music
  { name: 'music-note-01', label: 'Music Note', category: 'Worship & Music' },
  { name: 'mic-01', label: 'Microphone', category: 'Worship & Music' },
  { name: 'headphones', label: 'Headphones', category: 'Worship & Music' },
  { name: 'guitar', label: 'Guitar', category: 'Worship & Music' },
  { name: 'piano', label: 'Piano', category: 'Worship & Music' },
  { name: 'voice', label: 'Voice / Singing', category: 'Worship & Music' },
  { name: 'hand-pointing-up', label: 'Hand Raised', category: 'Worship & Music' },

  // Giving & Generosity
  { name: 'coins-01', label: 'Coins', category: 'Giving & Generosity' },
  { name: 'money-send-01', label: 'Give Money', category: 'Giving & Generosity' },
  { name: 'gift', label: 'Gift Box', category: 'Giving & Generosity' },
  { name: 'heart-check', label: 'Heart Check', category: 'Giving & Generosity' },
  { name: 'hand-heart-01', label: 'Heart in Hand', category: 'Giving & Generosity' },
  { name: 'treasure-chest', label: 'Treasure Chest', category: 'Giving & Generosity' },
  { name: 'donation', label: 'Donation', category: 'Giving & Generosity' },

  // Community & People
  { name: 'user-group', label: 'Group of People', category: 'Community & People' },
  { name: 'user-add-01', label: 'Add Person', category: 'Community & People' },
  { name: 'handshake', label: 'Handshake', category: 'Community & People' },
  { name: 'family', label: 'Family', category: 'Community & People' },
  { name: 'baby-02', label: 'Baby / Child', category: 'Community & People' },
  { name: 'globe-02', label: 'Globe / World', category: 'Community & People' },
  { name: 'puzzle', label: 'Puzzle Piece', category: 'Community & People' },
  { name: 'link-04', label: 'Link / Chain', category: 'Community & People' },
  { name: 'bridge', label: 'Bridge', category: 'Community & People' },
  { name: 'love-korean-finger', label: 'Love Sign', category: 'Community & People' },

  // Attendance & Check-in
  { name: 'running-shoes', label: 'Footprints / Shoes', category: 'Attendance & Check-in' },
  { name: 'calendar-check-01', label: 'Calendar Check', category: 'Attendance & Check-in' },
  { name: 'clock-01', label: 'Clock', category: 'Attendance & Check-in' },
  { name: 'location-01', label: 'Location Pin', category: 'Attendance & Check-in' },
  { name: 'door-01', label: 'Door', category: 'Attendance & Check-in' },
  { name: 'key-01', label: 'Key', category: 'Attendance & Check-in' },
  { name: 'sunrise', label: 'Sunrise', category: 'Attendance & Check-in' },
  { name: 'notification-03', label: 'Bell', category: 'Attendance & Check-in' },

  // Service & Volunteering
  { name: 'helping-hand', label: 'Helping Hand', category: 'Service & Volunteering' },
  { name: 'paint-brush-01', label: 'Paint Brush', category: 'Service & Volunteering' },
  { name: 'wrench-01', label: 'Wrench / Tool', category: 'Service & Volunteering' },
  { name: 'first-aid-kit', label: 'First Aid', category: 'Service & Volunteering' },
  { name: 'cooking-pot', label: 'Cooking Pot', category: 'Service & Volunteering' },
  { name: 'shopping-bag-01', label: 'Shopping Bag', category: 'Service & Volunteering' },
  { name: 'truck', label: 'Truck / Delivery', category: 'Service & Volunteering' },
  { name: 'shield-check', label: 'Shield Check', category: 'Service & Volunteering' },
  { name: 'apron', label: 'Apron', category: 'Service & Volunteering' },

  // Communication & Social
  { name: 'message-01', label: 'Chat Bubble', category: 'Communication & Social' },
  { name: 'message-multiple-01', label: 'Chat Bubbles', category: 'Communication & Social' },
  { name: 'megaphone-01', label: 'Megaphone', category: 'Communication & Social' },
  { name: 'mail-01', label: 'Email', category: 'Communication & Social' },
  { name: 'phone-01', label: 'Phone', category: 'Communication & Social' },
  { name: 'video-01', label: 'Video Camera', category: 'Communication & Social' },
  { name: 'pen-tool-01', label: 'Pen / Writing', category: 'Communication & Social' },
  { name: 'share-01', label: 'Share', category: 'Communication & Social' },

  // Education & Growth
  { name: 'graduation-scroll', label: 'Graduation', category: 'Education & Growth' },
  { name: 'book-open-01', label: 'Open Book', category: 'Education & Growth' },
  { name: 'idea-01', label: 'Lightbulb / Idea', category: 'Education & Growth' },
  { name: 'plant-01', label: 'Seedling / Growth', category: 'Education & Growth' },
  { name: 'tree-06', label: 'Tree', category: 'Education & Growth' },
  { name: 'mountain', label: 'Mountain Peak', category: 'Education & Growth' },
  { name: 'telescope-01', label: 'Telescope', category: 'Education & Growth' },
  { name: 'brain-02', label: 'Brain / Mind', category: 'Education & Growth' },
  { name: 'scroll', label: 'Scroll', category: 'Education & Growth' },

  // Milestones & Achievement
  { name: 'trophy', label: 'Trophy', category: 'Milestones & Achievement' },
  { name: 'medal-01', label: 'Medal', category: 'Milestones & Achievement' },
  { name: 'star-01', label: 'Star', category: 'Milestones & Achievement' },
  { name: 'diamond-01', label: 'Diamond', category: 'Milestones & Achievement' },
  { name: 'crown', label: 'Crown', category: 'Milestones & Achievement' },
  { name: 'rocket-01', label: 'Rocket', category: 'Milestones & Achievement' },
  { name: 'target-02', label: 'Target / Bullseye', category: 'Milestones & Achievement' },
  { name: 'flag-01', label: 'Flag', category: 'Milestones & Achievement' },
  { name: 'award-01', label: 'Award Ribbon', category: 'Milestones & Achievement' },
  { name: 'certificate-01', label: 'Certificate', category: 'Milestones & Achievement' },

  // Health & Wellness
  { name: 'heartbeat', label: 'Heartbeat', category: 'Health & Wellness' },
  { name: 'running', label: 'Running Person', category: 'Health & Wellness' },
  { name: 'apple-01', label: 'Apple / Nutrition', category: 'Health & Wellness' },
  { name: 'yoga-01', label: 'Yoga / Meditation', category: 'Health & Wellness' },

  // Nature & Seasons
  { name: 'flower', label: 'Flower', category: 'Nature & Seasons' },
  { name: 'leaf-01', label: 'Leaf', category: 'Nature & Seasons' },
  { name: 'snowflake', label: 'Snowflake / Winter', category: 'Nature & Seasons' },
  { name: 'rainbow', label: 'Rainbow / Promise', category: 'Nature & Seasons' },
  { name: 'cloud', label: 'Cloud', category: 'Nature & Seasons' },

  // Symbols
  { name: 'heart-01', label: 'Heart', category: 'Symbols' },
  { name: 'compass-01', label: 'Compass', category: 'Symbols' },
  { name: 'anchor', label: 'Anchor / Hope', category: 'Symbols' },
  { name: 'infinity-01', label: 'Infinity', category: 'Symbols' },
  { name: 'butterfly', label: 'Butterfly / Transformation', category: 'Symbols' },
  { name: 'dove', label: 'Dove / Peace', category: 'Symbols' },
  { name: 'feather', label: 'Feather', category: 'Symbols' },
  { name: 'fingerprint', label: 'Fingerprint / Identity', category: 'Symbols' },
  { name: 'eye', label: 'Eye / Vision', category: 'Symbols' },
  { name: 'flash', label: 'Lightning Bolt', category: 'Symbols' },
];

@Injectable()
export class BadgesService {
  private readonly logger = new Logger(BadgesService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly cache: CacheService,
    @InjectQueue('notifications') private readonly notificationsQueue: Queue,
  ) {}

  private getRlsContext() {
    const ctx = rlsStorage.getStore();
    if (!ctx) throw new InternalServerErrorException('RLS context unavailable');
    return ctx;
  }

  /**
   * Returns the curated icon catalog for badge creation.
   * Each icon includes a CDN preview URL so the frontend renders <img> tags
   * instead of loading 5,100 React components.
   */
  getIconCatalog(search?: string, category?: string, page = 1, limit = 200) {
    let filtered = BADGE_ICON_CATALOG;

    if (search && search.trim()) {
      const q = search.toLowerCase();
      filtered = filtered.filter(i =>
        i.name.includes(q) || i.label.toLowerCase().includes(q),
      );
    }

    if (category && category.trim()) {
      filtered = filtered.filter(i => i.category === category);
    }

    const total = filtered.length;
    const offset = (page - 1) * limit;
    const paginated = filtered.slice(offset, offset + limit);

    return {
      icons: paginated.map(i => ({
        name: i.name,
        label: i.label,
        category: i.category,
        previewUrl: `https://ico.hugeicons.com/${i.name}-stroke-rounded@2x.webp?v=1.0.0`,
      })),
      categories: [...new Set(BADGE_ICON_CATALOG.map(i => i.category))],
      total,
      page,
      limit,
    };
  }

  async getBadges() {
    const { queryRunner } = this.getRlsContext();
    const rows = await queryRunner.query(`
      SELECT b.*,
        (SELECT COUNT(*)::int FROM public.member_badges WHERE badge_id = b.id) AS award_count
      FROM public.badges b
      ORDER BY b.display_order, b.created_at
    `);
    return rows.map((r: any) => ({
      id: r.id,
      tenantId: r.tenant_id,
      name: r.name,
      description: r.description,
      icon: r.icon,
      color: r.color,
      tier: r.tier,
      category: r.category,
      autoAwardRule: r.auto_award_rule,
      isActive: r.is_active,
      displayOrder: r.display_order,
      createdBy: r.created_by,
      createdAt: r.created_at,
      awardCount: Number(r.award_count ?? 0),
    }));
  }

  async createBadge(dto: CreateBadgeDto, userId: string) {
    const { queryRunner, currentTenantId } = this.getRlsContext();
    try {
      const badge = queryRunner.manager.create(Badge, {
        tenantId: currentTenantId!,
        name: dto.name,
        description: dto.description ?? null,
        icon: dto.icon ?? 'award',
        color: dto.color ?? '#6366f1',
        tier: dto.tier ?? 'bronze',
        category: dto.category ?? 'custom',
        autoAwardRule: dto.autoAwardRule ?? null,
        displayOrder: dto.displayOrder ?? 0,
        createdBy: userId,
      });
      return await queryRunner.manager.save(Badge, badge);
    } catch (err: any) {
      if (err.code === '23505') {
        throw new ConflictException('A badge with this name already exists');
      }
      throw err;
    }
  }

  async updateBadge(id: string, dto: UpdateBadgeDto) {
    const { queryRunner } = this.getRlsContext();
    const updates: any = {};
    if (dto.name !== undefined) updates.name = dto.name;
    if (dto.description !== undefined) updates.description = dto.description;
    if (dto.icon !== undefined) updates.icon = dto.icon;
    if (dto.color !== undefined) updates.color = dto.color;
    if (dto.tier !== undefined) updates.tier = dto.tier;
    if (dto.category !== undefined) updates.category = dto.category;
    if (dto.autoAwardRule !== undefined) updates.autoAwardRule = dto.autoAwardRule;
    if (dto.isActive !== undefined) updates.isActive = dto.isActive;
    if (dto.displayOrder !== undefined) updates.displayOrder = dto.displayOrder;

    const result = await queryRunner.manager.update(Badge, { id }, updates);
    if (result.affected === 0) throw new NotFoundException('Badge not found');
    return queryRunner.manager.findOneOrFail(Badge, { where: { id } });
  }

  async deleteBadge(id: string) {
    const { queryRunner } = this.getRlsContext();
    const result = await queryRunner.manager.delete(Badge, { id });
    if (result.affected === 0) throw new NotFoundException('Badge not found');
  }

  async awardBadge(badgeId: string, dto: AwardBadgeDto, awardedBy: string) {
    const { queryRunner, currentTenantId } = this.getRlsContext();
    for (const userId of dto.userIds) {
      await queryRunner.query(
        `INSERT INTO public.member_badges (badge_id, user_id, tenant_id, awarded_by, awarded_reason)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (badge_id, user_id) DO NOTHING`,
        [badgeId, userId, currentTenantId, awardedBy, dto.reason ?? null],
      );
    }
    return { awarded: dto.userIds.length };
  }

  async revokeBadge(badgeId: string, userId: string) {
    const { queryRunner } = this.getRlsContext();
    const result = await queryRunner.query(
      `DELETE FROM public.member_badges WHERE badge_id = $1 AND user_id = $2 RETURNING id`,
      [badgeId, userId],
    );
    if (result.length === 0) throw new NotFoundException('Badge assignment not found');
  }

  async getMemberBadges(userId: string) {
    const { queryRunner } = this.getRlsContext();
    const rows = await queryRunner.query(
      `SELECT b.id, b.name, b.description, b.icon, b.color, b.tier, b.category,
        mb.awarded_at, mb.awarded_reason
       FROM public.member_badges mb
       JOIN public.badges b ON b.id = mb.badge_id
       WHERE mb.user_id = $1
       ORDER BY b.display_order, mb.awarded_at DESC`,
      [userId],
    );
    return rows.map((r: any) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      icon: r.icon,
      color: r.color,
      tier: r.tier,
      category: r.category,
      awardedAt: r.awarded_at,
      awardedReason: r.awarded_reason,
    }));
  }

  async checkAndAwardAutoBadges(tenantId: string, userId: string): Promise<Array<{ badgeId: string; name: string }>> {
    const { queryRunner } = this.getRlsContext();

    // 1. Load all active badges with auto_award_rules for this tenant
    const badges = await queryRunner.query(
      `SELECT id, name, auto_award_rule FROM public.badges
       WHERE tenant_id = $1 AND is_active = true AND auto_award_rule IS NOT NULL`,
      [tenantId],
    );

    const newlyAwarded: Array<{ badgeId: string; name: string }> = [];

    // Batch-fetch all badges this user already has (eliminates N per-badge existence queries)
    const existingAwards = await queryRunner.query(
      `SELECT badge_id FROM public.member_badges WHERE user_id = $1 AND tenant_id = $2`,
      [userId, tenantId],
    );
    const earnedSet = new Set(existingAwards.map((r: any) => r.badge_id));

    for (const badge of badges) {
      const rule = badge.auto_award_rule;
      if (!rule || !rule.type) continue;

      // Skip if already awarded (checked from batch-loaded set, not per-badge query)
      if (earnedSet.has(badge.id)) continue;

      let qualified = false;

      switch (rule.type) {
        case 'giving_lifetime': {
          const [row] = await queryRunner.query(
            `SELECT COALESCE(SUM(amount), 0)::float AS total
             FROM public.transactions WHERE user_id = $1 AND tenant_id = $2 AND status = 'succeeded'`,
            [userId, tenantId],
          );
          qualified = (row?.total ?? 0) >= (rule.threshold ?? 0);
          break;
        }

        case 'giving_single': {
          const [row] = await queryRunner.query(
            `SELECT amount FROM public.transactions
             WHERE user_id = $1 AND tenant_id = $2 AND status = 'succeeded'
             ORDER BY created_at DESC LIMIT 1`,
            [userId, tenantId],
          );
          qualified = (row?.amount ?? 0) >= (rule.threshold ?? 0);
          break;
        }

        case 'attendance_streak': {
          const rows = await queryRunner.query(
            `SELECT DISTINCT DATE(checked_in_at) AS check_date
             FROM public.check_ins WHERE user_id = $1 AND tenant_id = $2
             ORDER BY check_date DESC`,
            [userId, tenantId],
          );
          // Count consecutive weeks
          let streak = 0;
          if (rows.length > 0) {
            streak = 1;
            for (let i = 1; i < rows.length; i++) {
              const prev = new Date(rows[i - 1].check_date);
              const curr = new Date(rows[i].check_date);
              const diffDays = (prev.getTime() - curr.getTime()) / (1000 * 60 * 60 * 24);
              if (diffDays <= 7) streak++;
              else break;
            }
          }
          qualified = streak >= (rule.days ?? 30);
          break;
        }

        case 'attendance_count': {
          const [row] = await queryRunner.query(
            `SELECT COUNT(*)::int AS cnt FROM public.check_ins WHERE user_id = $1 AND tenant_id = $2`,
            [userId, tenantId],
          );
          qualified = (row?.cnt ?? 0) >= (rule.count ?? 0);
          break;
        }

        case 'baptized': {
          const [row] = await queryRunner.query(
            `SELECT is_baptized FROM public.member_journeys WHERE user_id = $1 AND tenant_id = $2`,
            [userId, tenantId],
          );
          qualified = row?.is_baptized === true;
          break;
        }

        case 'members_class': {
          const [row] = await queryRunner.query(
            `SELECT attended_members_class FROM public.member_journeys WHERE user_id = $1 AND tenant_id = $2`,
            [userId, tenantId],
          );
          qualified = row?.attended_members_class === true;
          break;
        }

        case 'group_count': {
          const [row] = await queryRunner.query(
            `SELECT COUNT(DISTINCT group_id)::int AS cnt FROM public.group_members WHERE user_id = $1`,
            [userId],
          );
          qualified = (row?.cnt ?? 0) >= (rule.min ?? 1);
          break;
        }

        case 'volunteer_hours': {
          const [row] = await queryRunner.query(
            `SELECT COALESCE(SUM(hours), 0)::float AS total FROM public.volunteer_hours WHERE user_id = $1 AND tenant_id = $2`,
            [userId, tenantId],
          );
          qualified = (row?.total ?? 0) >= (rule.min ?? 0);
          break;
        }

        case 'post_count': {
          const [row] = await queryRunner.query(
            `SELECT COUNT(*)::int AS cnt FROM public.posts WHERE author_id = $1 AND tenant_id = $2`,
            [userId, tenantId],
          );
          qualified = (row?.cnt ?? 0) >= (rule.min ?? 1);
          break;
        }

        case 'prayer_count': {
          const [row] = await queryRunner.query(
            `SELECT COUNT(*)::int AS cnt FROM public.prayers WHERE author_id = $1 AND tenant_id = $2`,
            [userId, tenantId],
          );
          qualified = (row?.cnt ?? 0) >= (rule.min ?? 1);
          break;
        }

        case 'comment_count': {
          const [row] = await queryRunner.query(
            `SELECT COUNT(*)::int AS cnt FROM public.comments WHERE author_id = $1 AND tenant_id = $2`,
            [userId, tenantId],
          );
          qualified = (row?.cnt ?? 0) >= (rule.min ?? 1);
          break;
        }

        case 'message_count': {
          const [row] = await queryRunner.query(
            `SELECT COUNT(*)::int AS cnt FROM public.chat_messages WHERE user_id = $1`,
            [userId],
          );
          qualified = (row?.cnt ?? 0) >= (rule.min ?? 1);
          break;
        }

        case 'total_interactions': {
          const [row] = await queryRunner.query(
            `SELECT (
              (SELECT COUNT(*) FROM public.posts WHERE author_id = $1 AND tenant_id = $2) +
              (SELECT COUNT(*) FROM public.comments WHERE author_id = $1 AND tenant_id = $2) +
              (SELECT COUNT(*) FROM public.chat_messages WHERE user_id = $1) +
              (SELECT COUNT(*) FROM public.post_likes WHERE user_id = $1)
            )::int AS cnt`,
            [userId, tenantId],
          );
          qualified = (row?.cnt ?? 0) >= (rule.min ?? 1);
          break;
        }

        case 'follower_count': {
          const [row] = await queryRunner.query(
            `SELECT COUNT(*)::int AS cnt FROM public.follows WHERE following_id = $1`,
            [userId],
          );
          qualified = (row?.cnt ?? 0) >= (rule.min ?? 1);
          break;
        }

        case 'following_count': {
          const [row] = await queryRunner.query(
            `SELECT COUNT(*)::int AS cnt FROM public.follows WHERE follower_id = $1`,
            [userId],
          );
          qualified = (row?.cnt ?? 0) >= (rule.min ?? 1);
          break;
        }

        case 'fundraiser_donation_count': {
          const [row] = await queryRunner.query(
            `SELECT COUNT(*)::int AS cnt FROM public.fundraiser_donations
             WHERE donor_id = $1 AND payment_status = 'succeeded'`,
            [userId],
          );
          qualified = (row?.cnt ?? 0) >= (rule.min ?? 1);
          break;
        }

        case 'fundraiser_donation_total': {
          const [row] = await queryRunner.query(
            `SELECT COALESCE(SUM(amount), 0)::float AS total FROM public.fundraiser_donations
             WHERE donor_id = $1 AND payment_status = 'succeeded'`,
            [userId],
          );
          qualified = (row?.total ?? 0) >= (rule.threshold ?? 0);
          break;
        }

        case 'login_streak': {
          const rows = await queryRunner.query(
            `SELECT DISTINCT DATE(last_seen_at) AS d FROM public.users WHERE id = $1 AND last_seen_at IS NOT NULL
             UNION
             SELECT DISTINCT DATE(created_at) AS d FROM public.daily_app_opens WHERE user_id = $1
             ORDER BY d DESC`,
            [userId],
          );
          let streak = 0;
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          for (let i = 0; i < rows.length; i++) {
            const expected = new Date(today);
            expected.setDate(expected.getDate() - i);
            const actual = new Date(rows[i]?.d);
            actual.setHours(0, 0, 0, 0);
            if (actual.getTime() === expected.getTime()) {
              streak++;
            } else {
              break;
            }
          }
          qualified = streak >= (rule.min ?? 1);
          break;
        }
      }

      if (qualified) {
        await queryRunner.query(
          `INSERT INTO public.member_badges (badge_id, user_id, tenant_id, awarded_reason)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (badge_id, user_id) DO NOTHING`,
          [badge.id, userId, tenantId, `Auto-awarded: ${rule.type}`],
        );
        newlyAwarded.push({ badgeId: badge.id, name: badge.name });

        // Fire super-rare broadcast if this is a diamond/platinum badge with < 5 earners
        const tier = badge.auto_award_rule?.tier ?? badge.tier;
        if (['diamond', 'platinum'].includes(tier) || badge.rarity_tier === 'mythic' || badge.rarity_tier === 'legendary') {
          const [{ count: awardCount }] = await queryRunner.query(
            `SELECT COUNT(*)::int AS count FROM public.member_badges WHERE badge_id = $1`,
            [badge.id],
          );
          if (Number(awardCount) <= 5) {
            this.fireSuperRareBroadcast(tenantId, userId, badge.name, Number(awardCount)).catch(err => this.logger.warn(`Super-rare broadcast failed: ${err.message}`));
          }
        }
      }
    }

    return newlyAwarded;
  }

  /**
   * Returns badge progress for a specific member.
   * For each badge with an auto-award rule, calculates:
   *   - current value (e.g., $3,200 given)
   *   - target value (e.g., $5,000 threshold)
   *   - percent complete (0-100)
   *   - whether already earned
   *
   * This powers the progress bars on the member's profile.
   */
  async getMemberBadgeProgress(tenantId: string, userId: string) {
    const { queryRunner } = this.getRlsContext();

    // Get all active badges with auto-award rules
    const badges = await queryRunner.query(
      `SELECT b.id, b.name, b.description, b.icon, b.color, b.tier, b.category,
        b.auto_award_rule, b.display_order,
        EXISTS(SELECT 1 FROM public.member_badges mb WHERE mb.badge_id = b.id AND mb.user_id = $2) AS is_earned
       FROM public.badges b
       WHERE b.tenant_id = $1 AND b.is_active = true AND b.auto_award_rule IS NOT NULL
       ORDER BY b.display_order, b.created_at`,
      [tenantId, userId],
    );

    // Pre-fetch all the member's stats in parallel (18 queries batched)
    const [
      [givingRow], [attendanceRow], [journeyRow], [groupRow],
      [volunteerRow], [postRow], [prayerRow],
      [commentRow], [messageRow], [interactionRow],
      [followerRow], [followingRow],
      [fundraiserCountRow], [fundraiserTotalRow],
    ] = await Promise.all([
      queryRunner.query(
        `SELECT COALESCE(SUM(amount), 0)::float AS total, MAX(amount)::float AS max_single
         FROM public.transactions WHERE user_id = $1 AND tenant_id = $2 AND status = 'succeeded'`,
        [userId, tenantId],
      ),
      queryRunner.query(
        `SELECT COUNT(*)::int AS total_count FROM public.check_ins WHERE user_id = $1 AND tenant_id = $2`,
        [userId, tenantId],
      ),
      queryRunner.query(
        `SELECT is_baptized, attended_members_class FROM public.member_journeys WHERE user_id = $1 AND tenant_id = $2`,
        [userId, tenantId],
      ).then(rows => rows.length ? rows : [{ is_baptized: false, attended_members_class: false }]),
      queryRunner.query(
        `SELECT COUNT(DISTINCT gm.group_id)::int AS cnt
         FROM public.group_members gm
         JOIN public.groups g ON g.id = gm.group_id AND g.tenant_id = $2
         WHERE gm.user_id = $1`,
        [userId, tenantId],
      ),
      queryRunner.query(
        `SELECT COALESCE(SUM(hours), 0)::float AS total FROM public.volunteer_hours WHERE user_id = $1 AND tenant_id = $2`,
        [userId, tenantId],
      ),
      queryRunner.query(
        `SELECT COUNT(*)::int AS cnt FROM public.posts WHERE author_id = $1 AND tenant_id = $2`,
        [userId, tenantId],
      ),
      queryRunner.query(
        `SELECT COUNT(*)::int AS cnt FROM public.prayers WHERE author_id = $1 AND tenant_id = $2`,
        [userId, tenantId],
      ),
      queryRunner.query(
        `SELECT COUNT(*)::int AS cnt FROM public.comments WHERE author_id = $1 AND tenant_id = $2`,
        [userId, tenantId],
      ),
      queryRunner.query(
        `SELECT COUNT(*)::int AS cnt FROM public.chat_messages WHERE user_id = $1`,
        [userId],
      ),
      queryRunner.query(
        `SELECT (
          (SELECT COUNT(*) FROM public.posts WHERE author_id = $1 AND tenant_id = $2) +
          (SELECT COUNT(*) FROM public.comments WHERE author_id = $1 AND tenant_id = $2) +
          (SELECT COUNT(*) FROM public.chat_messages WHERE user_id = $1) +
          (SELECT COUNT(*) FROM public.post_likes WHERE user_id = $1)
        )::int AS cnt`,
        [userId, tenantId],
      ),
      queryRunner.query(
        `SELECT COUNT(*)::int AS cnt FROM public.follows WHERE following_id = $1`,
        [userId],
      ),
      queryRunner.query(
        `SELECT COUNT(*)::int AS cnt FROM public.follows WHERE follower_id = $1`,
        [userId],
      ),
      queryRunner.query(
        `SELECT COUNT(*)::int AS cnt FROM public.fundraiser_donations WHERE donor_id = $1 AND payment_status = 'succeeded'`,
        [userId],
      ),
      queryRunner.query(
        `SELECT COALESCE(SUM(amount), 0)::float AS total FROM public.fundraiser_donations WHERE donor_id = $1 AND payment_status = 'succeeded'`,
        [userId],
      ),
    ]);

    const stats = {
      givingTotal: givingRow?.total ?? 0,
      givingMaxSingle: givingRow?.max_single ?? 0,
      attendanceCount: attendanceRow?.total_count ?? 0,
      isBaptized: journeyRow?.is_baptized === true,
      attendedMembersClass: journeyRow?.attended_members_class === true,
      groupCount: groupRow?.cnt ?? 0,
      volunteerHours: volunteerRow?.total ?? 0,
      postCount: postRow?.cnt ?? 0,
      prayerCount: prayerRow?.cnt ?? 0,
      commentCount: commentRow?.cnt ?? 0,
      messageCount: messageRow?.cnt ?? 0,
      totalInteractions: interactionRow?.cnt ?? 0,
      followerCount: followerRow?.cnt ?? 0,
      followingCount: followingRow?.cnt ?? 0,
      fundraiserDonationCount: fundraiserCountRow?.cnt ?? 0,
      fundraiserDonationTotal: fundraiserTotalRow?.total ?? 0,
    };

    // Calculate progress for each badge
    const progress = badges.map((badge: any) => {
      const rule = badge.auto_award_rule;
      const isEarned = badge.is_earned;
      let current = 0;
      let target = 0;
      let unit = '';

      switch (rule.type) {
        case 'giving_lifetime':
          current = stats.givingTotal;
          target = rule.threshold ?? 0;
          unit = 'dollars';
          break;
        case 'giving_single':
          current = stats.givingMaxSingle;
          target = rule.threshold ?? 0;
          unit = 'dollars';
          break;
        case 'attendance_count':
          current = stats.attendanceCount;
          target = rule.count ?? 0;
          unit = 'check-ins';
          break;
        case 'attendance_streak':
          // Streak is harder to show as progress — show count as approximation
          current = stats.attendanceCount;
          target = rule.days ?? 30;
          unit = 'consecutive weeks';
          break;
        case 'baptized':
          current = stats.isBaptized ? 1 : 0;
          target = 1;
          unit = 'milestone';
          break;
        case 'members_class':
          current = stats.attendedMembersClass ? 1 : 0;
          target = 1;
          unit = 'milestone';
          break;
        case 'group_count':
          current = stats.groupCount;
          target = rule.min ?? 1;
          unit = 'groups';
          break;
        case 'volunteer_hours':
          current = stats.volunteerHours;
          target = rule.min ?? 0;
          unit = 'hours';
          break;
        case 'post_count':
          current = stats.postCount;
          target = rule.min ?? 1;
          unit = 'posts';
          break;
        case 'prayer_count':
          current = stats.prayerCount;
          target = rule.min ?? 1;
          unit = 'prayers';
          break;
        case 'comment_count':
          current = stats.commentCount;
          target = rule.min ?? 1;
          unit = 'comments';
          break;
        case 'message_count':
          current = stats.messageCount;
          target = rule.min ?? 1;
          unit = 'messages';
          break;
        case 'total_interactions':
          current = stats.totalInteractions;
          target = rule.min ?? 1;
          unit = 'interactions';
          break;
        case 'follower_count':
          current = stats.followerCount;
          target = rule.min ?? 1;
          unit = 'followers';
          break;
        case 'following_count':
          current = stats.followingCount;
          target = rule.min ?? 1;
          unit = 'following';
          break;
        case 'fundraiser_donation_count':
          current = stats.fundraiserDonationCount;
          target = rule.min ?? 1;
          unit = 'donations';
          break;
        case 'fundraiser_donation_total':
          current = stats.fundraiserDonationTotal;
          target = rule.threshold ?? 0;
          unit = 'dollars';
          break;
        case 'login_streak':
          current = 0; // Streak requires real-time calculation, show as unknown
          target = rule.min ?? 1;
          unit = 'consecutive days';
          break;
        default:
          current = 0;
          target = 1;
          unit = '';
      }

      const percent = target > 0 ? Math.min(Math.round((current / target) * 100), 100) : 0;

      return {
        badge: {
          id: badge.id,
          name: badge.name,
          description: badge.description,
          icon: badge.icon,
          color: badge.color,
          tier: badge.tier,
          category: badge.category,
        },
        isEarned,
        progress: {
          current,
          target,
          percent,
          unit,
          remaining: Math.max(target - current, 0),
        },
      };
    });

    // Sort: unearned first (so they see what to work toward), then earned
    progress.sort((a: any, b: any) => {
      if (a.isEarned && !b.isEarned) return 1;
      if (!a.isEarned && b.isEarned) return -1;
      return b.progress.percent - a.progress.percent; // closest to earning first
    });

    return {
      memberId: userId,
      totalBadgesEarned: progress.filter((p: any) => p.isEarned).length,
      totalBadgesAvailable: progress.length,
      badges: progress,
    };
  }

  /**
   * Returns all platform-wide system badges with rarity percentages.
   * Used by the "Shepard Badges" tab in admin and the badge collection screen in mobile.
   * Includes whether the requesting user has earned each badge.
   */
  async getGlobalBadges(userId?: string) {
    // Cache the rarity counts for 60 seconds (expensive: 246 badges × COUNT)
    const badgeCounts = await this.cache.wrap<any[]>('badges:global:counts', 60, async () => {
      return this.dataSource.query(
        `SELECT b.id, b.name, b.description, b.icon, b.color, b.tier, b.category,
                b.rarity_tier, b.auto_award_rule, b.display_order,
                COALESCE(mc.earned_count, 0) AS earned_count
         FROM public.badges b
         LEFT JOIN (
           SELECT badge_id, COUNT(*)::int AS earned_count
           FROM public.member_badges
           GROUP BY badge_id
         ) mc ON mc.badge_id = b.id
         WHERE b.is_system = true AND b.is_active = true
         ORDER BY b.display_order, b.created_at`,
      );
    });

    // Total users (cached separately, 5 min TTL)
    const totalUsers = await this.cache.wrap<number>('badges:total_users', 300, async () => {
      const [{ count }] = await this.dataSource.query(`SELECT COUNT(*)::int AS count FROM public.users`);
      return Math.max(Number(count), 1);
    });

    // User's earned badges (not cached — per-user)
    let earnedSet = new Set<string>();
    if (userId) {
      const earned = await this.dataSource.query(
        `SELECT badge_id FROM public.member_badges WHERE user_id = $1`,
        [userId],
      );
      earnedSet = new Set(earned.map((r: any) => r.badge_id));
    }

    return badgeCounts.map((r: any) => {
      const earnedCount = Number(r.earned_count);
      return {
        id: r.id,
        name: r.name,
        description: r.description,
        icon: r.icon,
        color: r.color,
        tier: r.tier,
        category: r.category,
        rarityTier: r.rarity_tier,
        autoAwardRule: r.auto_award_rule,
        isEarned: earnedSet.has(r.id),
        isSystem: true,
        totalEarned: earnedCount,
        totalUsers,
        rarityPercent: Math.round((earnedCount / totalUsers) * 10000) / 100,
      };
    });
  }

  /**
   * Broadcasts a system notification to all users when someone earns a super-rare badge.
   * Triggered when a diamond/platinum/mythic/legendary badge has < 5 total earners.
   */
  private async fireSuperRareBroadcast(tenantId: string, userId: string, badgeName: string, awardCount: number) {
    // Get the earner's name
    const [user] = await this.dataSource.query(
      `SELECT full_name FROM public.users WHERE id = $1`, [userId],
    );
    const userName = user?.full_name ?? 'A member';

    // Get all user IDs in the same tenant (excluding the earner)
    const recipients = await this.dataSource.query(
      `SELECT user_id FROM public.tenant_memberships WHERE tenant_id = $1 AND user_id != $2`,
      [tenantId, userId],
    );
    const recipientIds = recipients.map((r: any) => r.user_id);

    if (recipientIds.length === 0) return;

    // Queue bulk notification
    await this.notificationsQueue.add('notification', {
      type: 'system_broadcast',
      tenantId,
      recipientIds,
      actorUserId: userId,
      broadcastTitle: 'Legendary Achievement!',
      broadcastBody: `${userName} just earned the "${badgeName}" badge — only ${awardCount} ${awardCount === 1 ? 'person has' : 'people have'} this!`,
      previewText: `${userName} earned "${badgeName}"`,
      screen: 'UserProfile',
      params: { userId },
    });

    this.logger.log(`Super-rare badge broadcast: "${badgeName}" earned by ${userId} (${awardCount} total earners)`);
  }

  async getBadgeLeaderboard(limit: number) {
    const { queryRunner } = this.getRlsContext();
    const rows = await queryRunner.query(
      `SELECT u.id, u.full_name, u.avatar_url, COUNT(mb.id)::int AS badge_count
       FROM public.member_badges mb
       JOIN public.users u ON u.id = mb.user_id
       GROUP BY u.id, u.full_name, u.avatar_url
       ORDER BY badge_count DESC
       LIMIT $1`,
      [limit],
    );
    return rows.map((r: any) => ({
      id: r.id,
      fullName: r.full_name,
      avatarUrl: r.avatar_url,
      badgeCount: r.badge_count,
    }));
  }
}
