import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { AiService } from './ai.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  // The only endpoint we need: Ask the Pastor AI
  @Post('ask')
  @UseGuards(JwtAuthGuard)
  async ask(@Body('question') question: string) {
    return this.aiService.askPastor(question);
  }
}