import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ChallengesService } from './challenges.service';

/**
 * Faith Walks (Challenges) cron — missed-day sweep.
 *
 * Fires hourly globally. On each fire, identifies tenants whose local
 * time is currently in the 00:00-00:59 window (i.e. just crossed local
 * midnight) and runs sweepMissedTasksForTenant for each. Per-tenant
 * scheduling is achieved through this "wake hourly, filter by local
 * hour" pattern — backend has no per-timezone scheduler primitive, and
 * standing this up would be much heavier than the once-per-tenant-per-
 * day cost we save.
 *
 * Idempotency is on the DB side (challenge_enrollment_missed_tasks PK
 * dedupes), so a tenant that gets swept twice within the same midnight
 * hour (e.g. via clock drift or a scheduler restart) only counts each
 * missed task once.
 *
 * The cron uses the service-role DataSource (no JWT context), which is
 * documented justification for bypassing RLS: cross-tenant aggregate
 * work that the request-bound queryRunner can't perform.
 */
@Injectable()
export class ChallengesScheduler {
  private readonly logger = new Logger(ChallengesScheduler.name);

  constructor(private readonly challenges: ChallengesService) {}

  /**
   * Hourly at minute 0. Sweeps any tenant whose local time is in the
   * post-midnight hour. On a typical hour, this finds 1-2 tenants (the
   * timezones currently crossing midnight) and processes each in <1s.
   */
  @Cron('0 * * * *')
  async tickMissedDaySweep(): Promise<void> {
    try {
      const tenantIds = await this.challenges.findTenantsAtMidnight();
      if (tenantIds.length === 0) return;

      let totalMissed = 0;
      let totalTouched = 0;
      for (const tenantId of tenantIds) {
        try {
          const result = await this.challenges.sweepMissedTasksForTenant(tenantId);
          totalMissed += result.tasksMissed;
          totalTouched += result.enrollmentsTouched;
        } catch (err: any) {
          // Don't let one tenant's failure stop the others.
          this.logger.error(`Sweep failed for tenant ${tenantId}: ${err.message}`);
        }
      }
      if (totalMissed > 0) {
        this.logger.log(
          `Missed-day sweep: ${tenantIds.length} tenants, ${totalMissed} tasks across ${totalTouched} enrollments`,
        );
      }
    } catch (err: any) {
      this.logger.error(`Missed-day sweep tick failed: ${err.message}`);
    }
  }
}
