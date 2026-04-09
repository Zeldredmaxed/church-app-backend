import { Injectable, NotFoundException, InternalServerErrorException, ConflictException } from '@nestjs/common';
import { rlsStorage } from '../common/storage/rls.storage';
import { Badge } from './entities/badge.entity';
import { CreateBadgeDto } from './dto/create-badge.dto';
import { UpdateBadgeDto } from './dto/update-badge.dto';
import { AwardBadgeDto } from './dto/award-badge.dto';

@Injectable()
export class BadgesService {
  private getRlsContext() {
    const ctx = rlsStorage.getStore();
    if (!ctx) throw new InternalServerErrorException('RLS context unavailable');
    return ctx;
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

    for (const badge of badges) {
      const rule = badge.auto_award_rule;
      if (!rule || !rule.type) continue;

      // Check if already awarded
      const [existing] = await queryRunner.query(
        `SELECT 1 FROM public.member_badges WHERE badge_id = $1 AND user_id = $2`,
        [badge.id, userId],
      );
      if (existing) continue;

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
      }

      if (qualified) {
        await queryRunner.query(
          `INSERT INTO public.member_badges (badge_id, user_id, tenant_id, awarded_reason)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (badge_id, user_id) DO NOTHING`,
          [badge.id, userId, tenantId, `Auto-awarded: ${rule.type}`],
        );
        newlyAwarded.push({ badgeId: badge.id, name: badge.name });
      }
    }

    return newlyAwarded;
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
