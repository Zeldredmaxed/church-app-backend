import { IsString, IsOptional, IsIn, IsInt, IsUrl, MaxLength, Min, IsDateString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateFundraiserDto {
  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  overview?: string;

  @ApiPropertyOptional({ enum: ['Education', 'Fundraising', 'Disaster', 'Health', 'Community', 'Missions'] })
  @IsOptional()
  @IsIn(['Education', 'Fundraising', 'Disaster', 'Health', 'Community', 'Missions'])
  category?: string;

  @ApiPropertyOptional({ description: 'Target amount in cents' })
  @IsOptional()
  @IsInt()
  @Min(100)
  targetAmount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  endsAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl()
  @MaxLength(2048)
  imageUrl?: string;

  @ApiPropertyOptional({ enum: ['draft', 'active', 'paused', 'completed', 'cancelled'] })
  @IsOptional()
  @IsIn(['draft', 'active', 'paused', 'completed', 'cancelled'])
  status?: string;
}
