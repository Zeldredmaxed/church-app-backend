import { IsOptional, IsBoolean, IsString, IsDateString, IsIn, IsArray } from 'class-validator';

export class UpdateJourneyDto {
  @IsOptional()
  @IsBoolean()
  attendedMembersClass?: boolean;

  @IsOptional()
  @IsDateString()
  membersClassDate?: string;

  @IsOptional()
  @IsBoolean()
  isBaptized?: boolean;

  @IsOptional()
  @IsDateString()
  baptismDate?: string;

  @IsOptional()
  @IsDateString()
  salvationDate?: string;

  @IsOptional()
  @IsIn(['not_started', 'foundations', 'growth', 'leadership', 'completed'])
  discipleshipTrack?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  skills?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  interests?: string[];

  @IsOptional()
  @IsString()
  bio?: string;
}
