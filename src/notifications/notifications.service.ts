import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as admin from 'firebase-admin';
import * as path from 'path';

@Injectable()
export class NotificationsService implements OnModuleInit {
  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    // Initialize Firebase Admin if not already initialized
    if (!admin.apps.length) {
      try {
        admin.initializeApp({
          credential: admin.credential.cert(path.join(process.cwd(), 'firebase-key.json')),
        });
      } catch (error) {
        console.log('⚠️ Firebase Admin initialization skipped (no credentials):', error.message);
      }
    }
  }

  // 1. Save Token
  async saveToken(userId: string, token: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { fcmToken: token }
    });
  }

  // 2. Update User Preferences
  async updatePreferences(userId: string, settings: any) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { notificationSettings: settings }
    });
  }

  // 3. Send Notification (The Smart Filter)
  async send(userId: string, type: 'chat' | 'sermons' | 'announcements', title: string, body: string) {
    // A. Get User & Admin Rules
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    const rules = await this.prisma.systemSetting.findUnique({ where: { key: 'notification_rules' } });
    
    if (!user || !user.fcmToken) return;

    // B. Check Permissions (With Safety Checks)
    // We cast to 'any' to stop TypeScript from complaining about JSON types
    const adminRules = rules?.value as any;
    const userSettings = user.notificationSettings as any;

    // Safely check values (default to false if missing)
    const adminForced = adminRules ? adminRules[type] === true : false;
    const userWanted = userSettings ? userSettings[type] === true : true; // Default to true if user hasn't set preference

    // If Admin didn't force it, AND User turned it off -> Don't send
    if (!adminForced && !userWanted) {
      console.log(`🔕 Notification blocked by user preference: ${type}`);
      return;
    }

    // C. Send via Firebase
    try {
      await admin.messaging().send({
        token: user.fcmToken,
        notification: { title, body },
        data: { type }
      });
      console.log(`🔔 Sent ${type} notification to ${user.firstName}`);
    } catch (e: any) {
      console.log("FCM Error (Simulated if no real creds):", e.message);
    }
  }
}
