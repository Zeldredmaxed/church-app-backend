import { IsString, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Accepts both { fromNodeId, toNodeId } (legacy) and { from, to } (current
 * frontend spec). The service normalizes before writing.
 */
export class WorkflowConnectionDto {
  @ApiPropertyOptional({ description: 'Source node ID — legacy name' })
  @IsOptional()
  @IsString()
  fromNodeId?: string;

  @ApiPropertyOptional({ description: 'Source node ID — current name' })
  @IsOptional()
  @IsString()
  from?: string;

  @ApiPropertyOptional({ description: 'Target node ID — legacy name' })
  @IsOptional()
  @IsString()
  toNodeId?: string;

  @ApiPropertyOptional({ description: 'Target node ID — current name' })
  @IsOptional()
  @IsString()
  to?: string;

  @ApiPropertyOptional({
    description:
      'Branch label emitted by the source node. For if_else use "true" or "false"; for switch_case use the matched case name or "default"; for linear nodes omit or use "default".',
  })
  @IsOptional()
  @IsString()
  branch?: string;
}
