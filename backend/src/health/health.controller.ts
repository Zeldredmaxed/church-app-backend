import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { DataSource } from 'typeorm';

@ApiTags('Health')
@Controller('health')
@SkipThrottle()
export class HealthController {
  constructor(private readonly dataSource: DataSource) {}

  @Get()
  @ApiOperation({ summary: 'Liveness probe — is the process running?' })
  @ApiResponse({ status: 200, description: '{ status: "ok", timestamp }' })
  liveness() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe — is the database connection alive?' })
  @ApiResponse({ status: 200, description: '{ status: "ok"|"degraded", database: "connected"|"disconnected", timestamp }' })
  async readiness() {
    try {
      await this.dataSource.query('SELECT 1');
      return {
        status: 'ok',
        database: 'connected',
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        status: 'degraded',
        database: 'disconnected',
        timestamp: new Date().toISOString(),
      };
    }
  }
}
