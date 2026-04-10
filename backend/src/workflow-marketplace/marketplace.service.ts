import { Injectable, Logger, NotFoundException, ForbiddenException, ConflictException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createHash } from 'crypto';
import { OFFICIAL_TEMPLATES } from './official-templates';

@Injectable()
export class MarketplaceService {
  private readonly logger = new Logger(MarketplaceService.name);

  constructor(private readonly dataSource: DataSource) {}

  /* ───── Browse Templates ───── */

  async browseTemplates(filters?: {
    category?: string;
    search?: string;
    isOfficial?: boolean;
    sortBy?: string;
  }) {
    const conditions: string[] = ['wt.is_published = true'];
    const params: any[] = [];
    let idx = 1;

    if (filters?.category) {
      conditions.push(`wt.category = $${idx++}`);
      params.push(filters.category);
    }

    if (filters?.search) {
      conditions.push(`(wt.name ILIKE $${idx} OR wt.description ILIKE $${idx})`);
      params.push(`%${filters.search}%`);
      idx++;
    }

    if (filters?.isOfficial !== undefined) {
      conditions.push(`wt.is_official = $${idx++}`);
      params.push(filters.isOfficial);
    }

    let orderBy = 'wt.install_count DESC';
    switch (filters?.sortBy) {
      case 'newest':
        orderBy = 'wt.created_at DESC';
        break;
      case 'rating':
        orderBy = 'avg_rating DESC, wt.install_count DESC';
        break;
      case 'price_low':
        orderBy = 'wt.price_cents ASC, wt.install_count DESC';
        break;
      case 'price_high':
        orderBy = 'wt.price_cents DESC, wt.install_count DESC';
        break;
      case 'popular':
      default:
        orderBy = 'wt.install_count DESC';
        break;
    }

    const rows = await this.dataSource.query(
      `SELECT wt.*,
              CASE WHEN wt.rating_count > 0 THEN (wt.rating_sum::float / wt.rating_count)::numeric(2,1) ELSE 0 END AS avg_rating,
              t.name AS publisher_name
       FROM public.workflow_templates wt
       LEFT JOIN public.tenants t ON t.id = wt.publisher_tenant_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY ${orderBy}`,
      params,
    );

    return {
      data: rows.map((r: any) => this.mapTemplate(r)),
    };
  }

  /* ───── Get Single Template ───── */

  async getTemplate(id: string) {
    const [row] = await this.dataSource.query(
      `SELECT wt.*,
              CASE WHEN wt.rating_count > 0 THEN (wt.rating_sum::float / wt.rating_count)::numeric(2,1) ELSE 0 END AS avg_rating,
              t.name AS publisher_name
       FROM public.workflow_templates wt
       LEFT JOIN public.tenants t ON t.id = wt.publisher_tenant_id
       WHERE wt.id = $1`,
      [id],
    );
    if (!row) throw new NotFoundException('Template not found');
    return this.mapTemplate(row);
  }

  /* ───── Structural Fingerprint ───── */

