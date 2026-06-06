import { IsString, MaxLength, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Body for POST /api/media/finalize-image. The Matches regex enforces
 * the `tenants/<uuid>/users/<uuid>/<filename>` prefix shape — the
 * controller does the second-layer check that the prefix matches THE
 * CALLER's tenant + user. The regex alone wouldn't stop a cross-tenant
 * key; it just blocks path-traversal and obviously-malformed input.
 */
export class FinalizeImageDto {
  @ApiProperty({
    description: 'S3 object key the mobile just PUT to (returned from /api/media/presigned-url)',
    example: 'tenants/<tid>/users/<uid>/photo-1234567890.jpg',
    maxLength: 512,
  })
  @IsString()
  @MaxLength(512)
  @Matches(/^tenants\/[a-f0-9-]{36}\/users\/[a-f0-9-]{36}\//, {
    message: 'fileKey must follow tenants/<uuid>/users/<uuid>/... pattern',
  })
  fileKey: string;
}
