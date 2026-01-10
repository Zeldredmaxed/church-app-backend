import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class BibleService {
  constructor(private readonly prisma: PrismaService) {}

  // 1. Create Highlight (Admin Only)
  create(data: { book: string; chapter: number; verse: number; note?: string }) {
    return this.prisma.bibleHighlight.create({ data });
  }

  // 2. Get All Highlights (For the App)
  findAll() {
    return this.prisma.bibleHighlight.findMany({
      orderBy: { createdAt: 'desc' }
    });
  }

  // 3. Remove
  remove(id: string) {
    return this.prisma.bibleHighlight.delete({ where: { id } });
  }
}
