import { Injectable, Logger, BadRequestException, NotFoundException, ConflictException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  Relationship,
  ALL_RELATIONSHIPS,
  INVERSE,
  SPOUSE_PROPAGATION,
  resolveLabel,
} from './family-types';
import { ExpoPushService } from '../notifications/expo-push.service';
import { AuditService } from '../audit/audit.service';

/** Grouped relationship types for the mobile picker */
const RELATIONSHIP_TYPES = [
  { value: 'spouse', label: 'Spouse', category: 'Immediate Family' },
  { value: 'parent', label: 'Parent', category: 'Immediate Family' },
  { value: 'child', label: 'Child', category: 'Immediate Family' },
  { value: 'sibling', label: 'Sibling', category: 'Immediate Family' },
  { value: 'grandparent', label: 'Grandparent', category: 'Grandparents & Grandchildren' },
  { value: 'grandchild', label: 'Grandchild', category: 'Grandparents & Grandchildren' },
  { value: 'uncle_aunt', label: 'Uncle/Aunt', category: 'Extended Family' },
  { value: 'nephew_niece', label: 'Nephew/Niece', category: 'Extended Family' },
  { value: 'cousin', label: 'Cousin', category: 'Extended Family' },
  { value: 'parent_in_law', label: 'Parent-in-Law', category: 'In-Laws' },
  { value: 'child_in_law', label: 'Child-in-Law', category: 'In-Laws' },
  { value: 'sibling_in_law', label: 'Sibling-in-Law', category: 'In-Laws' },
  { value: 'cousin_in_law', label: 'Cousin-in-Law', category: 'In-Laws' },
];

/** Color mapping for tree visualization */
const RELATIONSHIP_COLORS: Record<string, string> = {
  self: '#3B82F6',
  spouse: '#EC4899',
  parent: '#E8825E',
  child: '#F472B6',
  sibling: '#10B981',
  grandparent: '#8B7355',
  grandchild: '#A78BFA',
  uncle_aunt: '#F59E0B',
  nephew_niece: '#06B6D4',
  cousin: '#8B5CF6',
  parent_in_law: '#D97706',
  child_in_law: '#DB2777',
  sibling_in_law: '#059669',
  cousin_in_law: '#7C3AED',
};

/**
 * Family connection service.
 *
 * NOTE: This service uses this.dataSource (service role) instead of the RLS queryRunner.
 * All queries include explicit WHERE tenant_id = $1 for isolation.
 * Migration to queryRunner is planned for post-launch (see issue #7 in role-sweep audit).
 */
@Injectable()
export class FamilyService {
  private readonly logger = new Logger(FamilyService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly expoPushService: ExpoPushService,
    private readonly audit: AuditService,
  ) {}

  // ────────────────────────────────────────────────────────
  // GET /family/types
  // ────────────────────────────────────────────────────────

  getTypes() {
    return RELATIONSHIP_TYPES;
  }

  // ────────────────────────────────────────────────────────
  // PUT /family/visibility + GET /family/visibility/:userId
  // ────────────────────────────────────────────────────────

  async setVisibility(userId: string, isPublic: boolean) {
    await this.dataSource.query(
      `INSERT INTO public.family_visibility (user_id, is_public, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (user_id)
       DO UPDATE SET is_public = $2, updated_at = now()`,
      [userId, isPublic],
    );
    return { isPublic };
  }

  async getVisibility(userId: string) {
    const [row] = await this.dataSource.query(
      `SELECT is_public FROM public.family_visibility WHERE user_id = $1`,
      [userId],
    );
    return { isPublic: row?.is_public ?? true };
  }

  // ────────────────────────────────────────────────────────
  // POST /family/requests/:id/respond  (unified accept/reject)
  // ────────────────────────────────────────────────────────

  async respondToRequest(tenantId: string, userId: string, requestId: string, accept: boolean) {
    if (accept) {
      return this.acceptRequest(tenantId, userId, requestId);
    }
    return this.declineRequest(tenantId, userId, requestId);
  }

  // ────────────────────────────────────────────────────────
  // POST /family/request
  // ────────────────────────────────────────────────────────

