import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { AdminAgentService } from './admin-agent.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('admin-agent')
export class AdminAgentController {
  constructor(private readonly adminAgentService: AdminAgentService) {}

  @Post('command')
  @UseGuards(JwtAuthGuard)
  async execute(@Body() body: { adminId: string; command: string }) {
    return this.adminAgentService.processCommand(body.adminId, body.command);
  }
}
