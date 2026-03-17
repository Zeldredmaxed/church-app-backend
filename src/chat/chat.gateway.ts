import { WebSocketGateway, SubscribeMessage, MessageBody, WebSocketServer, ConnectedSocket, OnGatewayConnection, OnGatewayDisconnect } from '@nestjs/websockets';
import { ChatService } from './chat.service';
import { NotificationsService } from '../notifications/notifications.service'; // <--- Import
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';

@WebSocketGateway({ cors: { origin: '*' } }) 
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  constructor(
    private readonly chatService: ChatService,
    private readonly notificationsService: NotificationsService, // <--- Inject Service
    private readonly jwtService: JwtService, // <--- JWT validation
  ) {}

  /**
   * Validate JWT token from WebSocket handshake
   */
  private validateToken(token: string): any {
    if (!token) {
      throw new UnauthorizedException('No token provided');
    }

    try {
      // Extract JWT from "Bearer <token>"
      const jwtToken = token.startsWith('Bearer ') ? token.slice(7) : token;
      const decoded = this.jwtService.verify(jwtToken, {
        secret: process.env.JWT_SECRET || 'MySuperSecretChurchKey2026!',
      });
      return decoded;
    } catch (error) {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  /**
   * Handle new WebSocket connections with JWT validation
   */
  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth.token || client.handshake.headers.authorization;
      const user = this.validateToken(token);
      client.data.user = user;
      console.log(`✅ WebSocket user ${user.email} connected (id: ${client.id})`);
    } catch (error) {
      console.error('❌ WebSocket connection rejected:', error.message);
      client.disconnect();
    }
  }

  /**
   * Handle WebSocket disconnections
   */
  handleDisconnect(client: Socket) {
    console.log(`👋 WebSocket user disconnected (id: ${client.id})`);
  }

  @SubscribeMessage('sendMessage')
  async handleMessage(
    @MessageBody() payload: { conversationId: string; userId: string; content: string },
    @ConnectedSocket() client: Socket,
  ) {
    // Verify user is authenticated
    if (!client.data.user) {
      throw new UnauthorizedException('WebSocket client not authenticated');
    }

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
    if (message && 'sender' in message) {
      console.log(`🔔 PUSH ALERT: New message from ${(message as any).sender?.firstName}: "${(message as any).content}"`);
    }
    
    // Example of how you WOULD call it if you had a token:
    // this.notificationsService.sendPushNotification(otherUserToken, "New Message", message.content);
  }

  @SubscribeMessage('joinRoom')
  handleJoinRoom(@MessageBody() conversationId: string, @ConnectedSocket() client: Socket) {
    // Verify user is authenticated
    if (!client.data.user) {
      throw new UnauthorizedException('WebSocket client not authenticated');
    }
    client.join(conversationId);
  }
}