import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as admin from 'firebase-admin';

@Injectable()
export class NotificationsService implements OnModuleInit {
  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    // Prevent double initialization
    if (admin.apps.length) return;

    // THE FIX: Read from Env Vars and fix the "Newline" bug
    const privateKey = process.env.FIREBASE_PRIVATE_KEY
      ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') // Fix newlines
      : undefined;

    if (!privateKey || !process.env.FIREBASE_CLIENT_EMAIL) {
      console.warn('⚠️ Firebase Credentials missing. Notifications will fail.');
      return;
    }

    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: privateKey,
      }),
    });
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

  // 3. Send Notification (Debug Version)
  async send(userId: string, type: 'chat' | 'sermons' | 'announcements', title: string, body: string) {
    console.log(`[NOTIFY] Attempting to send '${type}' to User ${userId}`);

    // A. Get User
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      console.log(`[NOTIFY] ❌ User not found: ${userId}`);
      return;
    }

    // B. Check Token
    if (!user.fcmToken) {
      console.log(`[NOTIFY] ❌ User ${user.firstName} has NO FCM Token. Cannot send.`);
      return;
    }
    console.log(`[NOTIFY] ✅ Token found: ${user.fcmToken.substring(0, 10)}...`);

    // C. Check Permissions
    const rules = await this.prisma.systemSetting.findUnique({ where: { key: 'notification_rules' } });
    const adminRules = rules?.value as any;
    const userSettings = user.notificationSettings as any;

    const adminForced = adminRules ? adminRules[type] === true : false;
    const userWanted = userSettings ? userSettings[type] === true : true; // Default to true

    console.log(`[NOTIFY] Permissions - AdminForced: ${adminForced}, UserWanted: ${userWanted}`);

    if (!adminForced && !userWanted) {
      console.log(`[NOTIFY] 🔕 Blocked by preferences.`);
      return;
    }

    // D. Send via Firebase
    try {
      await admin.messaging().send({
        token: user.fcmToken,
        notification: { title, body },
        data: { type },
      });
      console.log(`[NOTIFY] 🚀 SUCCESS! Sent to ${user.firstName}`);
    } catch (e: any) {
      console.log(`[NOTIFY] 💥 FIREBASE ERROR:`, e.message);
    }
  }
}
