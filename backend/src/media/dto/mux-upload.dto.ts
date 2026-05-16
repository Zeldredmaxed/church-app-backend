import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class MuxUploadDto {
  @ApiPropertyOptional({
    description:
      'CORS origin for the signed upload URL. Native mobile clients can omit (defaults to *). Web clients must pass their origin.',
    example: 'https://app.shepardapp.com',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  corsOrigin?: string;
}
