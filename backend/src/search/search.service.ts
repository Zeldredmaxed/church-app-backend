import { Injectable } from '@nestjs/common';
import { rlsStorage } from '../common/storage/rls.storage';

export interface PostSearchResult {
  id: string;
  content: string;
  mediaType: string;
  mediaUrl: string | null;
  visibility: string;
  createdAt: Date;
  likeCount: number;
  commentCount: number;
  isLikedByMe: boolean;
  isSavedByMe: boolean;
  rank: number;
  author: {
    id: string;
    fullName: string | null;
    avatarUrl: string | null;
  };
}

export interface MemberSearchResult {
  userId: string;
  email: string;
  fullName: string | null;
  avatarUrl: string | null;
  role: string;
  rank: number;
}

@Injectable()
export class SearchService {
  /**
   * Full-text search on posts within the current tenant.
   *
   * Uses `websearch_to_tsquery` which provides robust query parsing:
   *   - Handles quoted phrases, OR, negation
   *   - Tolerant of user input (no syntax errors)
   *
   * RLS SELECT policy on posts ("posts: select tenant or global") ensures
   * only tenant-scoped and global posts are visible. We additionally filter
   * by tenant_id in the query to exclude global posts from tenant search.
   *
   * Results are ranked by `ts_rank` (relevance score) with cursor-based
   * pagination using the post id as cursor.
   */
  async searchPosts(
    query: string,
    userId: string,
    cursor?: string,
    limit: number = 20,
  ): Promise<{ data: PostSearchResult[]; nextCursor: string | null }> {
    const { queryRunner } = rlsStorage.getStore()!;

    // $1 = query, $2 = userId (for visibility filter + isLikedByMe/isSavedByMe)
    // ILIKE fallback ensures short/common words still match even without a search_vector hit
    const params: any[] = [query, userId];

    let sql = `
      SELECT
        p.id,
        p.content,
        p.media_type    AS "mediaType",
        p.media_url     AS "mediaUrl",
        p.visibility,
        p.created_at    AS "createdAt",
        u.id            AS author_id,
        u.full_name     AS author_full_name,
        u.avatar_url    AS author_avatar_url,
        (SELECT COUNT(*)::int FROM public.post_likes WHERE post_id = p.id)              AS like_count,
        (SELECT COUNT(*)::int FROM public.comments   WHERE post_id = p.id)              AS comment_count,
        EXISTS(SELECT 1 FROM public.post_likes WHERE post_id = p.id AND user_id = $2)  AS is_liked_by_me,
        EXISTS(SELECT 1 FROM public.post_saves WHERE post_id = p.id AND user_id = $2)  AS is_saved_by_me
      FROM public.posts p
      LEFT JOIN public.users u ON u.id = p.author_id
      WHERE (
        p.search_vector @@ websearch_to_tsquery('english', $1)
        OR p.content ILIKE '%' || $1 || '%'
        OR u.full_name ILIKE '%' || $1 || '%'
      )
      AND (p.visibility = 'public' OR p.author_id = $2)
      AND p.tenant_id IS NOT NULL
    `;

    if (cursor) {
      params.push(cursor);
      sql += ` AND p.id < $${params.length}`;
    }

    params.push(limit + 1);
    sql += ` ORDER BY p.created_at DESC LIMIT $${params.length}`;

    const rows = await queryRunner.query(sql, params);

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? page[page.length - 1].id : null;

    const data: PostSearchResult[] = page.map((row: any) => ({
      id: row.id,
      content: row.content,
      mediaType: row.mediaType,
      mediaUrl: row.mediaUrl,
      visibility: row.visibility,
      createdAt: row.createdAt,
      likeCount: Number(row.like_count),
      commentCount: Number(row.comment_count),
      isLikedByMe: row.is_liked_by_me,
      isSavedByMe: row.is_saved_by_me,
      rank: 0,
      author: {
        id: row.author_id,
        fullName: row.author_full_name,
        avatarUrl: row.author_avatar_url,
      },
    }));

    return { data, nextCursor };
  }

  /**
   * Full-text search on members within the current tenant.
   *
   * Joins tenant_memberships to users, filtered by tenant_id via RLS.
   * The search_vector on users contains full_name (A weight) and email (B weight).
   *
   * RLS SELECT policy on tenant_memberships ensures only current-tenant
   * memberships are visible.
   */
  async searchMembers(
    query: string,
    cursor?: string,
    limit: number = 20,
  ): Promise<{ results: MemberSearchResult[]; nextCursor: string | null }> {
    const { queryRunner } = rlsStorage.getStore()!;

    let sql = `
      SELECT
        tm.user_id AS "userId",
        u.email,
        u.full_name AS "fullName",
        u.avatar_url AS "avatarUrl",
        tm.role,
        ts_rank(u.search_vector, websearch_to_tsquery('english', $1)) AS rank
      FROM public.tenant_memberships tm
      JOIN public.users u ON u.id = tm.user_id
      WHERE u.search_vector @@ websearch_to_tsquery('english', $1)
    `;
    const params: any[] = [query];

    if (cursor) {
      params.push(cursor);
      sql += ` AND tm.user_id != $${params.length}`;
      sql += `
        AND (
          ts_rank(u.search_vector, websearch_to_tsquery('english', $1)),
          tm.user_id
        ) < (
          SELECT ts_rank(cu.search_vector, websearch_to_tsquery('english', $1)), cu.id
          FROM public.users cu WHERE cu.id = $${params.length}
        )
      `;
    }

    params.push(limit + 1);
    sql += ` ORDER BY rank DESC, tm.user_id DESC LIMIT $${params.length}`;

    const rows = await queryRunner.query(sql, params);

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? page[page.length - 1].userId : null;

    const results: MemberSearchResult[] = page.map((row: any) => ({
      userId: row.userId,
      email: row.email,
      fullName: row.fullName,
      avatarUrl: row.avatarUrl,
      role: row.role,
      rank: parseFloat(row.rank),
    }));

    return { results, nextCursor };
  }
}
