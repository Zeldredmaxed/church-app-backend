import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CreateWorkflowDto } from './dto/create-workflow.dto';
import { UpdateWorkflowDto } from './dto/update-workflow.dto';
import { NODE_TYPE_REGISTRY } from './workflow-node-types';

@Injectable()
export class WorkflowsService {
  private readonly logger = new Logger(WorkflowsService.name);

  constructor(private readonly dataSource: DataSource) {}

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
      nodes: nodes.map((n: any) => ({
        id: n.id,
        workflowId: n.workflow_id,
        nodeType: n.node_type,
        nodeConfig: n.node_config,
        positionX: n.position_x,
        positionY: n.position_y,
        label: n.label,
      })),
      connections: connections.map((c: any) => ({
        id: c.id,
        workflowId: c.workflow_id,
        fromNodeId: c.from_node_id,
        toNodeId: c.to_node_id,
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
}