  async sendRequest(tenantId: string, requesterId: string, targetUserId: string, relationship: string) {
    if (requesterId === targetUserId) {
      throw new BadRequestException('Cannot add yourself as family');
    }
    if (!ALL_RELATIONSHIPS.includes(relationship as Relationship)) {
      throw new BadRequestException('Invalid relationship');
    }

    // Verify target user is a member of the same tenant
    const [targetMembership] = await this.dataSource.query(
      `SELECT 1 FROM public.tenant_memberships WHERE tenant_id = $1 AND user_id = $2`,
      [tenantId, targetUserId],
    );
    if (!targetMembership) {
      throw new BadRequestException('That user is not a member of your church.');
    }

    // Check for existing connection or pending request between these two
    const [existing] = await this.dataSource.query(
      `SELECT id, status FROM public.family_connections
       WHERE tenant_id = $1 AND user_id = $2 AND related_user_id = $3
         AND status IN ('pending', 'accepted')
       LIMIT 1`,
      [tenantId, requesterId, targetUserId],
    );
    if (existing?.status === 'accepted') throw new ConflictException('Family connection already exists');
    if (existing?.status === 'pending') throw new ConflictException('A pending request already exists');

    // Resolve label using target's gender
    const targetGender = await this.getUserGender(targetUserId);
    const label = resolveLabel(relationship as Relationship, targetGender);

    const [row] = await this.dataSource.query(
      `INSERT INTO public.family_connections
        (tenant_id, user_id, related_user_id, relationship, relationship_label, status, is_inferred)
       VALUES ($1, $2, $3, $4, $5, 'pending', false)
       RETURNING *`,
      [tenantId, requesterId, targetUserId, relationship, label],
    );

    // Notification: do it synchronously rather than via the BullMQ queue.
    // The queue flow has been unreliable for this code path (testers reported
    // notifications missing and we observed zero notification rows landing
    // for recent family_requests). Direct INSERT guarantees the in-app row,
    // and we fire the Expo push inline as a separate fire-and-forget call.
    const [requester] = await this.dataSource.query(
      `SELECT full_name FROM public.users WHERE id = $1`,
      [requesterId],
    );
    const requesterName = requester?.full_name ?? 'Someone';
    const title = 'Family Connection Request';
    const body = `${requesterName} wants to add you as their ${label}`;
    // Payload mobile expects: type + screen for the type-based fallback +
    // deep-link, plus the original fields we already stored (requestId,
    // requesterId, relationship) so the Family screen can render quick
    // approve/deny actions without an extra fetch.
    const notificationData = {
      type: 'family_request',
      screen: 'Family',
      params: { requestId: row.id },
      requestId: row.id,
      requesterId,
      relationship,
    };

    await this.dataSource.query(
      `INSERT INTO public.notifications
        (tenant_id, recipient_id, sender_id, type, title, body, data, payload)
       VALUES ($1, $2, $3, 'family_request', $4, $5, $6::jsonb, '{}'::jsonb)`,
      [tenantId, targetUserId, requesterId, title, body, JSON.stringify(notificationData)],
    );

    // Fire-and-forget push — don't block the response on Expo or token
    // lookup, and don't fail the request if the push pipeline hiccups.
    this.expoPushService
      .sendPushOnly({
        recipientId: targetUserId,
        senderId: requesterId,
        type: 'family_request',
        title,
        body,
        data: notificationData,
      })
      .catch(err => this.logger.warn(`family_request push failed: ${err.message}`));

    return this.mapRow(row);
  }

  // ────────────────────────────────────────────────────────
  // GET /family/requests  (sent + received)
  // ────────────────────────────────────────────────────────

  async getRequests(tenantId: string, userId: string) {
    const rows = await this.dataSource.query(
      `SELECT fc.*,
              u1.full_name AS user_name,     u1.avatar_url AS user_avatar,
              u2.full_name AS related_name,   u2.avatar_url AS related_avatar
       FROM public.family_connections fc
       JOIN public.users u1 ON u1.id = fc.user_id
       JOIN public.users u2 ON u2.id = fc.related_user_id
       WHERE fc.tenant_id = $1
         AND (fc.user_id = $2 OR fc.related_user_id = $2)
         AND fc.status = 'pending' AND fc.is_inferred = false
       ORDER BY fc.created_at DESC`,
      [tenantId, userId],
    );

    return rows.map((r: any) => ({
      id: r.id,
      userId: r.user_id,
      userName: r.user_name,
      userAvatar: r.user_avatar,
      relatedUserId: r.related_user_id,
      relatedUserName: r.related_name,
      relatedUserAvatar: r.related_avatar,
      relationship: r.relationship,
      relationshipLabel: r.relationship_label,
      status: r.status,
      direction: r.user_id === userId ? 'sent' : 'received',
      createdAt: r.created_at,
    }));
  }

