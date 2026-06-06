import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AttendanceService } from './attendance.service';

/**
 * Cron entry point for the automated geo-attendance system.
 *
 * Three timers:
 *   - Every minute: fire start-pushes for occurrences whose starts_at
 *     is within the next 60s (silent-ish broadcast to opted-in members).
 *   - Every minute: sweep occurrences whose ends_at + 5 min has passed
 *     and compute service_attendance rows.
 *   - Once a day at 02:00 UTC: regenerate the next 30 days of service
 *     occurrences from the schedule.
 *
 * All operations are idempotent — re-running them is a no-op via DB
 * locks (UPDATE … WHERE start_push_sent_at IS NULL RETURNING id) and
 * INSERT … ON CONFLICT DO NOTHING.
 *
 * The scheduler runs on every NestJS instance, but the DB locks above
 * ensure exactly-once semantics across replicas.
 */
@Injectable()
export class AttendanceScheduler {
  private readonly logger = new Logger(AttendanceScheduler.name);

  constructor(private readonly attendance: AttendanceService) {}

  /**
   * Per-minute tick fires the **start** push when an occurrence's
   * starts_at is within the next 60 seconds AND hasn't been pushed.
   * That filter means in practice we only push ONCE per occurrence —
   * the 1438 ticks per day where no occurrence is starting are no-ops.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async tickStartPushes(): Promise<void> {
    try {
      const result = await this.attendance.fireStartPushes();
      if (result.pushed > 0) {
        this.logger.log(`Start-push tick: pushed ${result.pushed} notifications`);
      }
    } catch (err: any) {
      this.logger.error(`Start-push tick failed: ${err.message}`);
    }
  }

  /**
   * Per-minute tick fires the **end** push (default 3 min before ends_at)
   * so the mobile sends a final location. Once per occurrence by the
   * same start_push_sent_at-style lock.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async tickEndPushes(): Promise<void> {
    try {
      const result = await this.attendance.fireEndPushes();
      if (result.pushed > 0) {
        this.logger.log(`End-push tick: pushed ${result.pushed} notifications`);
      }
    } catch (err: any) {
      this.logger.error(`End-push tick failed: ${err.message}`);
    }
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async tickSweep(): Promise<void> {
    try {
      const result = await this.attendance.sweepEndedOccurrences();
      if (result.swept > 0) {
        this.logger.log(`Sweep tick: processed ${result.swept} occurrences`);
      }
    } catch (err: any) {
      this.logger.error(`Sweep tick failed: ${err.message}`);
    }
  }

  /**
   * 02:00 UTC daily. Backfills the next 30 days of occurrences so the
   * start-push + sweep ticks always have rows to operate on. Safe to
   * re-run; UNIQUE(service_id, occurrence_date) makes it a no-op for
   * already-generated dates.
   */
  @Cron('0 2 * * *')
  async tickGenerateOccurrences(): Promise<void> {
    try {
      const result = await this.attendance.generateUpcomingOccurrences(30);
      this.logger.log(`Occurrence generator: created ${result.generated} new rows`);
    } catch (err: any) {
      this.logger.error(`Occurrence generator failed: ${err.message}`);
    }
  }
}
