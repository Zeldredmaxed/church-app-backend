import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { CommunicationsService } from './communications.service';
import { CreateSegmentDto } from './dto/create-segment.dto';
import { CreateTemplateDto } from './dto/create-template.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { ScheduleMessageDto } from './dto/schedule-message.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SupabaseJwtPayload } from '../common/types/jwt-payload.type';

@ApiTags('Communications')
@ApiBearerAuth()
@Controller('communications')
@UseGuards(JwtAuthGuard)
@UseInterceptors(RlsContextInterceptor)
export class CommunicationsController {
  constructor(private readonly communicationsService: CommunicationsService) {}

  @Get('segments')
  @ApiOperation({ summary: 'List audience segments' })
  @ApiResponse({ status: 200, description: 'List of segments' })
  getSegments(@CurrentUser() user: SupabaseJwtPayload) {
    const tenantId = user.app_metadata?.current_tenant_id!;
    return this.communicationsService.getSegments(tenantId);
  }

  @Post('segments')
  @ApiOperation({ summary: 'Create an audience segment' })
  @ApiResponse({ status: 201, description: 'Segment created' })
  createSegment(
    @CurrentUser() user: SupabaseJwtPayload,
    @Body() dto: CreateSegmentDto,
  ) {
    const tenantId = user.app_metadata?.current_tenant_id!;
    return this.communicationsService.createSegment(tenantId, dto, user.sub);
  }

  @Post('segment-preview')
  @ApiOperation({ summary: 'Preview segment matched count' })
  @ApiResponse({ status: 200, description: 'Matched member count' })
  previewSegment(
    @CurrentUser() user: SupabaseJwtPayload,
    @Body() body: { rules: Record<string, any> },
  ) {
    const tenantId = user.app_metadata?.current_tenant_id!;
    return this.communicationsService.previewSegment(tenantId, body.rules);
  }

  @Get('templates')
  @ApiOperation({ summary: 'List message templates' })
  @ApiResponse({ status: 200, description: 'List of templates' })
  getTemplates(@CurrentUser() user: SupabaseJwtPayload) {
    const tenantId = user.app_metadata?.current_tenant_id!;
    return this.communicationsService.getTemplates(tenantId);
  }

  @Post('templates')
  @ApiOperation({ summary: 'Create a message template' })
  @ApiResponse({ status: 201, description: 'Template created' })
  createTemplate(
    @CurrentUser() user: SupabaseJwtPayload,
    @Body() dto: CreateTemplateDto,
  ) {
    const tenantId = user.app_metadata?.current_tenant_id!;
    return this.communicationsService.createTemplate(tenantId, dto, user.sub);
  }

  @Post('send')
  @ApiOperation({ summary: 'Send a message' })
  @ApiResponse({ status: 201, description: 'Message sent' })
  sendMessage(
    @CurrentUser() user: SupabaseJwtPayload,
    @Body() dto: SendMessageDto,
  ) {
    const tenantId = user.app_metadata?.current_tenant_id!;
    return this.communicationsService.sendMessage(tenantId, dto, user.sub);
  }

  @Post('schedule')
  @ApiOperation({ summary: 'Schedule a message for later' })
  @ApiResponse({ status: 201, description: 'Message scheduled' })
  scheduleMessage(
    @CurrentUser() user: SupabaseJwtPayload,
    @Body() dto: ScheduleMessageDto,
  ) {
    const tenantId = user.app_metadata?.current_tenant_id!;
    return this.communicationsService.scheduleMessage(tenantId, dto, user.sub);
  }

  @Get('history')
  @ApiOperation({ summary: 'Get sent messages history' })
  @ApiResponse({ status: 200, description: 'Paginated message history' })
  getHistory(
    @CurrentUser() user: SupabaseJwtPayload,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    const tenantId = user.app_metadata?.current_tenant_id!;
    const parsedLimit = Math.min(Math.max(parseInt(limit ?? '20', 10) || 20, 1), 100);
    return this.communicationsService.getHistory(tenantId, parsedLimit, cursor);
  }

  @Get('analytics')
  @ApiOperation({ summary: 'Get communications analytics' })
  @ApiResponse({ status: 200, description: 'Analytics summary' })
  getAnalytics(@CurrentUser() user: SupabaseJwtPayload) {
    const tenantId = user.app_metadata?.current_tenant_id!;
    return this.communicationsService.getAnalytics(tenantId);
  }
}