  /**
   * Generates a structural fingerprint for a workflow.
   *
   * The fingerprint captures the STRUCTURE — not names, positions, or config values.
   * Two workflows with identical node types in the same connection order produce
   * the same fingerprint, even if they have different names or config.
   *
   * Algorithm:
   *   1. Sort nodes topologically (by connection graph)
   *   2. Build a canonical string: triggerType → nodeType1:branch → nodeType2:branch → ...
   *   3. SHA-256 hash the canonical string
   */
  private generateFingerprint(
    triggerType: string,
    nodes: Array<{ id: string; nodeType: string }>,
    connections: Array<{ fromNodeId: string; toNodeId: string; branch?: string }>,
  ): string {
    // Build adjacency list
    const adj = new Map<string, Array<{ to: string; branch: string }>>();
    const inDegree = new Map<string, number>();

    for (const node of nodes) {
      adj.set(node.id, []);
      inDegree.set(node.id, 0);
    }

    for (const conn of connections) {
      adj.get(conn.fromNodeId)?.push({ to: conn.toNodeId, branch: conn.branch ?? 'default' });
      inDegree.set(conn.toNodeId, (inDegree.get(conn.toNodeId) ?? 0) + 1);
    }

    // Topological sort (Kahn's algorithm) — deterministic ordering
    const queue: string[] = [];
    for (const [nodeId, deg] of inDegree) {
      if (deg === 0) queue.push(nodeId);
    }
    // Sort queue for determinism when multiple roots
    queue.sort();

    const nodeMap = new Map(nodes.map(n => [n.id, n.nodeType]));
    const parts: string[] = [triggerType];

    while (queue.length > 0) {
      const current = queue.shift()!;
      const nodeType = nodeMap.get(current) ?? 'unknown';
      const edges = adj.get(current) ?? [];

      // Sort edges for determinism
      edges.sort((a, b) => a.branch.localeCompare(b.branch) || a.to.localeCompare(b.to));

      for (const edge of edges) {
        const targetType = nodeMap.get(edge.to) ?? 'unknown';
        parts.push(`${nodeType}:${edge.branch}:${targetType}`);
        const newDeg = (inDegree.get(edge.to) ?? 1) - 1;
        inDegree.set(edge.to, newDeg);
        if (newDeg === 0) {
          queue.push(edge.to);
          queue.sort();
        }
      }
    }

    const canonical = parts.join('→');
    return createHash('sha256').update(canonical).digest('hex');
  }

  /* ───── Publish Template ───── */

  async publishTemplate(
    tenantId: string,
    dto: {
      name: string;
      description: string;
      category: string;
      tags?: string[];
      priceCents?: number;
      workflowId: string;
    },
    userId: string,
  ) {
    // Load the source workflow
    const [workflow] = await this.dataSource.query(
      `SELECT * FROM public.workflows WHERE id = $1 AND tenant_id = $2`,
      [dto.workflowId, tenantId],
    );
    if (!workflow) throw new NotFoundException('Workflow not found');

    const nodes = await this.dataSource.query(
      `SELECT * FROM public.workflow_nodes WHERE workflow_id = $1 ORDER BY position_y, position_x`,
      [dto.workflowId],
    );

    const connections = await this.dataSource.query(
      `SELECT * FROM public.workflow_connections WHERE workflow_id = $1`,
      [dto.workflowId],
    );

    const serializedNodes = nodes.map((n: any) => ({
      id: n.id,
      nodeType: n.node_type,
      nodeConfig: n.node_config,
      positionX: n.position_x,
      positionY: n.position_y,
      label: n.label,
    }));

    const serializedConnections = connections.map((c: any) => ({
      fromNodeId: c.from_node_id,
      toNodeId: c.to_node_id,
      branch: c.branch,
    }));

    // Generate structural fingerprint for duplicate detection
    const fingerprint = this.generateFingerprint(
      workflow.trigger_type,
      serializedNodes,
      serializedConnections,
    );

    // Check for existing published template with same structure
    const [existing] = await this.dataSource.query(
      `SELECT id, name, publisher_tenant_id FROM public.workflow_templates
       WHERE structure_fingerprint = $1 AND is_published = true`,
      [fingerprint],
    );

    if (existing) {
      throw new ConflictException(
        `A workflow with this exact structure already exists in the store: "${existing.name}". ` +
        `Please modify your workflow to make it unique before publishing.`,
      );
    }

    const [template] = await this.dataSource.query(
      `INSERT INTO public.workflow_templates
       (publisher_tenant_id, publisher_user_id, name, description, category, tags,
        trigger_type, trigger_config, nodes, connections, price_cents, is_official,
        structure_fingerprint)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, false, $12)
       RETURNING *`,
      [
        tenantId,
        userId,
        dto.name,
        dto.description,
        dto.category,
        dto.tags ?? [],
        workflow.trigger_type,
        JSON.stringify(workflow.trigger_config),
        JSON.stringify(serializedNodes),
        JSON.stringify(serializedConnections),
        dto.priceCents ?? 0,
        fingerprint,
      ],
    );

    return this.mapTemplate(template);
  }

