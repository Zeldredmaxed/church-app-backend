import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Ip,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { JoinIosWaitlistDto } from './dto/join-waitlist.dto';
import { IosWaitlistService } from './ios-waitlist.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { SuperAdminGuard } from '../common/guards/super-admin.guard';

@ApiTags('iOS Waitlist')
@Controller('ios-waitlist')
export class IosWaitlistController {
  constructor(private readonly service: IosWaitlistService) {}

  /**
   * PUBLIC, throttled (5/min/IP). iOS users on /install submit their
   * email here. Idempotent — same email twice returns success both
   * times without exposing existence.
   */
  @Post()
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Join the iOS waitlist (public, throttled)' })
  @ApiResponse({ status: 200, description: '{ joined: true }' })
  join(@Body() dto: JoinIosWaitlistDto, @Ip() ip: string) {
    return this.service.join(dto, ip);
  }

  /** Super-admin: paginated list for the admin dashboard inspection view. */
  @Get('admin')
  @UseGuards(JwtAuthGuard, SuperAdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List waitlist entries (super-admin)' })
  @ApiResponse({ status: 200, description: '{ totalPending, totalInvited, count, items }' })
  listAdmin(
    @Query('status') status?: 'pending' | 'invited' | 'all',
    @Query('limit') limit?: string,
  ) {
    return this.service.listAll(status ?? 'all', limit ? Number(limit) : 1000);
  }

  /**
   * Super-admin: export waitlist as TestFlight-ready CSV.
   *
   * Defaults:
   *   status=pending (only rows not yet exported)
   *   markInvited=true (stamp invited_at on every row included so
   *                     they don't show up in the next export)
   *
   * For a dry-run that doesn't mutate state:
   *   GET /api/ios-waitlist/admin/export.csv?markInvited=false
   *
   * For a full re-export (all rows including already-invited):
   *   GET /api/ios-waitlist/admin/export.csv?status=all&markInvited=false
   */
  @Get('admin/export.csv')
  @UseGuards(JwtAuthGuard, SuperAdminGuard)
  @ApiBearerAuth()
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @ApiOperation({ summary: 'Export waitlist as TestFlight-ready CSV (super-admin)' })
  async exportCsv(
    @Res({ passthrough: true }) res: Response,
    @Query('status') status?: 'pending' | 'all',
    @Query('markInvited') markInvited?: string,
  ) {
    const shouldStamp = markInvited !== 'false';
    const csv = await this.service.exportCsv(status ?? 'pending', shouldStamp);
    const filename = `shepard-ios-waitlist-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return csv;
  }
}
