import { PartialType } from '@nestjs/swagger';
import { CreateShopItemDto } from './create-shop-item.dto';

/**
 * All fields optional. `options`, when provided, REPLACES the option set —
 * the service deletes existing rows and re-inserts. Omit the field to keep
 * existing options untouched.
 */
export class UpdateShopItemDto extends PartialType(CreateShopItemDto) {}
