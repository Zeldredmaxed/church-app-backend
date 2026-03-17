import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards } from '@nestjs/common';
import { SystemSettingsService } from './system-settings.service';
import { CreateSystemSettingDto } from './dto/create-system-setting.dto';
import { UpdateSystemSettingDto } from './dto/update-system-setting.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('system-settings')
export class SystemSettingsController {
  constructor(private readonly systemSettingsService: SystemSettingsService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  create(@Body() createSystemSettingDto: CreateSystemSettingDto) {
    return this.systemSettingsService.create(createSystemSettingDto);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  findAll() {
    return this.systemSettingsService.findAll();
  }

  @Get(':key')
  @UseGuards(JwtAuthGuard)
  findOne(@Param('key') key: string) {
    return this.systemSettingsService.findOne(key);
  }

  @Patch(':key')
  @UseGuards(JwtAuthGuard)
  update(@Param('key') key: string, @Body() updateSystemSettingDto: UpdateSystemSettingDto) {
    return this.systemSettingsService.update(key, updateSystemSettingDto);
  }

  @Delete(':key')
  @UseGuards(JwtAuthGuard)
  remove(@Param('key') key: string) {
    return this.systemSettingsService.remove(key);
  }

  // Specific endpoint for notification rules
  @Get('notification_rules')
  @UseGuards(JwtAuthGuard)
  getNotificationRules() {
    return this.systemSettingsService.findOne('notification_rules');
  }

  @Patch('notification_rules')
  @UseGuards(JwtAuthGuard)
  updateNotificationRules(@Body() body: { value: any }) {
    return this.systemSettingsService.update('notification_rules', { value: body.value });
  }
}
