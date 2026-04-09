import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { CareCasesService } from './care-cases.service';
import { CreateCareCaseDto } from './dto/create-care-case.dto';
import { UpdateCareCaseDto } from './dto/update-care-case.dto';
import { CreateCareNoteDto } from './dto/create-care-note.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SupabaseJwtPayload } from '../common/types/jwt-payload.type';

@ApiTags('Care Cases')
@ApiBearerAuth()
@Controller('care-cases')
@UseGuards(JwtAuthGuard)
@UseInterceptors(RlsContextInterceptor)
export class CareCasesController {
  constructor(private readonly careCasesService: CareCasesService) {}

  @Get()
  @ApiOperation({ summary: 'List care cases with optional filters and pagination' })
  @ApiResponse({ status: 200, description: 'Paginated list of care cases' })
  getCases(
    @CurrentUser() user: SupabaseJwtPayload,
    @Query('status') status?: string,
    @Query('priority') priority?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    const tenantId = user.app_metadata?.current_tenant_id!;
    const parsedLimit = Math.min(Math.max(parseInt(limit ?? '20', 10) || 20, 1), 100);
    return this.careCasesService.getCases(tenantId, { status, priority }, parsedLimit, cursor);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new care case' })
  @ApiResponse({ status: 201, description: 'Care case created' })
  createCase(
    @CurrentUser() user: SupabaseJwtPayload,
    @Body() dto: CreateCareCaseDto,
  ) {
    const tenantId = user.app_metadata?.current_tenant_id!;
    return this.careCasesService.createCase(tenantId, dto, user.sub);
  }

  @Get('kpis')
  @ApiOperation({ summary: 'Get care case KPI counts' })
  @ApiResponse({ status: 200, description: 'Care case KPIs' })
  getCareKpis(@CurrentUser() user: SupabaseJwtPayload) {
    const tenantId = user.app_metadata?.current_tenant_id!;
    return this.careCasesService.getCareKpis(tenantId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single care case by ID' })
  @ApiResponse({ status: 200, description: 'Care case details with note count' })
  getCase(
    @CurrentUser() user: SupabaseJwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const tenantId = user.app_metadata?.current_tenant_id!;
    return this.careCasesService.getCase(tenantId, id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update a care case' })
  @ApiResponse({ status: 200, description: 'Care case updated' })
  updateCase(
    @CurrentUser() user: SupabaseJwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCareCaseDto,
  ) {
    const tenantId = user.app_metadata?.current_tenant_id!;
    return this.careCasesService.updateCase(tenantId, id, dto);
  }

  @Get(':id/timeline')
  @ApiOperation({ summary: 'Get timeline (notes) for a care case' })
  @ApiResponse({ status: 200, description: 'List of care notes' })
  getTimeline(
    @CurrentUser() user: SupabaseJwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const tenantId = user.app_metadata?.current_tenant_id!;
    return this.careCasesService.getTimeline(tenantId, id);
  }

  @Post(':id/notes')
  @ApiOperation({ summary: 'Add a note to a care case' })
  @ApiResponse({ status: 201, description: 'Care note added' })
  addNote(
    @CurrentUser() user: SupabaseJwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateCareNoteDto,
  ) {
    const tenantId = user.app_metadata?.current_tenant_id!;
    return this.careCasesService.addNote(tenantId, id, dto, user.sub);
  }
}
