import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  Req,
  ParseUUIDPipe,
  UseGuards,
  UseInterceptors,
  ForbiddenException,
  BadRequestException,
  HttpCode,
  HttpStatus,
  Logger,
  RawBodyRequest,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { WorkflowsService } from './workflows.service';
import { WorkflowEngineService } from './workflow-engine.service';
import { CreateWorkflowDto } from './dto/create-workflow.dto';
import { UpdateWorkflowDto } from './dto/update-workflow.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SupabaseJwtPayload } from '../common/types/jwt-payload.type';
import { getTierFeatures, TierFeatures } from '../common/config/tier-features.config';
import { Tenant } from '../tenants/entities/tenant.entity';

@ApiTags('Workflows')
@ApiBearerAuth()
@Controller('workflows')
@UseGuards(JwtAuthGuard)
@UseInterceptors(RlsContextInterceptor)
export class WorkflowsController {
  private readonly logger = new Logger(WorkflowsController.name);

  constructor(
    private readonly workflowsService: WorkflowsService,
    private readonly workflowEngineService: WorkflowEngineService,
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
  ) {}

  /* ───── Tier Gate Helper ───── */

  private async getTenantFeatures(tenantId: string): Promise<TierFeatures> {
    const tenant = await this.dataSource.manager.findOne(Tenant, {
      where: { id: tenantId },
      select: ['tier'],
    });
    return getTierFeatures(tenant?.tier ?? 'standard');
  }

  private async ensureWorkflowsEnabled(tenantId: string): Promise<TierFeatures> {
    const features = await this.getTenantFeatures(tenantId);
    if (!features.workflows) {
      throw new ForbiddenException(
        'Workflow Automation requires a paid plan. Upgrade to unlock automated workflows for your church.',
      );
    }
    return features;
  }

  private async enforceWorkflowLimits(tenantId: string, features: TierFeatures, nodeCount?: number) {
    // Check workflow count limit
    if (features.maxWorkflows !== -1) {
      const [{ count }] = await this.dataSource.query(
        `SELECT COUNT(*)::int AS count FROM public.workflows WHERE tenant_id = $1`,
        [tenantId],
      );
      if (count >= features.maxWorkflows) {
        throw new ForbiddenException(
          `Your plan allows ${features.maxWorkflows} workflow(s). Upgrade to Enterprise for unlimited workflows.`,
        );
      }
    }

    // Check node count limit
    if (nodeCount !== undefined && features.maxWorkflowNodes !== -1) {
      if (nodeCount > features.maxWorkflowNodes) {
        throw new ForbiddenException(
          `Your plan allows up to ${features.maxWorkflowNodes} nodes per workflow. Upgrade to Enterprise for unlimited nodes.`,
        );
      }
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
    const features = await this.ensureWorkflowsEnabled(tenantId);
    await this.enforceWorkflowLimits(tenantId, features, dto.nodes?.length);
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

  /* ───── AI Workflow Generation (Enterprise only) ───── */

  @Post('generate')
  @ApiOperation({ summary: 'Generate a workflow from a natural language description (Enterprise only)' })
  @ApiResponse({ status: 201, description: 'Generated workflow definition' })
  async generateWorkflow(
    @CurrentUser() user: SupabaseJwtPayload,
    @Body() body: { prompt: string },
  ) {
    const tenantId = user.app_metadata?.current_tenant_id!;
    const features = await this.ensureWorkflowsEnabled(tenantId);

    if (features.maxWorkflows !== -1) {
      throw new ForbiddenException(
        'AI workflow generation requires an Enterprise plan.',
      );
    }

    if (!body.prompt || body.prompt.length > 1000) {
      throw new BadRequestException('Prompt is required (max 1000 characters)');
    }

    return this.workflowsService.generateWorkflowFromAI(tenantId, body.prompt, user.sub);
  }
}

/* ───── Inbound Webhook Controller (separate, no JWT) ───── */

@ApiTags('Workflow Webhooks')
@Controller('webhooks/workflows')
@SkipThrottle()
export class WorkflowWebhookController {
  private readonly logger = new Logger(WorkflowWebhookController.name);

  constructor(
    private readonly workflowsService: WorkflowsService,
    private readonly workflowEngineService: WorkflowEngineService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Receives inbound webhooks from external services.
   * URL pattern: POST /api/webhooks/workflows/:workflowId
   *
   * The workflowId is embedded in the URL — the external service configures
   * this URL as their webhook endpoint. No JWT required.
   *
   * The workflow must have trigger_type = 'inbound_webhook' and be active.
   */
  @Post(':workflowId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Receive inbound webhook for a workflow (no auth, URL-based)' })
  @ApiResponse({ status: 200, description: '{ received: true, executionId }' })
  @ApiResponse({ status: 404, description: 'Workflow not found or not an inbound webhook type' })
  async receiveWebhook(
    @Param('workflowId', ParseUUIDPipe) workflowId: string,
    @Body() payload: any,
    @Req() req: Request,
  ) {
    // Look up the workflow (service-role — no RLS)
    const [workflow] = await this.dataSource.query(
      `SELECT id, tenant_id, trigger_type, trigger_config, is_active
       FROM public.workflows WHERE id = $1`,
      [workflowId],
    );

    if (!workflow) {
      throw new BadRequestException('Workflow not found');
    }

    if (workflow.trigger_type !== 'inbound_webhook') {
      throw new BadRequestException('This workflow is not configured for inbound webhooks');
    }

    if (!workflow.is_active) {
      this.logger.warn(`Inbound webhook received for inactive workflow ${workflowId}`);
      return { received: true, message: 'Workflow is inactive', executionId: null };
    }

    // Optional: verify webhook secret if configured
    const secret = workflow.trigger_config?.secret;
    if (secret) {
      const providedSecret = req.headers['x-webhook-secret'] as string;
      if (providedSecret !== secret) {
        throw new BadRequestException('Invalid webhook secret');
      }
    }

    this.logger.log(`Inbound webhook received for workflow ${workflowId}`);

    // Execute the workflow asynchronously
    const execution = await this.workflowEngineService.executeWorkflow(
      workflowId,
      workflow.tenant_id,
      undefined,
      { source: 'inbound_webhook', payload, headers: req.headers },
    );

    return { received: true, executionId: execution?.executionId ?? null };
  }
}
