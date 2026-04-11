import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  ParseUUIDPipe,
  UseGuards,
  UseInterceptors,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { DataSource } from 'typeorm';
import { MemberProfilesService } from './member-profiles.service';
import { UpdateJourneyDto } from './dto/update-journey.dto';
import { CreateNoteDto } from './dto/create-note.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RoleGuard, RequiresRole } from '../common/guards/role.guard';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SupabaseJwtPayload } from '../common/types/jwt-payload.type';

@ApiTags('Member Profiles')
@ApiBearerAuth()
@Controller('members')
@UseGuards(JwtAuthGuard)
@UseInterceptors(RlsContextInterceptor)
export class MemberProfilesController {
  constructor(
    private readonly memberProfilesService: MemberProfilesService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Helper: check if caller is admin/pastor/accountant in current tenant.
   * Returns true if they have a privileged role.
   */
  private async isPrivilegedUser(userId: string, tenantId: string): Promise<boolean> {
    const [membership] = await this.dataSource.query(
      `SELECT role FROM public.tenant_memberships WHERE user_id = $1 AND tenant_id = $2`,
      [userId, tenantId],
    );
    return ['admin', 'pastor', 'accountant'].includes(membership?.role);
  }

  @Get(':userId/profile')
  @ApiOperation({ summary: 'Get full 360-degree member profile (self or admin/pastor only)' })
  @ApiResponse({ status: 200, description: 'Full member profile' })
  async getMemberProfile(
    @CurrentUser() user: SupabaseJwtPayload,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    const tenantId = user.app_metadata?.current_tenant_id;
    if (!tenantId) throw new BadRequestException('No tenant context');

    // Members can view their own profile; admin/pastor/accountant can view anyone's
    if (userId !== user.sub && !(await this.isPrivilegedUser(user.sub, tenantId))) {
      throw new ForbiddenException('You can only view your own profile');
    }

    return this.memberProfilesService.getMemberProfile(tenantId, userId);
  }

  @Put(':userId/journey')
  @UseGuards(RoleGuard)
  @RequiresRole('admin', 'pastor')
  @ApiOperation({ summary: 'Upsert spiritual journey for a member (admin/pastor only)' })
  @ApiResponse({ status: 200, description: 'Journey updated' })
  updateJourney(
    @CurrentUser() user: SupabaseJwtPayload,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: UpdateJourneyDto,
  ) {
    const tenantId = user.app_metadata?.current_tenant_id!;
    return this.memberProfilesService.updateJourney(tenantId, userId, dto);
  }

  @Get(':userId/notes')
  @UseGuards(RoleGuard)
  @RequiresRole('admin', 'pastor')
  @ApiOperation({ summary: 'Get pastor notes for a member (admin/pastor only)' })
  @ApiResponse({ status: 200, description: 'List of notes' })
  getNotes(
    @CurrentUser() user: SupabaseJwtPayload,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    const tenantId = user.app_metadata?.current_tenant_id!;
    return this.memberProfilesService.getNotes(tenantId, userId);
  }

  @Post(':userId/notes')
  @UseGuards(RoleGuard)
  @RequiresRole('admin', 'pastor')
  @ApiOperation({ summary: 'Add a pastor note for a member (admin/pastor only)' })
  @ApiResponse({ status: 201, description: 'Note created' })
  addNote(
    @CurrentUser() user: SupabaseJwtPayload,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: CreateNoteDto,
  ) {
    const tenantId = user.app_metadata?.current_tenant_id!;
    return this.memberProfilesService.addNote(tenantId, userId, dto, user.sub);
  }

  @Delete(':userId/notes/:noteId')
  @UseGuards(RoleGuard)
  @RequiresRole('admin', 'pastor')
  @ApiOperation({ summary: 'Delete a pastor note (admin/pastor only)' })
  @ApiResponse({ status: 200, description: 'Note deleted' })
  deleteNote(
    @CurrentUser() user: SupabaseJwtPayload,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('noteId', ParseUUIDPipe) noteId: string,
  ) {
    const tenantId = user.app_metadata?.current_tenant_id!;
    return this.memberProfilesService.deleteNote(tenantId, noteId);
  }
}
