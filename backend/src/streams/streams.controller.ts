import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
  UseGuards,
  UseInterceptors,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { StreamsService } from './streams.service';
import { CreateStreamDto } from './dto/create-stream.dto';
import { UpdateStreamDto } from './dto/update-stream.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RoleGuard, RequiresRole } from '../common/guards/role.guard';
import { ChurchOnly } from '../common/guards/church-only.guard';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SupabaseJwtPayload } from '../common/types/jwt-payload.type';

@ApiTags('Streams')
@ApiBearerAuth()
@Controller('streams')
@UseGuards(JwtAuthGuard)
@UseInterceptors(RlsContextInterceptor)
@ChurchOnly()
export class StreamsController {
  constructor(private readonly streamsService: StreamsService) {}

  // Static routes BEFORE parameterized.
  @Get('current')
  @ApiOperation({ summary: 'Get the currently live stream (or null)' })
  getCurrent() {
    return this.streamsService.getCurrent();
  }

  @Get()
  @ApiOperation({ summary: 'List streams for the tenant' })
  list(@Query('limit') limit?: string) {
    const parsed = Math.min(parseInt(limit ?? '50', 10) || 50, 100);
    return this.streamsService.list(parsed);
  }

  @Post()
  @UseGuards(RoleGuard)
  @RequiresRole('admin', 'pastor')
  // Provisioning costs money on Mux. Without a rate limit a double-tap
  // (or accidental retry) spins up two paid live streams. 5/min/tenant
  // is generous enough for normal admin work; concurrent provisioning
  // is bounded by the per-IP throttle.
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a stream (admin/pastor) — returns the RTMP streamKey ONCE',
  })
  create(@Body() dto: CreateStreamDto, @CurrentUser() user: SupabaseJwtPayload) {
    return this.streamsService.create(dto, user.sub);
  }

  @Put(':id')
  @UseGuards(RoleGuard)
  @RequiresRole('admin', 'pastor')
  @ApiOperation({ summary: 'Update a stream (admin/pastor)' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStreamDto,
  ) {
    return this.streamsService.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(RoleGuard)
  @RequiresRole('admin', 'pastor')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a stream (admin/pastor)' })
  async delete(@Param('id', ParseUUIDPipe) id: string) {
    await this.streamsService.delete(id);
  }
}
