import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Expo, ExpoPushMessage } from 'expo-server-sdk';

@Injectable()
export class NotificationsService {
  private expo = new Expo();

  constructor(private readonly prisma: PrismaService) {}

  // 1. Save Token
  async saveToken(userId: string, token: string) {
    if (!Expo.isExpoPushToken(token)) {
      console.error(`[NOTIFY] ❌ Invalid Expo Push Token: ${token}`);
      return;
    }
    
    return this.prisma.user.update({
      where: { id: userId },
      data: { fcmToken: token }
    });
  }

  // 2. Update Preferences
  async updatePreferences(userId: string, settings: any) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { notificationSettings: settings }
    });
  }

  // 3. Send Notification
  async send(userId: string, type: 'chat' | 'sermons' | 'announcements', title: string, body: string) {
    console.log(`[NOTIFY] Preparing to send '${type}' to User ${userId}`);

    // A. Get User
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    
    if (!user || !user.fcmToken) {
      console.log(`[NOTIFY] ❌ User missing or no token.`);
      return;
    }

    // B. Check Permissions
    const rules = await this.prisma.systemSetting.findUnique({ where: { key: 'notification_rules' } });
    const adminRules = rules?.value as any;
    const userSettings = user.notificationSettings as any;

    const adminForced = adminRules ? adminRules[type] === true : false;
    const userWanted = userSettings ? userSettings[type] === true : true;

    if (!adminForced && !userWanted) {
      console.log(`[NOTIFY] 🔕 Blocked by preferences.`);
      return;
    }

    // C. Construct Message
    // FIX: We explicitly tell TypeScript this array holds Expo messages
    const messages: ExpoPushMessage[] = []; 

    if (!Expo.isExpoPushToken(user.fcmToken)) {
      console.error(`[NOTIFY] ❌ Token is not a valid Expo token: ${user.fcmToken}`);
      return;
    }

    messages.push({
      to: user.fcmToken,
      sound: 'default',
      title: title,
      body: body,
      data: { type },
    });

    // D. Send via Expo
    try {
      const chunks = this.expo.chunkPushNotifications(messages);
      
      for (const chunk of chunks) {
        try {
          const ticketChunk = await this.expo.sendPushNotificationsAsync(chunk);
          console.log(`[NOTIFY] 🚀 Sent successfully!`, ticketChunk);
        } catch (error) {
          console.error(`[NOTIFY] Error sending chunk`, error);
        }
      }
    } catch (e) {
      console.log(`[NOTIFY] 💥 EXPO ERROR:`, e);
    }
  }
}
