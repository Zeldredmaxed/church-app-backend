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
  ForbiddenException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { DataSource } from 'typeorm';
import { WorkflowsService } from './workflows.service';
import { WorkflowEngineService } from './workflow-engine.service';
import { CreateWorkflowDto } from './dto/create-workflow.dto';
import { UpdateWorkflowDto } from './dto/update-workflow.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SupabaseJwtPayload } from '../common/types/jwt-payload.type';
import { getTierFeatures } from '../common/config/tier-features.config';
import { Tenant } from '../tenants/entities/tenant.entity';

@ApiTags('Workflows')
@ApiBearerAuth()
@Controller('workflows')
@UseGuards(JwtAuthGuard)
@UseInterceptors(RlsContextInterceptor)
export class WorkflowsController {
  constructor(
    private readonly workflowsService: WorkflowsService,
    private readonly workflowEngineService: WorkflowEngineService,
    private readonly dataSource: DataSource,
  ) {}

  /* ───── Tier Gate Helper ───── */

  private async ensureWorkflowsEnabled(tenantId: string) {
    const tenant = await this.dataSource.manager.findOne(Tenant, {
      where: { id: tenantId },
      select: ['tier'],
    });
    const features = getTierFeatures(tenant?.tier ?? 'standard');
    if (!features.workflows) {
      throw new ForbiddenException(
        'Workflow Automation requires an Enterprise plan. Upgrade to unlock automated workflows for your church.',
      );
    }
  }

  /* ───── Static Routes (BEFORE :id) ───── */

  @Get('node-types')
  @ApiOperation({ summary: 'Get available node types for the workflow builder palette' })
  @ApiResponse({ status: 200, description: 'Node type registry' })
  getNodeTypes() {
    return this.workflowsService.getNodeTypes();
  }

  @Get('executions/:executionId')
  @ApiOperation({ summary: 'Get a single execution with step-by-step logs' })
  @ApiResponse({ status: 200, description: 'Execution details with logs' })
  async getExecution(
    @CurrentUser() user: SupabaseJwtPayload,
    @Param('executionId', ParseUUIDPipe) executionId: string,
  ) {
    const tenantId = user.app_metadata?.current_tenant_id!;
    await this.ensureWorkflowsEnabled(tenantId);
    return this.workflowsService.getExecution(tenantId, executionId);
  }

  @Post('executions/:executionId/cancel')
  @ApiOperation({ summary: 'Cancel a running or paused execution' })
  @ApiResponse({ status: 200, description: 'Execution cancelled' })
  async cancelExecution(
    @CurrentUser() user: SupabaseJwtPayload,
    @Param('executionId', ParseUUIDPipe) executionId: string,
  ) {
    const tenantId = user.app_metadata?.current_tenant_id!;
    await this.ensureWorkflowsEnabled(tenantId);
    return this.workflowsService.cancelExecution(tenantId, executionId);
  }

  /* ───── CRUD Routes ───── */

  @Get()
  @ApiOperation({ summary: 'List all workflows for this church' })
  @ApiResponse({ status: 200, description: 'List of workflows' })
  async getWorkflows(
    @CurrentUser() user: SupabaseJwtPayload,
    @Query('isActive') isActive?: string,
    @Query('triggerType') triggerType?: string,
  ) {
    const tenantId = user.app_metadata?.current_tenant_id!;
    await this.ensureWorkflowsEnabled(tenantId);
    return this.workflowsService.getWorkflows(tenantId, {
      isActive: isActive !== undefined ? isActive === 'true' : undefined,
      triggerType,
    });
  }

  @Post()
  @ApiOperation({ summary: 'Create a new workflow' })
  @ApiResponse({ status: 201, description: 'Workflow created with nodes and connections' })
  async createWorkflow(
    @CurrentUser() user: SupabaseJwtPayload,
    @Body() dto: CreateWorkflowDto,
  ) {
    const tenantId = user.app_metadata?.current_tenant_id!;
    await this.ensureWorkflowsEnabled(tenantId);
    return this.workflowsService.createWorkflow(tenantId, dto, user.sub);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single workflow with all nodes and connections' })
  @ApiResponse({ status: 200, description: 'Full workflow definition' })
  async getWorkflow(
    @CurrentUser() user: SupabaseJwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const tenantId = user.app_metadata?.current_tenant_id!;
    await this.ensureWorkflowsEnabled(tenantId);
    return this.workflowsService.getWorkflow(tenantId, id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update a workflow (metadata and/or nodes/connections)' })
  @ApiResponse({ status: 200, description: 'Workflow updated' })
  async updateWorkflow(
    @CurrentUser() user: SupabaseJwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateWorkflowDto,
  ) {
    const tenantId = user.app_metadata?.current_tenant_id!;
    await this.ensureWorkflowsEnabled(tenantId);
    return this.workflowsService.updateWorkflow(tenantId, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a workflow and all its nodes, connections, executions' })
  @ApiResponse({ status: 200, description: 'Workflow deleted' })
  async deleteWorkflow(
    @CurrentUser() user: SupabaseJwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const tenantId = user.app_metadata?.current_tenant_id!;
    await this.ensureWorkflowsEnabled(tenantId);
    return this.workflowsService.deleteWorkflow(tenantId, id);
  }

  @Put(':id/toggle')
  @ApiOperation({ summary: 'Enable or disable a workflow' })
  @ApiResponse({ status: 200, description: 'Workflow toggled' })
  async toggleWorkflow(
    @CurrentUser() user: SupabaseJwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { isActive: boolean },
  ) {
    const tenantId = user.app_metadata?.current_tenant_id!;
    await this.ensureWorkflowsEnabled(tenantId);
    return this.workflowsService.toggleWorkflow(tenantId, id, body.isActive);
  }

  @Post(':id/trigger')
  @ApiOperation({ summary: 'Manually trigger a workflow (for testing)' })
  @ApiResponse({ status: 201, description: 'Workflow execution started' })
  async triggerWorkflow(
    @CurrentUser() user: SupabaseJwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { targetUserId?: string },
  ) {
    const tenantId = user.app_metadata?.current_tenant_id!;
    await this.ensureWorkflowsEnabled(tenantId);
    return this.workflowEngineService.executeWorkflow(
      id,
      tenantId,
      body.targetUserId,
      { source: 'manual', triggeredBy: user.sub },
    );
  }

  @Get(':id/executions')
  @ApiOperation({ summary: 'List executions for a specific workflow' })
  @ApiResponse({ status: 200, description: 'Paginated list of executions' })
  async getWorkflowExecutions(
    @CurrentUser() user: SupabaseJwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    const tenantId = user.app_metadata?.current_tenant_id!;
    await this.ensureWorkflowsEnabled(tenantId);
    const parsedLimit = Math.min(Math.max(parseInt(limit ?? '20', 10) || 20, 1), 100);
    return this.workflowsService.getExecutions(tenantId, id, status, parsedLimit, cursor);
  }
}
