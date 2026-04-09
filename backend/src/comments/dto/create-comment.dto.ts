import { IsString, IsNotEmpty, IsOptional, IsUUID, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Payload for POST /api/posts/:postId/comments.
 * postId, tenantId, and authorId are all derived server-side and excluded here.
 */
export class CreateCommentDto {
  @ApiProperty({ example: 'Great post!', maxLength: 2000 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  content: string;

  @ApiPropertyOptional({ description: 'Parent comment ID for threaded replies. Omit for top-level comments.' })
  @IsOptional()
  @IsUUID()
  parentId?: string;
}
