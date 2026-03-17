import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SubscriptionStatusService {
  constructor(private prisma: PrismaService) {}

  // Check if a church/user has active subscription
  async checkStatus(userId: string): Promise<{
    isActive: boolean;
    isBlocked: boolean;
    message?: string;
    plan?: string;
    expiresAt?: Date;
  }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        subscriptionStatus: true,
        subscriptionPlan: true,
        subscriptionExpiresAt: true,
        subscriptionCanceled: true,
      },
    });

    if (!user) {
      return { isActive: false, isBlocked: true, message: 'User not found' };
    }

    // Check if explicitly blocked by admin
    if (user.subscriptionStatus === 'BLOCKED') {
      return {
        isActive: false,
        isBlocked: true,
        message: 'Currently down for maintenance. Please contact administrator.',
        plan: user.subscriptionPlan || undefined,
      };
    }

    // Check if subscription expired
    if (user.subscriptionExpiresAt && new Date(user.subscriptionExpiresAt) < new Date()) {
      return {
        isActive: false,
        isBlocked: true,
        message: 'Currently down for maintenance. Please contact administrator.',
        plan: user.subscriptionPlan || undefined,
        expiresAt: user.subscriptionExpiresAt,
      };
    }

    // Check if canceled
    if (user.subscriptionCanceled) {
      return {
        isActive: false,
        isBlocked: true,
        message: 'Currently down for maintenance. Please contact administrator.',
        plan: user.subscriptionPlan || undefined,
      };
    }

    // Active
    if (user.subscriptionStatus === 'ACTIVE') {
      return {
        isActive: true,
        isBlocked: false,
        plan: user.subscriptionPlan || undefined,
        expiresAt: user.subscriptionExpiresAt || undefined,
      };
    }

    // Default - no subscription found, allow access for now (grace period)
    return {
      isActive: true,
      isBlocked: false,
    };
  }

  // Update subscription status (admin only)
  async updateStatus(
    userId: string, 
    status: 'ACTIVE' | 'INACTIVE' | 'BLOCKED' | 'PAST_DUE',
    plan?: string,
    expiresAt?: Date
  ) {
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        subscriptionStatus: status,
        subscriptionPlan: plan,
        subscriptionExpiresAt: expiresAt,
        subscriptionCanceled: status === 'INACTIVE',
      },
    });
  }

  // Block all users in a church (by adminId)
  async blockChurch(churchAdminId: string) {
    // Find all users in the same church/organization
    const admin = await this.prisma.user.findUnique({
      where: { id: churchAdminId },
    });

    if (!admin || admin.role !== 'ADMIN') {
      throw new Error('Only admins can block their church');
    }

    // For now, block just the admin - the app can check this status
    return this.prisma.user.update({
      where: { id: churchAdminId },
      data: { subscriptionStatus: 'BLOCKED' },
    });
  }

  // Unblock church
  async unblockChurch(churchAdminId: string) {
    return this.prisma.user.update({
      where: { id: churchAdminId },
      data: { 
        subscriptionStatus: 'ACTIVE',
        subscriptionCanceled: false,
      },
    });
  }

  // Get all subscriptions (admin view)
  async getAllSubscriptions() {
    return this.prisma.user.findMany({
      where: {
        role: 'ADMIN',
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        subscriptionStatus: true,
        subscriptionPlan: true,
        subscriptionExpiresAt: true,
        subscriptionCanceled: true,
      },
    });
  }
}
