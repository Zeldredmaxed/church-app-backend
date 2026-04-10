import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  ParseUUIDPipe,
  UseGuards,
  UseInterceptors,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { FamilyService } from './family.service';
import { SendFamilyRequestDto } from './dto/send-family-request.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SupabaseJwtPayload } from '../common/types/jwt-payload.type';

@ApiTags('Family')
@ApiBearerAuth()
@Controller('family')
@UseGuards(JwtAuthGuard)
@UseInterceptors(RlsContextInterceptor)
export class FamilyController {
  constructor(private readonly familyService: FamilyService) {}

  // ── Static routes MUST come before :userId param routes ──

  @Post('request')
  @ApiOperation({ summary: 'Send a family connection request' })
  @ApiResponse({ status: 201, description: 'Request sent, notification dispatched' })
  sendRequest(
    @Body() dto: SendFamilyRequestDto,
    @CurrentUser() user: SupabaseJwtPayload,
  ) {
    const tenantId = user.app_metadata?.current_tenant_id!;
    return this.familyService.sendRequest(tenantId, user.sub, dto.targetUserId, dto.relationship);
  }

  @Get('requests')
  @ApiOperation({ summary: 'Get all pending family requests (sent and received)' })
  getRequests(@CurrentUser() user: SupabaseJwtPayload) {
    const tenantId = user.app_metadata?.current_tenant_id!;
    return this.familyService.getRequests(tenantId, user.sub);
  }

  @Post('requests/:id/accept')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Accept a family connection request (triggers inference engine)' })
  acceptRequest(
    @Param('id', ParseUUIDPipe) requestId: string,
    @CurrentUser() user: SupabaseJwtPayload,
  ) {
    const tenantId = user.app_metadata?.current_tenant_id!;
    return this.familyService.acceptRequest(tenantId, user.sub, requestId);
  }

  @Post('requests/:id/decline')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Decline a family connection request' })
  declineRequest(
    @Param('id', ParseUUIDPipe) requestId: string,
    @CurrentUser() user: SupabaseJwtPayload,
  ) {
    const tenantId = user.app_metadata?.current_tenant_id!;
    return this.familyService.declineRequest(tenantId, user.sub, requestId);
  }

  // ── Parameterized routes ──

  @Get(':userId/tree')
  @ApiOperation({ summary: 'Get structured family tree for a member' })
  getFamilyTree(
    @CurrentUser() user: SupabaseJwtPayload,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    const tenantId = user.app_metadata?.current_tenant_id!;
    return this.familyService.getFamilyTree(tenantId, userId);
  }

  @Get(':userId')
  @ApiOperation({ summary: 'Get flat list of all family connections for a member' })
  getFlatFamily(
    @CurrentUser() user: SupabaseJwtPayload,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    const tenantId = user.app_metadata?.current_tenant_id!;
    return this.familyService.getFlatFamily(tenantId, userId);
  }

  @Delete(':userId/:familyMemberId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a family connection (cascades inferred links)' })
  removeConnection(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('familyMemberId', ParseUUIDPipe) familyMemberId: string,
    @CurrentUser() user: SupabaseJwtPayload,
  ) {
    const tenantId = user.app_metadata?.current_tenant_id!;
    return this.familyService.removeConnection(tenantId, userId, familyMemberId);
  }
}
