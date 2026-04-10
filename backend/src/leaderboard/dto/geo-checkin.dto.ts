import { IsNumber } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class GeoCheckinDto {
  @ApiProperty({ example: 33.749 })
  @IsNumber()
  lat: number;

  @ApiProperty({ example: -84.388 })
  @IsNumber()
  lng: number;
}
