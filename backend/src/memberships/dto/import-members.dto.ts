import { IsIn, IsOptional, IsString } from 'class-validator';

/**
 * Body for POST /api/admin/members/import. The CSV file itself rides
 * as multipart `file`; this DTO carries metadata only.
 *
 * `source` hints column-name mapping (Tithely + Breeze have different
 * conventions). 'generic' means we try a permissive header-match
 * strategy: any column matching /email/i becomes the email, etc.
 */
export class ImportMembersDto {
  @IsString()
  @IsIn(['tithely', 'breeze', 'churchteams', 'planning_center', 'generic'])
  source: 'tithely' | 'breeze' | 'churchteams' | 'planning_center' | 'generic';

  /**
   * Optional tag NAME to assign to every imported row. Defaults to
   * "Imported - Pending Invite" if omitted — this is the tag the
   * marketplace's invitation workflow listens for (member_tagged
   * trigger). Pastors can swap the tag name to fire a different
   * workflow.
   */
  @IsString()
  @IsOptional()
  assignTag?: string;
}
