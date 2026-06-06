import {
  IsArray,
  IsBoolean,
  IsIn,
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

export class ShopItemOptionInput {
  @ApiProperty({ minLength: 1, maxLength: 100 })
  @IsString()
  @Length(1, 100)
  label: string;

  @ApiPropertyOptional({ default: 0, description: 'Delta added to base price (CENTS).' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000_000)
  priceDeltaCents?: number = 0;
}

export class CreateShopItemDto {
  @ApiProperty({ minLength: 1, maxLength: 200 })
  @IsString()
  @Length(1, 200)
  title: string;

  @ApiPropertyOptional({ maxLength: 4000 })
  @IsOptional()
  @IsString()
  @Length(0, 4000)
  description?: string;

  @ApiProperty({ description: 'Price in CENTS (1000 = $10.00).', minimum: 0 })
  @IsInt()
  @Min(0)
  @Max(10_000_000)
  priceCents: number;

  @ApiProperty({ enum: ['Merch', 'Events', 'Giving', 'Books', 'Media'] })
  @IsIn(['Merch', 'Events', 'Giving', 'Books', 'Media'])
  category: 'Merch' | 'Events' | 'Giving' | 'Books' | 'Media';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(0, 200)
  section?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(0, 1000)
  imageUrl?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  inStock?: boolean = true;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  hot?: boolean = false;

  @ApiPropertyOptional({ description: 'Remaining inventory; omit / null = unlimited.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  stock?: number | null;

  @ApiPropertyOptional({ type: [ShopItemOptionInput] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ShopItemOptionInput)
  options?: ShopItemOptionInput[];
}
