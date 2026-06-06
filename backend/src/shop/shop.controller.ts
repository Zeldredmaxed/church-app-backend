import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ShopService } from './shop.service';
import { PurchaseShopItemDto } from './dto/purchase-shop-item.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { ChurchOnly } from '../common/guards/church-only.guard';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SupabaseJwtPayload } from '../common/types/jwt-payload.type';

/**
 * Public shop endpoints — every member of a tenant can browse + buy.
 * @ChurchOnly() blocks the no-church-home guest tenant from reaching here.
 */
@ApiTags('Shop')
@ApiBearerAuth()
@Controller('shop')
@UseGuards(JwtAuthGuard)
@UseInterceptors(RlsContextInterceptor)
@ChurchOnly()
export class ShopController {
  constructor(private readonly shopService: ShopService) {}

  @Get()
  @ApiOperation({ summary: 'List active shop items for the current tenant' })
  @ApiResponse({ status: 200, description: '{ data: ShopItem[], total, limit, offset }' })
  list(
    @Query('category') category?: string,
    @Query('q') q?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const parsedLimit = Math.min(Math.max(parseInt(limit ?? '20', 10) || 20, 1), 100);
    const parsedOffset = Math.max(parseInt(offset ?? '0', 10) || 0, 0);
    return this.shopService.list({
      category,
      q,
      limit: parsedLimit,
      offset: parsedOffset,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single shop item with its options' })
  @ApiResponse({ status: 200, description: 'ShopItem with stock + options[]' })
  getOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.shopService.getOne(id);
  }

  @Post(':id/purchase')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Purchase a shop item via Stripe Connect (saved PaymentMethod, off-session)',
    description:
      'Creates + confirms a PaymentIntent on the church\'s Connect account with platform fee. ' +
      'Returns the order row plus PI client_secret/next_action if Stripe needs further auth.',
  })
  @ApiResponse({ status: 201, description: '{ order }' })
  @ApiResponse({ status: 400, description: 'Out of stock, invalid options, or payment failed' })
  purchase(
    @Param('id', ParseUUIDPipe) itemId: string,
    @Body() dto: PurchaseShopItemDto,
    @CurrentUser() user: SupabaseJwtPayload,
  ) {
    if (!user?.sub) throw new BadRequestException('User context missing');
    return this.shopService.purchase(itemId, dto, user.sub);
  }
}
