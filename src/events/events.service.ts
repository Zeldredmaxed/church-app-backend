import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateEventDto } from './dto/create-event.dto';
import { UpdateEventDto } from './dto/update-event.dto';

@Injectable()
export class EventsService {
  constructor(private readonly prisma: PrismaService) {}

  create(createEventDto: CreateEventDto) {
    return this.prisma.event.create({
      data: {
        ...createEventDto,
        // We convert the text dates coming from the app into real Database Dates
        startTime: new Date(createEventDto.startTime),
        endTime: new Date(createEventDto.endTime),
      },
    });
  }

  findAll() {
    // Return events sorted by upcoming date
    return this.prisma.event.findMany({
      orderBy: { startTime: 'asc' }
    });
  }

  findOne(id: string) {
    return this.prisma.event.findUnique({ where: { id } });
  }

  update(id: string, updateEventDto: UpdateEventDto) {
    return this.prisma.event.update({
      where: { id },
      data: {
        ...updateEventDto,
        // If dates are provided, convert them; otherwise undefined
        startTime: updateEventDto.startTime ? new Date(updateEventDto.startTime) : undefined,
        endTime: updateEventDto.endTime ? new Date(updateEventDto.endTime) : undefined,
      },
    });
  }

  remove(id: string) {
    return this.prisma.event.delete({ where: { id } });
  }
}