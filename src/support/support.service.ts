import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SupportService {
  constructor(private readonly prisma: PrismaService) {}

  // Create Ticket
  create(data: { type: string; message: string; userId: string }) {
    return this.prisma.supportTicket.create({ data });
  }

  // Find All (With User info)
  findAll() {
    return this.prisma.supportTicket.findMany({
      orderBy: { createdAt: 'desc' },
      include: { user: true },
    });
  }

  // Update Status (Open -> Resolved)
  update(id: string, updateData: { status: string }) {
    return this.prisma.supportTicket.update({
      where: { id },
      data: updateData,
    });
  }

  // Delete
  remove(id: string) {
    return this.prisma.supportTicket.delete({ where: { id } });
  }
}
