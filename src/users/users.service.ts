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
    
    // 1. Create User
    const user = await this.prisma.user.create({
      data: {
        email: createUserDto.email,
        password: hashedPassword,
        firstName: createUserDto.firstName,
        lastName: createUserDto.lastName,
        phone: createUserDto.phone,
        address: createUserDto.address,
        isBaptized: createUserDto.isBaptized || false,
        children: createUserDto.children || [],
      },
    });

    // 2. Auto-Assign Tags ("Member" AND "New Member")
    const tagsToAssign = ["Member", "New Member"];

    for (const tagName of tagsToAssign) {
      // Find or Create Tag
      let tag = await this.prisma.tag.findFirst({ where: { name: tagName } });
      if (!tag) {
        // Create it if it doesn't exist (Blue for Member, Green for New)
        tag = await this.prisma.tag.create({ 
          data: { 
            name: tagName, 
            color: tagName === 'New Member' ? '#4CAF50' : '#1976D2' 
          } 
        });
      }
      
      // Assign to User
      await this.prisma.userTag.create({
        data: { userId: user.id, tagId: tag.id }
      }).catch(() => {}); // Ignore if already assigned
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

  // 2.5. Filter Users (with criteria)
  async filterUsers(criteria: any) {
    const whereClause: any = {};

    // 1. Exact Matches (Strings)
    if (criteria.gender) whereClause.gender = criteria.gender;
    if (criteria.maritalStatus) whereClause.maritalStatus = criteria.maritalStatus;
    if (criteria.membershipStatus) whereClause.membershipStatus = criteria.membershipStatus;
    if (criteria.parentingStage) whereClause.parentingStage = criteria.parentingStage;
    if (criteria.discipleshipStage) whereClause.discipleshipStage = criteria.discipleshipStage;
    if (criteria.volunteerStatus) whereClause.volunteerStatus = criteria.volunteerStatus;
    if (criteria.givingFrequency) whereClause.givingFrequency = criteria.givingFrequency;
    if (criteria.preferredContact) whereClause.preferredContact = criteria.preferredContact;
    if (criteria.attendanceFreq) whereClause.attendanceFreq = criteria.attendanceFreq;

    // 2. Boolean Matches
    if (criteria.isBaptized !== undefined) whereClause.isBaptized = criteria.isBaptized;
    if (criteria.singleParent !== undefined) whereClause.singleParent = criteria.singleParent;
    if (criteria.leadershipRole !== undefined) whereClause.leadershipRole = criteria.leadershipRole;
    if (criteria.smallGroupMember !== undefined) whereClause.smallGroupMember = criteria.smallGroupMember;
    if (criteria.pastoralCareNeeded !== undefined) whereClause.pastoralCareNeeded = criteria.pastoralCareNeeded;
    if (criteria.giverStatus !== undefined) whereClause.giverStatus = criteria.giverStatus;

    // 3. Array Contains (Postgres 'has')
    if (criteria.ministryInterest) {
      whereClause.ministryInterests = { has: criteria.ministryInterest };
    }
    if (criteria.careType) {
      whereClause.careTypes = { has: criteria.careType };
    }
    if (criteria.careNeed) {
      whereClause.careNeeds = { has: criteria.careNeed };
    }
    if (criteria.lifeEvent) {
      whereClause.lifeEvents = { has: criteria.lifeEvent };
    }
    if (criteria.ministrySkill) {
      whereClause.ministrySkills = { has: criteria.ministrySkill };
    }

    // 4. Age Ranges (ageGroup: Convert string to date range)
    if (criteria.ageGroup) {
      const today = new Date();
      let minAge: number | null = null;
      let maxAge: number | null = null;

      switch (criteria.ageGroup) {
        case 'Child':
          minAge = 0;
          maxAge = 12;
          break;
        case 'Youth':
          minAge = 13;
          maxAge = 18;
          break;
        case 'Young Adult':
          minAge = 19;
          maxAge = 29;
          break;
        case 'Adult':
          minAge = 30;
          maxAge = 64;
          break;
        case 'Senior':
          minAge = 65;
          maxAge = null; // No upper limit
          break;
      }

      if (minAge !== null) {
        const maxDate = new Date(today.getFullYear() - minAge, today.getMonth(), today.getDate());
        whereClause.dateOfBirth = { ...whereClause.dateOfBirth, lte: maxDate };
      }
      if (maxAge !== null) {
        const minDate = new Date(today.getFullYear() - maxAge - 1, today.getMonth(), today.getDate());
        whereClause.dateOfBirth = { ...whereClause.dateOfBirth, gte: minDate };
      }
    }

    // Date/Age Calculations (minAge/maxAge - keep existing logic)
    if (criteria.minAge || criteria.maxAge) {
      const today = new Date();
      if (criteria.minAge) {
        const d = new Date(today.getFullYear() - criteria.minAge, today.getMonth(), today.getDate());
        whereClause.dateOfBirth = { ...whereClause.dateOfBirth, lte: d };
      }
      if (criteria.maxAge) {
        const d = new Date(today.getFullYear() - criteria.maxAge - 1, today.getMonth(), today.getDate());
        whereClause.dateOfBirth = { ...whereClause.dateOfBirth, gte: d };
      }
    }

    // 5. Date Ranges (isNewMember: Created < 6 months ago)
    if (criteria.isNewMember) {
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
      whereClause.createdAt = { gte: sixMonthsAgo };
    }

    // Keep existing hasChildren filter if needed
    if (criteria.hasChildren) {
      whereClause.children = {
        not: null,
      };
    }

    return this.prisma.user.findMany({
      where: whereClause,
      include: {
        tags: {
          include: { tag: true }
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

  // 5. Update User (With Data Cleaning)
  async update(id: string, updateUserDto: UpdateUserDto) {
    // A. Avatar Cleanup (Keep existing logic)
    if (updateUserDto.avatarUrl) {
      const oldUser = await this.prisma.user.findUnique({ where: { id } });
      if (oldUser?.avatarUrl && !oldUser.avatarUrl.startsWith('http')) {
        const filePath = oldUser.avatarUrl.startsWith('/') ? oldUser.avatarUrl.substring(1) : oldUser.avatarUrl;
        fs.unlink(filePath, () => {});
      }
    }

    // B. Clean the Data for Prisma
    // We create a new object to ensure types are perfect
    const dataToSave: any = { ...updateUserDto };

    // Fix Date: Convert string to Date object if it exists
    if (typeof dataToSave.dateOfBirth === 'string') {
      dataToSave.dateOfBirth = new Date(dataToSave.dateOfBirth);
    }
    // Fix Date: Last Attended
    if (typeof dataToSave.lastAttended === 'string') {
      dataToSave.lastAttended = new Date(dataToSave.lastAttended);
    }
    
    // Fix Arrays: Ensure they are arrays (Prisma needs set: [...] sometimes, but usually direct array works)
    // If we receive "string", split it. If array, keep it.
    // (This is a safety catch in case the DTO didn't catch it)
    
    // Fix Role: Ensure it matches the Enum if passed
    if (dataToSave.role) {
       // Optional: Validate role or delete it if you don't want to update it here
    }

    // Handle password hashing if password is being updated
    if ('password' in dataToSave && dataToSave.password) {
      dataToSave.password = await bcrypt.hash(dataToSave.password, 10);
    }

    // C. Perform Update
    try {
      return await this.prisma.user.update({
        where: { id },
        data: dataToSave,
      });
    } catch (error) {
      console.log("Update Error Details:", error); // <--- This will show up in your terminal
      throw error; // Re-throw so the frontend gets the 500
    }
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

    // D. Calculate Best Streak
    // If the new current streak is higher than the old best, update the best.
    // (Note: user.bestStreak might be null for old users, so default to 0)
    const currentBest = user.bestStreak || 0;
    const newBest = streak > currentBest ? streak : currentBest;

    // E. Save
    return this.prisma.user.update({
      where: { id: userId },
      data: { 
        habitData: data as any,
        streak: streak as any,
        bestStreak: newBest // <--- Saving the new high score
      } as any
    });
  }
}