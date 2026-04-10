import { IsBoolean, IsOptional, IsString, IsArray, ValidateNested, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';

export class OnboardingFormFieldDto {
  @ApiProperty({ description: 'Field key — matches FIELD_LIBRARY key or custom key like "custom_1"' })
  @IsString()
  key: string;

  @ApiPropertyOptional({ description: 'Whether this field is required' })
  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @ApiPropertyOptional({ description: 'Field type (required for custom fields)' })
  @IsOptional()
  @IsString()
  type?: string;

  @ApiPropertyOptional({ description: 'Field label (required for custom fields)' })
  @IsOptional()
  @IsString()
  label?: string;

  @ApiPropertyOptional({ description: 'Options for select/multiselect custom fields' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  options?: string[];

  @ApiPropertyOptional({ description: 'Placeholder text for custom fields' })
  @IsOptional()
  @IsString()
  placeholder?: string;
}

export class UpdateFormDto {
  @ApiPropertyOptional({ description: 'Whether the onboarding form is active' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Welcome message shown at top of form', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  welcomeMessage?: string;

  @ApiProperty({ description: 'Array of field configurations', type: [OnboardingFormFieldDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OnboardingFormFieldDto)
  fields: OnboardingFormFieldDto[];
}
