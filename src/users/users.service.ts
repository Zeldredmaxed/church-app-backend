import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import * as bcrypt from 'bcrypt'; // <--- We imported the encryption tool

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createUserDto: CreateUserDto) {
    // 1. Scramble the password (10 rounds of salt)
    const hashedPassword = await bcrypt.hash(createUserDto.password, 10);

    // 2. Save user with the scrambled password
    return this.prisma.user.create({
      data: {
        email: createUserDto.email,
        password: hashedPassword, 
        firstName: createUserDto.firstName,
        lastName: createUserDto.lastName,
      },
    });
  }

  // Helper to find a user by email (needed for login later)
  async findOneByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } });
  }

  findAll() {
    return this.prisma.user.findMany();
  }

  findOne(id: string) {
    return this.prisma.user.findUnique({ where: { id } });
  }

  update(id: string, updateUserDto: UpdateUserDto) {
    return this.prisma.user.update({
      where: { id },
      data: updateUserDto,
    });
  }

  remove(id: string) {
    return this.prisma.user.delete({ where: { id } });
  }
}