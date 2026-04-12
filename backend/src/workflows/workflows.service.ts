import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { CreateWorkflowDto } from './dto/create-workflow.dto';
import { UpdateWorkflowDto } from './dto/update-workflow.dto';
import { NODE_TYPE_REGISTRY, TRIGGER_TYPES, ACTION_TYPES, CONDITION_TYPES, DELAY_TYPES, FILTER_TYPES } from './workflow-node-types';

@Injectable()
export class WorkflowsService {
  private readonly logger = new Logger(WorkflowsService.name);
  private readonly anthropicKey: string | null;

  constructor(
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
  ) {
    this.anthropicKey = this.config.get<string>('ANTHROPIC_API_KEY') ?? null;
  }

  /* ───── List Workflows ───── */

  async getWorkflows(
    tenantId: string,
    filters?: { isActive?: boolean; triggerType?: string },
  ) {
    const conditions: string[] = ['w.tenant_id = $1'];
    const params: any[] = [tenantId];
    let idx = 2;

    if (filters?.isActive !== undefined) {
      conditions.push(`w.is_active = $${idx++}`);
      params.push(filters.isActive);
    }
    if (filters?.triggerType) {
      conditions.push(`w.trigger_type = $${idx++}`);
      params.push(filters.triggerType);
    }

    const rows = await this.dataSource.query(
      `SELECT w.*,
              (SELECT COUNT(*)::int FROM public.workflow_nodes wn WHERE wn.workflow_id = w.id) AS node_count,
              (SELECT COUNT(*)::int FROM public.workflow_connections wc WHERE wc.workflow_id = w.id) AS connection_count,
              (SELECT COUNT(*)::int FROM public.workflow_executions we WHERE we.workflow_id = w.id) AS execution_count
       FROM public.workflows w
       WHERE ${conditions.join(' AND ')}
       ORDER BY w.created_at DESC`,
      params,
    );

    return {
      data: rows.map((r: any) => ({
        id: r.id,
        tenantId: r.tenant_id,
        name: r.name,
        description: r.description,
        triggerType: r.trigger_type,
        triggerConfig: r.trigger_config,
        isActive: r.is_active,
        createdBy: r.created_by,
        nodeCount: r.node_count,
        connectionCount: r.connection_count,
        executionCount: r.execution_count,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      })),
    };
  }

  /* ───── Get Single Workflow ───── */

