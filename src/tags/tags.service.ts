import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTagDto } from './dto/create-tag.dto';

@Injectable()
export class TagsService {
  constructor(private readonly prisma: PrismaService) {}

  // 1. Create a Tag (e.g., "Worship Team")
  create(createTagDto: CreateTagDto) {
    return this.prisma.tag.create({
      data: createTagDto,
    });
  }

  // 2. List all tags
  findAll() {
    return this.prisma.tag.findMany();
  }

  // 3. Assign a User to a Tag
  async assignUser(tagId: string, userId: string) {
    return this.prisma.userTag.create({
      data: {
        tagId: tagId,
        userId: userId,
      },
    });
  }
  
  // 4. Remove a User from a Tag
  async removeUser(tagId: string, userId: string) {
    return this.prisma.userTag.delete({
      where: {
        userId_tagId: { userId, tagId }
      }
    });
  }
}