  /* ───── Unpublish Template ───── */

  async unpublishTemplate(tenantId: string, templateId: string) {
    const [template] = await this.dataSource.query(
      `SELECT * FROM public.workflow_templates WHERE id = $1`,
      [templateId],
    );
    if (!template) throw new NotFoundException('Template not found');
    if (template.publisher_tenant_id !== tenantId) {
      throw new ForbiddenException('You can only unpublish your own templates');
    }

    await this.dataSource.query(
      `UPDATE public.workflow_templates SET is_published = false, updated_at = now() WHERE id = $1`,
      [templateId],
    );

    return { unpublished: true };
  }

  /* ───── Install Template ───── */

  async installTemplate(tenantId: string, templateId: string, userId: string) {
    const [template] = await this.dataSource.query(
      `SELECT * FROM public.workflow_templates WHERE id = $1 AND is_published = true`,
      [templateId],
    );
    if (!template) throw new NotFoundException('Template not found');

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // 1. Create a new workflow from the template definition
      const [workflow] = await queryRunner.query(
        `INSERT INTO public.workflows (tenant_id, name, description, trigger_type, trigger_config, created_by)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [tenantId, template.name, template.description, template.trigger_type, JSON.stringify(template.trigger_config), userId],
      );

      // 2. Insert nodes and build ID map
      const nodes: any[] = typeof template.nodes === 'string' ? JSON.parse(template.nodes) : template.nodes;
      const connections: any[] = typeof template.connections === 'string' ? JSON.parse(template.connections) : template.connections;
      const idMap = new Map<string, string>();

      for (const node of nodes) {
        const [inserted] = await queryRunner.query(
          `INSERT INTO public.workflow_nodes (workflow_id, node_type, node_config, position_x, position_y, label)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id`,
          [workflow.id, node.nodeType, JSON.stringify(node.nodeConfig), node.positionX, node.positionY, node.label ?? null],
        );
        idMap.set(node.id, inserted.id);
      }

      // 3. Insert connections with mapped IDs
      for (const conn of connections) {
        const fromId = idMap.get(conn.fromNodeId);
        const toId = idMap.get(conn.toNodeId);
        if (!fromId || !toId) {
          this.logger.warn(`Skipping connection with unmapped node: ${conn.fromNodeId} -> ${conn.toNodeId}`);
          continue;
        }
        await queryRunner.query(
          `INSERT INTO public.workflow_connections (workflow_id, from_node_id, to_node_id, branch)
           VALUES ($1, $2, $3, $4)`,
          [workflow.id, fromId, toId, conn.branch ?? 'default'],
        );
      }

      // 4. Record the install
      await queryRunner.query(
        `INSERT INTO public.workflow_template_installs (template_id, tenant_id, installed_by, workflow_id, amount_paid)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (template_id, tenant_id) DO UPDATE SET
           workflow_id = $4, installed_by = $3, installed_at = now()`,
        [templateId, tenantId, userId, workflow.id, template.price_cents],
      );

      // 5. Increment install count
      await queryRunner.query(
        `UPDATE public.workflow_templates SET install_count = install_count + 1, updated_at = now() WHERE id = $1`,
        [templateId],
      );

      await queryRunner.commitTransaction();

      return {
        templateId,
        workflowId: workflow.id,
        name: template.name,
        installed: true,
      };
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  /* ───── Rate Template ───── */

  async rateTemplate(
    tenantId: string,
    templateId: string,
    dto: { rating: number; review?: string },
  ) {
    const [template] = await this.dataSource.query(
      `SELECT id FROM public.workflow_templates WHERE id = $1`,
      [templateId],
    );
    if (!template) throw new NotFoundException('Template not found');

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Upsert rating
      await queryRunner.query(
        `INSERT INTO public.workflow_template_ratings (template_id, tenant_id, rating, review)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (template_id, tenant_id) DO UPDATE SET rating = $3, review = $4, created_at = now()`,
        [templateId, tenantId, dto.rating, dto.review ?? null],
      );

      // Recalculate rating_sum and rating_count from actual ratings
      await queryRunner.query(
        `UPDATE public.workflow_templates
         SET rating_sum = (SELECT COALESCE(SUM(rating), 0) FROM public.workflow_template_ratings WHERE template_id = $1),
             rating_count = (SELECT COUNT(*) FROM public.workflow_template_ratings WHERE template_id = $1),
             updated_at = now()
         WHERE id = $1`,
        [templateId],
      );

      await queryRunner.commitTransaction();
      return { rated: true, rating: dto.rating };
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  /* ───── My Published Templates ───── */

  async getMyPublishedTemplates(tenantId: string) {
    const rows = await this.dataSource.query(
      `SELECT wt.*,
              CASE WHEN wt.rating_count > 0 THEN (wt.rating_sum::float / wt.rating_count)::numeric(2,1) ELSE 0 END AS avg_rating
       FROM public.workflow_templates wt
       WHERE wt.publisher_tenant_id = $1
       ORDER BY wt.created_at DESC`,
      [tenantId],
    );
    return { data: rows.map((r: any) => this.mapTemplate(r)) };
  }

  /* ───── My Installed Templates ───── */

  async getMyInstalledTemplates(tenantId: string) {
    const rows = await this.dataSource.query(
      `SELECT wt.*, wti.installed_at, wti.workflow_id AS installed_workflow_id,
              CASE WHEN wt.rating_count > 0 THEN (wt.rating_sum::float / wt.rating_count)::numeric(2,1) ELSE 0 END AS avg_rating,
              t.name AS publisher_name
       FROM public.workflow_template_installs wti
       JOIN public.workflow_templates wt ON wt.id = wti.template_id
       LEFT JOIN public.tenants t ON t.id = wt.publisher_tenant_id
       WHERE wti.tenant_id = $1
       ORDER BY wti.installed_at DESC`,
      [tenantId],
    );
    return {
      data: rows.map((r: any) => ({
        ...this.mapTemplate(r),
        installedAt: r.installed_at,
        installedWorkflowId: r.installed_workflow_id,
      })),
    };
  }

  /* ───── Seed Official Templates ───── */

  async seedOfficialTemplates() {
    let seeded = 0;
    for (const tpl of OFFICIAL_TEMPLATES) {
      const result = await this.dataSource.query(
        `INSERT INTO public.workflow_templates
         (name, description, category, tags, trigger_type, trigger_config, nodes, connections,
          price_cents, is_official, is_published)
         SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, true, true
         WHERE NOT EXISTS (
           SELECT 1 FROM public.workflow_templates WHERE name = $1 AND is_official = true
         )
         RETURNING id`,
        [
          tpl.name,
          tpl.description,
          tpl.category,
          tpl.tags,
          tpl.triggerType,
          JSON.stringify(tpl.triggerConfig),
          JSON.stringify(tpl.nodes),
          JSON.stringify(tpl.connections),
          tpl.priceCents,
        ],
      );
      if (result.length > 0) seeded++;
    }
    this.logger.log(`Seeded ${seeded} official templates (${OFFICIAL_TEMPLATES.length} total defined)`);
    return { seeded, total: OFFICIAL_TEMPLATES.length };
  }

  /* ───── Helpers ───── */

  private mapTemplate(r: any) {
    return {
      id: r.id,
      publisherTenantId: r.publisher_tenant_id,
      publisherUserId: r.publisher_user_id,
      publisherName: r.publisher_name ?? null,
      name: r.name,
      description: r.description,
      category: r.category,
      tags: r.tags,
      triggerType: r.trigger_type,
      triggerConfig: r.trigger_config,
      nodes: r.nodes,
      connections: r.connections,
      priceCents: r.price_cents,
      currency: r.currency,
      isOfficial: r.is_official,
      isPublished: r.is_published,
      installCount: r.install_count,
      ratingSum: r.rating_sum,
      ratingCount: r.rating_count,
      avgRating: r.avg_rating !== undefined ? parseFloat(r.avg_rating) : 0,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }
}
