import {
  Controller,
  Get,
  Put,
  Post,
  Delete,
  Body,
  Param,
  ParseUUIDPipe,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { OnboardingService } from './onboarding.service';
import { UpdateFormDto } from './dto/update-form.dto';
import { SubmitResponsesDto } from './dto/submit-responses.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SupabaseJwtPayload } from '../common/types/jwt-payload.type';

/**
 * Admin endpoints — require JWT authentication.
 * Uses service-role DataSource (not RLS) because form management
 * is admin-only and responses are cross-member.
 */
@ApiTags('Onboarding (Admin)')
@ApiBearerAuth()
@Controller('onboarding')
@UseGuards(JwtAuthGuard)
export class OnboardingAdminController {
  constructor(private readonly onboardingService: OnboardingService) {}

  @Get('field-library')
  @ApiOperation({ summary: 'Get all available onboarding fields grouped by category' })
  getFieldLibrary() {
    return this.onboardingService.getFieldLibrary();
  }

  @Get('form')
  @ApiOperation({ summary: 'Get the current church onboarding form' })
  getForm(@CurrentUser() user: SupabaseJwtPayload) {
    const tenantId = user.app_metadata?.current_tenant_id;
    if (!tenantId) return null;
    return this.onboardingService.getForm(tenantId);
  }

  @Put('form')
  @ApiOperation({ summary: 'Create or update the onboarding form' })
  updateForm(
    @Body() dto: UpdateFormDto,
    @CurrentUser() user: SupabaseJwtPayload,
  ) {
    const tenantId = user.app_metadata?.current_tenant_id;
    if (!tenantId) return null;
    return this.onboardingService.createOrUpdateForm(tenantId, dto, user.sub);
  }

  @Delete('form')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete the onboarding form' })
  deleteForm(@CurrentUser() user: SupabaseJwtPayload) {
    const tenantId = user.app_metadata?.current_tenant_id;
    if (!tenantId) return null;
    return this.onboardingService.deleteForm(tenantId);
  }

  @Get('responses')
  @ApiOperation({ summary: 'Get all submitted onboarding responses (admin)' })
  getResponses(@CurrentUser() user: SupabaseJwtPayload) {
    const tenantId = user.app_metadata?.current_tenant_id;
    if (!tenantId) return [];
    return this.onboardingService.getResponses(tenantId);
  }

  @Get('responses/:userId')
  @ApiOperation({ summary: 'Get a specific member onboarding response (admin)' })
  getMemberResponse(
    @Param('userId', ParseUUIDPipe) userId: string,
    @CurrentUser() user: SupabaseJwtPayload,
  ) {
    const tenantId = user.app_metadata?.current_tenant_id;
    if (!tenantId) return null;
    return this.onboardingService.getResponses(tenantId, userId);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get onboarding response statistics' })
  getStats(@CurrentUser() user: SupabaseJwtPayload) {
    const tenantId = user.app_metadata?.current_tenant_id;
    if (!tenantId) return null;
    return this.onboardingService.getResponseStats(tenantId);
  }
}

/**
 * Public endpoints — no auth required.
 * Used during the signup flow before the user has a JWT.
 */
@ApiTags('Onboarding (Public)')
@Controller('onboarding')
export class OnboardingPublicController {
  constructor(private readonly onboardingService: OnboardingService) {}

  @Get(':tenantId/form')
  @ApiOperation({ summary: 'Get the public onboarding form for signup (no auth)' })
  getPublicForm(@Param('tenantId', ParseUUIDPipe) tenantId: string) {
    return this.onboardingService.getPublicForm(tenantId);
  }

  @Post(':tenantId/submit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Submit onboarding responses (called during signup)' })
  async submitResponses(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Body() dto: SubmitResponsesDto,
  ) {
    // Look up active form
    const form = await this.onboardingService.getPublicForm(tenantId);
    if (!form) return { submitted: false, reason: 'No active onboarding form' };

    return this.onboardingService.submitResponses(tenantId, dto.userId, form.id, dto.responses);
  }
}
