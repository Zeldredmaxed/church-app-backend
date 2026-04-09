import { IsString, IsNotEmpty, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AskDto {
  @ApiProperty({
    example: 'Show me members who haven\'t attended in 30 days',
    description: 'Natural language query for the Shepherd Assistant',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  query: string;
}
