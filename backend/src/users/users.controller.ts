import {
  Controller,
  Get,
  Put,
  Patch,
  Delete,
  Body,
  UseGuards,
  UseInterceptors,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SupabaseJwtPayload } from '../common/types/jwt-payload.type';

@ApiTags('Users')
@ApiBearerAuth()
@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @UseInterceptors(RlsContextInterceptor)
  @ApiOperation({ summary: 'Get authenticated user profile' })
  @ApiResponse({ status: 200, description: 'User profile' })
  getMe(@CurrentUser() user: SupabaseJwtPayload) {
    return this.usersService.getMe(user.sub);
  }

  @Patch('me')
  @UseInterceptors(RlsContextInterceptor)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update authenticated user profile (fullName, avatarUrl)' })
  @ApiResponse({ status: 200, description: 'Updated user profile' })
  updateMe(
    @CurrentUser() user: SupabaseJwtPayload,
    @Body() dto: UpdateUserDto,
  ) {
    return this.usersService.updateMe(user.sub, dto);
  }

  @Delete('me')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Permanently delete account and all data (GDPR Right to Erasure)' })
  @ApiResponse({ status: 200, description: 'Account deleted. All personal data erased.' })
  @ApiResponse({ status: 404, description: 'User not found' })
  deleteMe(@CurrentUser() user: SupabaseJwtPayload) {
    return this.usersService.deleteMe(user.sub);
  }

  @Get('me/settings')
  @ApiOperation({ summary: 'Get notification settings' })
  @ApiResponse({ status: 200, description: 'User notification settings' })
  getSettings(@CurrentUser() user: SupabaseJwtPayload) {
    return this.usersService.getSettings(user.sub);
  }

  @Put('me/settings')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update notification settings' })
  @ApiResponse({ status: 200, description: 'Updated notification settings' })
  updateSettings(
    @CurrentUser() user: SupabaseJwtPayload,
    @Body() dto: UpdateSettingsDto,
  ) {
    return this.usersService.updateSettings(user.sub, dto);
  }

  @Get('me/streak')
  @ApiOperation({ summary: 'Get login streak info' })
  @ApiResponse({ status: 200, description: 'Current and longest login streak' })
  getStreak(@CurrentUser() user: SupabaseJwtPayload) {
    return this.usersService.getStreak(user.sub);
  }

  @Get('me/export')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Export all personal data as JSON (GDPR Right of Access)' })
  @ApiResponse({ status: 200, description: 'JSON dump of all user data across all tenants' })
  exportData(@CurrentUser() user: SupabaseJwtPayload) {
    return this.usersService.exportData(user.sub);
  }
}
