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
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { MemberProfilesService } from './member-profiles.service';
import { UpdateJourneyDto } from './dto/update-journey.dto';
import { CreateNoteDto } from './dto/create-note.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SupabaseJwtPayload } from '../common/types/jwt-payload.type';

@ApiTags('Member Profiles')
@ApiBearerAuth()
@Controller('members')
@UseGuards(JwtAuthGuard)
@UseInterceptors(RlsContextInterceptor)
export class MemberProfilesController {
  constructor(private readonly memberProfilesService: MemberProfilesService) {}

  @Get(':userId/profile')
  @ApiOperation({ summary: 'Get full 360-degree member profile' })
  @ApiResponse({ status: 200, description: 'Full member profile' })
  getMemberProfile(
    @CurrentUser() user: SupabaseJwtPayload,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    const tenantId = user.app_metadata?.current_tenant_id!;
    return this.memberProfilesService.getMemberProfile(tenantId, userId);
  }

  @Put(':userId/journey')
  @ApiOperation({ summary: 'Upsert spiritual journey for a member' })
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
  @ApiOperation({ summary: 'Get pastor notes for a member' })
  @ApiResponse({ status: 200, description: 'List of notes' })
  getNotes(
    @CurrentUser() user: SupabaseJwtPayload,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    const tenantId = user.app_metadata?.current_tenant_id!;
    return this.memberProfilesService.getNotes(tenantId, userId);
  }

  @Post(':userId/notes')
  @ApiOperation({ summary: 'Add a pastor note for a member' })
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
  @ApiOperation({ summary: 'Delete a pastor note' })
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
