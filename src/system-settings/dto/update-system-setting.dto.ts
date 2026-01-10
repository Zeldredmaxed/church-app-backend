import { PartialType } from '@nestjs/swagger';
import { CreateSystemSettingDto } from './create-system-setting.dto';

export class UpdateSystemSettingDto extends PartialType(CreateSystemSettingDto) {}
