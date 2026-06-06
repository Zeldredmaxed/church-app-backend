import { Injectable, BadRequestException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  PROFILE_INCOMPLETE_CODE,
  RequirementSetKey,
  MissingField,
} from './profile-completeness.types';

/**
 * Profile-completeness gating.
 *
 * The pastor's spec: certain features (volunteer, child-pickup, group
 * leader) require the church to actually be able to reach the member.
 * If contact info is missing, the feature should refuse the action with
 * a structured "what's missing" payload the mobile can render.
 *
 * Requirement sets are hardcoded — the field list is product policy,
 * not per-tenant config. Adding a new set means editing this file +
 * adding a guard to the feature endpoint.
 *
 * Public contract (typed shape, mobile-facing): see
 * ./profile-completeness.types.ts. The 400 body always includes
 * `code: PROFILE_INCOMPLETE` so clients can stably match on it.
 */

export type RequirementSet = RequirementSetKey;

/**
 * A single requirement check. `field` is the dotted path or column we
 * surface to the mobile (used as the toggle label on the "complete your
 * profile" screen). `validate` returns true when the value satisfies
 * the requirement.
 */
interface RequirementCheck {
  field: string;
  label: string;
  validate: (row: any) => boolean;
}

const HAS_VALUE = (v: any) =>
  v !== null && v !== undefined && (typeof v !== 'string' || v.trim().length > 0);

const HAS_ADDRESS = (addr: any) =>
  !!addr && typeof addr === 'object' &&
  HAS_VALUE(addr.street) && HAS_VALUE(addr.city) && HAS_VALUE(addr.state) &&
  HAS_VALUE(addr.postalCode);

const HAS_EMERGENCY_CONTACT = (ec: any) =>
  !!ec && typeof ec === 'object' &&
  HAS_VALUE(ec.name) && HAS_VALUE(ec.phone);

const CORE: RequirementCheck[] = [
  { field: 'fullName', label: 'Full name', validate: r => HAS_VALUE(r.full_name) },
  { field: 'email', label: 'Email', validate: r => HAS_VALUE(r.email) },
  { field: 'phone', label: 'Phone number', validate: r => HAS_VALUE(r.phone) },
];

const REQUIREMENT_SETS: Record<RequirementSet, RequirementCheck[]> = {
  // The bare minimum the church needs to identify and contact a member.
  core: CORE,

  // Volunteer signup: church needs to reach them about shifts, and a
  // street address for things like background checks or T-shirt mailing.
  volunteer: [
    ...CORE,
    { field: 'address', label: 'Mailing address', validate: r => HAS_ADDRESS(r.address) },
  ],

  // Anyone authorized to pick up children (or whose kids the church
  // checks in) needs an emergency contact + full address for safety.
  child_pickup: [
    ...CORE,
    { field: 'address', label: 'Mailing address', validate: r => HAS_ADDRESS(r.address) },
    { field: 'emergencyContact', label: 'Emergency contact (name + phone)', validate: r => HAS_EMERGENCY_CONTACT(r.emergency_contact) },
    { field: 'dateOfBirth', label: 'Date of birth (for ID matching)', validate: r => HAS_VALUE(r.date_of_birth) },
  ],

  // Group leaders rep the church publicly; secondary phone helps members
  // reach them off-hours when their main phone is on do-not-disturb.
  group_leader: [
    ...CORE,
    { field: 'address', label: 'Mailing address', validate: r => HAS_ADDRESS(r.address) },
    { field: 'phoneSecondary', label: 'Secondary phone number', validate: r => HAS_VALUE(r.phone_secondary) },
  ],
};

@Injectable()
export class ProfileCompletenessService {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Returns completeness state for every requirement set. Used by the
   * mobile's "complete your profile" screen to render checkmarks +
   * missing-field prompts.
   */
  async getAll(userId: string) {
    const row = await this.loadUser(userId);
    const sets: Record<string, { complete: boolean; missing: Array<{ field: string; label: string }> }> = {};
    for (const setName of Object.keys(REQUIREMENT_SETS) as RequirementSet[]) {
      sets[setName] = this.evaluate(REQUIREMENT_SETS[setName], row);
    }
    return { sets };
  }

  /**
   * Returns completeness state for one requirement set.
   */
  async getOne(userId: string, set: RequirementSet) {
    const row = await this.loadUser(userId);
    return this.evaluate(REQUIREMENT_SETS[set], row);
  }

  /**
   * Asserts a requirement set is satisfied. Throws BadRequestException
   * with a structured payload the mobile can render directly. Call from
   * feature endpoints that gate on profile completeness.
   *
   *   await this.completeness.require(user.sub, 'volunteer');
   */
  async require(userId: string, set: RequirementSet): Promise<void> {
    const result = await this.getOne(userId, set);
    if (!result.complete) {
      // Shape matches ProfileIncompleteErrorBody in
      // ./profile-completeness.types.ts. Keep these keys stable — the
      // mobile + admin dashboards hard-match `code` and walk
      // `missing[].field` / `missing[].label`.
      throw new BadRequestException({
        message: 'Profile incomplete',
        code: PROFILE_INCOMPLETE_CODE,
        requirementSet: set,
        missing: result.missing as MissingField[],
      });
    }
  }

  private async loadUser(userId: string) {
    const [row] = await this.dataSource.query(
      `SELECT id, email, full_name, phone, phone_secondary, address,
              date_of_birth, emergency_contact
       FROM public.users WHERE id = $1`,
      [userId],
    );
    if (!row) throw new BadRequestException('User not found');
    return row;
  }

  private evaluate(checks: RequirementCheck[], row: any) {
    const missing = checks
      .filter(c => !c.validate(row))
      .map(c => ({ field: c.field, label: c.label }));
    return { complete: missing.length === 0, missing };
  }
}
