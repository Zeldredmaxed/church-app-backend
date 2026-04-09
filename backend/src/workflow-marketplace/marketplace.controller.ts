import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { MarketplaceService } from './marketplace.service';
import { PublishTemplateDto } from './dto/publish-template.dto';
import { RateTemplateDto } from './dto/rate-template.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SupabaseJwtPayload } from '../common/types/jwt-payload.type';

const TEMPLATE_CATEGORIES = [
  'general', 'onboarding', 'engagement', 'giving', 'care',
  'events', 'volunteers', 'communications', 'reports', 'spiritual_growth',
];

/* ───── Public Routes (no auth) ───── */

@ApiTags('Workflow Marketplace')
@Controller('workflow-store')
export class MarketplaceController {
  constructor(private readonly marketplaceService: MarketplaceService) {}

  @Get()
  @ApiOperation({ summary: 'Browse published workflow templates' })
  @ApiResponse({ status: 200, description: 'List of published templates' })
  async browse(
    @Query('category') category?: string,
    @Query('search') search?: string,
    @Query('sort') sort?: string,
    @Query('official') official?: string,
  ) {
    return this.marketplaceService.browseTemplates({
      category,
      search,
      isOfficial: official !== undefined ? official === 'true' : undefined,
      sortBy: sort,
    });
  }

  @Get('categories')
  @ApiOperation({ summary: 'List available template categories' })
  @ApiResponse({ status: 200, description: 'Category list' })
  getCategories() {
    return {
      data: TEMPLATE_CATEGORIES.map((c) => ({
        id: c,
        label: c.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase()),
      })),
    };
  }

  @Get('my/published')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(RlsContextInterceptor)
  @ApiOperation({ summary: 'List templates published by my church' })
  @ApiResponse({ status: 200, description: 'My published templates' })
  async myPublished(@CurrentUser() user: SupabaseJwtPayload) {
    const tenantId = user.app_metadata?.current_tenant_id!;
    return this.marketplaceService.getMyPublishedTemplates(tenantId);
  }

  @Get('my/installed')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(RlsContextInterceptor)
  @ApiOperation({ summary: 'List templates installed by my church' })
  @ApiResponse({ status: 200, description: 'My installed templates' })
  async myInstalled(@CurrentUser() user: SupabaseJwtPayload) {
    const tenantId = user.app_metadata?.current_tenant_id!;
    return this.marketplaceService.getMyInstalledTemplates(tenantId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single template with full detail' })
  @ApiResponse({ status: 200, description: 'Template detail' })
  async getTemplate(@Param('id', ParseUUIDPipe) id: string) {
    return this.marketplaceService.getTemplate(id);
  }

  @Post('publish')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(RlsContextInterceptor)
  @ApiOperation({ summary: 'Publish a workflow as a marketplace template' })
  @ApiResponse({ status: 201, description: 'Template published' })
  async publish(
    @CurrentUser() user: SupabaseJwtPayload,
    @Body() dto: PublishTemplateDto,
  ) {
    const tenantId = user.app_metadata?.current_tenant_id!;
    return this.marketplaceService.publishTemplate(tenantId, dto, user.sub);
  }

  @Delete(':id/unpublish')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(RlsContextInterceptor)
  @ApiOperation({ summary: 'Unpublish your own template' })
  @ApiResponse({ status: 200, description: 'Template unpublished' })
  async unpublish(
    @CurrentUser() user: SupabaseJwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const tenantId = user.app_metadata?.current_tenant_id!;
    return this.marketplaceService.unpublishTemplate(tenantId, id);
  }

  @Post(':id/install')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(RlsContextInterceptor)
  @ApiOperation({ summary: 'Install (buy) a template into your church' })
  @ApiResponse({ status: 201, description: 'Template installed, workflow created' })
  async install(
    @CurrentUser() user: SupabaseJwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const tenantId = user.app_metadata?.current_tenant_id!;
    return this.marketplaceService.installTemplate(tenantId, id, user.sub);
  }

  @Post(':id/rate')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(RlsContextInterceptor)
  @ApiOperation({ summary: 'Rate a template (1-5 stars)' })
  @ApiResponse({ status: 201, description: 'Rating submitted' })
  async rate(
    @CurrentUser() user: SupabaseJwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RateTemplateDto,
  ) {
    const tenantId = user.app_metadata?.current_tenant_id!;
    return this.marketplaceService.rateTemplate(tenantId, id, dto);
  }

  @Post('seed-official')
  @ApiOperation({ summary: 'Seed official templates (idempotent, call once)' })
  @ApiResponse({ status: 201, description: 'Official templates seeded' })
  async seedOfficial() {
    return this.marketplaceService.seedOfficialTemplates();
  }
}
