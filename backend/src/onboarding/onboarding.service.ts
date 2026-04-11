import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { FIELD_LIBRARY, FIELD_LIBRARY_MAP, OnboardingFieldDef } from './onboarding-field-library';
import { UpdateFormDto } from './dto/update-form.dto';

export interface ResolvedField {
  key: string;
  label: string;
  description?: string;
  type: string;
  category: string;
  options?: string[];
  placeholder?: string;
  required: boolean;
  isCustom: boolean;
}

@Injectable()
export class OnboardingService {
  private readonly logger = new Logger(OnboardingService.name);

  constructor(private readonly dataSource: DataSource) {}

  /**
   * Returns the FIELD_LIBRARY grouped by category.
   */
  getFieldLibrary() {
    const grouped: Record<string, OnboardingFieldDef[]> = {};
    for (const field of FIELD_LIBRARY) {
      if (!grouped[field.category]) grouped[field.category] = [];
      grouped[field.category].push(field);
    }
    return grouped;
  }

  /**
   * Get the onboarding form for a tenant (admin view — includes inactive).
   */
  async getForm(tenantId: string) {
    const [row] = await this.dataSource.query(
      `SELECT * FROM public.onboarding_forms WHERE tenant_id = $1`,
      [tenantId],
    );
    if (!row) return null;
    return this.resolveForm(row);
  }

  /**
   * Get the public onboarding form — only if active. Used during signup (no auth).
   */
  async getPublicForm(tenantId: string) {
    const [row] = await this.dataSource.query(
      `SELECT * FROM public.onboarding_forms WHERE tenant_id = $1 AND is_active = true`,
      [tenantId],
    );
    if (!row) return null;
    return this.resolveForm(row);
  }

  /**
   * Upsert the onboarding form for a tenant. Only one form per tenant.
   */
  async createOrUpdateForm(tenantId: string, dto: UpdateFormDto, userId: string) {
    const fieldsJson = JSON.stringify(dto.fields);

    const [row] = await this.dataSource.query(
      `INSERT INTO public.onboarding_forms (tenant_id, is_active, welcome_message, fields, created_by)
       VALUES ($1, $2, $3, $4::jsonb, $5)
       ON CONFLICT (tenant_id) DO UPDATE SET
         is_active = COALESCE($2, onboarding_forms.is_active),
         welcome_message = $3,
         fields = $4::jsonb,
         updated_at = now()
       RETURNING *`,
      [
        tenantId,
        dto.isActive ?? true,
        dto.welcomeMessage ?? null,
        fieldsJson,
        userId,
      ],
    );

    return this.resolveForm(row);
  }

  /**
   * Delete the onboarding form for a tenant.
   */
  async deleteForm(tenantId: string) {
    const result = await this.dataSource.query(
      `DELETE FROM public.onboarding_forms WHERE tenant_id = $1 RETURNING id`,
      [tenantId],
    );
    if (result.length === 0) throw new NotFoundException('Onboarding form not found');
    return { deleted: true };
  }

  /**
   * Submit onboarding responses and auto-populate journey data.
   */
  async submitResponses(tenantId: string, userId: string, formId: string, responses: Record<string, any>) {
    // Save responses
    await this.dataSource.query(
      `INSERT INTO public.onboarding_responses (tenant_id, user_id, form_id, responses)
       VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT (user_id, tenant_id) DO UPDATE SET
         responses = $4::jsonb,
         submitted_at = now()`,
      [tenantId, userId, formId, JSON.stringify(responses)],
    );

    // Auto-populate journey data from mapped fields
    await this.populateJourneyFromResponses(tenantId, userId, responses);

    return { submitted: true };
  }

  /**
   * Get all submitted responses for a tenant (admin), optionally for a specific user.
   */
  async getResponses(tenantId: string, userId?: string) {
    if (userId) {
      const [row] = await this.dataSource.query(
        `SELECT r.*, u.full_name, u.email
         FROM public.onboarding_responses r
         JOIN public.users u ON u.id = r.user_id
         WHERE r.tenant_id = $1 AND r.user_id = $2`,
        [tenantId, userId],
      );
      if (!row) throw new NotFoundException('Onboarding response not found');
      return this.mapResponseRow(row);
    }

    const rows = await this.dataSource.query(
      `SELECT r.*, u.full_name, u.email
       FROM public.onboarding_responses r
       JOIN public.users u ON u.id = r.user_id
       WHERE r.tenant_id = $1
       ORDER BY r.submitted_at DESC`,
      [tenantId],
    );
    return rows.map((r: any) => this.mapResponseRow(r));
  }

