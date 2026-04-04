import { IsString, IsNotEmpty, IsEmail, MinLength, MaxLength, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RegisterChurchDto {
  @ApiProperty({ example: 'Grace Community Church' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  churchName: string;

  @ApiProperty({ example: 'grace-church', description: 'Lowercase letters and dashes only' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(63)
  @Matches(/^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/, {
    message: 'churchId must contain only lowercase letters, numbers, and dashes',
  })
  churchId: string;

  @ApiProperty({ example: 'Pastor John Smith' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  adminName: string;

  @ApiProperty({ example: 'pastor@gracechurch.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'StrongP@ssw0rd!' })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password: string;

  @ApiProperty({ example: 'NG-ABC1-DEF2', description: 'Invite code provided by platform owner' })
  @IsString()
  @IsNotEmpty()
  registrationKey: string;
}
