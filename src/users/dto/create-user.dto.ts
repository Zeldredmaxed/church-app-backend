export class CreateUserDto {
  // Essentials
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phone?: string;
  address?: string;
  role?: string; // <--- The missing piece!
  
  // Basic Demographics
  gender?: string;
  maritalStatus?: string;
  dateOfBirth?: Date | string;

  // Family & Household
  spouseName?: string;
  householdId?: string;
  parentingStage?: string;
  singleParent?: boolean;
  children?: any[]; 

  // Spiritual Milestones
  membershipStatus?: string;
  membershipDate?: Date | string;
  isBaptized?: boolean;
  baptismDate?: Date | string;
  salvationDate?: Date | string;
  
  // Ministry & Discipleship
  leadershipRole?: boolean;
  volunteerStatus?: string;
  ministrySkills?: string[];
  smallGroupMember?: boolean;
  discipleshipStage?: string;
  ministryInterests?: string[];

  // Care & Life
  pastoralCareNeeded?: boolean;
  careTypes?: string[];
  lifeEvents?: string[];

  // Engagement
  attendanceFreq?: string;
  lastAttended?: Date | string;
  communicationPref?: string;
  preferredContact?: string;

  // Giving
  giverStatus?: boolean;
  givingFrequency?: string;
  
  // Tech
  fcmToken?: string;
  notificationSettings?: any;
  streak?: number;
  avatarUrl?: string;
}
