import { IsOptional, IsString, IsNotEmpty, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Payload for PATCH /api/posts/:id.
 * Only content is user-editable.
 * videoMuxPlaybackId is managed exclusively by the Mux webhook pipeline (Phase 2).
 * tenantId and authorId are immutable once set.
 */
export class UpdatePostDto {
  @ApiPropertyOptional({ example: 'Updated post content', maxLength: 5000 })
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'content cannot be set to an empty string' })
  @MaxLength(5000)
  content?: string;
}
