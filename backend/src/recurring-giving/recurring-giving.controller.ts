import { Controller, Get, Post, Delete, Body, Param, ParseUUIDPipe, UseGuards, UseInterceptors, HttpCode, HttpStatus, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { RecurringGivingService } from './recurring-giving.service';
import { CreateRecurringGiftDto } from './dto/create-recurring-gift.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SupabaseJwtPayload } from '../common/types/jwt-payload.type';

@ApiTags('Recurring Giving')
@ApiBearerAuth()
@Controller('giving/recurring')
@UseGuards(JwtAuthGuard)
@UseInterceptors(RlsContextInterceptor)
export class RecurringGivingController {
  constructor(private readonly recurringGivingService: RecurringGivingService) {}

  @Get()
  @ApiOperation({ summary: 'List active recurring gifts for the current user' })
  getRecurringGifts(@CurrentUser() user: SupabaseJwtPayload) {
    return this.recurringGivingService.getRecurringGifts(user.sub);
  }

  @Get('all')
  @UseGuards(PermissionsGuard)
  @Permissions('manage_finance')
  @ApiOperation({ summary: 'List all recurring gifts for the tenant (manage_finance — includes donor names)' })
  @ApiResponse({ status: 200, description: 'Array of recurring gifts with donor names' })
  @ApiResponse({ status: 403, description: 'manage_finance permission required' })
  getAllRecurringGifts(@CurrentUser() user: SupabaseJwtPayload) {
    const tenantId = user.app_metadata?.current_tenant_id;
    if (!tenantId) throw new BadRequestException('No tenant context');
    return this.recurringGivingService.getAllRecurringGifts(tenantId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a recurring gift' })
  createRecurringGift(@Body() dto: CreateRecurringGiftDto, @CurrentUser() user: SupabaseJwtPayload) {
    return this.recurringGivingService.createRecurringGift(dto, user.sub, user.app_metadata?.current_tenant_id!);
  }

  @Post(':id/pause')
  @ApiOperation({ summary: 'Pause a recurring gift' })
  pauseGift(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SupabaseJwtPayload) {
    return this.recurringGivingService.pauseGift(id, user.sub);
  }

  @Post(':id/resume')
  @ApiOperation({ summary: 'Resume a paused recurring gift' })
  resumeGift(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SupabaseJwtPayload) {
    return this.recurringGivingService.resumeGift(id, user.sub);
  }

  @Delete(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel a recurring gift' })
  cancelGift(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SupabaseJwtPayload) {
    return this.recurringGivingService.cancelGift(id, user.sub);
  }
}
