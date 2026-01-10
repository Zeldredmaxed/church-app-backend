import { PartialType } from '@nestjs/mapped-types';
import { CreateUserDto } from './create-user.dto';

export class UpdateUserDto extends PartialType(CreateUserDto) {
  // Add these new allowed fields
  fcmToken?: string;
  notificationSettings?: any; // We use 'any' for JSON objects to keep it simple
}
