import { IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ResetPasswordDto {
  @ApiProperty({ example: 'newSecureP@ss1', description: 'New password (min 8 characters)' })
  @IsString()
  @MinLength(8)
  password: string;
}
