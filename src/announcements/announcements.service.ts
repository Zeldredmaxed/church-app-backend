import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAnnouncementDto } from './dto/create-announcement.dto';
import { UpdateAnnouncementDto } from './dto/update-announcement.dto';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class AnnouncementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  // 1. Create with Notification
  async create(data: CreateAnnouncementDto) {
    // A. Handle Pinning
    if (data.isPinned) {
      await this.prisma.announcement.updateMany({
        where: { isPinned: true },
        data: { isPinned: false },
      });
    }

    // B. Save to DB
    const announcement = await this.prisma.announcement.create({ data });

    // C. TRIGGER NOTIFICATION (The Fix)
    // We get all users who have FCM tokens
    const users = await this.prisma.user.findMany({
      where: { fcmToken: { not: null } },
    });

    // Loop and send (In a huge app, we'd use a Queue or Topic, but this works for MVP)
    for (const user of users) {
      this.notificationsService.send(
        user.id,
        'announcements', // Type
        'New Announcement', // Title
        data.title, // Body
      );
    }

    return announcement;
  }

  // 2. Find All (Pinned items first)
  findAll() {
    return this.prisma.announcement.findMany({
      orderBy: [
        { isPinned: 'desc' }, 
        { createdAt: 'desc' }
      ]
    });
  }

  // 3. Find One
  findOne(id: string) {
    return this.prisma.announcement.findUnique({ where: { id } });
  }

  // 4. Update
  update(id: string, updateAnnouncementDto: UpdateAnnouncementDto) {
    return this.prisma.announcement.update({
      where: { id },
      data: updateAnnouncementDto,
    });
  }

  // 5. Toggle Pin
  async togglePin(id: string) {
    // Unpin all
    await this.prisma.announcement.updateMany({ data: { isPinned: false } });
    
    // Pin this one
    return this.prisma.announcement.update({
      where: { id },
      data: { isPinned: true }
    });
  }

  // 6. Remove
  remove(id: string) {
    return this.prisma.announcement.delete({ where: { id } });
  }
}