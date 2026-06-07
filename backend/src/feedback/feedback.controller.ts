import {
  Controller, Get, Post, Patch, Delete,
  Body, Param, Query, ParseUUIDPipe,
  UseGuards, UseInterceptors, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { FeedbackService } from './feedback.service';
import { CreateFeedbackDto } from './dto/create-feedback.dto';
import { UpdateFeedbackDto } from './dto/update-feedback.dto';
import { TriageFeedbackDto } from './dto/triage-feedback.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { SuperAdminGuard } from '../common/guards/super-admin.guard';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SupabaseJwtPayload } from '../common/types/jwt-payload.type';

@ApiTags('Feedback')
@ApiBearerAuth()
@Controller('feedback')
@UseGuards(JwtAuthGuard)
@UseInterceptors(RlsContextInterceptor)
export class FeedbackController {
  constructor(private readonly feedbackService: FeedbackService) {}

  /**
   * Super-admin cross-tenant triage queue (migration 104). Returns
   * every open/in-progress feedback item across ALL tenants, sorted
   * by priority (critical → low) then created_at ASC. Powers the
   * "check the bug logs" workflow.
   *
   * MUST be declared BEFORE any @Get(':id') / @Patch(':id') routes —
   * NestJS route matching is order-sensitive and `triage` would
   * otherwise collide with the param route.
   *
   * Optional filters: ?status= ?category= ?priority= ?limit=
   *   status: open | in_progress | completed | closed | all
   *           (default: open + in_progress)
   *   category: frontend | backend | admin | unknown | untriaged
   *   priority: low | medium | high | critical
   *   limit: 1-500 (default 100)
   */
  @Get('triage')
  @UseGuards(SuperAdminGuard)
  @ApiOperation({ summary: 'Cross-tenant triage queue (super-admin only)' })
  @ApiResponse({ status: 200, description: '{ totalUntriaged, count, items: [...] }' })
  listForTriage(
    @Query('status') status?: 'open' | 'in_progress' | 'completed' | 'closed' | 'all',
    @Query('category') category?: 'frontend' | 'backend' | 'admin' | 'unknown' | 'untriaged',
    @Query('priority') priority?: 'low' | 'medium' | 'high' | 'critical',
    @Query('limit') limit?: string,
  ) {
    return this.feedbackService.listAllForTriage({
      status,
      category,
      priority,
      limit: limit ? Math.max(1, Math.min(500, Number(limit))) : undefined,
    });
  }

  /** Super-admin: mark a feedback item triaged. Stamps triaged_at + triaged_by. */
  @Post(':id/triage')
  @UseGuards(SuperAdminGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Triage a feedback item (super-admin only)' })
  @ApiResponse({ status: 200, description: 'Updated feedback row with triage state' })
  @ApiResponse({ status: 400, description: 'Body must include at least one triage field' })
  triage(
    @CurrentUser() user: SupabaseJwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TriageFeedbackDto,
  ) {
    return this.feedbackService.triageFeedback(id, user.sub, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List feedback for current tenant (optional ?type= filter)' })
  @ApiResponse({ status: 200, description: '{ data: FeedbackItem[] }' })
  getFeedback(
    @CurrentUser() user: SupabaseJwtPayload,
    @Query('type') type?: string,
  ) {
    return this.feedbackService.getFeedback(user.app_metadata?.current_tenant_id!, type);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Submit feedback (node request, bug report, or feature request)' })
  @ApiResponse({ status: 201, description: 'Created feedback item (includes optional screenshotUrls + deviceInfo per migration 104)' })
  createFeedback(
    @CurrentUser() user: SupabaseJwtPayload,
    @Body() dto: CreateFeedbackDto,
  ) {
    return this.feedbackService.createFeedback(
      user.app_metadata?.current_tenant_id!,
      user.sub,
      dto,
    );
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update feedback status (admin only)' })
  @ApiResponse({ status: 200, description: 'Updated status' })
  updateFeedback(
    @CurrentUser() user: SupabaseJwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFeedbackDto,
  ) {
    return this.feedbackService.updateStatus(user.app_metadata?.current_tenant_id!, id, dto.status);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete feedback (admin only)' })
  deleteFeedback(
    @CurrentUser() user: SupabaseJwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.feedbackService.deleteFeedback(user.app_metadata?.current_tenant_id!, id);
  }
}
