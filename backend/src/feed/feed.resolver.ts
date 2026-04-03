import { Resolver, Query, Args, Int, Context } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { FeedService } from './feed.service';
import { PaginatedFeedResponse } from './models/feed-post.model';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@Resolver()
export class FeedResolver {
  constructor(private readonly feedService: FeedService) {}

  /**
   * Returns the authenticated user's global feed.
   *
   * The feed is pre-computed in Redis via fan-out-on-write.
   * Falls back to a DB query of recent global posts if Redis is empty (cold start).
   *
   * Usage:
   *   query {
   *     globalFeed(limit: 20, offset: 0) {
   *       posts { id content mediaType author { id fullName avatarUrl } latestComment { id content author { fullName } } }
   *       total limit offset
   *     }
   *   }
   */
  @Query(() => PaginatedFeedResponse, { description: 'Returns the global feed for the authenticated user' })
  @UseGuards(JwtAuthGuard)
  async globalFeed(
    @Args('limit', { type: () => Int, defaultValue: 20 }) limit: number,
    @Args('offset', { type: () => Int, defaultValue: 0 }) offset: number,
    @Context() ctx: any,
  ): Promise<PaginatedFeedResponse> {
    const user = ctx.req.user;
    return this.feedService.getGlobalFeed(user.sub, limit, offset);
  }
}
