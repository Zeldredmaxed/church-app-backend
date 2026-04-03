import { IsString, IsNotEmpty, MaxLength, IsOptional, IsArray, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Payload for POST /api/posts.
 *
 * Intentionally excludes tenantId and authorId — both are derived server-side
 * from the verified JWT context. A client cannot post into a different tenant
 * or impersonate a different author.
 */
export class CreatePostDto {
  @ApiProperty({ example: 'Excited for Sunday service!', maxLength: 5000 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  content: string;

  @ApiPropertyOptional({ description: 'Mux playback ID for an attached video' })
  @IsOptional()
  @IsString()
  videoMuxPlaybackId?: string;

  @ApiPropertyOptional({ type: [String], description: 'User UUIDs mentioned in the post' })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  mentions?: string[];
}
