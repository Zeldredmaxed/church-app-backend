import { IsString, IsNotEmpty, MaxLength, IsOptional, IsArray, IsUUID, IsIn, IsObject, ValidateNested, IsNumber, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Normalized crop rectangle for IG/FB-style pinch-zoom-crop on video posts.
 * All four numbers are in [0..1] with origin at the top-left of the source
 * video. aspectRatio is optional metadata for the target frame so the
 * player can render letterbox-free.
 */
export class VideoCropRectDto {
  @ApiProperty({ example: 0.1, minimum: 0, maximum: 1 })
  @IsNumber()
  @Min(0)
  @Max(1)
  x: number;

  @ApiProperty({ example: 0.2, minimum: 0, maximum: 1 })
  @IsNumber()
  @Min(0)
  @Max(1)
  y: number;

  @ApiProperty({ example: 0.8, minimum: 0, maximum: 1 })
  @IsNumber()
  @Min(0)
  @Max(1)
  width: number;

  @ApiProperty({ example: 0.8, minimum: 0, maximum: 1 })
  @IsNumber()
  @Min(0)
  @Max(1)
  height: number;

  @ApiPropertyOptional({ example: 1, description: 'Target aspect ratio (width / height). 1 = square, 0.8 = 4:5.' })
  @IsOptional()
  @IsNumber()
  @Min(0.1)
  @Max(10)
  aspectRatio?: number;
}

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

  @ApiPropertyOptional({ enum: ['text', 'image', 'video'], default: 'text', description: 'Content type: text, image, or video' })
  @IsOptional()
  @IsString()
  @IsIn(['text', 'image', 'video'])
  mediaType?: string;

  @ApiPropertyOptional({ description: 'S3 URL for an attached image (from pre-signed upload)' })
  @IsOptional()
  @IsString()
  mediaUrl?: string;

  @ApiPropertyOptional({ description: 'Mux playback ID for an attached video (set directly if the upload was processed before post creation; usually omit and pass videoMuxUploadId instead).' })
  @IsOptional()
  @IsString()
  videoMuxPlaybackId?: string;

  @ApiPropertyOptional({
    description:
      'Mux Direct Upload ID returned from POST /api/media/mux-upload. The webhook will populate videoMuxPlaybackId once Mux finishes processing.',
  })
  @IsOptional()
  @IsString()
  videoMuxUploadId?: string;

  @ApiPropertyOptional({
    type: VideoCropRectDto,
    description:
      'Normalized pinch-zoom-crop rectangle. Stored on the post; playback applies it via CSS until a server-side transcode job is added.',
  })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => VideoCropRectDto)
  videoCropRect?: VideoCropRectDto;

  @ApiPropertyOptional({ enum: ['public', 'private'], default: 'public', description: 'Post visibility' })
  @IsOptional()
  @IsString()
  @IsIn(['public', 'private'])
  visibility?: 'public' | 'private';

  @ApiPropertyOptional({ type: [String], description: 'User UUIDs mentioned in the post' })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  mentions?: string[];

  @ApiPropertyOptional({
    description:
      'Badge definition the post is celebrating. Used by the "Share to feed" button on the AchievementModal. Backend verifies the caller actually earned this badge; rejects otherwise.',
  })
  @IsOptional()
  @IsUUID()
  sharedBadgeId?: string;
}
