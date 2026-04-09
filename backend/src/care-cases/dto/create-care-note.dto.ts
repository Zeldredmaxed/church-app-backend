import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateCareNoteDto {
  @ApiProperty({ example: 'Visited the member today. They are recovering well.' })
  @IsString()
  @IsNotEmpty()
  content: string;
}
