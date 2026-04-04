import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
  UseGuards,
  UseInterceptors,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { GivingService } from './giving.service';
import { DonateDto } from './dto/donate.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { SupabaseJwtPayload } from '../common/types/jwt-payload.type';

@ApiTags('Giving')
@ApiBearerAuth()
@Controller()
@UseGuards(JwtAuthGuard)
@UseInterceptors(RlsContextInterceptor)
export class GivingController {
  constructor(private readonly givingService: GivingService) {}

  @Post('giving/donate')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a donation PaymentIntent (returns clientSecret for Stripe.js)' })
  @ApiResponse({ status: 201, description: '{ clientSecret, transactionId }' })
  @ApiResponse({ status: 400, description: 'Church has not set up or activated payment processing' })
  donate(
    @CurrentUser() user: SupabaseJwtPayload,
    @Body() dto: DonateDto,
  ) {
    return this.givingService.donate(dto, user.sub);
  }

  @Get('giving/transactions')
  @ApiOperation({ summary: 'Get authenticated user donation history (cursor-paginated)' })
  @ApiResponse({ status: 200, description: '{ transactions, nextCursor }' })
  getMyTransactions(
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.givingService.getMyTransactions(
      cursor,
      limit ? parseInt(limit, 10) : 20,
    );
  }

  @Get('tenants/:tenantId/transactions')
  @UseGuards(PermissionsGuard)
  @Permissions('manage_finance')
  @ApiOperation({ summary: 'Get all tenant transactions (admin/accountant, cursor-paginated)' })
  @ApiResponse({ status: 200, description: '{ transactions, nextCursor }' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions (requires manage_finance)' })
  getTenantTransactions(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.givingService.getTenantTransactions(
      tenantId,
      cursor,
      limit ? parseInt(limit, 10) : 20,
    );
  }
}
