/**
 * Profile-completeness public contract.
 *
 * These types define the response shape for /api/users/me/profile-completeness
 * AND the body of any 400 thrown by ProfileCompletenessService.require(...).
 *
 * Mobile + admin clients should rely on the constants and types in this
 * file — DO NOT inline literal strings like 'PROFILE_INCOMPLETE' or
 * 'volunteer' at the call site.
 */

/** Discriminator for which gate failed / which set was queried. */
export type RequirementSetKey = 'core' | 'volunteer' | 'child_pickup' | 'group_leader';

/**
 * Shape of one missing field in the response. `field` is the camelCase
 * profile key (matches PATCH /api/users/me column names where applicable);
 * `label` is the human-readable string the mobile renders.
 */
export interface MissingField {
  field: string;
  label: string;
}

/** One requirement set's evaluation result. */
export interface RequirementSetResult {
  complete: boolean;
  missing: MissingField[];
}

/** Response shape for GET /api/users/me/profile-completeness */
export interface ProfileCompletenessResponse {
  sets: Record<RequirementSetKey, RequirementSetResult>;
}

/**
 * 400 BadRequest body thrown by ProfileCompletenessService.require()
 * and any endpoint that gates on a requirement set.
 *
 *   {
 *     "statusCode": 400,
 *     "message": "Profile incomplete",
 *     "code": "PROFILE_INCOMPLETE",
 *     "requirementSet": "volunteer",
 *     "missing": [{ "field": "address", "label": "Mailing address" }]
 *   }
 *
 * `code` is the stable discriminator clients should match on (literal
 * string PROFILE_INCOMPLETE_CODE below) — do NOT match on `message`.
 */
export interface ProfileIncompleteErrorBody {
  statusCode: 400;
  message: 'Profile incomplete';
  code: typeof PROFILE_INCOMPLETE_CODE;
  requirementSet: RequirementSetKey;
  missing: MissingField[];
}

export const PROFILE_INCOMPLETE_CODE = 'PROFILE_INCOMPLETE' as const;
