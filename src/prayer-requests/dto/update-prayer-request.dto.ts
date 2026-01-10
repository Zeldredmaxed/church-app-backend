import { PartialType } from '@nestjs/swagger';
import { CreatePrayerRequestDto } from './create-prayer-request.dto';

export class UpdatePrayerRequestDto extends PartialType(CreatePrayerRequestDto) {}
