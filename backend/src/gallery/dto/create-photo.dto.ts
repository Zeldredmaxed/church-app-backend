import { IsString, IsNotEmpty, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreatePhotoDto {
  @ApiProperty({ example: 'https://cdn.example.com/photos/event1.jpg' })
  @IsString()
  @IsNotEmpty()
  mediaUrl: string;

  @ApiPropertyOptional({ example: 'easter-2026' })
  @IsOptional()
  @IsString()
  album?: string;
}
