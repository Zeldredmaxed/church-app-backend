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
  BadRequestException,
  ParseIntPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { GivingService } from './giving.service';
import { DonateDto } from './dto/donate.dto';
import { CreateFundDto } from './dto/create-fund.dto';
import { CreateBatchDto } from './dto/create-batch.dto';
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

  @Get('giving/kpis')
  @ApiOperation({ summary: 'Get giving KPI metrics for dashboard' })
  @ApiResponse({ status: 200, description: 'Giving KPIs: totalGiving, thisMonth, pendingCount, uniqueDonors' })
  getGivingKpis(@CurrentUser() user: SupabaseJwtPayload) {
    const tenantId = user.app_metadata?.current_tenant_id;
    if (!tenantId) throw new BadRequestException('No tenant context');
    return this.givingService.getGivingKpis(tenantId);
  }

  @Get('giving/donors')
  @ApiOperation({ summary: 'List unique donors for current tenant' })
  @ApiResponse({ status: 200, description: 'Array of donor profiles' })
  getDonors(@CurrentUser() user: SupabaseJwtPayload) {
    const tenantId = user.app_metadata?.current_tenant_id;
    if (!tenantId) throw new BadRequestException('No tenant context');
    return this.givingService.getDonors(tenantId);
  }

  @Get('giving/funds')
  @ApiOperation({ summary: 'List active giving funds' })
  @ApiResponse({ status: 200, description: 'Array of giving funds' })
  getFunds(@CurrentUser() user: SupabaseJwtPayload) {
    const tenantId = user.app_metadata?.current_tenant_id;
    if (!tenantId) throw new BadRequestException('No tenant context');
    return this.givingService.getFunds(tenantId);
  }

  @Post('giving/funds')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new giving fund' })
  @ApiResponse({ status: 201, description: 'Fund created' })
  createFund(
    @CurrentUser() user: SupabaseJwtPayload,
    @Body() dto: CreateFundDto,
  ) {
    const tenantId = user.app_metadata?.current_tenant_id;
    if (!tenantId) throw new BadRequestException('No tenant context');
    return this.givingService.createFund(tenantId, dto);
  }

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
    const parsedLimit = Math.min(Math.max(parseInt(limit ?? '20', 10) || 20, 1), 100);
    return this.givingService.getMyTransactions(cursor, parsedLimit);
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
    const parsedLimit = Math.min(Math.max(parseInt(limit ?? '20', 10) || 20, 1), 100);
    return this.givingService.getTenantTransactions(tenantId, cursor, parsedLimit);
  }

  // ─── Batch Entry (Cash/Check) ───

  @Post('giving/batch')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Record a batch of offline donations (cash/check)' })
  @ApiResponse({ status: 201, description: 'Batch created with all transactions' })
  createBatch(
    @CurrentUser() user: SupabaseJwtPayload,
    @Body() dto: CreateBatchDto,
  ) {
    const tenantId = user.app_metadata?.current_tenant_id;
    if (!tenantId) throw new BadRequestException('No tenant context');
    return this.givingService.createBatch(tenantId, user.sub, dto);
  }

  @Get('giving/batches')
  @ApiOperation({ summary: 'List past giving batches for audit trail' })
  @ApiResponse({ status: 200, description: 'Array of batch summaries' })
  getBatches(@CurrentUser() user: SupabaseJwtPayload) {
    const tenantId = user.app_metadata?.current_tenant_id;
    if (!tenantId) throw new BadRequestException('No tenant context');
    return this.givingService.getBatches(tenantId);
  }

  // ─── Giving Statements ───

  @Get('giving/statements/:userId')
  @ApiOperation({ summary: 'Generate giving statement for a donor (tax purposes)' })
  @ApiResponse({ status: 200, description: 'Structured statement data for PDF rendering' })
  getGivingStatement(
    @Param('userId', ParseUUIDPipe) donorUserId: string,
    @Query('year') year: string,
    @CurrentUser() user: SupabaseJwtPayload,
  ) {
    const tenantId = user.app_metadata?.current_tenant_id;
    if (!tenantId) throw new BadRequestException('No tenant context');
    const parsedYear = parseInt(year, 10) || new Date().getFullYear();
    return this.givingService.getGivingStatement(tenantId, donorUserId, parsedYear);
  }
}
