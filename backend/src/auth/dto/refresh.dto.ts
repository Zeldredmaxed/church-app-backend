import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RefreshDto {
  @ApiProperty({ description: 'Refresh token from login or previous refresh' })
  @IsString()
  @IsNotEmpty()
  refreshToken: string;
}
