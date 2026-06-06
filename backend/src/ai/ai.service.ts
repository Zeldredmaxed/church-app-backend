import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { rlsStorage } from '../common/storage/rls.storage';
import { AiConversation } from './entities/ai-conversation.entity';
import { AiMessage } from './entities/ai-message.entity';

const ANTHROPIC_MODEL = 'claude-sonnet-4-6';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const OPENAI_WHISPER_URL = 'https://api.openai.com/v1/audio/transcriptions';
const SYSTEM_PROMPT = `You are Shepherd Assistant, an AI helper for church administrators using the Shepard platform.
Be concise, warm, and practical. When the admin asks for stats they should run a structured report instead — say so.
Never invent church data; if you don't know, say so.`;

export type StreamChunk =
  | { type: 'token'; data: string }
  | { type: 'done'; data: { messageId: string; conversationId: string } }
  | { type: 'error'; data: string };

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly anthropicKey: string | null;
  private readonly openaiKey: string | null;

  constructor(
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
  ) {
    this.anthropicKey = this.config.get<string>('ANTHROPIC_API_KEY') ?? null;
    this.openaiKey = this.config.get<string>('OPENAI_API_KEY') ?? null;
    if (!this.anthropicKey) {
      this.logger.warn('ANTHROPIC_API_KEY not configured — AI chat will fall back to a stub response.');
    }
    if (!this.openaiKey) {
      this.logger.warn('OPENAI_API_KEY not configured — POST /api/ai/transcribe will return 503.');
    }
  }

  private getCtx() {
    const ctx = rlsStorage.getStore();
    if (!ctx) throw new InternalServerErrorException('RLS context unavailable');
    if (!ctx.currentTenantId) throw new BadRequestException('No active tenant context.');
    return ctx;
  }

  // ── Conversations ──

  async listConversations(userId: string) {
    const { queryRunner } = this.getCtx();
    const rows = await queryRunner.query(
      `SELECT c.id, c.title, c.model, c.created_at, c.updated_at,
              (SELECT COUNT(*)::int FROM public.ai_messages m WHERE m.conversation_id = c.id) AS message_count,
              (SELECT content FROM public.ai_messages m WHERE m.conversation_id = c.id
                 ORDER BY created_at DESC LIMIT 1) AS last_message_preview
       FROM public.ai_conversations c
       WHERE c.user_id = $1
       ORDER BY c.updated_at DESC
       LIMIT 100`,
      [userId],
    );

    return {
      data: rows.map((r: any) => ({
        id: r.id,
        title: r.title,
        model: r.model,
        messageCount: Number(r.message_count ?? 0),
        lastMessagePreview: r.last_message_preview ? String(r.last_message_preview).slice(0, 200) : null,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      })),
    };
  }

  async createConversation(userId: string, content: string, explicitTitle?: string) {
    const { queryRunner, currentTenantId } = this.getCtx();

    const title = (explicitTitle ?? content).slice(0, 80) || 'New conversation';

    const conversation = queryRunner.manager.create(AiConversation, {
      tenantId: currentTenantId!,
      userId,
      title,
      model: ANTHROPIC_MODEL,
    });
    const savedConv = await queryRunner.manager.save(AiConversation, conversation);

    const firstMessage = queryRunner.manager.create(AiMessage, {
      conversationId: savedConv.id,
      role: 'user',
      content,
    });
    const savedMsg = await queryRunner.manager.save(AiMessage, firstMessage);

    return {
      conversation: this.mapConversation(savedConv),
      message: this.mapMessage(savedMsg),
    };
  }

  async deleteConversation(userId: string, id: string) {
    const { queryRunner } = this.getCtx();

    const conv = await queryRunner.manager.findOne(AiConversation, { where: { id } });
    if (!conv) throw new NotFoundException('Conversation not found');
    if (conv.userId !== userId) throw new NotFoundException('Conversation not found');

    await queryRunner.manager.delete(AiConversation, { id });
    return { id, deleted: true };
  }

  async getConversation(userId: string, id: string) {
    const { queryRunner } = this.getCtx();

    const conv = await queryRunner.manager.findOne(AiConversation, { where: { id } });
    if (!conv || conv.userId !== userId) throw new NotFoundException('Conversation not found');

    const messages = await queryRunner.query(
      `SELECT id, role, content, tokens_input, tokens_output, created_at
       FROM public.ai_messages WHERE conversation_id = $1 ORDER BY created_at ASC`,
      [id],
    );

    return {
      conversation: this.mapConversation(conv),
      messages: messages.map((m: any) => this.mapMessage(m as any)),
    };
  }

  // ── Streaming send ──
  // Persists the user message immediately, then streams an assistant reply from
  // Anthropic. The full assistant text is saved when the stream completes.
  /**
   * Two-phase send pattern (POST then SSE) — EventSource is GET-only
   * and can't carry a body, so we persist the user message via POST
   * and stream the assistant reply via a separate SSE GET keyed on
   * the user-message id.
   */
  async persistUserMessage(
    userId: string,
    conversationId: string,
    content: string,
  ): Promise<{ messageId: string; conversationId: string }> {
    const { queryRunner } = this.getCtx();
    const conv = await queryRunner.manager.findOne(AiConversation, { where: { id: conversationId } });
    if (!conv || conv.userId !== userId) {
      throw new (require('@nestjs/common').NotFoundException)('Conversation not found');
    }
    const msg = queryRunner.manager.create(AiMessage, {
      conversationId,
      role: 'user',
      content,
    });
    const saved = await queryRunner.manager.save(AiMessage, msg);
    return { messageId: saved.id, conversationId };
  }

  /**
   * Streams the assistant reply for an already-persisted user message.
   * `signal` is wired through to the Anthropic fetch — when the mobile
   * EventSource disconnects mid-stream, the controller's AbortController
   * fires, the upstream HTTP socket cancels (no leaked tokens), and
   * the loop exits without persisting a half-baked assistant message.
   */
  async *streamReply(
    userId: string,
    conversationId: string,
    triggerMessageId: string,
    signal: AbortSignal,
  ): AsyncGenerator<StreamChunk> {
    const { queryRunner } = this.getCtx();

    const conv = await queryRunner.manager.findOne(AiConversation, { where: { id: conversationId } });
    if (!conv || conv.userId !== userId) {
      yield { type: 'error', data: 'Conversation not found' };
      return;
    }

    // Verify the triggerMessageId belongs to this conversation. Without
    // this check, a caller could pass a message id from a DIFFERENT
    // conversation and we'd silently use this conversation's history.
    const triggerCheck = await queryRunner.query(
      `SELECT 1 FROM public.ai_messages
       WHERE id = $1 AND conversation_id = $2 AND role = 'user'`,
      [triggerMessageId, conversationId],
    );
    if (triggerCheck.length === 0) {
      yield { type: 'error', data: 'Trigger message not found in this conversation' };
      return;
    }

    const history = await queryRunner.query(
      `SELECT role, content FROM public.ai_messages
       WHERE conversation_id = $1 ORDER BY created_at ASC LIMIT 60`,
      [conversationId],
    );

    let fullAssistantText = '';
    let tokensInput: number | null = null;
    let tokensOutput: number | null = null;
    let aborted = false;

    if (!this.anthropicKey) {
      const stub = "AI is not configured on this server. Set ANTHROPIC_API_KEY to enable chat.";
      fullAssistantText = stub;
      for (const word of stub.split(' ')) {
        if (signal.aborted) { aborted = true; break; }
        yield { type: 'token', data: word + ' ' };
      }
    } else {
      try {
        const response = await fetch(ANTHROPIC_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': this.anthropicKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: ANTHROPIC_MODEL,
            max_tokens: 2048,
            stream: true,
            system: SYSTEM_PROMPT,
            messages: history.map((m: any) => ({ role: m.role, content: m.content })),
          }),
          signal,
        });

        if (!response.ok || !response.body) {
          const errText = await response.text().catch(() => `HTTP ${response.status}`);
          this.logger.error(`Anthropic stream failed: ${response.status} ${errText}`);
          yield { type: 'error', data: 'AI temporarily unavailable. Please try again.' };
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          if (signal.aborted) { aborted = true; await reader.cancel().catch(() => {}); break; }
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const events = buffer.split('\n\n');
          buffer = events.pop() ?? '';

          for (const evt of events) {
            const lines = evt.split('\n');
            const dataLine = lines.find(l => l.startsWith('data: '));
            if (!dataLine) continue;
            const dataStr = dataLine.slice(6).trim();
            if (!dataStr) continue;
            try {
              const parsed = JSON.parse(dataStr);
              if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta') {
                const text = parsed.delta.text ?? '';
                fullAssistantText += text;
                yield { type: 'token', data: text };
              } else if (parsed.type === 'message_start' && parsed.message?.usage) {
                tokensInput = parsed.message.usage.input_tokens ?? null;
              } else if (parsed.type === 'message_delta' && parsed.usage) {
                tokensOutput = parsed.usage.output_tokens ?? tokensOutput;
              }
            } catch {
              // ignore malformed event
            }
          }
        }
      } catch (err: any) {
        if (signal.aborted || err?.name === 'AbortError') {
          aborted = true;
        } else {
          this.logger.error(`Anthropic stream error: ${err.message}`);
          yield { type: 'error', data: 'AI temporarily unavailable. Please try again.' };
          return;
        }
      }
    }

    // Don't persist a half-baked assistant message if the client
    // bailed mid-stream — the RLS queryRunner is being torn down
    // anyway, and the partial content has no value.
    if (aborted) {
      this.logger.log(`AI stream aborted by client (conv ${conversationId}, msg ${triggerMessageId})`);
      return;
    }

    const assistantMsg = queryRunner.manager.create(AiMessage, {
      conversationId,
      role: 'assistant',
      content: fullAssistantText,
      tokensInput,
      tokensOutput,
    });
    const savedAssistant = await queryRunner.manager.save(AiMessage, assistantMsg);

    await queryRunner.query(
      `UPDATE public.ai_conversations SET updated_at = now() WHERE id = $1`,
      [conversationId],
    );

    yield {
      type: 'done',
      data: { messageId: savedAssistant.id, conversationId },
    };
  }

  // ── Whisper transcription ──

  /**
   * Accepts a base64-encoded audio payload (mobile records via expo-av and
   * uploads as base64 since the backend has no multer pipeline). Forwards
   * to OpenAI Whisper and returns the transcription.
   */
  async transcribeBase64(audioBase64: string, mimeType?: string, filename?: string): Promise<{ text: string }> {
    if (!this.openaiKey) {
      throw new ServiceUnavailableException(
        'Audio transcription is not configured on this server. Set OPENAI_API_KEY to enable it.',
      );
    }
    if (!audioBase64 || typeof audioBase64 !== 'string') {
      throw new BadRequestException('audioBase64 (string) is required.');
    }

    let buffer: Buffer;
    try {
      // Strip data URL prefix if present (e.g. "data:audio/m4a;base64,...")
      const stripped = audioBase64.replace(/^data:[^;]+;base64,/, '');
      buffer = Buffer.from(stripped, 'base64');
    } catch {
      throw new BadRequestException('audioBase64 must be valid base64.');
    }
    if (buffer.length === 0) throw new BadRequestException('Empty audio payload.');
    if (buffer.length > 25 * 1024 * 1024) {
      throw new BadRequestException('Audio file too large (max 25 MB).');
    }

    const form = new FormData();
    // Copy into a fresh ArrayBuffer so the BlobPart type's ArrayBufferLike
    // constraint (which excludes SharedArrayBuffer) is satisfied.
    const ab = new ArrayBuffer(buffer.byteLength);
    new Uint8Array(ab).set(buffer);
    const blob = new Blob([ab], { type: mimeType || 'audio/m4a' });
    form.append('file', blob, filename || 'audio.m4a');
    form.append('model', 'whisper-1');

    const res = await fetch(OPENAI_WHISPER_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.openaiKey}` },
      body: form,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => `HTTP ${res.status}`);
      this.logger.error(`Whisper failed: ${res.status} ${errText}`);
      throw new ServiceUnavailableException('Transcription failed. Please try again.');
    }

    const data: any = await res.json();
    return { text: String(data.text ?? '') };
  }

  // ── Helpers ──

  private mapConversation(c: AiConversation) {
    return {
      id: c.id,
      title: c.title,
      model: c.model,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    };
  }

  private mapMessage(m: AiMessage | any) {
    return {
      id: m.id,
      role: m.role,
      content: m.content,
      tokensInput: m.tokensInput ?? m.tokens_input ?? null,
      tokensOutput: m.tokensOutput ?? m.tokens_output ?? null,
      createdAt: m.createdAt ?? m.created_at,
    };
  }
}
