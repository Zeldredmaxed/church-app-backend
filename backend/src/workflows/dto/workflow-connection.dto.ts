import { IsString, IsNotEmpty, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class WorkflowConnectionDto {
  @ApiProperty({ description: 'Source node ID (references client-side temp ID)' })
  @IsString()
  @IsNotEmpty()
  fromNodeId: string;

  @ApiProperty({ description: 'Target node ID (references client-side temp ID)' })
  @IsString()
  @IsNotEmpty()
  toNodeId: string;

  @ApiPropertyOptional({ description: 'Branch label: true/false for conditions, default otherwise' })
  @IsOptional()
  @IsString()
  branch?: string;
}
