import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { SystemSettingsService } from './system-settings.service';
import { CreateSystemSettingDto } from './dto/create-system-setting.dto';
import { UpdateSystemSettingDto } from './dto/update-system-setting.dto';

@Controller('system-settings')
export class SystemSettingsController {
  constructor(private readonly systemSettingsService: SystemSettingsService) {}

  @Post()
  create(@Body() createSystemSettingDto: CreateSystemSettingDto) {
    return this.systemSettingsService.create(createSystemSettingDto);
  }

  @Get()
  findAll() {
    return this.systemSettingsService.findAll();
  }

  @Get(':key')
  findOne(@Param('key') key: string) {
    return this.systemSettingsService.findOne(key);
  }

  @Patch(':key')
  update(@Param('key') key: string, @Body() updateSystemSettingDto: UpdateSystemSettingDto) {
    return this.systemSettingsService.update(key, updateSystemSettingDto);
  }

  @Delete(':key')
  remove(@Param('key') key: string) {
    return this.systemSettingsService.remove(key);
  }

  // Specific endpoint for notification rules
  @Get('notification_rules')
  getNotificationRules() {
    return this.systemSettingsService.findOne('notification_rules');
  }

  @Patch('notification_rules')
  updateNotificationRules(@Body() body: { value: any }) {
    return this.systemSettingsService.update('notification_rules', { value: body.value });
  }
}
