import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ChallengesService } from './challenges.service';
import { CreateChallengeDto } from './dto/create-challenge.dto';
import { UpdateChallengeDto } from './dto/update-challenge.dto';
import { ChallengeTaskInput, UpdateChallengeTaskDto } from './dto/challenge-task.dto';
import { ReplaceTasksDto } from './dto/replace-tasks.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RoleGuard, RequiresRole } from '../common/guards/role.guard';
import { ChurchOnly } from '../common/guards/church-only.guard';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SupabaseJwtPayload } from '../common/types/jwt-payload.type';

/**
 * Admin/pastor Challenge + task builder and participation dashboard.
 * Mounted at /api/admin/challenges.
 */
@ApiTags('Challenges (admin)')
@ApiBearerAuth()
@Controller('admin/challenges')
@UseGuards(JwtAuthGuard, RoleGuard)
@RequiresRole('admin', 'pastor')
@UseInterceptors(RlsContextInterceptor)
@ChurchOnly()
export class ChallengesAdminController {
  constructor(private readonly challenges: ChallengesService) {}

  private tenantId(user: SupabaseJwtPayload): string {
    const t = user.app_metadata?.current_tenant_id;
    if (!t) throw new BadRequestException('No tenant context');
    return t;
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a challenge (optionally with inline tasks[])' })
  @ApiResponse({ status: 201, description: 'Challenge with tasks[]' })
  create(@Body() dto: CreateChallengeDto, @CurrentUser() user: SupabaseJwtPayload) {
    return this.challenges.createChallenge(dto, this.tenantId(user));
  }

  @Get()
  @ApiOperation({ summary: 'List all challenges (incl. drafts) with task + enrollment counts' })
  list(@CurrentUser() user: SupabaseJwtPayload) {
    return this.challenges.listChallengesAdmin(this.tenantId(user));
  }

  @Get(':id')
  @ApiOperation({ summary: 'Full challenge with ordered tasks[]' })
  getOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SupabaseJwtPayload) {
    return this.challenges.getChallengeAdmin(this.tenantId(user), id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update challenge metadata + publish state' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateChallengeDto,
    @CurrentUser() user: SupabaseJwtPayload,
  ) {
    return this.challenges.updateChallenge(this.tenantId(user), id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a challenge (cascades tasks + enrollments)' })
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SupabaseJwtPayload) {
    return this.challenges.deleteChallenge(this.tenantId(user), id);
  }

  @Get(':id/participation')
  @ApiOperation({
    summary: 'Participation dashboard for a challenge',
    description: '{ enrolledCount, activeCount, completedCount, totalTasks, avgCompletionPct, completionsByDay[], topStreaks[] }',
  })
  participation(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SupabaseJwtPayload) {
    return this.challenges.getParticipation(this.tenantId(user), id);
  }

  // ── task CRUD ──

  @Post(':id/tasks')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add a task to a challenge' })
  addTask(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChallengeTaskInput,
    @CurrentUser() user: SupabaseJwtPayload,
  ) {
    return this.challenges.addTask(this.tenantId(user), id, dto);
  }

  @Put(':id/tasks')
  @ApiOperation({
    summary: 'Replace the entire task set (builder save)',
    description: 'Deletes existing tasks and re-inserts the supplied set in one shot.',
  })
  replaceTasks(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReplaceTasksDto,
    @CurrentUser() user: SupabaseJwtPayload,
  ) {
    return this.challenges.replaceTasks(this.tenantId(user), id, dto.tasks);
  }

  @Patch(':id/tasks/:taskId')
  @ApiOperation({ summary: 'Update a single task' })
  updateTask(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Body() dto: UpdateChallengeTaskDto,
    @CurrentUser() user: SupabaseJwtPayload,
  ) {
    return this.challenges.updateTask(this.tenantId(user), id, taskId, dto);
  }

  @Delete(':id/tasks/:taskId')
  @ApiOperation({ summary: 'Delete a single task' })
  deleteTask(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @CurrentUser() user: SupabaseJwtPayload,
  ) {
    return this.challenges.deleteTask(this.tenantId(user), id, taskId);
  }
}
