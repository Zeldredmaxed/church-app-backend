import { Injectable, Logger, ForbiddenException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { getTierFeatures } from '../common/config/tier-features.config';

const GB = 1_073_741_824; // 1 GB in bytes

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);

  constructor(private readonly dataSource: DataSource) {}

  /**
   * Get storage usage summary for a tenant.
   */
  async getStorageUsage(tenantId: string) {
    // Ensure the usage row exists
    await this.ensureUsageRow(tenantId);

    const [usage] = await this.dataSource.query(
      `SELECT used_bytes, file_count, last_alert_percent, updated_at
       FROM public.tenant_storage_usage WHERE tenant_id = $1`,
      [tenantId],
    );

    const tier = await this.getTenantTier(tenantId);
    const features = getTierFeatures(tier);
    const limitBytes = features.storageLimit === -1 ? -1 : features.storageLimit * GB;
    const usedBytes = Number(usage.used_bytes);

    return {
      usedBytes,
      usedFormatted: this.formatBytes(usedBytes),
      limitBytes,
      limitFormatted: limitBytes === -1 ? 'Unlimited' : this.formatBytes(limitBytes),
      percentUsed: limitBytes === -1 ? 0 : Math.round((usedBytes / limitBytes) * 1000) / 10,
      fileCount: usage.file_count,
      tier,
      updatedAt: usage.updated_at,
    };
  }

  /**
   * Get storage breakdown by content type for the admin "Manage Storage" page.
   */
  async getStorageBreakdown(tenantId: string) {
    const rows = await this.dataSource.query(
      `SELECT source_type,
              COUNT(*)::int AS file_count,
              SUM(file_size_bytes)::bigint AS total_bytes
       FROM public.storage_files
       WHERE tenant_id = $1
       GROUP BY source_type
       ORDER BY total_bytes DESC`,
      [tenantId],
    );

    return {
      breakdown: rows.map((r: any) => ({
        sourceType: r.source_type,
        fileCount: r.file_count,
        totalBytes: Number(r.total_bytes),
        totalFormatted: this.formatBytes(Number(r.total_bytes)),
      })),
    };
  }

  /**
   * Get the largest files for a tenant (for the "Manage Storage" cleanup page).
   */
  async getLargestFiles(tenantId: string, limit: number = 50) {
    const rows = await this.dataSource.query(
      `SELECT sf.id, sf.file_key, sf.file_size_bytes, sf.content_type,
              sf.source_type, sf.source_id, sf.created_at,
              u.full_name AS uploaded_by_name
       FROM public.storage_files sf
       JOIN public.users u ON u.id = sf.user_id
       WHERE sf.tenant_id = $1
       ORDER BY sf.file_size_bytes DESC
       LIMIT $2`,
      [tenantId, limit],
    );

    return {
      files: rows.map((r: any) => ({
        id: r.id,
        fileKey: r.file_key,
        fileSizeBytes: Number(r.file_size_bytes),
        fileSizeFormatted: this.formatBytes(Number(r.file_size_bytes)),
        contentType: r.content_type,
        sourceType: r.source_type,
        sourceId: r.source_id,
        uploadedByName: r.uploaded_by_name,
        createdAt: r.created_at,
      })),
    };
  }

  /**
   * Check if a tenant has enough storage for a new upload.
   * Throws ForbiddenException if over limit.
   */
  async checkStorageLimit(tenantId: string, newFileSizeBytes: number): Promise<void> {
    const tier = await this.getTenantTier(tenantId);
    const features = getTierFeatures(tier);

    // Unlimited storage
    if (features.storageLimit === -1) return;

    const limitBytes = features.storageLimit * GB;

    await this.ensureUsageRow(tenantId);

    const [usage] = await this.dataSource.query(
      `SELECT used_bytes FROM public.tenant_storage_usage WHERE tenant_id = $1`,
      [tenantId],
    );

    const currentUsed = Number(usage.used_bytes);
    const afterUpload = currentUsed + newFileSizeBytes;

    if (afterUpload > limitBytes) {
      const usedFormatted = this.formatBytes(currentUsed);
      const limitFormatted = this.formatBytes(limitBytes);
      throw new ForbiddenException(
        `Storage limit reached (${usedFormatted} / ${limitFormatted}). ` +
        `Upgrade your plan or free up space by deleting old files.`,
      );
    }
  }

  /**
   * Record a file upload and update the tenant's running total.
   * Also checks threshold alerts (80%, 95%).
   */
  async recordUpload(
    tenantId: string,
    userId: string,
    fileKey: string,
    fileSizeBytes: number,
    contentType: string,
    sourceType: string = 'upload',
    sourceId?: string,
  ) {
    // Insert file record
    await this.dataSource.query(
      `INSERT INTO public.storage_files
        (tenant_id, user_id, file_key, file_size_bytes, content_type, source_type, source_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [tenantId, userId, fileKey, fileSizeBytes, contentType, sourceType, sourceId ?? null],
    );

    // Update running total
    await this.dataSource.query(
      `INSERT INTO public.tenant_storage_usage (tenant_id, used_bytes, file_count)
       VALUES ($1, $2, 1)
       ON CONFLICT (tenant_id) DO UPDATE SET
         used_bytes = tenant_storage_usage.used_bytes + $2,
         file_count = tenant_storage_usage.file_count + 1,
         updated_at = now()`,
      [tenantId, fileSizeBytes],
    );

    // Check thresholds and send alerts
    await this.checkThresholdAlerts(tenantId).catch(err =>
      this.logger.error('Failed to check storage threshold alerts', err),
    );
  }

  /**
   * Remove a file record and decrement the tenant's running total.
   */
  async recordDeletion(tenantId: string, fileId: string) {
    // Get file size before deleting
    const [file] = await this.dataSource.query(
      `DELETE FROM public.storage_files WHERE id = $1 AND tenant_id = $2 RETURNING file_size_bytes`,
      [fileId, tenantId],
    );

    if (!file) return;

    // Decrement running total
    await this.dataSource.query(
      `UPDATE public.tenant_storage_usage
       SET used_bytes = GREATEST(used_bytes - $2, 0),
           file_count = GREATEST(file_count - 1, 0),
           updated_at = now()
       WHERE tenant_id = $1`,
      [tenantId, Number(file.file_size_bytes)],
    );
  }

  // ─── PRIVATE ───

  private async checkThresholdAlerts(tenantId: string) {
    const tier = await this.getTenantTier(tenantId);
    const features = getTierFeatures(tier);
    if (features.storageLimit === -1) return; // unlimited

    const limitBytes = features.storageLimit * GB;

    const [usage] = await this.dataSource.query(
      `SELECT used_bytes, last_alert_percent FROM public.tenant_storage_usage WHERE tenant_id = $1`,
      [tenantId],
    );

    const usedBytes = Number(usage.used_bytes);
    const percentUsed = Math.round((usedBytes / limitBytes) * 100);
    const lastAlert = usage.last_alert_percent;

    // Determine which threshold we should alert at
    let alertPercent = 0;
    if (percentUsed >= 95 && lastAlert < 95) alertPercent = 95;
    else if (percentUsed >= 80 && lastAlert < 80) alertPercent = 80;

    if (alertPercent === 0) return;

    // Update last alert threshold
    await this.dataSource.query(
      `UPDATE public.tenant_storage_usage SET last_alert_percent = $2 WHERE tenant_id = $1`,
      [tenantId, alertPercent],
    );

    // Get all admin users for this tenant
    const admins = await this.dataSource.query(
      `SELECT user_id FROM public.tenant_memberships
       WHERE tenant_id = $1 AND role IN ('admin', 'pastor')`,
      [tenantId],
    );

    const usedFormatted = this.formatBytes(usedBytes);
    const limitFormatted = this.formatBytes(limitBytes);

    const title = alertPercent >= 95
      ? 'Storage Almost Full'
      : 'Storage Getting Full';

    const body = alertPercent >= 95
      ? `Your church is using ${usedFormatted} of ${limitFormatted} (${percentUsed}%). Uploads will be blocked soon. Upgrade your plan or free up space.`
      : `Your church is using ${usedFormatted} of ${limitFormatted} (${percentUsed}%). Consider upgrading to get more storage.`;

    // Send notification to all admins
    for (const admin of admins) {
      await this.dataSource.query(
        `INSERT INTO public.notifications (recipient_id, tenant_id, type, payload)
         VALUES ($1, $2, 'storage_alert', $3::jsonb)`,
        [
          admin.user_id,
          tenantId,
          JSON.stringify({ title, body, percentUsed, usedBytes, limitBytes, alertPercent }),
        ],
      );
    }

    this.logger.warn(`Storage alert (${alertPercent}%) sent for tenant ${tenantId}: ${usedFormatted} / ${limitFormatted}`);
  }

  private async ensureUsageRow(tenantId: string) {
    await this.dataSource.query(
      `INSERT INTO public.tenant_storage_usage (tenant_id) VALUES ($1) ON CONFLICT DO NOTHING`,
      [tenantId],
    );
  }

  private async getTenantTier(tenantId: string): Promise<string> {
    const [tenant] = await this.dataSource.query(
      `SELECT tier FROM public.tenants WHERE id = $1`,
      [tenantId],
    );
    return tenant?.tier ?? 'standard';
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    const value = bytes / Math.pow(1024, i);
    return `${value.toFixed(i > 1 ? 1 : 0)} ${units[i]}`;
  }
}
