import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { rlsStorage } from '../common/storage/rls.storage';
import { CheckIn } from './entities/check-in.entity';

@Injectable()
export class CheckinService {
  private getRlsContext() {
    const ctx = rlsStorage.getStore();
    if (!ctx) throw new InternalServerErrorException('RLS context unavailable');
    return ctx;
  }

  async getCurrentServices() {
    const { queryRunner } = this.getRlsContext();
    const rows = await queryRunner.query(
      `SELECT * FROM public.services WHERE day_of_week = EXTRACT(DOW FROM now())::int ORDER BY start_time ASC`,
    );

    return {
      services: rows.map((r: any) => ({
        id: r.id,
        tenantId: r.tenant_id,
        name: r.name,
        dayOfWeek: r.day_of_week,
        startTime: r.start_time,
        createdAt: r.created_at,
      })),
    };
  }

  async checkIn(userId: string, serviceId?: string) {
    const { queryRunner, currentTenantId } = this.getRlsContext();
    const checkIn = queryRunner.manager.create(CheckIn, {
      tenantId: currentTenantId!,
      userId,
      serviceId: serviceId ?? null,
    });
    const saved = await queryRunner.manager.save(CheckIn, checkIn);
    return { message: 'Checked in successfully', checkedInAt: saved.checkedInAt };
  }
}
