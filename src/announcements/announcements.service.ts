import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAnnouncementDto } from './dto/create-announcement.dto';
import { UpdateAnnouncementDto } from './dto/update-announcement.dto';

@Injectable()
export class AnnouncementsService {
  constructor(private readonly prisma: PrismaService) {}

  // 1. Create with Pinning Logic
  async create(data: CreateAnnouncementDto) {
    if (data.isPinned) {
      // Unpin everyone else first so only one is pinned
      await this.prisma.announcement.updateMany({
        where: { isPinned: true },
        data: { isPinned: false },
      });
    }
    return this.prisma.announcement.create({ data });
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