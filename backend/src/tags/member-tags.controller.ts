import { Controller, Get, Param, ParseUUIDPipe, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { TagsService } from './tags.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';

@ApiTags('Tags')
@ApiBearerAuth()
@Controller('members')
@UseGuards(JwtAuthGuard)
@UseInterceptors(RlsContextInterceptor)
export class MemberTagsController {
  constructor(private readonly tagsService: TagsService) {}

  @Get(':userId/tags')
  @ApiOperation({ summary: 'Get all tags for a specific member' })
  getMemberTags(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.tagsService.getMemberTags(userId);
  }
}
