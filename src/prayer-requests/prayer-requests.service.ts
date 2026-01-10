import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PrayerRequestsService {
  constructor(private readonly prisma: PrismaService) {}

  create(data: { content: string; isAnonymous: boolean; shareToWall: boolean; userId: string }) {
    return this.prisma.prayerRequest.create({ data });
  }

  // Find All (Include the list of who prayed so frontend knows)
  findAll() {
    return this.prisma.prayerRequest.findMany({
      orderBy: { createdAt: 'desc' },
      include: { 
        user: true,
        interactions: true // <--- Fetch the checklist
      } 
    });
  }

  remove(id: string) {
    return this.prisma.prayerRequest.delete({ where: { id } });
  }

  // Toggle Prayer (Add or Remove)
  async togglePray(prayerId: string, userId: string) {
    // 1. Check if they already prayed
    const existing = await this.prisma.prayerInteraction.findUnique({
      where: {
        userId_prayerId: { userId, prayerId }
      }
    });

    if (existing) {
      // --- UN-PRAY (Remove) ---
      // 1. Remove from checklist
      await this.prisma.prayerInteraction.delete({
        where: { id: existing.id }
      });
      // 2. Decrease count
      return this.prisma.prayerRequest.update({
        where: { id: prayerId },
        data: { prayCount: { decrement: 1 } },
        include: { interactions: true, user: true }
      });
    } else {
      // --- PRAY (Add) ---
      // 1. Add to checklist
      await this.prisma.prayerInteraction.create({
        data: { userId, prayerId }
      });
      // 2. Increase count
      return this.prisma.prayerRequest.update({
        where: { id: prayerId },
        data: { prayCount: { increment: 1 } },
        include: { interactions: true, user: true }
      });
    }
  }
}
