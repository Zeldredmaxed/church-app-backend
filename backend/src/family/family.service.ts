import { Injectable, Logger, BadRequestException, NotFoundException, ConflictException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  Relationship,
  ALL_RELATIONSHIPS,
  INVERSE,
  SPOUSE_PROPAGATION,
  resolveLabel,
} from './family-types';

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

  constructor(private readonly dataSource: DataSource) {}

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

    // Notification to target
    const [requester] = await this.dataSource.query(
      `SELECT full_name FROM public.users WHERE id = $1`, [requesterId],
    );
    const fromName = requester?.full_name || 'Someone';

    await this.dataSource.query(
      `INSERT INTO public.notifications (tenant_id, user_id, type, title, body, metadata)
       VALUES ($1, $2, 'family_request', $3, $4, $5::jsonb)`,
      [
        tenantId, targetUserId,
        'Family Connection Request',
        `${fromName} wants to add you as their ${label}`,
        JSON.stringify({ requestId: row.id, requesterId, relationship, actionUrl: '/family/requests' }),
      ],
    );

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

    // 4. Notify requester of acceptance
    const [target] = await this.dataSource.query(
      `SELECT full_name FROM public.users WHERE id = $1`, [req.related_user_id],
    );
    const targetName = target?.full_name || 'Someone';

    await this.dataSource.query(
      `INSERT INTO public.notifications (tenant_id, user_id, type, title, body, metadata)
       VALUES ($1, $2, 'family_accepted', $3, $4, $5::jsonb)`,
      [
        tenantId, req.user_id,
        'Family Connection Accepted',
        `${targetName} accepted your family request (${forwardLabel})`,
        JSON.stringify({ connectionId: requestId, relationship: rel }),
      ],
    );

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
        type: r.relationship,
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

    // Get ALL accepted connections from this user with visibility info
    const rows = await this.dataSource.query(
      `SELECT fc.related_user_id, fc.relationship, fc.relationship_label,
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
        children: [] as any[],
        parents: [] as any[],
      };
    };

    // Group by relationship
    const byRel: Record<string, any[]> = {};
    for (const r of rows) {
      if (!byRel[r.relationship]) byRel[r.relationship] = [];
      byRel[r.relationship].push(r);
    }

    // Build hierarchical tree
    const spouseRow = (byRel['spouse'] ?? [])[0];
    const children = (byRel['child'] ?? []).map((r: any) => mapNode(r, 'child'));
    const parents = (byRel['parent'] ?? []).map((r: any) => {
      const node = mapNode(r, 'parent');
      // Fetch grandparents (parent's parents) — 1 level up
      const grandparents = (byRel['grandparent'] ?? []).map((g: any) => mapNode(g, 'grandparent'));
      node.parents = grandparents;
      // Siblings are parent's other children
      node.children = (byRel['sibling'] ?? []).map((s: any) => mapNode(s, 'sibling'));
      return node;
    });

    const root = {
      id: rootRow?.id ?? userId,
      name: rootRow?.full_name ?? null,
      avatarUrl: rootRow?.avatar_url ?? null,
      isPrivate: false,
      color: RELATIONSHIP_COLORS['self'],
      relationship: 'self',
      children,
      parents,
      spouse: spouseRow ? {
        id: spouseRow.related_user_id,
        name: spouseRow.is_public ? spouseRow.full_name : null,
        avatarUrl: spouseRow.is_public ? spouseRow.avatar_url : null,
        isPrivate: !spouseRow.is_public,
        color: RELATIONSHIP_COLORS['spouse'],
        relationship: 'spouse',
        label: spouseRow.relationship_label,
      } : null,
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

  async removeConnection(tenantId: string, userId: string, familyMemberId: string) {
    // Find the forward row
    const [fwd] = await this.dataSource.query(
      `SELECT id FROM public.family_connections
       WHERE tenant_id = $1 AND user_id = $2 AND related_user_id = $3 AND status = 'accepted'`,
      [tenantId, userId, familyMemberId],
    );
    if (!fwd) throw new NotFoundException('Connection not found');

    // Find the reverse row
    const [rev] = await this.dataSource.query(
      `SELECT id FROM public.family_connections
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
