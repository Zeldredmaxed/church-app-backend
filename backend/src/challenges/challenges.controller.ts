import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ChallengesService } from './challenges.service';
import { CompleteTaskDto } from './dto/complete-task.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { ChurchOnly } from '../common/guards/church-only.guard';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SupabaseJwtPayload } from '../common/types/jwt-payload.type';

/**
 * Member-facing Challenges / Reading Plans. Browse + enroll, fetch
 * today's to-do list, complete tasks (timer-gated read, reflection,
 * check-in), track progress + streaks. Mounted at /api/challenges.
 */
@ApiTags('Challenges')
@ApiBearerAuth()
@Controller('challenges')
@UseGuards(JwtAuthGuard)
@UseInterceptors(RlsContextInterceptor)
@ChurchOnly()
export class ChallengesController {
  constructor(private readonly challenges: ChallengesService) {}

  private tenantId(user: SupabaseJwtPayload): string {
    const t = user.app_metadata?.current_tenant_id;
    if (!t) throw new BadRequestException('No tenant context');
    return t;
  }

  @Get()
  @ApiOperation({ summary: 'Browse published challenges (with my enrollment status)' })
  @ApiResponse({ status: 200, description: '{ data: Challenge[] } — each with myEnrollment | null' })
  browse(@CurrentUser() user: SupabaseJwtPayload) {
    return this.challenges.browse(this.tenantId(user), user.sub);
  }

  @Get('today')
  @ApiOperation({
    summary: "Today's to-do list across all my active enrollments",
    description: 'Grouped by challenge. Each group has { challenge, enrollment, dayIndex, started, finished, tasks[] } where each task carries my completion | null.',
  })
  getToday(@CurrentUser() user: SupabaseJwtPayload) {
    return this.challenges.getTodayAll(this.tenantId(user), user.sub);
  }

  // Static 'tasks' segment declared before ':id' so it matches first.
  @Post('tasks/:taskId/complete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Complete a task',
    description:
      'Reflection tasks require reflectionText (400 REFLECTION_REQUIRED otherwise). Scripture tasks with a timer require timerSatisfied / secondsSpent ≥ timerSeconds (400 TIMER_NOT_SATISFIED otherwise). Returns updated streak + progress.',
  })
  @ApiResponse({ status: 200, description: '{ recorded, taskId, completedOn, enrollment, progress }' })
  completeTask(
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Body() dto: CompleteTaskDto,
    @CurrentUser() user: SupabaseJwtPayload,
  ) {
    return this.challenges.completeTask(this.tenantId(user), user.sub, taskId, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Single challenge detail + my enrollment' })
  getOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SupabaseJwtPayload) {
    return this.challenges.getChallengeMember(this.tenantId(user), user.sub, id);
  }

  @Post(':id/enroll')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Enroll in a challenge (idempotent; re-activates an abandoned enrollment)' })
  enroll(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SupabaseJwtPayload) {
    return this.challenges.enroll(this.tenantId(user), user.sub, id);
  }

  @Post(':id/unenroll')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Abandon my enrollment (preserves completion history)' })
  unenroll(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SupabaseJwtPayload) {
    return this.challenges.unenroll(this.tenantId(user), user.sub, id);
  }

  @Get(':id/today')
  @ApiOperation({ summary: "Today's tasks for one challenge" })
  getChallengeToday(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SupabaseJwtPayload) {
    return this.challenges.getChallengeToday(this.tenantId(user), user.sub, id);
  }

  @Get(':id/progress')
  @ApiOperation({ summary: 'My progress on a challenge: per-day completion + streaks' })
  getProgress(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SupabaseJwtPayload) {
    return this.challenges.getProgress(this.tenantId(user), user.sub, id);
  }

  @Get(':id/days/:dayIndex')
  @ApiOperation({ summary: 'Tasks for a specific day (catch-up / browse ahead)' })
  getDay(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('dayIndex', ParseIntPipe) dayIndex: number,
    @CurrentUser() user: SupabaseJwtPayload,
  ) {
    return this.challenges.getDay(this.tenantId(user), user.sub, id, dayIndex);
  }
}
