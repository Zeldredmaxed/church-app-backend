import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  ParseUUIDPipe,
  UseGuards,
  UseInterceptors,
  HttpCode,
  HttpStatus,
  Sse,
  MessageEvent,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { Observable } from 'rxjs';
import { AiService } from './ai.service';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { TranscribeDto } from './dto/transcribe.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { TierGuard } from '../common/guards/tier.guard';
import { RequiresTier } from '../common/decorators/requires-tier.decorator';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SupabaseJwtPayload } from '../common/types/jwt-payload.type';

/**
 * AI Assistant — conversation persistence + streaming chat.
 *
 * Mounted at /api/ai/* (mobile expects this prefix). The legacy
 * /api/assistant/ask route is preserved on AssistantController for
 * back-compat with structured-report callers.
 *
 * Premium+ only via @RequiresTier('aiAssistant').
 */
@ApiTags('AI Assistant')
@ApiBearerAuth()
@Controller('ai')
@UseGuards(JwtAuthGuard, TierGuard)
@RequiresTier('aiAssistant')
@UseInterceptors(RlsContextInterceptor)
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Get('conversations')
  @ApiOperation({ summary: 'List the caller\'s AI conversations (most recent first)' })
  @ApiResponse({ status: 200, description: '{ data: Conversation[] }' })
  listConversations(@CurrentUser() user: SupabaseJwtPayload) {
    return this.aiService.listConversations(user.sub);
  }

  @Post('conversations')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new conversation with an opening user message' })
  @ApiResponse({ status: 201, description: '{ conversation, message }' })
  createConversation(
    @CurrentUser() user: SupabaseJwtPayload,
    @Body() dto: CreateConversationDto,
  ) {
    return this.aiService.createConversation(user.sub, dto.content, dto.title);
  }

  @Get('conversations/:id')
  @ApiOperation({ summary: 'Fetch a conversation with all of its messages' })
  @ApiResponse({ status: 200, description: '{ conversation, messages[] }' })
  getConversation(
    @CurrentUser() user: SupabaseJwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.aiService.getConversation(user.sub, id);
  }

  @Delete('conversations/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a conversation (cascade-deletes its messages)' })
  @ApiResponse({ status: 200, description: '{ id, deleted: true }' })
  deleteConversation(
    @CurrentUser() user: SupabaseJwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.aiService.deleteConversation(user.sub, id);
  }

  /**
   * Two-step send-and-stream pattern. EventSource is GET-only and can't
   * carry a JSON body, so the mobile:
   *   1. POSTs { content } to /api/ai/conversations/:id/messages
   *      → returns { messageId } (the user message is persisted server-side)
   *   2. Opens EventSource to /api/ai/conversations/:id/messages/:messageId/stream
   *      → reads the assistant's streaming reply
   * The stream is teardown-safe via AbortController so a client disconnect
   * abort the upstream Anthropic socket (no leaked tokens).
   */
  @Post('conversations/:id/messages')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Persist a user message and prepare it for streaming',
    description: 'Returns { messageId } — open EventSource to /:id/messages/:messageId/stream next.',
  })
  @ApiResponse({ status: 201, description: '{ messageId }' })
  sendMessage(
    @CurrentUser() user: SupabaseJwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SendMessageDto,
  ) {
    return this.aiService.persistUserMessage(user.sub, id, dto.content);
  }

  /**
   * Streams the assistant's reply to a previously-persisted user message.
   * Emits:
   *   event: token   data: "<chunk text>"
   *   event: done    data: {"messageId":"...","conversationId":"..."}
   *   event: error   data: "<message>"
   */
  @Sse('conversations/:id/messages/:messageId/stream')
  @ApiOperation({
    summary: 'Stream the assistant reply for a pending user message',
    description: 'NestJS @Sse — events of type "token", "done", "error".',
  })
  streamMessage(
    @CurrentUser() user: SupabaseJwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
  ): Observable<MessageEvent> {
    return new Observable<MessageEvent>(subscriber => {
      // AbortController lets us cancel the upstream Anthropic fetch when
      // the mobile EventSource disconnects mid-stream. Without it every
      // dropped session burns ~2k tokens on a stream Anthropic keeps
      // pumping until natural EOS, and a half-baked assistant message
      // gets persisted via a queryRunner whose RLS context is already
      // torn down.
      const abort = new AbortController();
      (async () => {
        try {
          for await (const chunk of this.aiService.streamReply(
            user.sub,
            id,
            messageId,
            abort.signal,
          )) {
            subscriber.next({
              type: chunk.type,
              data: typeof chunk.data === 'string' ? chunk.data : JSON.stringify(chunk.data),
            });
            if (chunk.type === 'done' || chunk.type === 'error') {
              subscriber.complete();
              return;
            }
          }
          subscriber.complete();
        } catch (err: any) {
          if (!abort.signal.aborted) {
            subscriber.next({ type: 'error', data: err?.message ?? 'Stream failed' });
          }
          subscriber.complete();
        }
      })();
      return () => abort.abort();
    });
  }

  @Post('transcribe')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Transcribe an audio recording to text via OpenAI Whisper',
    description:
      'Body: { audioBase64, mimeType?, filename? }. Returns { text }. ' +
      'If OPENAI_API_KEY is not configured, returns 503 with a clear message.',
  })
  @ApiResponse({ status: 200, description: '{ text }' })
  @ApiResponse({ status: 503, description: 'Transcription not configured on this server' })
  transcribe(@Body() dto: TranscribeDto) {
    return this.aiService.transcribeBase64(dto.audioBase64, dto.mimeType, dto.filename);
  }
}
