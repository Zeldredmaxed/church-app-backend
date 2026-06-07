import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { JoinIosWaitlistDto } from './dto/join-waitlist.dto';

@Injectable()
export class IosWaitlistService {
  private readonly logger = new Logger(IosWaitlistService.name);

  constructor(private readonly dataSource: DataSource) {}

  /**
   * Join the iOS waitlist. Idempotent: returns `{ joined: true }`
   * whether or not the email was already on the list (don't expose
   * existence — public unauthed endpoint, leaking would help spam
   * recon). Email is lowercased before storage so case variants
   * collapse to one row.
   */
  async join(dto: JoinIosWaitlistDto, ipAddress: string | null): Promise<{ joined: true }> {
    const email = dto.email.trim().toLowerCase();

    await this.dataSource.query(
      `INSERT INTO public.ios_waitlist (email, source, device_info, ip_address)
       VALUES ($1, $2, $3::jsonb, $4)
       ON CONFLICT (email) DO NOTHING`,
      [
        email,
        dto.source ?? null,
        JSON.stringify(dto.deviceInfo ?? {}),
        ipAddress,
      ],
    );

    this.logger.log(`iOS waitlist: ${email} (source=${dto.source ?? '-'})`);
    return { joined: true };
  }

  /** Super-admin: count + paginated list for dashboard inspection. */
  async listAll(
    status: 'pending' | 'invited' | 'all' = 'all',
    limit = 1000,
  ): Promise<{ totalPending: number; totalInvited: number; count: number; items: any[] }> {
    let where = '';
    if (status === 'pending') where = 'WHERE invited_at IS NULL';
    if (status === 'invited') where = 'WHERE invited_at IS NOT NULL';

    const cappedLimit = Math.min(Math.max(1, limit), 10_000);

    const items = await this.dataSource.query(
      `SELECT id, email, source, device_info, invited_at, created_at
       FROM public.ios_waitlist
       ${where}
       ORDER BY created_at DESC
       LIMIT ${cappedLimit}`,
    );

    const [counts] = await this.dataSource.query(
      `SELECT
        COUNT(*) FILTER (WHERE invited_at IS NULL)::int AS pending,
        COUNT(*) FILTER (WHERE invited_at IS NOT NULL)::int AS invited
       FROM public.ios_waitlist`,
    );

    return {
      totalPending: counts.pending,
      totalInvited: counts.invited,
      count: items.length,
      items,
    };
  }

  /**
   * Super-admin: emit TestFlight-ready CSV. Stamps `invited_at` on
   * every row returned (so the same row isn't re-included in a future
   * `?status=pending` export). Pass `?markInvited=false` for a
   * dry-run that doesn't stamp.
   *
   * TestFlight CSV format: First Name, Last Name, Email. We don't
   * collect names (just email at the form), so first/last are blank.
   * TestFlight accepts that — it'll email the address with no name
   * personalization.
   */
  async exportCsv(
    status: 'pending' | 'all' = 'pending',
    markInvited = true,
  ): Promise<string> {
    const rows = await this.dataSource.query(
      `SELECT id, email
       FROM public.ios_waitlist
       ${status === 'pending' ? 'WHERE invited_at IS NULL' : ''}
       ORDER BY created_at ASC`,
    );

    if (rows.length === 0) {
      return 'First Name,Last Name,Email\n';
    }

    if (markInvited) {
      const ids = rows.map((r: any) => r.id);
      await this.dataSource.query(
        `UPDATE public.ios_waitlist SET invited_at = now() WHERE id = ANY($1::uuid[]) AND invited_at IS NULL`,
        [ids],
      );
      this.logger.log(`iOS waitlist export: stamped ${rows.length} rows as invited`);
    }

    const header = 'First Name,Last Name,Email\n';
    const body = rows.map((r: any) => `,,${csvEscape(r.email)}`).join('\n');
    return header + body + '\n';
  }
}

/** CSV-escape a single field — wrap in quotes only if it contains a comma, quote, or newline. */
function csvEscape(s: string): string {
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
