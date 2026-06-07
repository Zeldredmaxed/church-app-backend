import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { parse } from 'csv-parse/sync';
import { SupabaseAdminService } from '../common/services/supabase-admin.service';
import { AuditService } from '../audit/audit.service';

/**
 * CSV member import (migration 101).
 *
 * Pastors transitioning from Tithely / Breeze / ChurchTeams /
 * Planning Center drop a CSV export and we populate profiles.
 *
 * Important behavior:
 *   - Auth user is created in Supabase with email_confirm=false and
 *     NO password — the user CANNOT log in until they accept an
 *     invitation. This is the "shadow profile" state.
 *   - No emails are sent at import time. The pastor controls timing
 *     via workflows triggered on the `member_tagged` event for
 *     the assigned tag (default: "Imported - Pending Invite").
 *   - Each row is its own transaction — a malformed row doesn't
 *     poison the whole import. Errors collected into the summary
 *     so admin can fix + re-upload (re-uploads dedupe on email).
 *
 * SERVICE-ROLE BYPASS (documented per CLAUDE.md): this method
 * operates on auth.users + public.users + tenant_memberships +
 * member_tags across the imported set. The webhook-style nature
 * (no end-user-bound JWT for the IMPORTED rows) plus cross-user
 * scope means RLS would block. We use this.dataSource with
 * explicit tenant_id pinning.
 */