  // ────────────────────────────────────────────────────────
  // POST /family/requests/:id/accept
  // ────────────────────────────────────────────────────────

  async acceptRequest(tenantId: string, userId: string, requestId: string) {
    const [req] = await this.dataSource.query(
      `SELECT * FROM public.family_connections
       WHERE id = $1 AND tenant_id = $2 AND related_user_id = $3 AND status = 'pending'`,
      [requestId, tenantId, userId],
    );
    if (!req) throw new NotFoundException('Pending request not found');

    const rel = req.relationship as Relationship;

    // 1. Accept the forward row + set label (target gender may have been set after request)
    const targetGender = await this.getUserGender(req.related_user_id);
    const forwardLabel = resolveLabel(rel, targetGender);

    await this.dataSource.query(
      `UPDATE public.family_connections
       SET status = 'accepted', accepted_at = now(), relationship_label = $2
       WHERE id = $1`,
      [requestId, forwardLabel],
    );

    // 2. Create reverse row (B → A)
    const inverseRel = INVERSE[rel];
    const requesterGender = await this.getUserGender(req.user_id);
    const reverseLabel = resolveLabel(inverseRel, requesterGender);

    await this.upsertInferred(
      tenantId, req.related_user_id, req.user_id,
      inverseRel, reverseLabel, requestId,
    );

    // 3. Run inference engine
    await this.runInference(tenantId, req.user_id, req.related_user_id, rel, requestId);

    // 4. Notify requester of acceptance (synchronous insert + inline push,
    //    same pattern as sendRequest for reliability).
    const [accepter] = await this.dataSource.query(
      `SELECT full_name FROM public.users WHERE id = $1`,
      [req.related_user_id],
    );
    const accepterName = accepter?.full_name ?? 'Someone';
    const acceptTitle = 'Family Connection Accepted';
    const acceptBody = `${accepterName} accepted your family request (${forwardLabel})`;
    const acceptData = {
      type: 'family_accepted',
      screen: 'Family',
      params: { connectionId: requestId },
      connectionId: requestId,
      relationship: rel,
    };

    await this.dataSource.query(
      `INSERT INTO public.notifications
        (tenant_id, recipient_id, sender_id, type, title, body, data, payload)
       VALUES ($1, $2, $3, 'family_accepted', $4, $5, $6::jsonb, '{}'::jsonb)`,
      [tenantId, req.user_id, req.related_user_id, acceptTitle, acceptBody, JSON.stringify(acceptData)],
    );

    this.expoPushService
      .sendPushOnly({
        recipientId: req.user_id,
        senderId: req.related_user_id,
        type: 'family_accepted',
        title: acceptTitle,
        body: acceptBody,
        data: acceptData,
      })
      .catch(err => this.logger.warn(`family_accepted push failed: ${err.message}`));

    // Audit. Drives the child-check-in safety trail — every accepted
    // family relationship is a potential pickup-authorization claim.
    await this.audit.log({
      action: 'family.relationship_created',
      resourceType: 'family',
      resourceId: requestId,
      targetUserId: req.user_id,
      summary: `${accepterName} accepted family relationship (${forwardLabel})`,
      metadata: {
        requestId,
        requesterId: req.user_id,
        accepterId: req.related_user_id,
        relationship: rel,
        relationshipLabel: forwardLabel,
        inverseRelationship: inverseRel,
      },
    });

    return { status: 'accepted' };
  }

  // ────────────────────────────────────────────────────────
  // POST /family/requests/:id/decline
  // ────────────────────────────────────────────────────────

  async declineRequest(tenantId: string, userId: string, requestId: string) {
    const result = await this.dataSource.query(
      `UPDATE public.family_connections
       SET status = 'declined'
       WHERE id = $1 AND tenant_id = $2 AND related_user_id = $3 AND status = 'pending'
       RETURNING id`,
      [requestId, tenantId, userId],
    );
    if (result.length === 0) throw new NotFoundException('Pending request not found');
    return { status: 'declined' };
  }

  // ────────────────────────────────────────────────────────
  // GET /family/:userId  (flat list)
  // ────────────────────────────────────────────────────────

