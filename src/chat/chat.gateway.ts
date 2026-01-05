import { WebSocketGateway, SubscribeMessage, MessageBody, WebSocketServer, ConnectedSocket } from '@nestjs/websockets';
import { ChatService } from './chat.service';
import { NotificationsService } from '../notifications/notifications.service'; // <--- Import
import { Server, Socket } from 'socket.io';

@WebSocketGateway({ cors: { origin: '*' } }) 
export class ChatGateway {
  @WebSocketServer()
  server: Server;

  constructor(
    private readonly chatService: ChatService,
    private readonly notificationsService: NotificationsService // <--- Inject Service
  ) {}

  @SubscribeMessage('sendMessage')
  async handleMessage(
    @MessageBody() payload: { conversationId: string; userId: string; content: string },
    @ConnectedSocket() client: Socket,
  ) {
    // 1. Save to DB
    const message = await this.chatService.saveMessage(
      payload.conversationId, 
      payload.userId, 
      payload.content
    );

    // 2. Broadcast to online users
    this.server.to(payload.conversationId).emit('newMessage', message);

    // 3. TRIGGER NOTIFICATION (Simulated)
    // In a real app, we would look up the "Device Token" of the OTHER user in the chat.
    // For now, we just prove the connection works.
    console.log(`🔔 PUSH ALERT: New message from ${message.sender.firstName}: "${message.content}"`);
    
    // Example of how you WOULD call it if you had a token:
    // this.notificationsService.sendPushNotification(otherUserToken, "New Message", message.content);
  }

  @SubscribeMessage('joinRoom')
  handleJoinRoom(@MessageBody() conversationId: string, @ConnectedSocket() client: Socket) {
    client.join(conversationId);
  }
}