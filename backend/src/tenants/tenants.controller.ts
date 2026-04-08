import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  UseGuards,
  UseInterceptors,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { TenantsService } from './tenants.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { RegisterChurchDto } from './dto/register-church.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { SuperAdminGuard } from '../common/guards/super-admin.guard';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SupabaseJwtPayload } from '../common/types/jwt-payload.type';

@ApiTags('Tenants')
@Controller('tenants')
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

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
}