  async getFlatFamily(tenantId: string, userId: string) {
    const rows = await this.dataSource.query(
      `SELECT fc.*, u.full_name, u.avatar_url, u.email,
              COALESCE(fv.is_public, true) AS is_public
       FROM public.family_connections fc
       JOIN public.users u ON u.id = fc.related_user_id
       LEFT JOIN public.family_visibility fv ON fv.user_id = fc.related_user_id
       WHERE fc.tenant_id = $1 AND fc.user_id = $2 AND fc.status = 'accepted'
       ORDER BY fc.relationship, fc.relationship_label`,
      [tenantId, userId],
    );

    const categoryMap: Record<string, string> = {};
    for (const t of RELATIONSHIP_TYPES) categoryMap[t.value] = t.category;

    return rows.map((r: any) => {
      const isPrivate = !r.is_public;
      return {
        id: r.id,
        userId: r.related_user_id,
        fullName: isPrivate ? null : r.full_name,
        avatarUrl: isPrivate ? null : r.avatar_url,
        // `type` retained for backwards compat; `relationship` matches the rest
        // of the Family API (request DTO, tree nodes, notifications).
        type: r.relationship,
        relationship: r.relationship,
        label: r.relationship_label,
        category: categoryMap[r.relationship] ?? 'Other',
        isPrivate,
      };
    });
  }

  // ────────────────────────────────────────────────────────
  // GET /family/:userId/tree  (structured)
  // ────────────────────────────────────────────────────────

  async getFamilyTree(tenantId: string, userId: string, viewerId: string) {
    // Get root user info
    const [rootRow] = await this.dataSource.query(
      `SELECT u.id, u.full_name, u.avatar_url,
              COALESCE(fv.is_public, true) AS is_public
       FROM public.users u
       LEFT JOIN public.family_visibility fv ON fv.user_id = u.id
       WHERE u.id = $1`,
      [userId],
    );

    const isOwnTree = userId === viewerId;
    const isPublic = rootRow?.is_public ?? true;

    // If tree is private and not the owner, return limited info
    if (!isPublic && !isOwnTree) {
      return { root: null, isPublic: false, totalMembers: 0 };
    }

    // Pull all accepted connections from this user, including the
    // is_inferred flag and inferred_via source so the mobile can render
    // derived (in-law, transitive) relationships with isDerived: true.
    const rows = await this.dataSource.query(
      `SELECT fc.related_user_id, fc.relationship, fc.relationship_label,
              fc.is_inferred, fc.inferred_via,
              u.full_name, u.avatar_url,
              COALESCE(fv.is_public, true) AS is_public
       FROM public.family_connections fc
       JOIN public.users u ON u.id = fc.related_user_id
       LEFT JOIN public.family_visibility fv ON fv.user_id = fc.related_user_id
       WHERE fc.tenant_id = $1 AND fc.user_id = $2 AND fc.status = 'accepted'
       ORDER BY fc.relationship, fc.relationship_label`,
      [tenantId, userId],
    );

    const mapNode = (r: any, relationship: string) => {
      const isPrivate = !r.is_public;
      return {
        id: r.related_user_id,
        name: isPrivate ? null : r.full_name,
        avatarUrl: isPrivate ? null : r.avatar_url,
        isPrivate,
        color: RELATIONSHIP_COLORS[relationship] ?? '#6B7280',
        relationship,
        label: r.relationship_label,
        // Inferred rows (e.g., parent_in_law derived from a spouse edge) carry
        // is_inferred = true in the DB. Surface as isDerived so the mobile
        // can style/badge them differently from direct relationships.
        isDerived: r.is_inferred === true,
        derivedVia: r.inferred_via ?? null,
        children: [] as any[],
        parents: [] as any[],
      };
    };

    // Group rows by relationship type
    const byRel: Record<string, any[]> = {};
    for (const r of rows) {
      if (!byRel[r.relationship]) byRel[r.relationship] = [];
      byRel[r.relationship].push(r);
    }

    // Build each relationship bucket. Every one of the 13 relationship types
    // gets its own array — previously only spouse/child/parent/sibling/
    // grandparent were rendered, which silently dropped uncles/aunts/nephews/
    // cousins and all the *_in_law derivatives. Mobile was reporting empty
    // in-law branches; this is the root cause.
    const bucket = (rel: Relationship) =>
      (byRel[rel] ?? []).map((r: any) => mapNode(r, rel));

    const parentsArr = bucket('parent').map(node => {
      // Keep the legacy nesting under each parent (grandparents + siblings as
      // children of the parent node) so existing mobile renderers don't break.
      // New top-level arrays carry the full data too.
      node.parents = bucket('grandparent');
      node.children = bucket('sibling');
      return node;
    });

    const spouseNode = bucket('spouse')[0] ?? null;

    const root = {
      id: rootRow?.id ?? userId,
      name: rootRow?.full_name ?? null,
      avatarUrl: rootRow?.avatar_url ?? null,
      isPrivate: false,
      color: RELATIONSHIP_COLORS['self'],
      relationship: 'self',
      isDerived: false,

      // Legacy fields — keep so existing mobile renderers don't break.
      children: bucket('child'),
      parents: parentsArr,
      spouse: spouseNode,

      // New flat buckets — one per relationship type. Mobile can render
      // these as horizontal scrollers / additional sections without doing
      // its own grouping.
      siblings: bucket('sibling'),
      grandparents: bucket('grandparent'),
      grandchildren: bucket('grandchild'),
      unclesAunts: bucket('uncle_aunt'),
      nephewsNieces: bucket('nephew_niece'),
      cousins: bucket('cousin'),
      parentsInLaw: bucket('parent_in_law'),
      childrenInLaw: bucket('child_in_law'),
      siblingsInLaw: bucket('sibling_in_law'),
      cousinsInLaw: bucket('cousin_in_law'),
    };

    return {
      root,
      isPublic,
      totalMembers: rows.length + 1,
    };
  }

