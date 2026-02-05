import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Expo } from 'expo-server-sdk';

@Injectable()
export class NotificationsService {
  private expo = new Expo();

  constructor(private readonly prisma: PrismaService) {}

  // 1. Save Token (No change)
  async saveToken(userId: string, token: string) {
    // Ensure we only save Expo tokens
    if (!Expo.isExpoPushToken(token)) {
      console.error(`[NOTIFY] ❌ Invalid Expo Push Token: ${token}`);
      return;
    }
    
    return this.prisma.user.update({
      where: { id: userId },
      data: { fcmToken: token } // We store the Expo token in this column
    });
  }

  // 2. Update Preferences (No change)
  async updatePreferences(userId: string, settings: any) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { notificationSettings: settings }
    });
  }

  // 3. Send Notification (Using Expo SDK)
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
    const messages = [];
    if (!Expo.isExpoPushToken(user.fcmToken)) {
      console.error(`[NOTIFY] ❌ Token is not a valid Expo token: ${user.fcmToken}`);
      return;
    }

    messages.push({
      to: user.fcmToken,
      sound: 'default',
      title: title,
      body: body,
      data: { type }, // Helps app know where to click
    });

    // D. Send via Expo
    try {
      // expo.sendPushNotificationsAsync handles the batching and http request
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
