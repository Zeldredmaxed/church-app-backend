import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class JoinRequestDto {
  @ApiPropertyOptional({
    description: 'Optional note from the requester explaining why they want to join.',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  message?: string;
}

export class DenyRequestDto {
  @ApiPropertyOptional({
    description: 'Optional reason shown to the requester.',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
