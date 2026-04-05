import {
  Controller,
  Get,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { SearchService } from './search.service';
import { SearchQueryDto } from './dto/search-query.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { TierGuard } from '../common/guards/tier.guard';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';
import { RequiresTier } from '../common/decorators/requires-tier.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SupabaseJwtPayload } from '../common/types/jwt-payload.type';

@ApiTags('Search')
@ApiBearerAuth()
@Controller('search')
@UseGuards(JwtAuthGuard)
@UseInterceptors(RlsContextInterceptor)
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  /**
   * Post search is available on all tiers.
   * Uses ILIKE for broad matching with a full-text relevance sort.
   */
  @Get('posts')
  @ApiOperation({ summary: 'Search posts in current tenant by content or author name' })
  @ApiResponse({ status: 200, description: '{ data: Post[], nextCursor: string | null }' })
  searchPosts(
    @Query() query: SearchQueryDto,
    @CurrentUser() user: SupabaseJwtPayload,
  ) {
    return this.searchService.searchPosts(query.q, user.sub, query.cursor, query.limit);
  }

  /**
   * Member search is a Pro+ tier feature.
   */
  @Get('members')
  @UseGuards(TierGuard)
  @RequiresTier('search')
  @ApiOperation({ summary: 'Full-text search members in current tenant (Pro+ tier)' })
  @ApiResponse({ status: 200, description: 'Paginated search results with cursor' })
  @ApiResponse({ status: 403, description: 'Requires Pro tier or above' })
  searchMembers(@Query() query: SearchQueryDto) {
    return this.searchService.searchMembers(query.q, query.cursor, query.limit);
  }
}
