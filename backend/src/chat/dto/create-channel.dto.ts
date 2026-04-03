import { IsString, IsIn, IsOptional, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateChannelDto {
  @ApiPropertyOptional({ example: 'Prayer Group', maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiProperty({ enum: ['public', 'private', 'direct'], example: 'private' })
  @IsString()
  @IsIn(['public', 'private', 'direct'])
  type: 'public' | 'private' | 'direct';
}
