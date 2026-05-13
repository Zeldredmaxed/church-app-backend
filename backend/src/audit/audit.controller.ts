import { BadRequestException, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RoleGuard, RequiresRole } from '../common/guards/role.guard';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SupabaseJwtPayload } from '../common/types/jwt-payload.type';
import { AuditService } from './audit.service';
import { ListAuditLogDto } from './dto/list-audit-log.dto';

@ApiTags('Admin / Audit Log')
@ApiBearerAuth()
@Controller('admin/audit-log')
@UseGuards(JwtAuthGuard, RoleGuard)
@RequiresRole('admin', 'pastor')
@UseInterceptors(RlsContextInterceptor)
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  @ApiOperation({
    summary: 'List admin audit log entries (admin/pastor only)',
    description: 'Cursor-paginated, reverse-chronological. All filters compose (AND). Tenant-scoped automatically.',
  })
  @ApiResponse({ status: 200, description: '{ entries: [...], nextCursor: string | null }' })
  list(@Query() query: ListAuditLogDto, @CurrentUser() user: SupabaseJwtPayload) {
    const tenantId = user.app_metadata?.current_tenant_id;
    if (!tenantId) throw new BadRequestException('No current tenant');
    return this.auditService.list(query, tenantId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single audit entry (includes IP + user-agent)' })
  async getOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SupabaseJwtPayload) {
    const tenantId = user.app_metadata?.current_tenant_id;
    if (!tenantId) throw new BadRequestException('No current tenant');
    const entry = await this.auditService.getOne(id, tenantId);
    if (!entry) throw new NotFoundException('Audit entry not found');
    return { entry };
  }
}
