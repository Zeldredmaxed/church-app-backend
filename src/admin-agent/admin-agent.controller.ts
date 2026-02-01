import { Controller, Post, Body } from '@nestjs/common';
import { AdminAgentService } from './admin-agent.service';

@Controller('admin-agent')
export class AdminAgentController {
  constructor(private readonly adminAgentService: AdminAgentService) {}

  @Post('command')
  async execute(@Body() body: { adminId: string; command: string }) {
    return this.adminAgentService.processCommand(body.adminId, body.command);
  }
}