  /**
   * Aggregate stats on responses for a tenant.
   */
  async getResponseStats(tenantId: string) {
    const [countRow] = await this.dataSource.query(
      `SELECT COUNT(*)::int AS total FROM public.onboarding_responses WHERE tenant_id = $1`,
      [tenantId],
    );

    // Most common interests
    const interestRows = await this.dataSource.query(
      `SELECT interest, COUNT(*)::int AS cnt
       FROM public.onboarding_responses,
            jsonb_array_elements_text(responses->'interests') AS interest
       WHERE tenant_id = $1
       GROUP BY interest ORDER BY cnt DESC LIMIT 10`,
      [tenantId],
    );

    // Most common skills
    const skillRows = await this.dataSource.query(
      `SELECT skill, COUNT(*)::int AS cnt
       FROM public.onboarding_responses,
            jsonb_array_elements_text(responses->'skills') AS skill
       WHERE tenant_id = $1
       GROUP BY skill ORDER BY cnt DESC LIMIT 10`,
      [tenantId],
    );

    // How did you hear breakdown
    const hearRows = await this.dataSource.query(
      `SELECT responses->>'how_did_you_hear' AS source, COUNT(*)::int AS cnt
       FROM public.onboarding_responses
       WHERE tenant_id = $1 AND responses->>'how_did_you_hear' IS NOT NULL
       GROUP BY source ORDER BY cnt DESC`,
      [tenantId],
    );

    return {
      totalResponses: countRow.total,
      topInterests: interestRows.map((r: any) => ({ interest: r.interest, count: r.cnt })),
      topSkills: skillRows.map((r: any) => ({ skill: r.skill, count: r.cnt })),
      referralSources: hearRows.map((r: any) => ({ source: r.source, count: r.cnt })),
    };
  }

  // ─── PRIVATE HELPERS ───

  private resolveForm(row: any) {
    const rawFields: any[] = typeof row.fields === 'string' ? JSON.parse(row.fields) : row.fields;

    const resolvedFields: ResolvedField[] = rawFields.map((f: any) => {
      const libraryDef = FIELD_LIBRARY_MAP[f.key];
      if (libraryDef) {
        // Pre-built field — merge library metadata with form config
        return {
          key: f.key,
          label: libraryDef.label,
          description: libraryDef.description,
          type: libraryDef.type,
          category: libraryDef.category,
          options: libraryDef.options,
          placeholder: libraryDef.placeholder,
          required: f.required ?? false,
          isCustom: false,
        };
      }
      // Custom field
      return {
        key: f.key,
        label: f.label ?? f.key,
        type: f.type ?? 'text',
        category: 'custom',
        options: f.options,
        placeholder: f.placeholder,
        required: f.required ?? false,
        isCustom: true,
      };
    });

    return {
      id: row.id,
      tenantId: row.tenant_id,
      isActive: row.is_active,
      welcomeMessage: row.welcome_message,
      fields: resolvedFields,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapResponseRow(row: any) {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      userId: row.user_id,
      fullName: row.full_name ?? null,
      email: row.email ?? null,
      formId: row.form_id,
      responses: row.responses,
      submittedAt: row.submitted_at,
    };
  }

  private async populateJourneyFromResponses(
    tenantId: string,
    userId: string,
    resp: Record<string, any>,
  ) {
    const journeyUpdates: Record<string, any> = {};

    if (resp.is_baptized !== undefined) journeyUpdates.is_baptized = resp.is_baptized;
    if (resp.baptism_date) journeyUpdates.baptism_date = resp.baptism_date;
    if (resp.salvation_date) journeyUpdates.salvation_date = resp.salvation_date;
    if (resp.is_saved === true && !resp.salvation_date) {
      journeyUpdates.salvation_date = new Date().toISOString().split('T')[0];
    }
    if (resp.interests) journeyUpdates.interests = resp.interests;
    if (resp.skills) journeyUpdates.skills = resp.skills;
    if (resp.faith_journey) {
      journeyUpdates.discipleship_track = this.mapFaithToTrack(resp.faith_journey);
    }

    if (Object.keys(journeyUpdates).length === 0) return;

    await this.dataSource.query(
      `INSERT INTO public.member_journeys (tenant_id, user_id, is_baptized, baptism_date, salvation_date, interests, skills, discipleship_track)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (tenant_id, user_id) DO UPDATE SET
         is_baptized = COALESCE($3, member_journeys.is_baptized),
         baptism_date = COALESCE($4, member_journeys.baptism_date),
         salvation_date = COALESCE($5, member_journeys.salvation_date),
         interests = COALESCE($6, member_journeys.interests),
         skills = COALESCE($7, member_journeys.skills),
         discipleship_track = COALESCE($8, member_journeys.discipleship_track),
         updated_at = now()`,
      [
        tenantId,
        userId,
        journeyUpdates.is_baptized ?? null,
        journeyUpdates.baptism_date ?? null,
        journeyUpdates.salvation_date ?? null,
        journeyUpdates.interests ? journeyUpdates.interests : null,
        journeyUpdates.skills ? journeyUpdates.skills : null,
        journeyUpdates.discipleship_track ?? null,
      ],
    );
  }

  private mapFaithToTrack(faithJourney: string): string {
    switch (faithJourney) {
      case 'Just exploring': return 'exploring';
      case 'New believer': return 'foundations';
      case 'Growing in faith': return 'growth';
      case 'Mature believer': return 'maturity';
      case 'Ready to lead/serve': return 'leadership';
      default: return 'exploring';
    }
  }
}
