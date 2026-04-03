import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  UseInterceptors,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { InvitationsService } from './invitations.service';
import { CreateInvitationDto } from './dto/create-invitation.dto';
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
  @ApiOperation({ summary: 'Accept an invitation by token. Call /auth/switch-tenant + /auth/refresh afterward.' })
  @ApiResponse({ status: 200, description: 'Invitation accepted. Membership created.' })
  @ApiResponse({ status: 400, description: 'Invalid/expired token or email mismatch' })
  acceptInvitation(
    @Param('token') token: string,
    @CurrentUser() user: SupabaseJwtPayload,
  ) {
    return this.invitationsService.acceptInvitation(token, user);
  }
}
