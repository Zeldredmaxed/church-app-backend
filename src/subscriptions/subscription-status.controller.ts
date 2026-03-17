import { Controller, Get, Post, Body, Param, UseGuards, Put } from '@nestjs/common';
import { SubscriptionStatusService } from './subscription-status.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@Controller('subscription-status')
export class SubscriptionStatusController {
  constructor(private readonly subscriptionStatusService: SubscriptionStatusService) {}

  // GET /subscription-status/:userId
  // Check if user has active subscription - can be called by app on startup
  @Get(':userId')
  async checkStatus(@Param('userId') userId: string) {
    return this.subscriptionStatusService.checkStatus(userId);
  }

  // PUT /subscription-status/:userId
  // Update subscription status - admin only
  @Put(':userId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  async updateStatus(
    @Param('userId') userId: string,
    @Body() body: { 
      status: 'ACTIVE' | 'INACTIVE' | 'BLOCKED' | 'PAST_DUE';
      plan?: string;
      expiresAt?: string;
    }
  ) {
    return this.subscriptionStatusService.updateStatus(
      userId,
      body.status,
      body.plan,
      body.expiresAt ? new Date(body.expiresAt) : undefined
    );
  }

  // POST /subscription-status/block/:adminId
  // Block entire church - admin only
  @Post('block/:adminId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  async blockChurch(@Param('adminId') adminId: string) {
    return this.subscriptionStatusService.blockChurch(adminId);
  }

  // POST /subscription-status/unblock/:adminId
  // Unblock entire church - admin only
  @Post('unblock/:adminId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  async unblockChurch(@Param('adminId') adminId: string) {
    return this.subscriptionStatusService.unblockChurch(adminId);
  }

  // GET /subscription-status/all
  // Get all subscriptions - for admin dashboard
  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  async getAllSubscriptions() {
    return this.subscriptionStatusService.getAllSubscriptions();
  }
}
