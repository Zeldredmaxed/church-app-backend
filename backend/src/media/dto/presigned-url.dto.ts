import { IsString, IsNotEmpty, MaxLength, Matches, IsInt, Min, Max } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Request body for POST /api/media/presigned-url.
 *
 * The filename is sanitised server-side before inclusion in the S3 key.
 * contentType is validated against an allowlist of safe MIME types.
 */
export class PresignedUrlDto {
  @ApiProperty({ example: 'sermon-photo.jpg', maxLength: 255 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  filename: string;

  @ApiProperty({ example: 'image/jpeg', description: 'Supported: image/jpeg, image/png, image/gif, image/webp, video/mp4, video/quicktime, video/webm' })
  @IsString()
  @IsNotEmpty()
  @Matches(
    /^(image\/(jpeg|png|gif|webp|heic|heif)|video\/(mp4|quicktime|webm|x-msvideo))$/,
    {
      message:
        'contentType must be a supported image or video MIME type ' +
        '(e.g., image/jpeg, image/png, video/mp4)',
    },
  )
  contentType: string;

  @ApiProperty({ example: 2048576, description: 'File size in bytes. Required for storage limit enforcement.' })
  @IsInt()
  @Min(1)
  @Max(524_288_000) // 500 MB hard cap per file
  fileSize: number;
}
