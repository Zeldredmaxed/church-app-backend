import { IsString, IsNotEmpty, IsNumber, IsOptional, IsObject } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class WorkflowNodeDto {
  @ApiProperty({ description: 'Temporary client-side ID used for connections' })
  @IsString()
  @IsNotEmpty()
  id: string;

  @ApiProperty({ description: 'Node type identifier' })
  @IsString()
  @IsNotEmpty()
  nodeType: string;

  @ApiProperty({ description: 'Node configuration object' })
  @IsObject()
  nodeConfig: Record<string, any>;

  @ApiProperty({ description: 'X position on canvas' })
  @IsNumber()
  positionX: number;

  @ApiProperty({ description: 'Y position on canvas' })
  @IsNumber()
  positionY: number;

  @ApiPropertyOptional({ description: 'Human-readable label' })
  @IsOptional()
  @IsString()
  label?: string;
}
