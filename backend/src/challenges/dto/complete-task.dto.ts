import { IsBoolean, IsInt, IsOptional, IsString, Length, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class CompleteTaskDto {
  @ApiPropertyOptional({ maxLength: 8000, description: 'Required (non-empty) for reflection tasks.' })
  @IsOptional()
  @IsString()
  @Length(0, 8000)
  reflectionText?: string;

  @ApiPropertyOptional({ description: 'Seconds the member spent on the task (scripture read timer).' })
  @IsOptional()
  @IsInt()
  @Min(0)
  secondsSpent?: number;

  @ApiPropertyOptional({
    default: true,
    description: 'Client asserts the read-timer elapsed. Server cross-checks secondsSpent against the task timer.',
  })
  @IsOptional()
  @IsBoolean()
  timerSatisfied?: boolean;
}
