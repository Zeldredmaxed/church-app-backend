import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ChallengeTaskInput } from './challenge-task.dto';

export class CreateChallengeDto {
  @ApiProperty({ minLength: 1, maxLength: 200 })
  @IsString()
  @Length(1, 200)
  title: string;

  @ApiPropertyOptional({ maxLength: 8000 })
  @IsOptional()
  @IsString()
  @Length(0, 8000)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(0, 1000)
  coverImageUrl?: string;

  @ApiPropertyOptional({ description: 'e.g. "reading_plan", "devotional", "habit".' })
  @IsOptional()
  @IsString()
  @Length(0, 100)
  category?: string;

  @ApiProperty({ minimum: 1, maximum: 366, description: 'Total days in the plan.' })
  @IsInt()
  @Min(1)
  @Max(366)
  durationDays: number;

  @ApiPropertyOptional({ description: 'ISO date (YYYY-MM-DD). Omit/null = self-paced; a date = fixed cohort start.' })
  @IsOptional()
  @IsDateString()
  startsOn?: string;

  @ApiPropertyOptional({ default: false, description: 'Publish immediately. Members only see published challenges.' })
  @IsOptional()
  @IsBoolean()
  isPublished?: boolean = false;

  @ApiPropertyOptional({ type: [ChallengeTaskInput], description: 'Optional inline task set authored with the challenge.' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChallengeTaskInput)
  tasks?: ChallengeTaskInput[];
}