  // ────────────────────────────────────────────────────────
  // DELETE /family/:userId/:familyMemberId
  // ────────────────────────────────────────────────────────

  async removeConnectionById(tenantId: string, userId: string, relationshipId: string) {
    const [conn] = await this.dataSource.query(
      `SELECT user_id, related_user_id FROM public.family_connections WHERE id = $1 AND tenant_id = $2`,
      [relationshipId, tenantId],
    );
    if (!conn) throw new NotFoundException('Connection not found');
    // Ensure the caller is one of the two parties
    if (conn.user_id !== userId && conn.related_user_id !== userId) {
      throw new NotFoundException('Connection not found');
    }
    return this.removeConnection(tenantId, conn.user_id, conn.related_user_id);
  }

  async removeConnection(
    tenantId: string,
    userId: string,
    familyMemberId: string,
    actorUserId?: string,
  ) {
    // Find the forward row
    const [fwd] = await this.dataSource.query(
      `SELECT id, relationship FROM public.family_connections
       WHERE tenant_id = $1 AND user_id = $2 AND related_user_id = $3 AND status = 'accepted'`,
      [tenantId, userId, familyMemberId],
    );
    if (!fwd) throw new NotFoundException('Connection not found');

    // Find the reverse row
    const [rev] = await this.dataSource.query(
      `SELECT id, relationship FROM public.family_connections
       WHERE tenant_id = $1 AND user_id = $2 AND related_user_id = $3 AND status = 'accepted'`,
      [tenantId, familyMemberId, userId],
    );

    // Cascade: delete all inferred rows triggered by either direction
    await this.cascadeDelete(fwd.id, tenantId);
    if (rev) await this.cascadeDelete(rev.id, tenantId);

    // Delete both directions
    await this.dataSource.query(
      `DELETE FROM public.family_connections
       WHERE tenant_id = $1 AND (
         (user_id = $2 AND related_user_id = $3) OR
         (user_id = $3 AND related_user_id = $2)
       )`,
      [tenantId, userId, familyMemberId],
    );

    // Audit. Drives the child-check-in safety review trail — an incorrect
    // inferred sibling deletion previously left no record. actorUserId
    // defaults to userId for self-initiated deletes (mobile DELETE
    // /family/:id); for the admin endpoint we pass the admin's id.
    const actor = actorUserId ?? userId;
    const [actorRow] = await this.dataSource.query(
      `SELECT full_name FROM public.users WHERE id = $1`,
      [actor],
    );
    await this.audit.log({
      action: 'family.relationship_removed',
      resourceType: 'family',
      resourceId: fwd.id,
      targetUserId: actor === userId ? familyMemberId : userId,
      summary: `${actorRow?.full_name ?? 'Member'} removed family relationship (${fwd.relationship})`,
      metadata: {
        userId,
        familyMemberId,
        relationship: fwd.relationship,
        reverseRelationship: rev?.relationship,
        viaAdmin: actorUserId !== undefined && actorUserId !== userId,
      },
    });
  }

