import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { SwitchTenantDto } from './dto/switch-tenant.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SupabaseJwtPayload } from '../common/types/jwt-payload.type';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('signup')
  @Throttle({ auth: { ttl: 60000, limit: 5 } })
  @ApiOperation({ summary: 'Register a new user account' })
  @ApiResponse({ status: 201, description: 'Account created. Confirm email before logging in.' })
  @ApiResponse({ status: 401, description: 'Signup failed (e.g., email already exists)' })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded (5 req/min)' })
  signup(@Body() dto: SignupDto) {
    return this.authService.signup(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ auth: { ttl: 60000, limit: 5 } })
  @ApiOperation({ summary: 'Authenticate and receive session tokens' })
  @ApiResponse({ status: 200, description: 'Returns accessToken, refreshToken, expiresAt, and user metadata' })
  @ApiResponse({ status: 401, description: 'Invalid email or password' })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded (5 req/min)' })
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle({ auth: { ttl: 60000, limit: 5 } })
  @ApiOperation({ summary: 'Exchange refresh token for new access token' })
  @ApiResponse({ status: 200, description: 'Returns new accessToken and refreshToken' })
  @ApiResponse({ status: 401, description: 'Invalid or expired refresh token' })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded (5 req/min)' })
  refresh(@Body() dto: RefreshDto) {
    return this.authService.refresh(dto);
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ auth: { ttl: 60000, limit: 3 } })
  @ApiOperation({ summary: 'Request a password reset email' })
  @ApiQuery({ name: 'redirectTo', required: false, description: 'URL the user is redirected to after clicking the reset link (should be your app\'s reset-password page)' })
  @ApiResponse({ status: 200, description: 'Always returns success to prevent email enumeration' })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded (3 req/min)' })
  forgotPassword(
    @Body() dto: ForgotPasswordDto,
    @Query('redirectTo') redirectTo?: string,
  ) {
    return this.authService.forgotPassword(dto, redirectTo);
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Set a new password (requires valid session from reset link)' })
  @ApiResponse({ status: 200, description: 'Password updated successfully' })
  @ApiResponse({ status: 401, description: 'Invalid or expired reset token' })
  resetPassword(
    @Body() dto: ResetPasswordDto,
    @Req() req: Request,
  ) {
    const token = (req.headers.authorization ?? '').replace('Bearer ', '');
    return this.authService.resetPassword(dto, token);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Logout (client should discard tokens)' })
  @ApiResponse({ status: 200, description: 'Logged out successfully' })
  logout() {
    return this.authService.logout();
  }

  @Get('session')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current session (user profile, memberships, current tenant)' })
  @ApiResponse({ status: 200, description: 'Session data for frontend bootstrap' })
  getSession(@CurrentUser() user: SupabaseJwtPayload) {
    return this.authService.getSession(user.sub);
  }

  @Post('switch-tenant')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Switch active tenant context. Client MUST call /auth/refresh afterward.' })
  @ApiResponse({ status: 200, description: 'Context switched. Call POST /auth/refresh for updated JWT.' })
  @ApiResponse({ status: 403, description: 'Not a member of the requested tenant' })
  switchTenant(
    @CurrentUser() user: SupabaseJwtPayload,
    @Body() dto: SwitchTenantDto,
  ) {
    return this.authService.switchTenant(user, dto);
  }
}
