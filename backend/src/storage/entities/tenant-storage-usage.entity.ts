import { Entity, PrimaryColumn, Column, UpdateDateColumn } from 'typeorm';

@Entity({ schema: 'public', name: 'tenant_storage_usage' })
export class TenantStorageUsage {
  @PrimaryColumn('uuid', { name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'bigint', name: 'used_bytes', default: 0 })
  usedBytes: string; // bigint comes back as string from pg

  @Column({ type: 'int', name: 'file_count', default: 0 })
  fileCount: number;

  @Column({ type: 'int', name: 'last_alert_percent', default: 0 })
  lastAlertPercent: number;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
