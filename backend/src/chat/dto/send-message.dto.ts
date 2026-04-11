import { IsString, IsOptional, MaxLength, IsUrl, IsIn } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class SendMessageDto {
  @ApiPropertyOptional({ example: 'Hello everyone!', maxLength: 5000 })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  content?: string;

  @ApiPropertyOptional({ description: 'Media URL from the upload pipeline (presigned-url → S3).' })
  @IsOptional()
  @IsUrl({}, { message: 'mediaUrl must be a valid URL' })
  @MaxLength(2048)
  mediaUrl?: string;

  @ApiPropertyOptional({ description: 'Media type: image, video, or audio (voice notes).', enum: ['image', 'video', 'audio'] })
  @IsOptional()
  @IsIn(['image', 'video', 'audio'], { message: 'mediaType must be one of: image, video, audio' })
  mediaType?: 'image' | 'video' | 'audio';
}
