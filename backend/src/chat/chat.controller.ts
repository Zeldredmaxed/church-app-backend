import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
  UseGuards,
  UseInterceptors,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { ChatService } from './chat.service';
import { CreateChannelDto } from './dto/create-channel.dto';
import { AddMemberDto } from './dto/add-member.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { GetMessagesDto } from './dto/get-messages.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SupabaseJwtPayload } from '../common/types/jwt-payload.type';

@ApiTags('Chat')
@ApiBearerAuth()
@Controller('channels')
@UseGuards(JwtAuthGuard)
@UseInterceptors(RlsContextInterceptor)
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a chat channel (public, private, or direct)' })
  @ApiResponse({ status: 201, description: 'Channel created. Creator auto-added as member.' })
  createChannel(
    @CurrentUser() user: SupabaseJwtPayload,
    @Body() dto: CreateChannelDto,
  ) {
    return this.chatService.createChannel(dto, user.sub);
  }

  @Get()
  @ApiOperation({ summary: 'List accessible channels in the current tenant' })
  @ApiResponse({ status: 200, description: 'Array of channels' })
  getChannels() {
    return this.chatService.getChannels();
  }

  @Post(':id/members')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add a member to a channel' })
  @ApiResponse({ status: 201, description: 'Member added (idempotent)' })
  addMember(
    @Param('id', ParseUUIDPipe) channelId: string,
    @Body() dto: AddMemberDto,
  ) {
    return this.chatService.addMember(channelId, dto.userId);
  }

  @Post(':id/messages')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Send a message to a channel' })
  @ApiResponse({ status: 201, description: 'Message sent. Push notification dispatched for private/direct channels.' })
  sendMessage(
    @Param('id', ParseUUIDPipe) channelId: string,
    @CurrentUser() user: SupabaseJwtPayload,
    @Body() dto: SendMessageDto,
  ) {
    return this.chatService.sendMessage(channelId, dto, user.sub);
  }

  @Get(':id/messages')
  @ApiOperation({ summary: 'Get channel messages with cursor-based pagination' })
  @ApiResponse({ status: 200, description: '{ messages, nextCursor } — nextCursor is null when no more messages' })
  getMessages(
    @Param('id', ParseUUIDPipe) channelId: string,
    @Query() query: GetMessagesDto,
  ) {
    return this.chatService.getMessages(channelId, query.cursor, query.limit);
  }
}
