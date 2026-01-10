import * as fs from 'fs';
import * as path from 'path';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import * as bcrypt from 'bcrypt';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  // 1. Create User (Register) with Auto-Tag
  async create(createUserDto: CreateUserDto) {
    const hashedPassword = await bcrypt.hash(createUserDto.password, 10);
    
    // 1. Create the User
    const userData: any = {
      email: createUserDto.email,
      password: hashedPassword,
      firstName: createUserDto.firstName,
      lastName: createUserDto.lastName,
    };
    
    // Add optional fields if provided
    if (createUserDto.phone) {
      userData.phone = createUserDto.phone;
    }
    if (createUserDto.address) {
      userData.address = createUserDto.address;
    }
    // Add role if provided (validate it's a valid Role enum value)
    if (createUserDto.role && ['ADMIN', 'LEADER', 'MEMBER', 'GUEST'].includes(createUserDto.role.toUpperCase())) {
      userData.role = createUserDto.role.toUpperCase();
    }
    
    const user = await this.prisma.user.create({
      data: userData,
    });

    // 2. Auto-Assign "Member" Tag
    // We look for a tag named "Member". If it doesn't exist, we create it.
    const memberTag = await this.prisma.tag.upsert({
      where: { id: 'auto_member_tag' }, // This is a hacky check, better to search by name
      // Actually, since we don't have unique names on tags in schema, let's do this:
      create: { name: "Member", color: "#1976D2" },
      update: {},
    }).catch(() => {
        // Fallback: If upsert fails (due to ID), just find first 'Member' tag or create new
        return this.prisma.tag.create({ data: { name: "Member", color: "#1976D2" }})
    });

    // 3. Link User to Tag
    // Note: Since finding by name is tricky without unique constraint, 
    // let's just create a new link blindly.
    // Better approach for MVP:
    try {
        // Find FIRST tag named "Member"
        let tag = await this.prisma.tag.findFirst({ where: { name: "Member" } });
        if (!tag) {
            tag = await this.prisma.tag.create({ data: { name: "Member", color: "#1976D2" } });
        }
        
        await this.prisma.userTag.create({
            data: { userId: user.id, tagId: tag.id }
        });
    } catch(e) {
        console.log("Auto-tag error", e);
    }

    return user;
  }

  // 2. Find All (Upgraded to include Tags/Roles)
  findAll() {
    return this.prisma.user.findMany({
      include: {
        tags: {
          include: { tag: true } // This lets us see if they are a "Pastor" or "Deacon"
        }
      },
      orderBy: { lastName: 'asc' }
    });
  }

  // 3. Find One by ID (Updated to DEEP FETCH tags)
  findOne(id: string) {
    return this.prisma.user.findUnique({ 
      where: { id },
      include: { 
        tags: { 
          include: { tag: true } // <--- This is the magic line. It gets the Name and Color.
        } 
      } 
    });
  }

  // 4. Find One by Email (CRITICAL FOR LOGIN)
  async findOneByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } });
  }

  // 5. Update User (With File Cleanup)
  async update(id: string, updateUserDto: UpdateUserDto) {
    const updateData: any = { ...updateUserDto };
    
    // 1. If they are updating the avatar, check for an old one
    if ((updateUserDto as any).avatarUrl) {
      const oldUser = await this.prisma.user.findUnique({ where: { id } });
      
      if (oldUser?.avatarUrl) {
        // The DB stores "/uploads/xyz.jpg". We need the full computer path.
        // Remove the leading slash to make it a valid file path: "uploads/xyz.jpg"
        const filePath = oldUser.avatarUrl.startsWith('/') 
          ? oldUser.avatarUrl.substring(1) 
          : oldUser.avatarUrl;

        // Delete the file if it exists
        fs.unlink(filePath, (err) => {
          if (err) console.log("Could not delete old photo:", err.message);
          else console.log("Deleted old profile photo:", filePath);
        });
      }
    }

    // Handle role field - convert string to Role enum if provided
    if (updateUserDto.role && typeof updateUserDto.role === 'string') {
      const validRoles = ['ADMIN', 'LEADER', 'MEMBER', 'GUEST'];
      if (validRoles.includes(updateUserDto.role.toUpperCase())) {
        updateData.role = updateUserDto.role.toUpperCase() as any; // Cast to Role enum
      } else {
        // Remove invalid role from update data
        delete updateData.role;
      }
    }
    
    // Handle password hashing if password is being updated
    if ('password' in updateData && updateData.password) {
      updateData.password = await bcrypt.hash(updateData.password, 10);
    }

    // 2. Perform the update
    return this.prisma.user.update({
      where: { id },
      data: updateData,
    });
  }

  // 6. Remove
  remove(id: string) {
    return this.prisma.user.delete({ where: { id } });
  }

  // 7. Toggle a Habit
  async toggleHabit(userId: string, habitType: 'word' | 'prayer' | 'service') {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new Error('User not found');
    }
    const today = new Date().toISOString().split('T')[0]; // "2026-01-10"
    
    let data = (user as any).habitData || { date: "", word: false, prayer: false, service: false };
    let streak = (user as any).streak || 0;

    // A. New Day Check?
    if (data.date !== today) {
      // It's a new day! 
      // 1. Check if they missed yesterday?
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split('T')[0];

      if (data.date === yesterdayStr) {
        // They were active yesterday. Streak continues!
        // (We don't increment yet, we wait for them to do 1 thing today)
      } else {
        // They missed a day. Streak resets.
        streak = 0;
      }

      // 2. Reset the checkboxes for today
      data = { date: today, word: false, prayer: false, service: false };
    }

    // B. Toggle the specific habit
    const wasFalse = data[habitType] === false;
    data[habitType] = true; // Mark as done (we only allow marking true for motivation)

    // C. Increment Streak?
    // If this is the FIRST action of the day, bump the streak
    const isFirstActionOfDay = wasFalse && 
      (Object.values(data).filter(v => v === true).length === 1); // Only this one is true

    if (isFirstActionOfDay) {
      streak += 1;
    }

    // D. Save
    return this.prisma.user.update({
      where: { id: userId },
      data: { 
        habitData: data as any,
        streak: streak as any
      } as any
    });
  }
}