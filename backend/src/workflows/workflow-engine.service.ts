import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { EmailService } from '../communications/email.service';
import { SmsService } from '../communications/sms.service';
import { OneSignalService } from '../notifications/onesignal.service';
import {
  TRIGGER_TYPES,
  ACTION_TYPES,
  CONDITION_TYPES,
  DELAY_TYPES,
  FILTER_TYPES,
} from './workflow-node-types';

interface WorkflowNodeRow {
  id: string;
  workflow_id: string;
  node_type: string;
  node_config: Record<string, any>;
  position_x: number;
  position_y: number;
  label: string | null;
}

interface WorkflowConnectionRow {
  id: string;
  workflow_id: string;
  from_node_id: string;
  to_node_id: string;
  branch: string;
}

interface ExecutionContext {
  executionId: string;
  workflowId: string;
  tenantId: string;
  targetUserId: string | null;
  triggerData: Record<string, any>;
}

// Service-role: background workflow execution. tenant_id enforced via ctx.tenantId in WHERE clauses, not RLS.
@Injectable()
export class WorkflowEngineService {
  private readonly logger = new Logger(WorkflowEngineService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly emailService: EmailService,
    private readonly smsService: SmsService,
    private readonly oneSignalService: OneSignalService,
    private readonly configService: ConfigService,
  ) {}

  /* ───── Main Entry Point ───── */

  async executeWorkflow(
    workflowId: string,
    tenantId: string,
    targetUserId?: string,
    triggerData: Record<string, any> = {},
  ): Promise<{ executionId: string }> {
    // 1. Load workflow
    const [workflow] = await this.dataSource.query(
      `SELECT * FROM public.workflows WHERE id = $1 AND tenant_id = $2 AND is_active = true`,
      [workflowId, tenantId],
    );
    if (!workflow) {
      this.logger.warn(`Workflow ${workflowId} not found or inactive`);
      return { executionId: '' };
    }

    // 2. Load nodes and connections
    const nodes: WorkflowNodeRow[] = await this.dataSource.query(
      `SELECT * FROM public.workflow_nodes WHERE workflow_id = $1`,
      [workflowId],
    );
    const connections: WorkflowConnectionRow[] = await this.dataSource.query(
      `SELECT * FROM public.workflow_connections WHERE workflow_id = $1`,
      [workflowId],
    );

    // 3. Create execution record
    const [execution] = await this.dataSource.query(
      `INSERT INTO public.workflow_executions (workflow_id, tenant_id, target_user_id, status, trigger_data)
       VALUES ($1, $2, $3, 'running', $4)
       RETURNING *`,
      [workflowId, tenantId, targetUserId ?? null, JSON.stringify(triggerData)],
    );

    const ctx: ExecutionContext = {
      executionId: execution.id,
      workflowId,
      tenantId,
      targetUserId: targetUserId ?? null,
      triggerData,
    };

    // 4. Find entry node (trigger node — a node whose type is in TRIGGER_TYPES)
    const triggerTypes: readonly string[] = TRIGGER_TYPES;
    const entryNode = nodes.find(n => triggerTypes.includes(n.node_type as any));
    if (!entryNode) {
      await this.failExecution(ctx, 'No trigger node found in workflow');
      return { executionId: execution.id };
    }

    // 5. Walk the graph
    try {
      await this.walkGraph(entryNode, nodes, connections, ctx);
    } catch (err: any) {
      await this.failExecution(ctx, err.message);
    }

    return { executionId: execution.id };
  }

  /* ───── Graph Walker (BFS) ───── */

