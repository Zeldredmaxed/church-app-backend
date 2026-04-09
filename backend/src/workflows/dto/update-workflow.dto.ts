import { IsString, IsOptional, IsObject, IsArray, IsIn, IsBoolean, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { WorkflowNodeDto } from './workflow-node.dto';
import { WorkflowConnectionDto } from './workflow-connection.dto';
import { TRIGGER_TYPES } from '../workflow-node-types';

export class UpdateWorkflowDto {
  @ApiPropertyOptional({ example: 'New Member Welcome Sequence v2' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: 'new_member' })
  @IsOptional()
  @IsString()
  @IsIn([...TRIGGER_TYPES])
  triggerType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  triggerConfig?: Record<string, any>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ type: [WorkflowNodeDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WorkflowNodeDto)
  nodes?: WorkflowNodeDto[];

  @ApiPropertyOptional({ type: [WorkflowConnectionDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WorkflowConnectionDto)
  connections?: WorkflowConnectionDto[];
}