  /**
   * Admin: list family relationships for review (child-safety reviews,
   * correcting bad inferences). Optionally scope to one userId. Returns
   * the raw rows joined with names; pagination intentionally omitted —
   * a single family tree maxes out at <100 connections.
   */
  async adminListRelationships(tenantId: string, userId?: string) {
    const params: any[] = [tenantId];
    let scope = '';
    if (userId) {
      params.push(userId);
      scope = ` AND (fc.user_id = $2 OR fc.related_user_id = $2)`;
    }
    const rows = await this.dataSource.query(
      `SELECT fc.id, fc.user_id, fc.related_user_id, fc.relationship,
              fc.relationship_label, fc.is_inferred, fc.inferred_from,
              fc.status, fc.created_at, fc.accepted_at,
              u1.full_name AS user_name,
              u2.full_name AS related_user_name
       FROM public.family_connections fc
       JOIN public.users u1 ON u1.id = fc.user_id
       JOIN public.users u2 ON u2.id = fc.related_user_id
       WHERE fc.tenant_id = $1 ${scope}
       ORDER BY fc.created_at DESC LIMIT 500`,
      params,
    );
    return {
      relationships: rows.map((r: any) => ({
        id: r.id,
        userId: r.user_id,
        userFullName: r.user_name,
        relatedUserId: r.related_user_id,
        relatedUserFullName: r.related_user_name,
        relationship: r.relationship,
        relationshipLabel: r.relationship_label,
        isInferred: r.is_inferred,
        inferredFrom: r.inferred_from,
        status: r.status,
        createdAt: r.created_at,
        acceptedAt: r.accepted_at,
      })),
    };
  }

  /**
   * Admin: remove a family connection regardless of who the caller is.
   * Required for correcting bad inferences (incorrect inferred sibling
   * etc.) that could otherwise authorize unauthorized child pickup. Both
   * directions of the relationship are deleted; audit log captures the
   * mandatory reason.
   */
  async adminRemoveConnection(
    tenantId: string,
    relationshipId: string,
    adminUserId: string,
    reason: string,
  ) {
    const [conn] = await this.dataSource.query(
      `SELECT user_id, related_user_id FROM public.family_connections WHERE id = $1 AND tenant_id = $2`,
      [relationshipId, tenantId],
    );
    if (!conn) throw new NotFoundException('Relationship not found');

    // Reuse the existing two-direction deletion + cascade logic. Pass
    // adminUserId so the audit row reflects who actually acted.
    await this.removeConnection(tenantId, conn.user_id, conn.related_user_id, adminUserId);

    // Append the mandatory reason as a separate audit row (the
    // removeConnection audit doesn't carry a reason field).
    await this.audit.log({
      action: 'family.relationship_force_removed',
      resourceType: 'family',
      resourceId: relationshipId,
      targetUserId: conn.user_id,
      summary: `Admin force-removed family relationship`,
      metadata: { reason, userId: conn.user_id, familyMemberId: conn.related_user_id },
    });
  }

  // ════════════════════════════════════════════════════════
  //  INFERENCE ENGINE
  // ═══════════════════════════════════════════════════════��

  /**
   * Runs all 5 inference rules after a connection is accepted.
   * @param A  user_id of the original request (the person who initiated)
   * @param B  related_user_id (the person who accepted)
   * @param rel  the relationship A→B
   * @param sourceId  the connection ID that triggered inference
   */
  private async runInference(
    tenantId: string, A: string, B: string,
    rel: Relationship, sourceId: string,
  ) {
    // Pre-fetch all related user IDs for batch gender lookup
    const relatedRows = await this.dataSource.query(
      `SELECT DISTINCT fc.related_user_id
       FROM public.family_connections fc
       WHERE fc.tenant_id = $1
         AND fc.user_id IN ($2, $3)
         AND fc.status = 'accepted'`,
      [tenantId, A, B],
    );
    const allIds = new Set<string>([A, B]);
    for (const r of relatedRows) allIds.add(r.related_user_id);

    const genderMap = await this.getUserGenderBatch([...allIds]);

    // ─── Rule 1: Spouse + Child = Both Parents' Child ───
    if (rel === 'spouse') {
      // A's existing children → also become B's children
      await this.propagateChildrenToSpouse(tenantId, A, B, sourceId, genderMap);
      // B's existing children → also become A's children
      await this.propagateChildrenToSpouse(tenantId, B, A, sourceId, genderMap);
    }

    // ─── Rule 2: Spouse + Parent = In-Law ───
    if (rel === 'spouse') {
      await this.propagateRelationshipsToSpouse(tenantId, A, B, sourceId, genderMap);
      await this.propagateRelationshipsToSpouse(tenantId, B, A, sourceId, genderMap);
    }

    // Rules 1–4 also apply when the NEW connection is a non-spouse type
    // and one party already has a spouse.
    if (rel !== 'spouse') {
      // A added B as <rel>. If A has a spouse S, propagate B→S.
      await this.propagateSingleToSpouse(tenantId, A, B, rel, sourceId, genderMap);
    }

    // ─── Rule 5: Parent + Existing Children = Siblings ───
    if (rel === 'parent') {
      // A set B as parent. B already has other children → they're A's siblings.
      await this.inferSiblingsFromParent(tenantId, A, B, sourceId, genderMap);
    }
    if (rel === 'child') {
      // A set B as child. A already has other children → they're B's siblings.
      await this.inferSiblingsFromExistingChildren(tenantId, A, B, sourceId, genderMap);
    }
  }

