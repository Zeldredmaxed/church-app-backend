import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateEventDto } from './dto/create-event.dto';
import { UpdateEventDto } from './dto/update-event.dto';

@Injectable()
export class EventsService {
  constructor(private readonly prisma: PrismaService) {}

  // 1. Create Event
  create(createEventDto: CreateEventDto) {
    return this.prisma.event.create({
      data: {
        title: createEventDto.title,
        description: createEventDto.description,
        startTime: new Date(createEventDto.startTime),
        endTime: new Date(createEventDto.endTime),
        location: createEventDto.location,
        // We cast to 'any' just in case DTO definition is strict, 
        // ensuring the new field is passed
        registrationQuestion: (createEventDto as any).registrationQuestion, 
      },
    });
  }

  // 2. Find All
  findAll() {
    return this.prisma.event.findMany({
      orderBy: { startTime: 'asc' },
      include: { registrations: true }
    });
  }

  // 3. Find One
  findOne(id: string) {
    return this.prisma.event.findUnique({ 
      where: { id },
      include: { registrations: { include: { user: true } } }
    });
  }

  // 4. Update (This was missing!)
  update(id: string, updateEventDto: UpdateEventDto) {
    return this.prisma.event.update({
      where: { id },
      data: {
        ...updateEventDto,
        // Convert dates if they are present
        startTime: updateEventDto.startTime ? new Date(updateEventDto.startTime) : undefined,
        endTime: updateEventDto.endTime ? new Date(updateEventDto.endTime) : undefined,
      },
    });
  }

  // 5. Remove (This was missing!)
  remove(id: string) {
    return this.prisma.event.delete({ where: { id } });
  }

  // 6. Register User
  async register(eventId: string, userId: string, answer: string) {
    return this.prisma.registration.create({
      data: {
        eventId,
        userId,
        answer
      }
    });
  }
}