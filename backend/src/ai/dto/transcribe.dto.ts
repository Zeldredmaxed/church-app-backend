import { IsString, IsNotEmpty, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class TranscribeDto {
  @ApiProperty({ description: 'Base64-encoded audio. Data-URL prefix is stripped if present.' })
  @IsString()
  @IsNotEmpty()
  audioBase64: string;

  @ApiPropertyOptional({ description: 'Audio MIME type. Defaults to audio/m4a.' })
  @IsOptional()
  @IsString()
  mimeType?: string;

  @ApiPropertyOptional({ description: 'Original file name (used as the filename in the multipart upload to Whisper).' })
  @IsOptional()
  @IsString()
  filename?: string;
}