  /** Rule 1: When A↔B become spouses, A's children become B's children too */
  private async propagateChildrenToSpouse(
    tenantId: string, owner: string, spouse: string, sourceId: string,
    genderMap: Map<string, string | null>,
  ) {
    const children = await this.dataSource.query(
      `SELECT related_user_id FROM public.family_connections
       WHERE tenant_id = $1 AND user_id = $2 AND relationship = 'child' AND status = 'accepted'`,
      [tenantId, owner],
    );

    for (const c of children) {
      if (c.related_user_id === spouse) continue;
      const childGender = genderMap.get(c.related_user_id) ?? null;
      const spouseGender = genderMap.get(spouse) ?? null;

      // spouse → child
      await this.upsertInferred(
        tenantId, spouse, c.related_user_id,
        'child', resolveLabel('child', childGender), sourceId,
      );
      // child → spouse (as parent)
      await this.upsertInferred(
        tenantId, c.related_user_id, spouse,
        'parent', resolveLabel('parent', spouseGender), sourceId,
      );
    }
  }

  /** Rules 2–4: When A↔B become spouses, propagate A's parents/siblings/cousins as B's in-laws */
  private async propagateRelationshipsToSpouse(
    tenantId: string, owner: string, spouse: string, sourceId: string,
    genderMap: Map<string, string | null>,
  ) {
    const rels = await this.dataSource.query(
      `SELECT related_user_id, relationship FROM public.family_connections
       WHERE tenant_id = $1 AND user_id = $2 AND status = 'accepted'
         AND relationship IN ('parent', 'sibling', 'cousin')`,
      [tenantId, owner],
    );

    for (const r of rels) {
      if (r.related_user_id === spouse) continue;
      const propagated = SPOUSE_PROPAGATION[r.relationship as Relationship];
      if (!propagated) continue;

      const relatedGender = genderMap.get(r.related_user_id) ?? null;
      const spouseGender = genderMap.get(spouse) ?? null;
      const inverseOfPropagated = INVERSE[propagated];

      // spouse → related (in-law version)
      await this.upsertInferred(
        tenantId, spouse, r.related_user_id,
        propagated, resolveLabel(propagated, relatedGender), sourceId,
      );
      // related ��� spouse (inverse in-law)
      await this.upsertInferred(
        tenantId, r.related_user_id, spouse,
        inverseOfPropagated, resolveLabel(inverseOfPropagated, spouseGender), sourceId,
      );
    }
  }

  /** When A adds B as a non-spouse, and A has spouse S, propagate to S */
  private async propagateSingleToSpouse(
    tenantId: string, A: string, B: string,
    rel: Relationship, sourceId: string,
    genderMap: Map<string, string | null>,
  ) {
    const [spouseRow] = await this.dataSource.query(
      `SELECT related_user_id FROM public.family_connections
       WHERE tenant_id = $1 AND user_id = $2 AND relationship = 'spouse' AND status = 'accepted'
       LIMIT 1`,
      [tenantId, A],
    );
    if (!spouseRow) return;
    const S = spouseRow.related_user_id;
    if (S === B) return;

    const propagated = SPOUSE_PROPAGATION[rel];
    if (!propagated) return;

    const bGender = genderMap.get(B) ?? null;
    const sGender = genderMap.get(S) ?? null;
    const inversePropagated = INVERSE[propagated];

    // S → B
    await this.upsertInferred(
      tenantId, S, B,
      propagated, resolveLabel(propagated, bGender), sourceId,
    );
    // B → S
    await this.upsertInferred(
      tenantId, B, S,
      inversePropagated, resolveLabel(inversePropagated, sGender), sourceId,
    );
  }

