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
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';

@ApiTags('Search')
@ApiBearerAuth()
@Controller('search')
@UseGuards(JwtAuthGuard)
@UseInterceptors(RlsContextInterceptor)
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get('posts')
  @ApiOperation({ summary: 'Full-text search posts in current tenant (ranked by relevance)' })
  @ApiResponse({ status: 200, description: 'Paginated search results with cursor' })
  searchPosts(@Query() query: SearchQueryDto) {
    return this.searchService.searchPosts(query.q, query.cursor, query.limit);
  }

  @Get('members')
  @ApiOperation({ summary: 'Full-text search members in current tenant (by name/email)' })
  @ApiResponse({ status: 200, description: 'Paginated search results with cursor' })
  searchMembers(@Query() query: SearchQueryDto) {
    return this.searchService.searchMembers(query.q, query.cursor, query.limit);
  }
}
