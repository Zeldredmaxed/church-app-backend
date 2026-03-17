import { Controller, Get, Post, Body, Param, Delete, UseGuards } from '@nestjs/common';
import { TagsService } from './tags.service';
import { CreateTagDto } from './dto/create-tag.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('tags')
export class TagsController {
  constructor(private readonly tagsService: TagsService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  create(@Body() createTagDto: CreateTagDto) {
    return this.tagsService.create(createTagDto);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  findAll() {
    return this.tagsService.findAll();
  }

  // Endpoint to add a user to a group: POST /tags/:id/users
  @Post(':id/users')
  @UseGuards(JwtAuthGuard)
  assignUser(@Param('id') tagId: string, @Body('userId') userId: string) {
    return this.tagsService.assignUser(tagId, userId);
  }

  // Endpoint to remove a user: DELETE /tags/:id/users/:userId
  @Delete(':id/users/:userId')
  @UseGuards(JwtAuthGuard)
  removeUser(@Param('id') tagId: string, @Param('userId') userId: string) {
    return this.tagsService.removeUser(tagId, userId);
  }
}