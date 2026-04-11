import { IsString, IsOptional, IsUUID, MaxLength, IsUrl, ValidateIf, Matches } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Payload for POST /api/posts/:postId/comments.
 * postId, tenantId, and authorId are all derived server-side and excluded here.
 *
 * At least one of `content` or `mediaUrl` must be provided.
 * Validation of this constraint is handled in the service layer.
 */
export class CreateCommentDto {
  @ApiPropertyOptional({ example: 'Great post!', maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  content?: string;

  @ApiPropertyOptional({ description: 'Image URL from the media upload pipeline (presigned-url → S3).' })
  @IsOptional()
  @IsUrl({}, { message: 'mediaUrl must be a valid URL' })
  @MaxLength(2048)
  @Matches(/\.(jpg|jpeg|png|gif|webp)(\?.*)?$/i, {
    message: 'mediaUrl must point to an image file (jpg, jpeg, png, gif, webp)',
  })
  mediaUrl?: string;

  @ApiPropertyOptional({ description: 'User IDs to mention in this comment. Each receives a notification.' })
  @IsOptional()
  @IsUUID('4', { each: true })
  mentionedUserIds?: string[];

  @ApiPropertyOptional({ description: 'Parent comment ID for threaded replies. Omit for top-level comments.' })
  @IsOptional()
  @IsUUID()
  parentId?: string;
}
