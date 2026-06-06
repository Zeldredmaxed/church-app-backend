import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Query,
  Body,
  BadRequestException,
  ForbiddenException,
  UseGuards,
  UseInterceptors,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { TenantsService } from './tenants.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { RegisterChurchDto } from './dto/register-church.dto';
import { TenantSignupDto } from './dto/signup.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { SuperAdminGuard } from '../common/guards/super-admin.guard';
import { RoleGuard, RequiresRole } from '../common/guards/role.guard';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SupabaseJwtPayload } from '../common/types/jwt-payload.type';

@ApiTags('Tenants')
@Controller('tenants')
export class TenantsController {
  constructor(
    private readonly tenantsService: TenantsService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Self-service church registration — PUBLIC endpoint (no JWT required).
   * Rate-limited to 5 requests per minute to prevent abuse.
   */
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ auth: { ttl: 60000, limit: 5 } })
  @ApiOperation({ summary: 'Register a new church (self-service, no auth required)' })
  @ApiResponse({ status: 201, description: 'Church created. Returns JWT for the new admin.' })
  @ApiResponse({ status: 400, description: 'Invalid registration key' })
  @ApiResponse({ status: 409, description: 'Email or Church App ID already taken' })
  register(@Body() dto: RegisterChurchDto) {
    return this.tenantsService.register(dto);
  }

  /**
   * NEW PAID SIGNUP (migration 100). PUBLIC. Creates a Stripe Checkout
   * subscription session and returns { checkoutUrl }. The tenant + admin
   * are created server-side on checkout.session.completed (single
   * source of truth — never trust the redirect). Rate-limited (10/min)
   * — looser than /register since payment is required, but still capped
   * to prevent abuse of Stripe API + email sends.
   */
  @Post('signup')
  @HttpCode(HttpStatus.OK)
  @Throttle({ auth: { ttl: 60_000, limit: 10 } })
  @ApiOperation({ summary: 'Start paid church signup (public, returns Stripe Checkout URL)' })
  @ApiResponse({ status: 200, description: '{ checkoutUrl }' })
  async signup(@Body() dto: TenantSignupDto): Promise<{ checkoutUrl: string }> {
    // success_url → ADMIN_DASHBOARD_URL/welcome (where the magic-link
    // consumer lives). cancel_url → PUBLIC_SITE_URL/pricing (marketing
    // site). Falling back PUBLIC → ADMIN when ADMIN is unset is wrong
    // because they're different hosts; require both in prod via
    // env-var checklist.
    const adminUrl =
      this.config.get<string>('ADMIN_DASHBOARD_URL') ?? 'https://admin.shepard.love';
    const publicUrl =
      this.config.get<string>('PUBLIC_SITE_URL') ?? 'https://shepard.love';
    return this.tenantsService.startSignup(dto, {
      successUrlBase: adminUrl,
      cancelUrlBase: publicUrl,
    });
  }

  /**
   * PATCH /api/tenants/:id — church profile editing (migration 100).
   * admin/pastor only; tenant-clamped — caller can only update THEIR
   * own tenant (compared against JWT app_metadata.current_tenant_id).
   */
  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, RoleGuard)
  @UseInterceptors(RlsContextInterceptor)
  @RequiresRole('admin', 'pastor')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update church profile (admin/pastor only, own tenant)' })
  @ApiResponse({ status: 200, description: 'Updated Tenant row' })
  async updateTenant(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTenantDto,
    @CurrentUser() user: SupabaseJwtPayload,
  ) {
    const callerTenantId = user.app_metadata?.current_tenant_id;
    if (!callerTenantId) {
      throw new BadRequestException('No active tenant context');
    }
    if (callerTenantId !== id) {
      throw new ForbiddenException('You can only update your own tenant');
    }
    return this.tenantsService.updateTenant(id, user.sub, dto);
  }

  /**
   * Public church directory — no auth required.
   * Returns only safe fields (id, name, slug) for the Join/signup church picker.
   */
  @Get('public')
  @ApiOperation({ summary: 'List all churches (public, no auth required)' })
  @ApiResponse({ status: 200, description: 'Array of { id, name, slug }' })
  getPublicChurches(@Query('q') q?: string) {
    return this.tenantsService.getPublicChurches(q);
  }

  @Post()
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, SuperAdminGuard)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new church/tenant (super admin only)' })
  @ApiResponse({ status: 201, description: 'Tenant created. Call /auth/refresh for updated JWT.' })
  @ApiResponse({ status: 403, description: 'Super admin access required' })
  create(
    @Body() dto: CreateTenantDto,
    @CurrentUser() user: SupabaseJwtPayload,
  ) {
    return this.tenantsService.create(dto, user);
  }

  @Get(':id')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(RlsContextInterceptor)
  @ApiOperation({ summary: 'Get tenant details' })
  @ApiResponse({ status: 200, description: 'Tenant details' })
  @ApiResponse({ status: 404, description: 'Tenant not found or not accessible' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.tenantsService.findOne(id);
  }

  /**
   * Returns the feature flags for the user's current tenant.
   * The frontend calls this on login to determine which UI elements to show.
   */
  @Get(':id/features')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(RlsContextInterceptor)
  @ApiOperation({ summary: 'Get tenant feature flags (for frontend bootstrap)' })
  @ApiResponse({ status: 200, description: 'Tenant tier info + feature flags' })
  getFeatures(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: SupabaseJwtPayload,
  ) {
    // Use the tenant from the user's JWT context rather than the URL param
    // to prevent enumeration of other tenants' features
    const tenantId = user.app_metadata?.current_tenant_id ?? id;
    return this.tenantsService.getFeatures(tenantId);
  }

  @Get(':id/profile')
  @ApiOperation({ summary: 'Get public church profile (name, location, counts)' })
  @ApiResponse({ status: 200, description: 'Tenant public profile' })
  getProfile(@Param('id', ParseUUIDPipe) id: string) {
    return this.tenantsService.getProfile(id);
  }

  @Get(':id/analytics')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(RlsContextInterceptor)
  @ApiOperation({ summary: 'Get admin analytics (requires manage_finance or admin)' })
  @ApiResponse({ status: 200, description: 'Analytics data' })
  getAnalytics(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('range') range?: string,
  ) {
    return this.tenantsService.getAnalytics(id, range ?? '30d');
  }
}
