import { IsNotEmpty, IsString, IsOptional, IsBoolean, MaxLength } from 'class-validator';

export class CreateNoteDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  content: string;

  @IsOptional()
  @IsBoolean()
  isPrivate?: boolean;
}
