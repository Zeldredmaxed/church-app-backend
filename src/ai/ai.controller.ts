import { Controller, Post, Body } from '@nestjs/common';
import { AiService } from './ai.service';

@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  // The only endpoint we need: Ask the Pastor AI
  @Post('ask')
  async ask(@Body('question') question: string) {
    return this.aiService.askPastor(question);
  }
}