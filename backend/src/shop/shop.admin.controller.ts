import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ShopService } from './shop.service';
import { CreateShopItemDto } from './dto/create-shop-item.dto';
import { UpdateShopItemDto } from './dto/update-shop-item.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RoleGuard, RequiresRole } from '../common/guards/role.guard';
import { ChurchOnly } from '../common/guards/church-only.guard';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SupabaseJwtPayload } from '../common/types/jwt-payload.type';

/**
 * Admin shop endpoints — admin/pastor only. Mounted at /api/admin/shop.
 * Deletes are soft (is_active = false) so the order ledger stays intact.
 */
@ApiTags('Shop (admin)')
@ApiBearerAuth()
@Controller('admin/shop')
@UseGuards(JwtAuthGuard, RoleGuard)
@RequiresRole('admin', 'pastor')
@UseInterceptors(RlsContextInterceptor)
@ChurchOnly()
export class ShopAdminController {
  constructor(private readonly shopService: ShopService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a shop item (admin/pastor)' })
  @ApiResponse({ status: 201, description: 'Created shop item with options[]' })
  create(@Body() dto: CreateShopItemDto, @CurrentUser() user: SupabaseJwtPayload) {
    if (!user?.sub) throw new BadRequestException('User context missing');
    return this.shopService.create(dto, user.sub);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update a shop item (admin/pastor)',
    description: 'Passing `options` replaces the entire option set; omit to keep existing options.',
  })
  @ApiResponse({ status: 200, description: 'Updated shop item with options[]' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateShopItemDto,
  ) {
    return this.shopService.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Remove a shop item (admin/pastor)',
    description: 'Soft delete — flips is_active = false. Order history preserved.',
  })
  @ApiResponse({ status: 200, description: '{ id, deleted: true }' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.shopService.remove(id);
  }
}
