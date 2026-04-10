import {
  Controller, Get, Post, Patch, Delete,
  Body, Param, Query, ParseUUIDPipe,
  UseGuards, UseInterceptors, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { FeedbackService } from './feedback.service';
import { CreateFeedbackDto } from './dto/create-feedback.dto';
import { UpdateFeedbackDto } from './dto/update-feedback.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
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
  @ApiResponse({ status: 201, description: 'Created feedback item' })
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
