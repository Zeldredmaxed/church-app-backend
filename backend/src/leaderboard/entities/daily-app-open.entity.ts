import { Entity, PrimaryColumn, Column } from 'typeorm';

@Entity({ schema: 'public', name: 'daily_app_opens' })
export class DailyAppOpen {
  @PrimaryColumn('uuid', { name: 'user_id' })
  userId: string;

  @PrimaryColumn('uuid', { name: 'tenant_id' })
  tenantId: string;

  @PrimaryColumn({ type: 'date', name: 'open_date' })
  openDate: string;
}
