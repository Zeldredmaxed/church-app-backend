import { IsString, IsNotEmpty, IsNumber, IsOptional, IsObject } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Accepts both the legacy field names (nodeType / nodeConfig / label) and the
 * current frontend spec (nodeTypeKey / config / title). The service normalizes
 * before writing to the DB. Frontends can migrate at their own pace.
 */
export class WorkflowNodeDto {
  @ApiProperty({ description: 'Temporary client-side ID used for connections' })
  @IsString()
  @IsNotEmpty()
  id: string;

  @ApiPropertyOptional({ description: 'Node type identifier (legacy name)' })
  @IsOptional()
  @IsString()
  nodeType?: string;

  @ApiPropertyOptional({ description: 'Node type identifier (current name)' })
  @IsOptional()
  @IsString()
  nodeTypeKey?: string;

  @ApiPropertyOptional({ description: 'Node configuration object (legacy name)' })
  @IsOptional()
  @IsObject()
  nodeConfig?: Record<string, any>;

  @ApiPropertyOptional({ description: 'Node configuration object (current name)' })
  @IsOptional()
  @IsObject()
  config?: Record<string, any>;

  @ApiProperty({ description: 'X position on canvas' })
  @IsNumber()
  positionX: number;

  @ApiProperty({ description: 'Y position on canvas' })
  @IsNumber()
  positionY: number;

  @ApiPropertyOptional({ description: 'Human-readable label (legacy name)' })
  @IsOptional()
  @IsString()
  label?: string;

  @ApiPropertyOptional({ description: 'Human-readable label (current name)' })
  @IsOptional()
  @IsString()
  title?: string;
}
