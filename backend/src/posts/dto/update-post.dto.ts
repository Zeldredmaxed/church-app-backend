import { IsOptional, IsString, IsNotEmpty, MaxLength, IsIn } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Payload for PATCH /api/posts/:id.
 * tenantId and authorId are immutable once set.
 * videoMuxPlaybackId is managed exclusively by the Mux webhook pipeline.
 */
export class UpdatePostDto {
  @ApiPropertyOptional({ example: 'Updated post content', maxLength: 5000 })
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'content cannot be set to an empty string' })
  @MaxLength(5000)
  content?: string;

  @ApiPropertyOptional({ enum: ['public', 'private'], description: 'Post visibility' })
  @IsOptional()
  @IsString()
  @IsIn(['public', 'private'])
  visibility?: 'public' | 'private';
}
