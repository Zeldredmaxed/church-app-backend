import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSystemSettingDto } from './dto/create-system-setting.dto';
import { UpdateSystemSettingDto } from './dto/update-system-setting.dto';

@Injectable()
export class SystemSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  create(createSystemSettingDto: CreateSystemSettingDto) {
    return this.prisma.systemSetting.create({
      data: createSystemSettingDto,
    });
  }

  findAll() {
    return this.prisma.systemSetting.findMany();
  }

  findOne(key: string) {
    return this.prisma.systemSetting.findUnique({
      where: { key },
    });
  }

  async update(key: string, updateSystemSettingDto: UpdateSystemSettingDto) {
    const existing = await this.prisma.systemSetting.findUnique({
      where: { key },
    });

    if (existing) {
      return this.prisma.systemSetting.update({
        where: { key },
        data: updateSystemSettingDto,
      });
    } else {
      return this.prisma.systemSetting.create({
        data: {
          key,
          value: updateSystemSettingDto.value,
        },
      });
    }
  }

  remove(key: string) {
    return this.prisma.systemSetting.delete({
      where: { key },
    });
  }
}
