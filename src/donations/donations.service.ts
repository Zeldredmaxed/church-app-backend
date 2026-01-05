import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDonationDto } from './dto/create-donation.dto';
import Stripe from 'stripe';

@Injectable()
export class DonationsService {
  private stripe: Stripe;

constructor(private readonly prisma: PrismaService) {
    this.stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? '', {
      apiVersion: '2025-12-15.clover' as any, // Changed 18 to 15
    });
  }

  async createPaymentIntent(createDonationDto: CreateDonationDto) {
    const amountInCents = createDonationDto.amount * 100; // Convert $50 -> 5000 cents

    // 1. Tell Stripe we want to collect money
    const paymentIntent = await this.stripe.paymentIntents.create({
      amount: amountInCents,
      currency: process.env.STRIPE_CURRENCY || 'usd',
      metadata: { userId: createDonationDto.userId || 'guest' },
      automatic_payment_methods: { enabled: true },
    });

    // 2. Save a "Pending" record in our database
    await this.prisma.donation.create({
      data: {
        amount: amountInCents,
        currency: 'usd',
        status: 'pending',
        paymentId: paymentIntent.id,
        userId: createDonationDto.userId,
      },
    });

    // 3. Send the "Client Secret" to the frontend so they can pay
    return {
      clientSecret: paymentIntent.client_secret,
    };
  }

  findAll() {
    return this.prisma.donation.findMany({ orderBy: { createdAt: 'desc' } });
  }
}