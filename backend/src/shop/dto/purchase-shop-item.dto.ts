import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class PurchaseShopItemDto {
  @ApiProperty({ description: 'Stripe PaymentMethod id from the mobile Stripe.js confirm flow.' })
  @IsString()
  paymentMethodId: string;

  @ApiProperty({ minimum: 1, maximum: 999 })
  @IsInt()
  @Min(1)
  @Max(999)
  quantity: number;

  @ApiPropertyOptional({
    type: [String],
    description: 'shop_item_options.id picked by the buyer (subset of the item options).',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID('all', { each: true })
  optionIds?: string[];
}
