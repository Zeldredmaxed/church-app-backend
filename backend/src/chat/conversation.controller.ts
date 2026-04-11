import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  ParseUUIDPipe,
  UseGuards,
  UseInterceptors,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID } from 'class-validator';
import { ConversationService } from './conversation.service';
import { SendMessageDto } from './dto/send-message.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SupabaseJwtPayload } from '../common/types/jwt-payload.type';

class GetOrCreateConversationDto {
  @IsUUID()
  participantId: string;
}

@ApiTags('Messages / Conversations')
@ApiBearerAuth()
@Controller('messages/conversations')
@UseGuards(JwtAuthGuard)
@UseInterceptors(RlsContextInterceptor)
export class ConversationController {
  constructor(private readonly conversationService: ConversationService) {}

  @Get()
  @ApiOperation({ summary: 'List all DM conversations for the authenticated user' })
  @ApiResponse({ status: 200, description: 'Array of conversations with participant info and last message' })
  listConversations(@CurrentUser() user: SupabaseJwtPayload) {
    return this.conversationService.listConversations(user.sub);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get or create a DM conversation with a participant' })
  @ApiResponse({ status: 200, description: 'Conversation object with participant info' })
  getOrCreateConversation(
    @CurrentUser() user: SupabaseJwtPayload,
    @Body() dto: GetOrCreateConversationDto,
  ) {
    return this.conversationService.getOrCreateConversation(user.sub, dto.participantId);
  }

  @Get(':id/messages')
  @ApiOperation({ summary: 'Fetch all messages in a conversation' })
  @ApiResponse({ status: 200, description: 'Array of messages in chronological order' })
  getMessages(
    @Param('id', ParseUUIDPipe) conversationId: string,
    @CurrentUser() user: SupabaseJwtPayload,
  ) {
    return this.conversationService.getMessages(conversationId, user.sub);
  }

  @Post(':id/messages')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Send a message in a conversation' })
  @ApiResponse({ status: 201, description: 'Created message object' })
  sendMessage(
    @Param('id', ParseUUIDPipe) conversationId: string,
    @CurrentUser() user: SupabaseJwtPayload,
    @Body() dto: SendMessageDto,
  ) {
    return this.conversationService.sendMessage(conversationId, dto, user.sub);
  }
}