  async getWorkflow(tenantId: string, id: string) {
    const [row] = await this.dataSource.query(
      `SELECT * FROM public.workflows WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId],
    );
    if (!row) throw new NotFoundException('Workflow not found');

    const nodes = await this.dataSource.query(
      `SELECT * FROM public.workflow_nodes WHERE workflow_id = $1 ORDER BY position_y, position_x`,
      [id],
    );

    const connections = await this.dataSource.query(
      `SELECT * FROM public.workflow_connections WHERE workflow_id = $1`,
      [id],
    );

    return {
      id: row.id,
      tenantId: row.tenant_id,
      name: row.name,
      description: row.description,
      triggerType: row.trigger_type,
      triggerConfig: row.trigger_config,
      isActive: row.is_active,
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      // Dual-emit: legacy (nodeType/nodeConfig/label/fromNodeId/toNodeId) plus
      // current frontend spec (nodeTypeKey/config/title/from/to). Frontends can
      // migrate to the new names at their own pace; remove the legacy fields
      // once both admin dashboard and mobile confirm they're on the new names.
      nodes: nodes.map((n: any) => ({
        id: n.id,
        workflowId: n.workflow_id,
        nodeType: n.node_type,
        nodeTypeKey: n.node_type,
        nodeConfig: n.node_config,
        config: n.node_config,
        positionX: n.position_x,
        positionY: n.position_y,
        label: n.label,
        title: n.label,
      })),
      connections: connections.map((c: any) => ({
        id: c.id,
        workflowId: c.workflow_id,
        fromNodeId: c.from_node_id,
        toNodeId: c.to_node_id,
        from: c.from_node_id,
        to: c.to_node_id,
        branch: c.branch,
      })),
    };
  }

  /* ───── Create Workflow ───── */

  async createWorkflow(tenantId: string, dto: CreateWorkflowDto, userId: string) {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // 1. Insert workflow
      const [workflow] = await queryRunner.query(
        `INSERT INTO public.workflows (tenant_id, name, description, trigger_type, trigger_config, created_by)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [tenantId, dto.name, dto.description ?? null, dto.triggerType, JSON.stringify(dto.triggerConfig ?? {}), userId],
      );

      // 2. Build client ID → real UUID map
      const idMap = new Map<string, string>();

      for (const node of dto.nodes) {
        const [inserted] = await queryRunner.query(
          `INSERT INTO public.workflow_nodes (workflow_id, node_type, node_config, position_x, position_y, label)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id`,
          [workflow.id, node.nodeType, JSON.stringify(node.nodeConfig), node.positionX, node.positionY, node.label ?? null],
        );
        idMap.set(node.id, inserted.id);
      }

      // 3. Insert connections with mapped IDs
      for (const conn of dto.connections) {
        const fromId = idMap.get(conn.fromNodeId);
        const toId = idMap.get(conn.toNodeId);
        if (!fromId || !toId) {
          throw new Error(`Connection references unknown node ID: ${conn.fromNodeId} -> ${conn.toNodeId}`);
        }
        await queryRunner.query(
          `INSERT INTO public.workflow_connections (workflow_id, from_node_id, to_node_id, branch)
           VALUES ($1, $2, $3, $4)`,
          [workflow.id, fromId, toId, conn.branch ?? 'default'],
        );
      }

      await queryRunner.commitTransaction();
      return this.getWorkflow(tenantId, workflow.id);
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  /* ───── Update Workflow ───── */

  async updateWorkflow(tenantId: string, id: string, dto: UpdateWorkflowDto) {
    // Verify exists
    const [existing] = await this.dataSource.query(
      `SELECT id FROM public.workflows WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId],
    );
    if (!existing) throw new NotFoundException('Workflow not found');

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Update metadata fields
      const fields: string[] = [];
      const params: any[] = [];
      let idx = 1;

      if (dto.name !== undefined) { fields.push(`name = $${idx++}`); params.push(dto.name); }
      if (dto.description !== undefined) { fields.push(`description = $${idx++}`); params.push(dto.description); }
      if (dto.triggerType !== undefined) { fields.push(`trigger_type = $${idx++}`); params.push(dto.triggerType); }
      if (dto.triggerConfig !== undefined) { fields.push(`trigger_config = $${idx++}`); params.push(JSON.stringify(dto.triggerConfig)); }
      if (dto.isActive !== undefined) { fields.push(`is_active = $${idx++}`); params.push(dto.isActive); }

      if (fields.length > 0) {
        fields.push(`updated_at = now()`);
        await queryRunner.query(
          `UPDATE public.workflows SET ${fields.join(', ')} WHERE id = $${idx++} AND tenant_id = $${idx}`,
          [...params, id, tenantId],
        );
      }

      // If nodes/connections provided, delete and re-insert
      if (dto.nodes && dto.connections) {
        await queryRunner.query(`DELETE FROM public.workflow_connections WHERE workflow_id = $1`, [id]);
        await queryRunner.query(`DELETE FROM public.workflow_nodes WHERE workflow_id = $1`, [id]);

        const idMap = new Map<string, string>();

        for (const node of dto.nodes) {
          const [inserted] = await queryRunner.query(
            `INSERT INTO public.workflow_nodes (workflow_id, node_type, node_config, position_x, position_y, label)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING id`,
            [id, node.nodeType, JSON.stringify(node.nodeConfig), node.positionX, node.positionY, node.label ?? null],
          );
          idMap.set(node.id, inserted.id);
        }

        for (const conn of dto.connections) {
          const fromId = idMap.get(conn.fromNodeId);
          const toId = idMap.get(conn.toNodeId);
          if (!fromId || !toId) {
            throw new Error(`Connection references unknown node ID: ${conn.fromNodeId} -> ${conn.toNodeId}`);
          }
          await queryRunner.query(
            `INSERT INTO public.workflow_connections (workflow_id, from_node_id, to_node_id, branch)
             VALUES ($1, $2, $3, $4)`,
            [id, fromId, toId, conn.branch ?? 'default'],
          );
        }
      }

      await queryRunner.commitTransaction();
      return this.getWorkflow(tenantId, id);
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  /* ───── Delete Workflow ───── */

  async deleteWorkflow(tenantId: string, id: string) {
    const result = await this.dataSource.query(
      `DELETE FROM public.workflows WHERE id = $1 AND tenant_id = $2 RETURNING id`,
      [id, tenantId],
    );
    if (result.length === 0) throw new NotFoundException('Workflow not found');
    return { deleted: true };
  }

  /* ───── Toggle Active ───── */

  async toggleWorkflow(tenantId: string, id: string, isActive: boolean) {
    // Guard: the controller receives `@Body() body: { isActive: boolean }` as
    // an inline TS type, which the ValidationPipe does not enforce. If the
    // client sends { active: true } or omits the body, isActive is undefined
    // and the UPDATE tries to SET is_active = NULL (NOT NULL column → 500).
    if (typeof isActive !== 'boolean') {
      throw new BadRequestException('isActive (boolean) is required');
    }
    const [row] = await this.dataSource.query(
      `UPDATE public.workflows SET is_active = $1, updated_at = now()
       WHERE id = $2 AND tenant_id = $3 RETURNING *`,
      [isActive, id, tenantId],
    );
    if (!row) throw new NotFoundException('Workflow not found');
    return {
      id: row.id,
      name: row.name,
      isActive: row.is_active,
      updatedAt: row.updated_at,
    };
  }

  /* ───── Node Types ───── */

  getNodeTypes() {
    return { data: NODE_TYPE_REGISTRY };
  }

  /* ───── Executions ───── */

  async getExecutions(
    tenantId: string,
    workflowId?: string,
    status?: string,
    limit = 20,
    cursor?: string,
  ) {
    const conditions: string[] = ['we.tenant_id = $1'];
    const params: any[] = [tenantId];
    let idx = 2;

    if (workflowId) {
      conditions.push(`we.workflow_id = $${idx++}`);
      params.push(workflowId);
    }
    if (status) {
      conditions.push(`we.status = $${idx++}`);
      params.push(status);
    }
    if (cursor) {
      conditions.push(`we.started_at < $${idx++}`);
      params.push(cursor);
    }

    params.push(limit);

    const rows = await this.dataSource.query(
      `SELECT we.*, w.name AS workflow_name, u.full_name AS target_user_name
       FROM public.workflow_executions we
       LEFT JOIN public.workflows w ON w.id = we.workflow_id
       LEFT JOIN public.users u ON u.id = we.target_user_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY we.started_at DESC
       LIMIT $${idx}`,
      params,
    );

    return {
      data: rows.map((r: any) => ({
        id: r.id,
        workflowId: r.workflow_id,
        workflowName: r.workflow_name,
        tenantId: r.tenant_id,
        targetUserId: r.target_user_id,
        targetUserName: r.target_user_name,
        status: r.status,
        triggerData: r.trigger_data,
        currentNodeId: r.current_node_id,
        errorMessage: r.error_message,
        startedAt: r.started_at,
        completedAt: r.completed_at,
        nextStepAt: r.next_step_at,
      })),
      cursor: rows.length === limit ? rows[rows.length - 1].started_at : null,
    };
  }

  async getExecution(tenantId: string, executionId: string) {
    const [row] = await this.dataSource.query(
      `SELECT we.*, w.name AS workflow_name, u.full_name AS target_user_name
       FROM public.workflow_executions we
       LEFT JOIN public.workflows w ON w.id = we.workflow_id
       LEFT JOIN public.users u ON u.id = we.target_user_id
       WHERE we.id = $1 AND we.tenant_id = $2`,
      [executionId, tenantId],
    );
    if (!row) throw new NotFoundException('Execution not found');

    const logs = await this.dataSource.query(
      `SELECT wel.*, wn.node_type, wn.label AS node_label
       FROM public.workflow_execution_logs wel
       LEFT JOIN public.workflow_nodes wn ON wn.id = wel.node_id
       WHERE wel.execution_id = $1
       ORDER BY wel.executed_at ASC`,
      [executionId],
    );

    return {
      id: row.id,
      workflowId: row.workflow_id,
      workflowName: row.workflow_name,
      tenantId: row.tenant_id,
      targetUserId: row.target_user_id,
      targetUserName: row.target_user_name,
      status: row.status,
      triggerData: row.trigger_data,
      currentNodeId: row.current_node_id,
      errorMessage: row.error_message,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      nextStepAt: row.next_step_at,
      logs: logs.map((l: any) => ({
        id: l.id,
        executionId: l.execution_id,
        nodeId: l.node_id,
        nodeType: l.node_type,
        nodeLabel: l.node_label,
        status: l.status,
        inputData: l.input_data,
        outputData: l.output_data,
        errorMessage: l.error_message,
        executedAt: l.executed_at,
      })),
    };
  }

  async cancelExecution(tenantId: string, executionId: string) {
    const [row] = await this.dataSource.query(
      `UPDATE public.workflow_executions
       SET status = 'cancelled', completed_at = now()
       WHERE id = $1 AND tenant_id = $2 AND status IN ('running', 'paused')
       RETURNING id, status`,
      [executionId, tenantId],
    );
    if (!row) throw new NotFoundException('Execution not found or already completed');
    return { id: row.id, status: row.status };
  }

  /* ───── AI Workflow Generation ───── */

  async generateWorkflowFromAI(tenantId: string, prompt: string, userId: string) {
    if (!this.anthropicKey) {
      return {
        message: 'AI workflow generation requires ANTHROPIC_API_KEY to be configured.',
        suggestedWorkflow: this.getFallbackWorkflow(prompt),
      };
    }

    const systemPrompt = `You are a workflow builder for a church management platform.
Given a natural language description, generate a workflow definition as JSON.

AVAILABLE TRIGGER TYPES: ${TRIGGER_TYPES.join(', ')}
AVAILABLE ACTION TYPES: ${ACTION_TYPES.join(', ')}
AVAILABLE CONDITION TYPES: ${CONDITION_TYPES.join(', ')}
AVAILABLE DELAY TYPES: ${DELAY_TYPES.join(', ')}
AVAILABLE FILTER TYPES: ${FILTER_TYPES.join(', ')}

Return ONLY valid JSON with this shape (no markdown, no explanation):
{
  "name": "Workflow Name",
  "description": "What this workflow does",
  "triggerType": "one of the trigger types above",
  "triggerConfig": {},
  "nodes": [
    { "id": "node-1", "nodeType": "trigger_type_here", "nodeConfig": {}, "positionX": 50, "positionY": 100, "label": "Display Name" },
    { "id": "node-2", "nodeType": "action_or_condition", "nodeConfig": { "relevant": "config" }, "positionX": 300, "positionY": 100, "label": "Display Name" }
  ],
  "connections": [
    { "fromNodeId": "node-1", "toNodeId": "node-2", "branch": "default" }
  ]
}

Rules:
- First node must match the triggerType
- Position nodes left-to-right (increment positionX by 250 per step)
- For conditions, create two branches: one connection with branch "true" and one with branch "false"
- For delays, use nodeConfig like { "amount": 1, "unit": "days" }
- For send_email, use nodeConfig like { "subject": "...", "body": "..." }
- For send_sms, use nodeConfig like { "body": "..." }
- For assign_tag, use nodeConfig like { "tagName": "..." } (tagId will be resolved later)
- Keep workflows practical — 3-8 nodes typically`;

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.anthropicKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 2048,
          messages: [
            { role: 'user', content: `${systemPrompt}\n\nCreate a workflow for: "${prompt}"` },
          ],
        }),
      });

      if (!response.ok) {
        throw new Error(`Claude API error: ${response.status}`);
      }

      const data = await response.json();
      const text = data.content?.[0]?.text?.trim();

      if (!text) throw new Error('No response from AI');

      // Parse and validate the JSON
      const workflow = JSON.parse(text);

      return {
        message: 'Workflow generated successfully. Review and save when ready.',
        suggestedWorkflow: workflow,
      };
    } catch (err: any) {
      this.logger.warn(`AI workflow generation failed: ${err.message}`);
      return {
        message: 'AI generation failed. Here is a suggested template instead.',
        suggestedWorkflow: this.getFallbackWorkflow(prompt),
      };
    }
  }

  private getFallbackWorkflow(prompt: string) {
    const lower = prompt.toLowerCase();

    if (lower.includes('new member') || lower.includes('welcome')) {
      return {
        name: 'New Member Welcome Flow',
        description: 'Welcomes new members with email, follow-up, and tag assignment',
        triggerType: 'new_member',
        triggerConfig: {},
        nodes: [
          { id: 'node-1', nodeType: 'new_member', nodeConfig: {}, positionX: 50, positionY: 100, label: 'New Member Joins' },
          { id: 'node-2', nodeType: 'send_email', nodeConfig: { subject: 'Welcome to our church!', body: 'We are so glad you joined us...' }, positionX: 300, positionY: 100, label: 'Send Welcome Email' },
          { id: 'node-3', nodeType: 'wait_duration', nodeConfig: { amount: 3, unit: 'days' }, positionX: 550, positionY: 100, label: 'Wait 3 Days' },
          { id: 'node-4', nodeType: 'send_sms', nodeConfig: { body: 'Hey! Just checking in — how was your first experience with us?' }, positionX: 800, positionY: 100, label: 'Follow-up SMS' },
          { id: 'node-5', nodeType: 'assign_tag', nodeConfig: { tagName: 'New Member' }, positionX: 1050, positionY: 100, label: 'Tag as New Member' },
        ],
        connections: [
          { fromNodeId: 'node-1', toNodeId: 'node-2', branch: 'default' },
          { fromNodeId: 'node-2', toNodeId: 'node-3', branch: 'default' },
          { fromNodeId: 'node-3', toNodeId: 'node-4', branch: 'default' },
          { fromNodeId: 'node-4', toNodeId: 'node-5', branch: 'default' },
        ],
      };
    }

    // Generic template
    return {
      name: 'Custom Workflow',
      description: prompt,
      triggerType: 'manual',
      triggerConfig: {},
      nodes: [
        { id: 'node-1', nodeType: 'manual', nodeConfig: {}, positionX: 50, positionY: 100, label: 'Manual Trigger' },
        { id: 'node-2', nodeType: 'send_email', nodeConfig: { subject: 'Notification', body: 'This is an automated message.' }, positionX: 300, positionY: 100, label: 'Send Email' },
      ],
      connections: [
        { fromNodeId: 'node-1', toNodeId: 'node-2', branch: 'default' },
      ],
    };
  }
}
