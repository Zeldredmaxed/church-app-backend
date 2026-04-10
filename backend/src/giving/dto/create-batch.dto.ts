import { IsArray, ValidateNested, IsNumber, IsString, IsOptional, IsUUID, IsIn, Min, IsDateString } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class BatchItemDto {
  @ApiPropertyOptional({ description: 'Donor user ID (omit for anonymous cash)' })
  @IsOptional()
  @IsUUID()
  donorId?: string;

  @ApiProperty({ example: 100.00, description: 'Donation amount in dollars' })
  @IsNumber()
  @Min(0.01)
  amount: number;

  @ApiPropertyOptional({ description: 'Fund ID' })
  @IsOptional()
  @IsUUID()
  fundId?: string;

  @ApiProperty({ enum: ['cash', 'check'], description: 'Payment method' })
  @IsIn(['cash', 'check'])
  method: 'cash' | 'check';

  @ApiPropertyOptional({ description: 'Check number (for check entries)' })
  @IsOptional()
  @IsString()
  checkNumber?: string;

  @ApiPropertyOptional({ description: 'Date of donation (defaults to today)' })
  @IsOptional()
  @IsDateString()
  date?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreateBatchDto {
  @ApiPropertyOptional({ description: 'Batch name/label (e.g., "Sunday 4/10 Morning Service")' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({ type: [BatchItemDto], description: 'Array of offline donation entries' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BatchItemDto)
  items: BatchItemDto[];
}
