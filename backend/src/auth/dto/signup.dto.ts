import { IsEmail, IsString, IsOptional, IsUUID, MinLength, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SignupDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'secureP@ss1', minLength: 8, maxLength: 72 })
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  @MaxLength(72, { message: 'Password must not exceed 72 characters' }) // bcrypt limit
  password: string;

  @ApiPropertyOptional({ example: 'John Smith', description: 'User display name' })
  @IsOptional()
  @IsString()
  fullName?: string;

  @ApiPropertyOptional({ example: '55069766-b0ea-494a-8611-e39992447e20', description: 'Church to join as member on signup' })
  @IsOptional()
  @IsUUID()
  tenantId?: string;
}
