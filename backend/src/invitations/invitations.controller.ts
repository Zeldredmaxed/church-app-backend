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
import { RoleGuard, RequiresRole } from '../common/guards/role.guard';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { InvitationsService } from './invitations.service';
import { CreateInvitationDto } from './dto/create-invitation.dto';
import { SignupAndAcceptInvitationDto } from './dto/signup-and-accept.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SupabaseJwtPayload } from '../common/types/jwt-payload.type';

@ApiTags('Invitations')
@ApiBearerAuth()
@Controller('invitations')
export class InvitationsController {
  constructor(private readonly invitationsService: InvitationsService) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(RlsContextInterceptor)
  @ApiOperation({ summary: 'List pending invitations for current tenant (admin/pastor)' })
  @ApiResponse({ status: 200, description: 'Array of pending invitations' })
  getInvitations() {
    return this.invitationsService.getInvitations();
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(RlsContextInterceptor)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Send an invitation to join the current tenant' })
  @ApiResponse({ status: 201, description: 'Invitation created and email queued' })
  createInvitation(
    @CurrentUser() user: SupabaseJwtPayload,
    @Body() dto: CreateInvitationDto,
  ) {
    return this.invitationsService.createInvitation(dto, user);
  }

  @Post(':token/accept')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Accept an invitation by token (existing account). Returns { message, tenantId, role }. Call /auth/switch-tenant + /auth/refresh afterward.' })
  @ApiResponse({ status: 200, description: '{ message, tenantId, role }' })
  @ApiResponse({ status: 400, description: 'Invalid/expired token or email mismatch' })
  acceptInvitation(
    @Param('token') token: string,
    @CurrentUser() user: SupabaseJwtPayload,
  ) {
    return this.invitationsService.acceptInvitation(token, user);
  }

  /**
   * PUBLIC variant for brand-new invitees with no Shepard account.
   * Creates the Supabase auth user + accepts the invitation atomically,
   * returns session tokens for immediate login (no second call to
   * /auth/login needed).
   *
   * The auth user's email is LOCKED to the invitation's email — the
   * caller cannot redirect the invite to a different address. If an
   * account already exists for the email, returns 409 — they should
   * log in and use POST /:token/accept instead.
   *
   * Throttled 5/min/IP because it's unauthed + creates auth users.
   */
  @Post(':token/signup-and-accept')
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Create an account + accept invitation in one call (public, brand-new invitee).' })
  @ApiResponse({ status: 200, description: '{ user, tenantId, role, session } — session = { access_token, refresh_token, expires_at }' })
  @ApiResponse({ status: 409, description: 'Account already exists OR invitation already accepted' })
  @ApiResponse({ status: 410, description: 'Invitation expired or cancelled' })
  signupAndAcceptInvitation(
    @Param('token') token: string,
    @Body() dto: SignupAndAcceptInvitationDto,
  ) {
    return this.invitationsService.signupAndAcceptInvitation(token, dto);
  }

  /**
   * Cancel a pending invitation (migration 100). admin/pastor only.
   * Soft-cancel via cancelled_at; the row is preserved for audit
   * history and the accept flow refuses to use cancelled tokens.
   */
  @Delete(':id')
  @UseGuards(JwtAuthGuard, RoleGuard)
  @UseInterceptors(RlsContextInterceptor)
  @RequiresRole('admin', 'pastor')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel a pending invitation (admin/pastor only)' })
  @ApiResponse({ status: 200, description: '{ cancelled: true }' })
  @ApiResponse({ status: 404, description: 'Invitation not found in this tenant' })
  @ApiResponse({ status: 409, description: 'Invitation already accepted (cannot cancel)' })
  cancelInvitation(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: SupabaseJwtPayload,
  ) {
    return this.invitationsService.cancelInvitation(id, user);
  }
}