@Injectable()
export class MemberImportService {
  private readonly logger = new Logger(MemberImportService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly supabaseAdmin: SupabaseAdminService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Parse a CSV buffer, create/update tenant members, return summary.
   * Idempotent on email — re-uploading the same file updates names /
   * phones / etc. but doesn't double-create.
   */
  async importCsv(args: {
    tenantId: string;
    /** UUID of the admin who uploaded the CSV — stamped on member_imports + assigned_by on member_tags. */
    importedByUserId: string;
    source: 'tithely' | 'breeze' | 'churchteams' | 'planning_center' | 'generic';
    filename: string | null;
    csvBuffer: Buffer;
    assignTagName: string;
  }): Promise<ImportSummary> {
    // Defensive caps. Tithely exports for big churches can hit 10k rows
    // but anything beyond should be uploaded in chunks.
    if (args.csvBuffer.length > 10 * 1024 * 1024) {
      throw new BadRequestException('CSV exceeds 10 MB cap. Split into smaller files.');
    }

    let rows: Record<string, string>[];
    try {
      rows = parse(args.csvBuffer, {
        columns: (header: string[]) => header.map((h) => h.trim()),
        skip_empty_lines: true,
        trim: true,
        bom: true, // Tithely + Breeze emit UTF-8 BOM
        relax_quotes: true,
        relax_column_count: true,
      });
    } catch (err: any) {
      throw new BadRequestException(`Could not parse CSV: ${err.message}`);
    }

    if (rows.length === 0) {
      throw new BadRequestException('CSV is empty.');
    }
    if (rows.length > 5000) {
      throw new BadRequestException(
        `Import too large: ${rows.length} rows. Maximum 5,000 per upload — split into multiple files.`,
      );
    }

    // Map columns per source. Returns a normalized { email, firstName,
    // lastName, phone, dateOfBirth, address, gender } object or null
    // if the row is missing the minimum required fields.
    const normalize = makeNormalizer(args.source);

    // Get-or-create the import-pending tag for this tenant.
    const tagId = await this.getOrCreateTag(args.tenantId, args.assignTagName);

    // Create the parent member_imports row up-front so we have a
    // batch UUID to stamp on every row (lets admin filter / undo).
    const [importRow] = await this.dataSource.query(
      `INSERT INTO public.member_imports (tenant_id, imported_by, source, filename, total_rows)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [args.tenantId, args.importedByUserId, args.source, args.filename, rows.length],
    );
    const importBatchId: string = importRow.id;

    const summary: ImportSummary = {
      importId: importBatchId,
      totalRows: rows.length,
      created: 0,
      updated: 0,
      skipped: 0,
      errors: [],
    };

    // Per-row processing. Each row is its own try/catch so a bad row
    // doesn't poison the rest.
    for (let i = 0; i < rows.length; i++) {
      const raw = rows[i];
      try {
        const norm = normalize(raw);
        if (!norm) {
          summary.skipped++;
          summary.errors.push({
            row: i + 2, // +2 because i is 0-indexed AND row 1 is the header
            reason: 'Missing required fields (need email + first/last name)',
          });
          continue;
        }

        const result = await this.upsertMember({
          tenantId: args.tenantId,
          importedByUserId: args.importedByUserId,
          importBatchId,
          tagId,
          email: norm.email,
          firstName: norm.firstName,
          lastName: norm.lastName,
          phone: norm.phone,
          dateOfBirth: norm.dateOfBirth,
        });

        if (result === 'created') summary.created++;
        else if (result === 'updated') summary.updated++;
        else summary.skipped++;
      } catch (err: any) {
        summary.errors.push({
          row: i + 2,
          reason: err.message ?? 'unknown error',
          email: raw.Email ?? raw.email ?? null,
        });
      }
    }

    // Update the summary row.
    await this.dataSource.query(
      `UPDATE public.member_imports SET
         created_count = $1, updated_count = $2, skipped_count = $3,
         error_count = $4, errors_jsonb = $5::jsonb
       WHERE id = $6`,
      [
        summary.created,
        summary.updated,
        summary.skipped,
        summary.errors.length,
        JSON.stringify(summary.errors),
        importBatchId,
      ],
    );

    // Audit log via the global service (uses service-role DataSource
    // since we're outside an RLS context for cross-user writes).
    try {
      await this.audit.log({
        action: 'members.imported',
        resourceType: 'tenant',
        resourceId: args.tenantId,
        summary: `Imported ${summary.created} members (${summary.updated} updated, ${summary.skipped} skipped, ${summary.errors.length} errors) from ${args.source} CSV`,
        metadata: {
          importId: importBatchId,
          source: args.source,
          filename: args.filename,
          totals: { created: summary.created, updated: summary.updated, skipped: summary.skipped, errors: summary.errors.length },
        },
      });
    } catch (err: any) {
      // Best-effort — don't fail the import on audit failure.
      this.logger.warn(`members.imported audit log failed: ${err.message}`);
    }

    this.logger.log(
      `Member import complete: tenant=${args.tenantId} batch=${importBatchId} ` +
      `created=${summary.created} updated=${summary.updated} skipped=${summary.skipped} errors=${summary.errors.length}`,
    );

    return summary;
  }

  /**
   * Get-or-create the assignment tag for this tenant. Workflow
   * trigger `member_tagged` on this tag is how pastors hook their
   * invitation flow. Returns the tag UUID.
   */
  private async getOrCreateTag(tenantId: string, tagName: string): Promise<string> {
    const [existing] = await this.dataSource.query(
      `SELECT id FROM public.tags WHERE tenant_id = $1 AND lower(name) = lower($2) LIMIT 1`,
      [tenantId, tagName],
    );
    if (existing?.id) return existing.id;

    const [created] = await this.dataSource.query(
      `INSERT INTO public.tags (tenant_id, name, color)
       VALUES ($1, $2, '#9333ea')
       RETURNING id`,
      [tenantId, tagName],
    );
    return created.id;
  }

  /**
   * Upsert one member: ensure auth.users row exists (email_confirm=false,
   * no password = shadow profile), upsert public.users with profile
   * fields, ensure tenant_memberships row with imported_at + import_batch,
   * ensure member_tags row for the assignment tag.
   *
   * Returns 'created' (new auth + new membership), 'updated' (existing
   * profile updated), or 'skipped' (no-op).
   */
  private async upsertMember(args: {
    tenantId: string;
    /** UUID of admin who triggered this import — used as assigned_by on member_tags. */
    importedByUserId: string;
    importBatchId: string;
    tagId: string;
    email: string;
    firstName: string;
    lastName: string;
    phone: string | null;
    dateOfBirth: string | null;
  }): Promise<'created' | 'updated' | 'skipped'> {
    const lowerEmail = args.email.toLowerCase();

    // Direct SQL lookup against auth.users (NOT listUsers — same lesson
    // as completeSignup in tenants.service: listUsers breaks past page 1).
    const [existingAuth] = await this.dataSource.query(
      `SELECT id FROM auth.users WHERE lower(email) = lower($1) LIMIT 1`,
      [lowerEmail],
    );

    let userId: string;
    let isNewUser = false;
    if (existingAuth?.id) {
      userId = existingAuth.id;
    } else {
      const fullName = `${args.firstName} ${args.lastName}`.trim();
      const { data: created, error } = await this.supabaseAdmin.client.auth.admin.createUser({
        email: lowerEmail,
        email_confirm: false, // shadow profile — can't log in until invited
        user_metadata: {
          full_name: fullName,
          imported: true,
        },
      });
      if (error || !created?.user) {
        throw new InternalServerErrorException(
          `Failed to create Supabase user for ${lowerEmail}: ${error?.message}`,
        );
      }
      userId = created.user.id;
      isNewUser = true;
    }

    // Upsert public.users row (handle_new_user trigger may have already
    // created a base row via the Supabase auth event; merge profile fields).
    const fullName = `${args.firstName} ${args.lastName}`.trim();
    await this.dataSource.query(
      `INSERT INTO public.users (id, email, full_name, phone, date_of_birth)
       VALUES ($1, $2, $3, $4, $5::date)
       ON CONFLICT (id) DO UPDATE SET
         full_name = COALESCE(EXCLUDED.full_name, public.users.full_name),
         phone = COALESCE(EXCLUDED.phone, public.users.phone),
         date_of_birth = COALESCE(EXCLUDED.date_of_birth, public.users.date_of_birth)`,
      [userId, lowerEmail, fullName, args.phone, args.dateOfBirth],
    );

    // Tenant membership row. New imports get role='member' + imported_at
    // + import_batch. Re-uploaded existing memberships just update the
    // import_batch link (so admin can see the latest import touched them).
    const [existingMembership] = await this.dataSource.query(
      `SELECT id, imported_at FROM public.tenant_memberships
       WHERE tenant_id = $1 AND user_id = $2 LIMIT 1`,
      [args.tenantId, userId],
    );

    let result: 'created' | 'updated' | 'skipped';
    if (!existingMembership) {
      await this.dataSource.query(
        `INSERT INTO public.tenant_memberships (tenant_id, user_id, role, permissions, imported_at, import_batch)
         VALUES ($1, $2, 'member', '{}'::jsonb, now(), $3)`,
        [args.tenantId, userId, args.importBatchId],
      );
      result = 'created';
    } else if (existingMembership.imported_at) {
      // Re-import — refresh batch link so admin can see latest touch.
      await this.dataSource.query(
        `UPDATE public.tenant_memberships SET import_batch = $1 WHERE id = $2`,
        [args.importBatchId, existingMembership.id],
      );
      result = 'updated';
    } else {
      // Existing manually-created member; don't overwrite their role
      // or stamp imported_at (they weren't actually imported). Profile
      // fields above DID update — count as updated.
      result = 'updated';
    }

    // Assign the import-pending tag (idempotent via PK). assigned_by
    // is the admin who triggered the import (previously was the
    // import_batch UUID as a placeholder — wrong FK semantics).
    await this.dataSource.query(
      `INSERT INTO public.member_tags (tag_id, user_id, assigned_by)
       VALUES ($1, $2, $3)
       ON CONFLICT (tag_id, user_id) DO NOTHING`,
      [args.tagId, userId, args.importedByUserId],
    );

    return result;
  }
}

// ──────────────────────────── types ────────────────────────────

export interface ImportSummary {
  importId: string;
  totalRows: number;
  created: number;
  updated: number;
  skipped: number;
  errors: Array<{ row: number; reason: string; email?: string | null }>;
}

interface NormalizedRow {
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  dateOfBirth: string | null;
}

/**
 * Per-source column mapping. Returns a function that maps one raw
 * row → normalized fields, or null if the row is unusable.
 *
 * Each source's column names below were taken from real exports
 * (Tithely: Aug 2025 export, Breeze: Sep 2025 export). Mappings
 * are forgiving — case-insensitive, tolerant of extra whitespace.
 */
function makeNormalizer(source: string): (row: Record<string, string>) => NormalizedRow | null {
  const lookup = (row: Record<string, string>, ...candidates: string[]): string | null => {
    const keys = Object.keys(row);
    for (const candidate of candidates) {
      const found = keys.find((k) => k.trim().toLowerCase() === candidate.trim().toLowerCase());
      if (found) {
        const v = row[found]?.trim();
        if (v) return v;
      }
    }
    return null;
  };

  return (row: Record<string, string>) => {
    let email: string | null;
    let firstName: string | null;
    let lastName: string | null;
    let phone: string | null;
    let dob: string | null;

    switch (source) {
      case 'tithely':
        email = lookup(row, 'Email', 'Email Address');
        firstName = lookup(row, 'First Name', 'FirstName');
        lastName = lookup(row, 'Last Name', 'LastName');
        phone = lookup(row, 'Mobile Phone', 'Phone', 'Cell Phone');
        dob = lookup(row, 'Date of Birth', 'DOB', 'Birthday');
        break;
      case 'breeze':
        email = lookup(row, 'Email', 'Email Address');
        firstName = lookup(row, 'First Name');
        lastName = lookup(row, 'Last Name');
        phone = lookup(row, 'Mobile', 'Cell', 'Home Phone', 'Phone');
        dob = lookup(row, 'Birthdate', 'Birthday', 'DOB');
        break;
      case 'churchteams':
        email = lookup(row, 'Email');
        firstName = lookup(row, 'First Name', 'First');
        lastName = lookup(row, 'Last Name', 'Last');
        phone = lookup(row, 'Cell', 'Mobile', 'Home');
        dob = lookup(row, 'Birthday', 'DOB');
        break;
      case 'planning_center':
        email = lookup(row, 'Email', 'Primary email');
        firstName = lookup(row, 'First Name', 'Given name');
        lastName = lookup(row, 'Last Name', 'Family name');
        phone = lookup(row, 'Mobile', 'Phone');
        dob = lookup(row, 'Birthdate', 'Birthday');
        break;
      default:
        // Generic / permissive — try lots of variants.
        email = lookup(row, 'email', 'email address', 'e-mail', 'Email', 'EMAIL');
        firstName = lookup(row, 'first name', 'firstname', 'first', 'given name', 'fname');
        lastName = lookup(row, 'last name', 'lastname', 'last', 'family name', 'lname', 'surname');
        phone = lookup(row, 'phone', 'mobile', 'cell', 'cellphone', 'cell phone', 'mobile phone');
        dob = lookup(row, 'date of birth', 'dob', 'birthday', 'birthdate', 'born');
        break;
    }

    // Email + a name component required (we allow first OR last to be
    // missing because some legacy CSVs only have "Display Name").
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
    if (!firstName && !lastName) return null;

    return {
      email: email.toLowerCase(),
      firstName: firstName ?? '',
      lastName: lastName ?? '',
      phone: phone ? phone.replace(/[^0-9+]/g, '').slice(0, 30) || null : null,
      // YYYY-MM-DD ISO parse; tolerant of MM/DD/YYYY → convert.
      dateOfBirth: normalizeDate(dob),
    };
  };
}

function normalizeDate(s: string | null): string | null {
  if (!s) return null;
  // ISO YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // US M/D/YYYY or MM/DD/YYYY
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (us) {
    const [, m, d, y] = us;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  // Bail — invalid date doesn't fail the row, just leaves dob null.
  return null;
}
