import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { TasksService } from './tasks.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SupabaseJwtPayload } from '../common/types/jwt-payload.type';

@ApiTags('Tasks')
@ApiBearerAuth()
@Controller('tasks')
@UseGuards(JwtAuthGuard)
@UseInterceptors(RlsContextInterceptor)
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Get()
  @ApiOperation({ summary: 'List tasks with optional filters and pagination' })
  @ApiResponse({ status: 200, description: 'Paginated list of tasks' })
  getTasks(
    @CurrentUser() user: SupabaseJwtPayload,
    @Query('status') status?: string,
    @Query('priority') priority?: string,
    @Query('assignedTo') assignedTo?: string,
    @Query('linkedType') linkedType?: string,
    @Query('linkedId') linkedId?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    const tenantId = user.app_metadata?.current_tenant_id!;
    const parsedLimit = Math.min(Math.max(parseInt(limit ?? '20', 10) || 20, 1), 100);
    return this.tasksService.getTasks(
      tenantId,
      { status, priority, assignedTo, linkedType, linkedId },
      parsedLimit,
      cursor,
    );
  }

  @Post()
  @ApiOperation({ summary: 'Create a new task' })
  @ApiResponse({ status: 201, description: 'Task created' })
  createTask(
    @CurrentUser() user: SupabaseJwtPayload,
    @Body() dto: CreateTaskDto,
  ) {
    const tenantId = user.app_metadata?.current_tenant_id!;
    return this.tasksService.createTask(tenantId, dto, user.sub);
  }

  @Get('kpis')
  @ApiOperation({ summary: 'Get task KPI counts' })
  @ApiResponse({ status: 200, description: 'Task KPIs' })
  getTaskKpis(@CurrentUser() user: SupabaseJwtPayload) {
    const tenantId = user.app_metadata?.current_tenant_id!;
    return this.tasksService.getTaskKpis(tenantId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single task by ID' })
  @ApiResponse({ status: 200, description: 'Task details' })
  getTask(
    @CurrentUser() user: SupabaseJwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const tenantId = user.app_metadata?.current_tenant_id!;
    return this.tasksService.getTask(tenantId, id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update a task' })
  @ApiResponse({ status: 200, description: 'Task updated' })
  updateTask(
    @CurrentUser() user: SupabaseJwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTaskDto,
  ) {
    const tenantId = user.app_metadata?.current_tenant_id!;
    return this.tasksService.updateTask(tenantId, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a task' })
  @ApiResponse({ status: 200, description: 'Task deleted' })
  deleteTask(
    @CurrentUser() user: SupabaseJwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const tenantId = user.app_metadata?.current_tenant_id!;
    return this.tasksService.deleteTask(tenantId, id);
  }

  @Put(':id/complete')
  @ApiOperation({ summary: 'Mark a task as completed' })
  @ApiResponse({ status: 200, description: 'Task completed' })
  completeTask(
    @CurrentUser() user: SupabaseJwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const tenantId = user.app_metadata?.current_tenant_id!;
    return this.tasksService.completeTask(tenantId, id);
  }
}
