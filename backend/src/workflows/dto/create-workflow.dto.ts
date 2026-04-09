import { IsString, IsNotEmpty, IsOptional, IsObject, IsArray, IsIn, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { WorkflowNodeDto } from './workflow-node.dto';
import { WorkflowConnectionDto } from './workflow-connection.dto';
import { TRIGGER_TYPES } from '../workflow-node-types';

export class CreateWorkflowDto {
  @ApiProperty({ example: 'New Member Welcome Sequence' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({ example: 'Sends a welcome email then assigns a follow-up task' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ example: 'new_member' })
  @IsString()
  @IsIn([...TRIGGER_TYPES])
  triggerType: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  triggerConfig?: Record<string, any>;

  @ApiProperty({ type: [WorkflowNodeDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WorkflowNodeDto)
  nodes: WorkflowNodeDto[];

  @ApiProperty({ type: [WorkflowConnectionDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WorkflowConnectionDto)
  connections: WorkflowConnectionDto[];
}
