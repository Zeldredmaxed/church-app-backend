import { Injectable, OnModuleInit } from '@nestjs/common';
import * as admin from 'firebase-admin';
import * as path from 'path';

@Injectable()
export class NotificationsService implements OnModuleInit {
  onModuleInit() {
    // Only initialize if we haven't done it yet
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert(path.join(process.cwd(), 'firebase-key.json')),
      });
    }
  }

  // Send a message to a specific device
  async sendPushNotification(deviceToken: string, title: string, body: string) {
    try {
      await admin.messaging().send({
        token: deviceToken,
        notification: {
          title: title,
          body: body,
        },
      });
      console.log('🔔 Notification sent successfully!');
    } catch (error) {
      console.log('❌ Error sending notification:', error.message);
    }
  }

  // Send to a "Topic" (e.g., "All Members" or "Worship Team")
  async sendToTopic(topic: string, title: string, body: string) {
    try {
      await admin.messaging().send({
        topic: topic,
        notification: { title, body },
      });
      console.log(`📢 Announcement sent to ${topic}`);
    } catch (error) {
      console.log('❌ Error sending announcement:', error.message);
    }
  }
}