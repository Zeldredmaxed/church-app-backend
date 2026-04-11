import { IsString, IsNotEmpty, IsOptional, IsIn, IsInt, IsUrl, MaxLength, Min, IsDateString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateFundraiserDto {
  @ApiProperty({ example: 'Next Generation Scholars', maxLength: 200 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  @ApiProperty({ example: 'Providing scholarships for youth...', maxLength: 2000 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  overview: string;

  @ApiProperty({ enum: ['Education', 'Fundraising', 'Disaster', 'Health', 'Community', 'Missions'] })
  @IsIn(['Education', 'Fundraising', 'Disaster', 'Health', 'Community', 'Missions'])
  category: string;

  @ApiProperty({ example: 1364300, description: 'Target amount in cents' })
  @IsInt()
  @Min(100)
  targetAmount: number;

  @ApiProperty({ example: '2026-05-26T00:00:00Z', description: 'Fundraiser deadline (must be in the future)' })
  @IsDateString()
  endsAt: string;

  @ApiPropertyOptional({ description: 'Hero image URL from upload pipeline' })
  @IsOptional()
  @IsUrl()
  @MaxLength(2048)
  imageUrl?: string;

  @ApiPropertyOptional({ enum: ['draft', 'active'], default: 'active' })
  @IsOptional()
  @IsIn(['draft', 'active'])
  status?: 'draft' | 'active';
}
