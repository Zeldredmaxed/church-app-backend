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
import { TenantsService } from './tenants.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { SuperAdminGuard } from '../common/guards/super-admin.guard';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SupabaseJwtPayload } from '../common/types/jwt-payload.type';

@ApiTags('Tenants')
@ApiBearerAuth()
@Controller('tenants')
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

  @Post()
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
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(RlsContextInterceptor)
  @ApiOperation({ summary: 'Get tenant details' })
  @ApiResponse({ status: 200, description: 'Tenant details' })
  @ApiResponse({ status: 404, description: 'Tenant not found or not accessible' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.tenantsService.findOne(id);
  }
}
