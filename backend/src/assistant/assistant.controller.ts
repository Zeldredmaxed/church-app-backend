import {
  Controller,
  Post,
  Body,
  UseGuards,
  UseInterceptors,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { AssistantService } from './assistant.service';
import { AskDto } from './dto/ask.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SupabaseJwtPayload } from '../common/types/jwt-payload.type';

@ApiTags('Shepherd Assistant')
@ApiBearerAuth()
@Controller('assistant')
@UseGuards(JwtAuthGuard)
@UseInterceptors(RlsContextInterceptor)
export class AssistantController {
  constructor(private readonly assistantService: AssistantService) {}

  @Post('ask')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Ask the Shepherd Assistant a natural language question about your church',
    description:
      'Accepts a plain English question and returns structured data from your church database. ' +
      'All queries are automatically scoped to your church — no access to other churches\' data. ' +
      'Examples: "Show me members who haven\'t attended in 30 days", ' +
      '"What\'s our giving report for this month?", "Who are our top donors?"',
  })
  @ApiResponse({
    status: 200,
    description: '{ query, summary, results[], resultCount, suggestions? }',
  })
  ask(
    @CurrentUser() user: SupabaseJwtPayload,
    @Body() dto: AskDto,
  ) {
    const tenantId = user.app_metadata?.current_tenant_id;
    if (!tenantId) {
      return {
        query: dto.query,
        summary: 'Please select a church first.',
        results: [],
        resultCount: 0,
      };
    }
    return this.assistantService.ask(tenantId, dto.query);
  }
}