  /** Rule 5: A sets B as parent. B's other children become A's siblings. */
  private async inferSiblingsFromParent(
    tenantId: string, A: string, parentB: string, sourceId: string,
    genderMap: Map<string, string | null>,
  ) {
    // Find B's other children (excluding A)
    const siblings = await this.dataSource.query(
      `SELECT related_user_id FROM public.family_connections
       WHERE tenant_id = $1 AND user_id = $2 AND relationship = 'child' AND status = 'accepted'
         AND related_user_id != $3`,
      [tenantId, parentB, A],
    );

    for (const s of siblings) {
      const sibGender = genderMap.get(s.related_user_id) ?? null;
      const aGender = genderMap.get(A) ?? null;

      // A → sibling
      await this.upsertInferred(
        tenantId, A, s.related_user_id,
        'sibling', resolveLabel('sibling', sibGender), sourceId,
      );
      // sibling → A
      await this.upsertInferred(
        tenantId, s.related_user_id, A,
        'sibling', resolveLabel('sibling', aGender), sourceId,
      );
    }
  }

  /** Rule 5 reverse: A sets B as child. A's other children become B's siblings. */
  private async inferSiblingsFromExistingChildren(
    tenantId: string, parentA: string, childB: string, sourceId: string,
    genderMap: Map<string, string | null>,
  ) {
    const otherChildren = await this.dataSource.query(
      `SELECT related_user_id FROM public.family_connections
       WHERE tenant_id = $1 AND user_id = $2 AND relationship = 'child' AND status = 'accepted'
         AND related_user_id != $3`,
      [tenantId, parentA, childB],
    );

    for (const c of otherChildren) {
      const cGender = genderMap.get(c.related_user_id) ?? null;
      const bGender = genderMap.get(childB) ?? null;

      await this.upsertInferred(
        tenantId, childB, c.related_user_id,
        'sibling', resolveLabel('sibling', cGender), sourceId,
      );
      await this.upsertInferred(
        tenantId, c.related_user_id, childB,
        'sibling', resolveLabel('sibling', bGender), sourceId,
      );
    }
  }

  // ════════════════════════════════════════════════════════
  //  HELPERS
  // ═══════════════════════════════════════════════════��════

  private async upsertInferred(
    tenantId: string, userId: string, relatedUserId: string,
    relationship: string, label: string, inferredVia: string,
  ) {
    await this.dataSource.query(
      `INSERT INTO public.family_connections
        (tenant_id, user_id, related_user_id, relationship, relationship_label,
         status, is_inferred, inferred_via, accepted_at)
       VALUES ($1, $2, $3, $4, $5, 'accepted', true, $6, now())
       ON CONFLICT (tenant_id, user_id, related_user_id, relationship) DO NOTHING`,
      [tenantId, userId, relatedUserId, relationship, label, inferredVia],
    );
  }

  private async cascadeDelete(sourceId: string, tenantId: string) {
    await this.dataSource.query(
      `WITH RECURSIVE derived AS (
        SELECT id FROM public.family_connections WHERE inferred_via = $1 AND tenant_id = $2
        UNION ALL
        SELECT fc.id FROM public.family_connections fc
        JOIN derived d ON fc.inferred_via = d.id AND fc.tenant_id = $2
      )
      DELETE FROM public.family_connections WHERE id IN (SELECT id FROM derived)`,
      [sourceId, tenantId],
    );
  }

  async getUserGender(userId: string): Promise<string | null> {
    // Try onboarding responses
    const [resp] = await this.dataSource.query(
      `SELECT responses->>'gender' AS gender FROM public.onboarding_responses WHERE user_id = $1 LIMIT 1`,
      [userId],
    );
    if (resp?.gender) return resp.gender;
    return null;
  }

  private async getUserGenderBatch(userIds: string[]): Promise<Map<string, string | null>> {
    if (userIds.length === 0) return new Map();
    const unique = [...new Set(userIds)];
    const rows = await this.dataSource.query(
      `SELECT user_id, responses->>'gender' AS gender FROM public.onboarding_responses WHERE user_id = ANY($1)`,
      [unique],
    );
    const map = new Map<string, string | null>();
    for (const id of unique) map.set(id, null);
    for (const r of rows) map.set(r.user_id, r.gender ?? null);
    return map;
  }

  private mapRow(r: any) {
    return {
      id: r.id,
      userId: r.user_id,
      relatedUserId: r.related_user_id,
      relationship: r.relationship,
      relationshipLabel: r.relationship_label,
      status: r.status,
      isInferred: r.is_inferred,
      createdAt: r.created_at,
      acceptedAt: r.accepted_at,
    };
  }
}
