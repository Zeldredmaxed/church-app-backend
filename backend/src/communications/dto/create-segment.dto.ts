import { IsString, IsNotEmpty, IsObject } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateSegmentDto {
  @ApiProperty({ example: 'Active Members' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: { minCheckIns: 3, period: '90days' } })
  @IsObject()
  @IsNotEmpty()
  rules: Record<string, any>;
}
