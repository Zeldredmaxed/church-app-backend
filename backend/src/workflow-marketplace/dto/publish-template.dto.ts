import { IsString, IsNotEmpty, IsOptional, IsArray, IsIn, IsNumber, Min, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const TEMPLATE_CATEGORIES = [
  'general', 'onboarding', 'engagement', 'giving', 'care',
  'events', 'volunteers', 'communications', 'reports', 'spiritual_growth',
] as const;

export class PublishTemplateDto {
  @ApiProperty({ example: 'New Member Welcome Flow' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: 'Automatically welcomes new members with email and follow-up' })
  @IsString()
  @IsNotEmpty()
  description: string;

  @ApiProperty({ example: 'onboarding', enum: TEMPLATE_CATEGORIES })
  @IsString()
  @IsIn([...TEMPLATE_CATEGORIES])
  category: string;

  @ApiPropertyOptional({ example: ['new-member', 'email'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({ example: 0, default: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  priceCents?: number;

  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000', description: 'The workflow to publish as a template' })
  @IsUUID()
  workflowId: string;
}