  private async walkGraph(
    startNode: WorkflowNodeRow,
    nodes: WorkflowNodeRow[],
    connections: WorkflowConnectionRow[],
    ctx: ExecutionContext,
  ) {
    const nodeMap = new Map(nodes.map(n => [n.id, n]));
    const queue: string[] = [startNode.id];
    const visited = new Set<string>();

    while (queue.length > 0) {
      const nodeId = queue.shift()!;
      if (visited.has(nodeId)) continue;
      visited.add(nodeId);

      const node = nodeMap.get(nodeId);
      if (!node) continue;

      // Update current node on execution
      await this.dataSource.query(
        `UPDATE public.workflow_executions SET current_node_id = $1 WHERE id = $2`,
        [nodeId, ctx.executionId],
      );

      // Execute the node
      const result = await this.executeNode(node, ctx);

      // Log the result
      await this.dataSource.query(
        `INSERT INTO public.workflow_execution_logs (execution_id, node_id, status, input_data, output_data, error_message)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          ctx.executionId,
          nodeId,
          result.status,
          JSON.stringify(result.inputData ?? {}),
          JSON.stringify(result.outputData ?? {}),
          result.errorMessage ?? null,
        ],
      );

      if (result.status === 'failed') {
        throw new Error(result.errorMessage ?? `Node ${node.node_type} failed`);
      }

      // If paused (delay), stop walking
      if (result.paused) {
        return;
      }

      // If skipped (filter didn't pass), stop this branch
      if (result.status === 'skipped') {
        continue;
      }

      // Find next nodes
      const outgoing = connections.filter(c => c.from_node_id === nodeId);

      if (result.branch) {
        // Condition node: follow only the matching branch
        const matchedConnections = outgoing.filter(c => c.branch === result.branch);
        for (const conn of matchedConnections) {
          queue.push(conn.to_node_id);
        }
      } else {
        // Action/trigger: follow all 'default' connections
        for (const conn of outgoing) {
          queue.push(conn.to_node_id);
        }
      }
    }

    // All nodes done — mark completed
    await this.dataSource.query(
      `UPDATE public.workflow_executions SET status = 'completed', completed_at = now() WHERE id = $1`,
      [ctx.executionId],
    );
  }

  /* ───── Node Executor ───── */

  private async executeNode(
    node: WorkflowNodeRow,
    ctx: ExecutionContext,
  ): Promise<{
    status: 'success' | 'failed' | 'skipped';
    branch?: string;
    paused?: boolean;
    inputData?: Record<string, any>;
    outputData?: Record<string, any>;
    errorMessage?: string;
  }> {
    const config = node.node_config ?? {};
    const triggerTypes: readonly string[] = TRIGGER_TYPES;
    const actionTypes: readonly string[] = ACTION_TYPES;
    const conditionTypes: readonly string[] = CONDITION_TYPES;
    const delayTypes: readonly string[] = DELAY_TYPES;
    const filterTypes: readonly string[] = FILTER_TYPES;

    try {
      // Trigger nodes are just entry points — pass through
      if (triggerTypes.includes(node.node_type)) {
        return { status: 'success', inputData: ctx.triggerData, outputData: { message: 'Trigger fired' } };
      }

      // Action nodes
      if (actionTypes.includes(node.node_type)) {
        return await this.executeAction(node.node_type, config, ctx);
      }

      // Condition nodes
      if (conditionTypes.includes(node.node_type)) {
        return await this.executeCondition(node.node_type, config, ctx);
      }

      // Delay nodes
      if (delayTypes.includes(node.node_type)) {
        return await this.executeDelay(node.node_type, config, ctx);
      }

      // Filter nodes
      if (filterTypes.includes(node.node_type)) {
        return await this.executeFilter(node.node_type, config, ctx);
      }

      return { status: 'failed', errorMessage: `Unknown node type: ${node.node_type}` };
    } catch (err: any) {
      return { status: 'failed', errorMessage: err.message };
    }
  }

  /* ───── Action Executor ───── */

  private async executeAction(
    nodeType: string,
    config: Record<string, any>,
    ctx: ExecutionContext,
  ): Promise<{ status: 'success' | 'failed'; inputData: Record<string, any>; outputData: Record<string, any>; errorMessage?: string }> {
    const inputData = { nodeType, config, targetUserId: ctx.targetUserId };

    switch (nodeType) {
      case 'send_email': {
        if (!ctx.targetUserId) return { status: 'success', inputData, outputData: { skipped: true, reason: 'No target user' } };
        const [user] = await this.dataSource.query(`SELECT email, full_name FROM public.users WHERE id = $1`, [ctx.targetUserId]);
        if (!user?.email) return { status: 'success', inputData, outputData: { skipped: true, reason: 'No email' } };
        const [tenant] = await this.dataSource.query(`SELECT name FROM public.tenants WHERE id = $1`, [ctx.tenantId]);
        const result = await this.emailService.sendEmail([user.email], config.subject ?? 'Notification', config.body ?? '', tenant?.name);
        return { status: 'success', inputData, outputData: { sent: result.sent, failed: result.failed } };
      }

      case 'send_sms': {
        if (!ctx.targetUserId) return { status: 'success', inputData, outputData: { skipped: true, reason: 'No target user' } };
        const [user] = await this.dataSource.query(`SELECT phone FROM public.users WHERE id = $1`, [ctx.targetUserId]);
        if (!user?.phone) return { status: 'success', inputData, outputData: { skipped: true, reason: 'No phone' } };
        const result = await this.smsService.sendSms([user.phone], config.body ?? '');
        return { status: 'success', inputData, outputData: { sent: result.sent, failed: result.failed } };
      }

      case 'send_push': {
        if (!ctx.targetUserId) return { status: 'success', inputData, outputData: { skipped: true, reason: 'No target user' } };
        await this.oneSignalService.sendPush(ctx.targetUserId, config.title ?? 'Notification', config.body ?? '');
        return { status: 'success', inputData, outputData: { sent: true } };
      }

      case 'send_notification': {
        if (!ctx.targetUserId) return { status: 'success', inputData, outputData: { skipped: true, reason: 'No target user' } };
        await this.dataSource.query(
          `INSERT INTO public.notifications (recipient_id, tenant_id, type, payload)
           VALUES ($1, $2, 'WORKFLOW', $3)`,
          [ctx.targetUserId, ctx.tenantId, JSON.stringify({ message: config.message ?? '', workflowId: ctx.workflowId })],
        );
        return { status: 'success', inputData, outputData: { notified: true } };
      }

      case 'create_task': {
        const [workflow] = await this.dataSource.query(`SELECT created_by FROM public.workflows WHERE id = $1 AND tenant_id = $2`, [ctx.workflowId, ctx.tenantId]);
        const [task] = await this.dataSource.query(
          `INSERT INTO public.tasks (tenant_id, title, priority, assigned_to, created_by, linked_type, linked_id)
           VALUES ($1, $2, $3, $4, $5, 'workflow', $6)
           RETURNING id`,
          [ctx.tenantId, config.title ?? 'Auto-created task', config.priority ?? 'medium', config.assignedTo ?? null, workflow?.created_by ?? ctx.targetUserId, ctx.workflowId],
        );
        return { status: 'success', inputData, outputData: { taskId: task?.id } };
      }

      case 'create_care_case': {
        const [workflow] = await this.dataSource.query(`SELECT created_by FROM public.workflows WHERE id = $1 AND tenant_id = $2`, [ctx.workflowId, ctx.tenantId]);
        const [cc] = await this.dataSource.query(
          `INSERT INTO public.care_cases (tenant_id, member_id, title, priority, created_by)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id`,
          [ctx.tenantId, ctx.targetUserId, config.title ?? 'Auto-created care case', config.priority ?? 'medium', workflow?.created_by],
        );
        return { status: 'success', inputData, outputData: { careCaseId: cc?.id } };
      }

      case 'assign_tag': {
        if (!ctx.targetUserId || !config.tagId) return { status: 'success', inputData, outputData: { skipped: true } };
        await this.dataSource.query(
          `INSERT INTO public.member_tags (tenant_id, user_id, tag_id)
           VALUES ($1, $2, $3)
           ON CONFLICT DO NOTHING`,
          [ctx.tenantId, ctx.targetUserId, config.tagId],
        );
        return { status: 'success', inputData, outputData: { tagged: true } };
      }

      case 'remove_tag': {
        if (!ctx.targetUserId || !config.tagId) return { status: 'success', inputData, outputData: { skipped: true } };
        await this.dataSource.query(
          `DELETE FROM public.member_tags WHERE tenant_id = $1 AND user_id = $2 AND tag_id = $3`,
          [ctx.tenantId, ctx.targetUserId, config.tagId],
        );
        return { status: 'success', inputData, outputData: { untagged: true } };
      }

      case 'add_to_group': {
        if (!ctx.targetUserId || !config.groupId) return { status: 'success', inputData, outputData: { skipped: true } };
        // Verify group belongs to this tenant before inserting
        const [group] = await this.dataSource.query(
          `SELECT id FROM public.groups WHERE id = $1 AND tenant_id = $2`,
          [config.groupId, ctx.tenantId],
        );
        if (!group) return { status: 'success', inputData, outputData: { skipped: true, reason: 'Group not in tenant' } };
        await this.dataSource.query(
          `INSERT INTO public.group_members (group_id, user_id, role)
           VALUES ($1, $2, 'member')
           ON CONFLICT DO NOTHING`,
          [config.groupId, ctx.targetUserId],
        );
        return { status: 'success', inputData, outputData: { addedToGroup: true } };
      }

      case 'remove_from_group': {
        if (!ctx.targetUserId || !config.groupId) return { status: 'success', inputData, outputData: { skipped: true } };
        // Verify group belongs to this tenant before deleting
        const [group] = await this.dataSource.query(
          `SELECT id FROM public.groups WHERE id = $1 AND tenant_id = $2`,
          [config.groupId, ctx.tenantId],
        );
        if (!group) return { status: 'success', inputData, outputData: { skipped: true, reason: 'Group not in tenant' } };
        await this.dataSource.query(
          `DELETE FROM public.group_members WHERE group_id = $1 AND user_id = $2`,
          [config.groupId, ctx.targetUserId],
        );
        return { status: 'success', inputData, outputData: { removedFromGroup: true } };
      }

      case 'update_journey': {
        if (!ctx.targetUserId || !config.field) return { status: 'success', inputData, outputData: { skipped: true } };
        // Lookup map prevents SQL injection via workflow config.field — untrusted DB
        // data is never concatenated into the query.
        const JOURNEY_FIELD_MAP: Record<string, string> = {
          attended_members_class: 'attended_members_class',
          members_class_date: 'members_class_date',
          is_baptized: 'is_baptized',
          baptism_date: 'baptism_date',
          salvation_date: 'salvation_date',
          discipleship_track: 'discipleship_track',
          skills: 'skills',
          interests: 'interests',
          bio: 'bio',
        };
        const col = JOURNEY_FIELD_MAP[config.field as string];
        if (!col) {
          this.logger.warn(`update_journey: invalid field "${config.field}" rejected`);
          return { status: 'success', inputData, outputData: { skipped: true, reason: 'Invalid field' } };
        }
        await this.dataSource.query(
          `INSERT INTO public.member_journeys (tenant_id, user_id, ${col})
           VALUES ($1, $2, $3)
           ON CONFLICT (tenant_id, user_id) DO UPDATE SET ${col} = $3`,
          [ctx.tenantId, ctx.targetUserId, config.value],
        );
        return { status: 'success', inputData, outputData: { updated: true } };
      }

      case 'update_member_role': {
        if (!ctx.targetUserId || !config.role) return { status: 'success', inputData, outputData: { skipped: true } };
        await this.dataSource.query(
          `UPDATE public.tenant_memberships SET role = $1 WHERE tenant_id = $2 AND user_id = $3`,
          [config.role, ctx.tenantId, ctx.targetUserId],
        );
        return { status: 'success', inputData, outputData: { roleUpdated: config.role } };
      }

      case 'generate_report': {
        // Simple stub: send an email with report summary
        const reportType = config.reportType ?? 'members';
        let reportData = '';

        if (reportType === 'members') {
          const [cnt] = await this.dataSource.query(
            `SELECT COUNT(*)::int AS total FROM public.tenant_memberships WHERE tenant_id = $1`, [ctx.tenantId],
          );
          reportData = `Total members: ${cnt.total}`;
        } else if (reportType === 'giving') {
          const [sum] = await this.dataSource.query(
            `SELECT COALESCE(SUM(amount), 0)::float AS total FROM public.transactions WHERE tenant_id = $1 AND created_at >= date_trunc('month', now())`, [ctx.tenantId],
          );
          reportData = `Giving this month: $${sum.total}`;
        } else {
          reportData = `Report type: ${reportType} (detailed report coming soon)`;
        }

        if (config.sendTo) {
          await this.emailService.sendEmail([config.sendTo], `${reportType} Report`, reportData);
        }
        return { status: 'success', inputData, outputData: { reportData } };
      }

      case 'trigger_workflow': {
        if (!config.workflowId) return { status: 'failed', inputData, outputData: {}, errorMessage: 'No workflowId configured' };
        const result = await this.executeWorkflow(config.workflowId, ctx.tenantId, ctx.targetUserId ?? undefined, ctx.triggerData);
        return { status: 'success', inputData, outputData: { childExecutionId: result.executionId } };
      }

      case 'webhook': {
        if (!config.url) return { status: 'failed', inputData, outputData: {}, errorMessage: 'No URL configured' };
        let headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (config.headers) {
          try { headers = { ...headers, ...JSON.parse(config.headers) }; } catch { /* ignore parse errors */ }
        }
        const response = await fetch(config.url, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            workflowId: ctx.workflowId,
            executionId: ctx.executionId,
            tenantId: ctx.tenantId,
            targetUserId: ctx.targetUserId,
            triggerData: ctx.triggerData,
          }),
        });
        return { status: 'success', inputData, outputData: { statusCode: response.status } };
      }

      case 'log_activity': {
        // Logged via the execution log itself — output the message
        return { status: 'success', inputData, outputData: { message: config.message ?? '' } };
      }

      case 'award_badge': {
        if (!ctx.targetUserId || !config.badgeId) return { status: 'success', inputData, outputData: { skipped: true } };
        await this.dataSource.query(
          `INSERT INTO public.member_badges (badge_id, user_id, tenant_id, awarded_by, awarded_reason)
           VALUES ($1, $2, $3, NULL, $4)
           ON CONFLICT (badge_id, user_id) DO NOTHING`,
          [config.badgeId, ctx.targetUserId, ctx.tenantId, config.reason ?? 'Awarded by workflow'],
        );
        return { status: 'success', inputData, outputData: { badgeAwarded: true } };
      }

      case 'revoke_badge': {
        if (!ctx.targetUserId || !config.badgeId) return { status: 'success', inputData, outputData: { skipped: true } };
        await this.dataSource.query(
          `DELETE FROM public.member_badges WHERE badge_id = $1 AND user_id = $2 AND tenant_id = $3`,
          [config.badgeId, ctx.targetUserId, ctx.tenantId],
        );
        return { status: 'success', inputData, outputData: { badgeRevoked: true } };
      }

      case 'check_auto_badges': {
        if (!ctx.targetUserId) return { status: 'success', inputData, outputData: { skipped: true, reason: 'No target user' } };
        // Load all active badges with auto_award_rules for this tenant
        const autoBadges = await this.dataSource.query(
          `SELECT id, name, auto_award_rule FROM public.badges
           WHERE tenant_id = $1 AND is_active = true AND auto_award_rule IS NOT NULL`,
          [ctx.tenantId],
        );
        const awarded: string[] = [];
        for (const badge of autoBadges) {
          const rule = badge.auto_award_rule;
          if (!rule || !rule.type) continue;
          const [existing] = await this.dataSource.query(
            `SELECT 1 FROM public.member_badges WHERE badge_id = $1 AND user_id = $2 AND tenant_id = $3`,
            [badge.id, ctx.targetUserId, ctx.tenantId],
          );
          if (existing) continue;
          let qualified = false;
          switch (rule.type) {
            case 'giving_lifetime': {
              const [r] = await this.dataSource.query(
                `SELECT COALESCE(SUM(amount), 0)::float AS total FROM public.transactions WHERE user_id = $1 AND tenant_id = $2 AND status = 'succeeded'`,
                [ctx.targetUserId, ctx.tenantId],
              );
              qualified = (r?.total ?? 0) >= (rule.threshold ?? 0);
              break;
            }
            case 'attendance_count': {
              const [r] = await this.dataSource.query(
                `SELECT COUNT(*)::int AS cnt FROM public.check_ins WHERE user_id = $1 AND tenant_id = $2`,
                [ctx.targetUserId, ctx.tenantId],
              );
              qualified = (r?.cnt ?? 0) >= (rule.count ?? 0);
              break;
            }
            case 'baptized': {
              const [r] = await this.dataSource.query(
                `SELECT is_baptized FROM public.member_journeys WHERE user_id = $1 AND tenant_id = $2`,
                [ctx.targetUserId, ctx.tenantId],
              );
              qualified = r?.is_baptized === true;
              break;
            }
            case 'members_class': {
              const [r] = await this.dataSource.query(
                `SELECT attended_members_class FROM public.member_journeys WHERE user_id = $1 AND tenant_id = $2`,
                [ctx.targetUserId, ctx.tenantId],
              );
              qualified = r?.attended_members_class === true;
              break;
            }
            case 'group_count': {
              const [r] = await this.dataSource.query(
                `SELECT COUNT(DISTINCT gm.group_id)::int AS cnt FROM public.group_members gm
                 JOIN public.groups g ON g.id = gm.group_id AND g.tenant_id = $2
                 WHERE gm.user_id = $1`,
                [ctx.targetUserId, ctx.tenantId],
              );
              qualified = (r?.cnt ?? 0) >= (rule.min ?? 1);
              break;
            }
            case 'volunteer_hours': {
              const [r] = await this.dataSource.query(
                `SELECT COALESCE(SUM(hours), 0)::float AS total FROM public.volunteer_hours WHERE user_id = $1 AND tenant_id = $2`,
                [ctx.targetUserId, ctx.tenantId],
              );
              qualified = (r?.total ?? 0) >= (rule.min ?? 0);
              break;
            }
          }
          if (qualified) {
            await this.dataSource.query(
              `INSERT INTO public.member_badges (badge_id, user_id, tenant_id, awarded_reason)
               VALUES ($1, $2, $3, $4)
               ON CONFLICT (badge_id, user_id) DO NOTHING`,
              [badge.id, ctx.targetUserId, ctx.tenantId, `Auto-awarded: ${rule.type}`],
            );
            awarded.push(badge.name);
          }
        }
        return { status: 'success', inputData, outputData: { awarded } };
      }

      default:
        return { status: 'failed', inputData, outputData: {}, errorMessage: `Unknown action: ${nodeType}` };
    }
  }

  /* ───── Condition Executor ───── */

  private async executeCondition(
    nodeType: string,
    config: Record<string, any>,
    ctx: ExecutionContext,
  ): Promise<{ status: 'success' | 'failed'; branch: string; inputData: Record<string, any>; outputData: Record<string, any>; errorMessage?: string }> {
    const inputData = { nodeType, config, targetUserId: ctx.targetUserId };

    switch (nodeType) {
      case 'check_tag': {
        if (!ctx.targetUserId || !config.tagId) return { status: 'success', branch: 'false', inputData, outputData: { reason: 'Missing target or tag' } };
        const [row] = await this.dataSource.query(
          `SELECT 1 FROM public.member_tags WHERE tenant_id = $1 AND user_id = $2 AND tag_id = $3`,
          [ctx.tenantId, ctx.targetUserId, config.tagId],
        );
        return { status: 'success', branch: row ? 'true' : 'false', inputData, outputData: { hasTag: !!row } };
      }

      case 'check_attendance': {
        if (!ctx.targetUserId) return { status: 'success', branch: 'false', inputData, outputData: {} };
        const days = Math.max(1, Math.min(3650, parseInt(String(config.days ?? 30), 10) || 30));
        const minCount = parseInt(String(config.minCount ?? 1), 10) || 1;
        const [row] = await this.dataSource.query(
          `SELECT COUNT(*)::int AS cnt FROM public.check_ins
           WHERE user_id = $1 AND tenant_id = $2 AND checked_in_at >= now() - ($3 || ' days')::interval`,
          [ctx.targetUserId, ctx.tenantId, days],
        );
        const met = (row?.cnt ?? 0) >= minCount;
        return { status: 'success', branch: met ? 'true' : 'false', inputData, outputData: { count: row?.cnt, required: minCount } };
      }

      case 'check_giving': {
        if (!ctx.targetUserId) return { status: 'success', branch: 'false', inputData, outputData: {} };
        const days = Math.max(1, Math.min(3650, parseInt(String(config.days ?? 30), 10) || 30));
        const minAmount = parseFloat(String(config.minAmount ?? 0)) || 0;
        const [row] = await this.dataSource.query(
          `SELECT COALESCE(SUM(amount), 0)::float AS total FROM public.transactions
           WHERE user_id = $1 AND tenant_id = $2 AND created_at >= now() - ($3 || ' days')::interval`,
          [ctx.targetUserId, ctx.tenantId, days],
        );
        const met = (row?.total ?? 0) >= minAmount;
        return { status: 'success', branch: met ? 'true' : 'false', inputData, outputData: { total: row?.total, required: minAmount } };
      }

      case 'check_group_membership': {
        if (!ctx.targetUserId || !config.groupId) return { status: 'success', branch: 'false', inputData, outputData: {} };
        const [row] = await this.dataSource.query(
          `SELECT 1 FROM public.group_members gm
           JOIN public.groups g ON g.id = gm.group_id AND g.tenant_id = $3
           WHERE gm.group_id = $1 AND gm.user_id = $2`,
          [config.groupId, ctx.targetUserId, ctx.tenantId],
        );
        return { status: 'success', branch: row ? 'true' : 'false', inputData, outputData: { inGroup: !!row } };
      }

      case 'check_engagement': {
        if (!ctx.targetUserId) return { status: 'success', branch: 'false', inputData, outputData: {} };
        // Simple engagement: count activities in last 30 days
        const [checkins] = await this.dataSource.query(
          `SELECT COUNT(*)::int AS cnt FROM public.check_ins WHERE user_id = $1 AND tenant_id = $2 AND checked_in_at >= now() - '30 days'::interval`,
          [ctx.targetUserId, ctx.tenantId],
        );
        const [giving] = await this.dataSource.query(
          `SELECT COUNT(*)::int AS cnt FROM public.transactions WHERE user_id = $1 AND tenant_id = $2 AND created_at >= now() - '30 days'::interval`,
          [ctx.targetUserId, ctx.tenantId],
        );
        const score = (checkins?.cnt ?? 0) + (giving?.cnt ?? 0);
        const levelThresholds: Record<string, number> = { inactive: 0, low: 1, medium: 3, high: 6 };
        const threshold = levelThresholds[config.level] ?? 0;
        const met = score >= threshold;
        return { status: 'success', branch: met ? 'true' : 'false', inputData, outputData: { score, threshold } };
      }

      case 'check_journey_stage': {
        if (!ctx.targetUserId || !config.milestone) return { status: 'success', branch: 'false', inputData, outputData: {} };
        const [journey] = await this.dataSource.query(
          `SELECT * FROM public.member_journeys WHERE tenant_id = $1 AND user_id = $2`,
          [ctx.tenantId, ctx.targetUserId],
        );
        if (!journey) return { status: 'success', branch: 'false', inputData, outputData: { reason: 'No journey record' } };
        const value = journey[config.milestone];
        const met = value === true || (typeof value === 'string' && value.length > 0);
        return { status: 'success', branch: met ? 'true' : 'false', inputData, outputData: { milestone: config.milestone, value } };
      }

      case 'check_member_data': {
        if (!ctx.targetUserId) return { status: 'success', branch: 'false', inputData, outputData: {} };
        const [user] = await this.dataSource.query(
          `SELECT u.*, tm.role FROM public.users u
           LEFT JOIN public.tenant_memberships tm ON tm.user_id = u.id AND tm.tenant_id = $2
           WHERE u.id = $1`,
          [ctx.targetUserId, ctx.tenantId],
        );
        if (!user) return { status: 'success', branch: 'false', inputData, outputData: { reason: 'User not found' } };

        const field = config.field;
        const operator = config.operator;
        const value = config.value;
        let fieldValue: any;

        if (field === 'role') fieldValue = user.role;
        else if (field === 'has_phone') fieldValue = !!user.phone;
        else if (field === 'has_email') fieldValue = !!user.email;
        else if (field === 'full_name') fieldValue = user.full_name;
        else fieldValue = user[field];

        let met = false;
        if (operator === 'equals') met = String(fieldValue) === String(value);
        else if (operator === 'not_equals') met = String(fieldValue) !== String(value);
        else if (operator === 'exists') met = fieldValue !== null && fieldValue !== undefined && fieldValue !== '' && fieldValue !== false;
        else if (operator === 'not_exists') met = fieldValue === null || fieldValue === undefined || fieldValue === '' || fieldValue === false;

        return { status: 'success', branch: met ? 'true' : 'false', inputData, outputData: { field, fieldValue, operator, compared: value } };
      }

      case 'check_date': {
        const dateField = config.dateField;
        const operator = config.operator;
        const value = config.value;
        let met = false;

        if (dateField === 'day_of_week') {
          const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
          const today = days[new Date().getDay()];
          if (operator === 'equals') met = today === value?.toLowerCase();
        } else if (dateField === 'today') {
          const todayStr = new Date().toISOString().slice(0, 10);
          if (operator === 'equals') met = todayStr === value;
          else if (operator === 'before') met = todayStr < value;
          else if (operator === 'after') met = todayStr > value;
        }

        return { status: 'success', branch: met ? 'true' : 'false', inputData, outputData: { met } };
      }

      case 'always_true': {
        return { status: 'success', branch: 'true', inputData, outputData: { always: true } };
      }

      case 'check_badge': {
        if (!ctx.targetUserId || !config.badgeId) return { status: 'success', branch: 'false', inputData, outputData: { reason: 'Missing target or badge' } };
        const [row] = await this.dataSource.query(
          `SELECT 1 FROM public.member_badges WHERE badge_id = $1 AND user_id = $2 AND tenant_id = $3`,
          [config.badgeId, ctx.targetUserId, ctx.tenantId],
        );
        return { status: 'success', branch: row ? 'true' : 'false', inputData, outputData: { hasBadge: !!row } };
      }

      case 'weather_check': {
        try {
          // Get church location from check-in config, or use provided coords
          let lat = config.latitude;
          let lng = config.longitude;

          if (!lat || !lng) {
            const [churchLoc] = await this.dataSource.query(
              `SELECT latitude, longitude FROM public.checkin_configs WHERE tenant_id = $1`,
              [ctx.tenantId],
            );
            lat = churchLoc?.latitude ?? 33.749;
            lng = churchLoc?.longitude ?? -84.388;
          }

          // Fetch from Open-Meteo (free, no API key)
          const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,weather_code&temperature_unit=fahrenheit`;
          const res = await fetch(url);
          const data = await res.json();
          const tempF = data.current?.temperature_2m ?? 0;
          const weatherCode = data.current?.weather_code ?? 0;

          // WMO weather codes: 61-67=rain, 71-77=snow, 95-99=thunderstorm
          const isRaining = weatherCode >= 61 && weatherCode <= 67;
          const isSnowing = weatherCode >= 71 && weatherCode <= 77;
          const isStormy = weatherCode >= 95 && weatherCode <= 99;

          let conditionMet = false;
          const condition = config.condition ?? 'temp_above';

          switch (condition) {
            case 'temp_above':
              conditionMet = tempF > (config.tempThreshold ?? 95);
              break;
            case 'temp_below':
              conditionMet = tempF < (config.tempThreshold ?? 32);
              break;
            case 'temp_between':
              conditionMet = tempF >= (config.tempMin ?? 0) && tempF <= (config.tempMax ?? 100);
              break;
            case 'is_raining':
              conditionMet = isRaining;
              break;
            case 'is_snowing':
              conditionMet = isSnowing;
              break;
            case 'is_stormy':
              conditionMet = isStormy;
              break;
          }

          return {
            status: 'success',
            branch: conditionMet ? 'true' : 'false',
            inputData,
            outputData: { tempF, weatherCode, isRaining, isSnowing, isStormy, condition, conditionMet },
          };
        } catch (err: any) {
          this.logger.error(`Weather check failed: ${err.message}`);
          return { status: 'success', branch: 'false', inputData, outputData: { error: err.message } };
        }
      }

      default:
        return { status: 'failed', branch: 'false', inputData, outputData: {}, errorMessage: `Unknown condition: ${nodeType}` };
    }
  }

  /* ───── Delay Executor ───── */

  private async executeDelay(
    nodeType: string,
    config: Record<string, any>,
    ctx: ExecutionContext,
  ): Promise<{ status: 'success'; paused: true; inputData: Record<string, any>; outputData: Record<string, any> }> {
    let nextStepAt: Date;

    switch (nodeType) {
      case 'wait_duration': {
        const amount = config.amount ?? 1;
        const unit = config.unit ?? 'hours';
        const ms: Record<string, number> = {
          minutes: 60 * 1000,
          hours: 60 * 60 * 1000,
          days: 24 * 60 * 60 * 1000,
          weeks: 7 * 24 * 60 * 60 * 1000,
        };
        nextStepAt = new Date(Date.now() + amount * (ms[unit] ?? ms.hours));
        break;
      }

      case 'wait_until_date': {
        nextStepAt = new Date(config.date);
        if (nextStepAt.getTime() <= Date.now()) {
          // Date already passed, don't pause
          return { status: 'success', paused: false as any, inputData: { nodeType, config }, outputData: { message: 'Date already passed, continuing' } } as any;
        }
        break;
      }

      case 'wait_until_day': {
        const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
        const targetDay = days.indexOf(config.dayOfWeek?.toLowerCase());
        if (targetDay === -1) {
          nextStepAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // fallback 1 day
        } else {
          const now = new Date();
          let daysUntil = targetDay - now.getDay();
          if (daysUntil <= 0) daysUntil += 7;
          nextStepAt = new Date(now.getTime() + daysUntil * 24 * 60 * 60 * 1000);
          nextStepAt.setHours(9, 0, 0, 0); // Resume at 9 AM
        }
        break;
      }

      case 'approval_gate': {
        const timeoutHours = config.timeoutHours ?? 24;
        nextStepAt = new Date(Date.now() + timeoutHours * 60 * 60 * 1000);

        // Find all admins/pastors to notify
        const admins = await this.dataSource.query(
          `SELECT tm.user_id, u.full_name, u.email, u.phone
           FROM public.tenant_memberships tm
           JOIN public.users u ON u.id = tm.user_id
           WHERE tm.tenant_id = $1 AND tm.role IN ('admin', 'pastor')`,
          [ctx.tenantId],
        );

        const approvalMessage = config.message ?? 'A workflow requires your approval to continue.';
        const notifyVia = config.notifyVia ?? 'all';
        const approvalPayload = {
          executionId: ctx.executionId,
          workflowId: ctx.workflowId,
          message: approvalMessage,
          timeoutAction: config.timeoutAction ?? 'cancel',
          expiresAt: nextStepAt.toISOString(),
        };

        for (const admin of admins) {
          // Always send in-app notification
          if (notifyVia === 'notification' || notifyVia === 'all') {
            await this.dataSource.query(
              `INSERT INTO public.notifications (recipient_id, tenant_id, type, payload)
               VALUES ($1, $2, 'workflow_approval', $3::jsonb)`,
              [admin.user_id, ctx.tenantId, JSON.stringify({ title: 'Approval Required', body: approvalMessage, ...approvalPayload })],
            );
          }

          // Send email if configured and email service available
          if ((notifyVia === 'email' || notifyVia === 'all') && admin.email) {
            await this.dataSource.query(
              `INSERT INTO public.sent_messages (tenant_id, channel, recipient, subject, body, status)
               VALUES ($1, 'email', $2, 'Workflow Approval Required', $3, 'queued')`,
              [ctx.tenantId, admin.email, `${approvalMessage}\n\nThis request expires in ${timeoutHours} hours.`],
            );
          }

          // Send SMS if configured and phone available
          if ((notifyVia === 'sms' || notifyVia === 'all') && admin.phone) {
            await this.dataSource.query(
              `INSERT INTO public.sent_messages (tenant_id, channel, recipient, body, status)
               VALUES ($1, 'sms', $2, $3, 'queued')`,
              [ctx.tenantId, admin.phone, `SHEPARD APPROVAL: ${approvalMessage} — Expires in ${timeoutHours}h`],
            );
          }
        }

        // Store approval metadata on the execution for the approve endpoint
        await this.dataSource.query(
          `UPDATE public.workflow_executions
           SET status = 'paused', current_node_id = $1, next_step_at = $2,
               trigger_data = jsonb_set(COALESCE(trigger_data, '{}'), '{_approval}', $3::jsonb)
           WHERE id = $4`,
          [
            null,
            nextStepAt.toISOString(),
            JSON.stringify({ pending: true, message: approvalMessage, timeoutAction: config.timeoutAction ?? 'cancel' }),
            ctx.executionId,
          ],
        );

        return {
          status: 'success',
          paused: true,
          inputData: { nodeType, config },
          outputData: {
            notifiedAdmins: admins.length,
            expiresAt: nextStepAt.toISOString(),
            timeoutAction: config.timeoutAction ?? 'cancel',
          },
        };
      }

      default:
        nextStepAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour fallback
    }

    // TODO(bullmq-resume): For long delays the execution is persisted as 'paused' and must be
    // resumed by an external scheduler (e.g. a BullMQ delayed job targeting a 'workflow-resume'
    // queue). Until that queue exists, a cron job or manual trigger is needed to resume executions
    // whose next_step_at has passed. Short delays (≤60s) could be kept in-process but all delays
    // here are stored in the DB and the worker exits — no in-process timer is used.
    const delayMs = nextStepAt.getTime() - Date.now();
    if (delayMs > 60_000) {
      this.logger.warn(
        `Workflow ${ctx.workflowId} execution ${ctx.executionId} paused for ${Math.round(delayMs / 1000)}s. ` +
        `Resumption requires an external scheduler (bullmq-resume queue not yet implemented).`,
      );
    }

    // Set execution to paused with next_step_at
    await this.dataSource.query(
      `UPDATE public.workflow_executions SET status = 'paused', current_node_id = $1, next_step_at = $2
       WHERE id = $3`,
      [null, nextStepAt.toISOString(), ctx.executionId],
    );

    return { status: 'success', paused: true, inputData: { nodeType, config }, outputData: { nextStepAt: nextStepAt.toISOString() } };
  }

  /* ───── Filter Executor ───── */

  private async executeFilter(
    nodeType: string,
    config: Record<string, any>,
    ctx: ExecutionContext,
  ): Promise<{ status: 'success' | 'skipped'; inputData: Record<string, any>; outputData: Record<string, any> }> {
    const inputData = { nodeType, config, targetUserId: ctx.targetUserId };

    if (!ctx.targetUserId) {
      return { status: 'skipped', inputData, outputData: { reason: 'No target user' } };
    }

    switch (nodeType) {
      case 'filter_by_tag': {
        if (!config.tagId) return { status: 'skipped', inputData, outputData: { reason: 'No tag configured' } };
        const [row] = await this.dataSource.query(
          `SELECT 1 FROM public.member_tags WHERE tenant_id = $1 AND user_id = $2 AND tag_id = $3`,
          [ctx.tenantId, ctx.targetUserId, config.tagId],
        );
        return { status: row ? 'success' : 'skipped', inputData, outputData: { hasTag: !!row } };
      }

      case 'filter_by_role': {
        if (!config.role) return { status: 'skipped', inputData, outputData: { reason: 'No role configured' } };
        const [row] = await this.dataSource.query(
          `SELECT 1 FROM public.tenant_memberships WHERE tenant_id = $1 AND user_id = $2 AND role = $3`,
          [ctx.tenantId, ctx.targetUserId, config.role],
        );
        return { status: row ? 'success' : 'skipped', inputData, outputData: { hasRole: !!row } };
      }

      case 'filter_by_group': {
        if (!config.groupId) return { status: 'skipped', inputData, outputData: { reason: 'No group configured' } };
        const [row] = await this.dataSource.query(
          `SELECT 1 FROM public.group_members gm
           JOIN public.groups g ON g.id = gm.group_id AND g.tenant_id = $3
           WHERE gm.group_id = $1 AND gm.user_id = $2`,
          [config.groupId, ctx.targetUserId, ctx.tenantId],
        );
        return { status: row ? 'success' : 'skipped', inputData, outputData: { inGroup: !!row } };
      }

      default:
        return { status: 'skipped', inputData, outputData: { reason: `Unknown filter: ${nodeType}` } };
    }
  }

  /* ───── Failure Handler ───── */

  private async failExecution(ctx: ExecutionContext, errorMessage: string) {
    this.logger.error(`Workflow execution ${ctx.executionId} failed: ${errorMessage}`);

    await this.dataSource.query(
      `UPDATE public.workflow_executions SET status = 'failed', error_message = $1, completed_at = now()
       WHERE id = $2`,
      [errorMessage, ctx.executionId],
    );

    // Notify the workflow creator
    try {
      const [workflow] = await this.dataSource.query(
        `SELECT created_by, name FROM public.workflows WHERE id = $1 AND tenant_id = $2`,
        [ctx.workflowId, ctx.tenantId],
      );
      if (workflow?.created_by) {
        let targetUserName = 'Unknown';
        if (ctx.targetUserId) {
          const [user] = await this.dataSource.query(
            `SELECT full_name FROM public.users WHERE id = $1`, [ctx.targetUserId],
          );
          targetUserName = user?.full_name ?? 'Unknown';
        }

        await this.dataSource.query(
          `INSERT INTO public.notifications (recipient_id, tenant_id, type, payload)
           VALUES ($1, $2, 'WORKFLOW_FAILED', $3)`,
          [
            workflow.created_by,
            ctx.tenantId,
            JSON.stringify({
              workflowName: workflow.name,
              executionId: ctx.executionId,
              targetUserName,
              error: errorMessage,
            }),
          ],
        );
      }
    } catch (notifyErr: any) {
      this.logger.error(`Failed to notify workflow creator: ${notifyErr.message}`);
    }
  }

  /* ───── Approval Gate Handler ───── */

  async handleApproval(tenantId: string, executionId: string, approved: boolean) {
    // Verify the execution is paused and belongs to this tenant
    const [exec] = await this.dataSource.query(
      `SELECT we.*, w.tenant_id
       FROM public.workflow_executions we
       JOIN public.workflows w ON w.id = we.workflow_id
       WHERE we.id = $1 AND w.tenant_id = $2 AND we.status = 'paused'`,
      [executionId, tenantId],
    );

    if (!exec) {
      return { error: 'Execution not found or not awaiting approval' };
    }

    const approval = exec.trigger_data?._approval;
    if (!approval?.pending) {
      return { error: 'This execution is not awaiting approval' };
    }

    if (approved) {
      // Clear approval flag and resume
      await this.dataSource.query(
        `UPDATE public.workflow_executions
         SET status = 'running', next_step_at = NULL,
             trigger_data = jsonb_set(trigger_data, '{_approval}', '{"pending":false,"approved":true}'::jsonb)
         WHERE id = $1`,
        [executionId],
      );

      // Log the approval
      const [lastLog] = await this.dataSource.query(
        `SELECT node_id FROM public.workflow_execution_logs
         WHERE execution_id = $1 ORDER BY executed_at DESC LIMIT 1`,
        [executionId],
      );

      await this.dataSource.query(
        `INSERT INTO public.workflow_execution_logs (execution_id, node_id, status, input_data, output_data)
         VALUES ($1, $2, 'success', '{"action":"approval_response"}'::jsonb, '{"approved":true}'::jsonb)`,
        [executionId, lastLog?.node_id],
      );

      // Resume from where we left off
      const nodes: WorkflowNodeRow[] = await this.dataSource.query(
        `SELECT * FROM public.workflow_nodes WHERE workflow_id = $1`, [exec.workflow_id],
      );
      const connections: WorkflowConnectionRow[] = await this.dataSource.query(
        `SELECT * FROM public.workflow_connections WHERE workflow_id = $1`, [exec.workflow_id],
      );

      const ctx: ExecutionContext = {
        executionId: exec.id,
        workflowId: exec.workflow_id,
        tenantId,
        targetUserId: exec.target_user_id,
        triggerData: { ...exec.trigger_data, _approval: { pending: false, approved: true } },
      };

      if (lastLog) {
        const outgoing = connections.filter(c => c.from_node_id === lastLog.node_id);
        const nodeMap = new Map(nodes.map(n => [n.id, n]));
        for (const conn of outgoing) {
          const nextNode = nodeMap.get(conn.to_node_id);
          if (nextNode) {
            await this.walkGraph(nextNode, nodes, connections, ctx);
          }
        }
      }

      // Check if workflow is done
      await this.dataSource.query(
        `UPDATE public.workflow_executions SET status = 'completed', completed_at = now()
         WHERE id = $1 AND status = 'running'`,
        [executionId],
      );

      return { status: 'approved', message: 'Workflow resumed' };
    } else {
      // Denied — cancel the execution
      await this.dataSource.query(
        `UPDATE public.workflow_executions
         SET status = 'cancelled', completed_at = now(),
             trigger_data = jsonb_set(trigger_data, '{_approval}', '{"pending":false,"approved":false}'::jsonb)
         WHERE id = $1`,
        [executionId],
      );

      return { status: 'denied', message: 'Workflow cancelled' };
    }
  }

  /* ───── Resume Paused Executions ───── */

  @Cron('*/1 * * * *')
  async resumePausedExecutions() {
    const paused = await this.dataSource.query(
      `SELECT we.*, w.tenant_id AS w_tenant_id
       FROM public.workflow_executions we
       JOIN public.workflows w ON w.id = we.workflow_id
       WHERE we.status = 'paused' AND we.next_step_at <= now()`,
    );

    for (const exec of paused) {
      this.logger.log(`Resuming paused execution ${exec.id}`);
      try {
        // Check if this is an approval gate that timed out
        const approval = exec.trigger_data?._approval;
        if (approval?.pending) {
          const timeoutAction = approval.timeoutAction ?? 'cancel';
          if (timeoutAction === 'cancel') {
            this.logger.log(`Approval gate timed out for execution ${exec.id} — cancelling`);
            await this.dataSource.query(
              `UPDATE public.workflow_executions SET status = 'cancelled', completed_at = now(),
                trigger_data = jsonb_set(trigger_data, '{_approval}', '{"pending":false,"approved":false,"timedOut":true}'::jsonb)
               WHERE id = $1`,
              [exec.id],
            );
            continue;
          }
          // timeoutAction === 'continue' — clear approval and resume normally
          await this.dataSource.query(
            `UPDATE public.workflow_executions
             SET trigger_data = jsonb_set(trigger_data, '{_approval}', '{"pending":false,"approved":true,"timedOut":true}'::jsonb)
             WHERE id = $1`,
            [exec.id],
          );
        }

        // Set back to running
        await this.dataSource.query(
          `UPDATE public.workflow_executions SET status = 'running', next_step_at = NULL WHERE id = $1`,
          [exec.id],
        );

        // Load workflow graph
        const nodes: WorkflowNodeRow[] = await this.dataSource.query(
          `SELECT * FROM public.workflow_nodes WHERE workflow_id = $1`, [exec.workflow_id],
        );
        const connections: WorkflowConnectionRow[] = await this.dataSource.query(
          `SELECT * FROM public.workflow_connections WHERE workflow_id = $1`, [exec.workflow_id],
        );

        const ctx: ExecutionContext = {
          executionId: exec.id,
          workflowId: exec.workflow_id,
          tenantId: exec.tenant_id,
          targetUserId: exec.target_user_id,
          triggerData: exec.trigger_data ?? {},
        };

        // Find the last executed node and continue from its outgoing connections
        const [lastLog] = await this.dataSource.query(
          `SELECT node_id FROM public.workflow_execution_logs
           WHERE execution_id = $1 ORDER BY executed_at DESC LIMIT 1`,
          [exec.id],
        );

        if (lastLog) {
          const outgoing = connections.filter(c => c.from_node_id === lastLog.node_id);
          if (outgoing.length > 0) {
            const nodeMap = new Map(nodes.map(n => [n.id, n]));
            for (const conn of outgoing) {
              const nextNode = nodeMap.get(conn.to_node_id);
              if (nextNode) {
                await this.walkGraph(nextNode, nodes, connections, ctx);
              }
            }
          } else {
            // No more nodes — mark completed
            await this.dataSource.query(
              `UPDATE public.workflow_executions SET status = 'completed', completed_at = now() WHERE id = $1`,
              [exec.id],
            );
          }
        }
      } catch (err: any) {
        this.logger.error(`Failed to resume execution ${exec.id}: ${err.message}`);
        await this.dataSource.query(
          `UPDATE public.workflow_executions SET status = 'failed', error_message = $1, completed_at = now() WHERE id = $2`,
          [err.message, exec.id],
        );
      }
    }
  }
}
