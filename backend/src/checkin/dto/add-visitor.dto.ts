import { IsString, IsOptional, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AddVisitorDto {
  @ApiProperty({ example: 'John Smith', description: 'Visitor name' })
  @IsString()
  name: string;

  @ApiPropertyOptional({ description: 'Optional service UUID' })
  @IsOptional()
  @IsUUID('4')
  serviceId?: string;
}
