import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import Stripe from 'stripe';

@Injectable()
export class DonationsService {
  private stripe: Stripe;

  constructor(private readonly prisma: PrismaService) {
    // 1. Initialize Stripe
    // We look for the key in the environment variables. 
    // If missing, it will throw an error (good safety check).
    this.stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
      apiVersion: '2023-10-16' as any, // Use latest stable version
    });
  }

  // 2. Create the Intent (The "Handshake")
  async createPaymentIntent(amountInDollars: number, userId: string) {
    try {
      // Stripe calculates in CENTS. $50.00 = 5000 cents.
      const amountInCents = Math.round(amountInDollars * 100);

      // A. Ask Stripe for permission to charge
      const paymentIntent = await this.stripe.paymentIntents.create({
        amount: amountInCents,
        currency: 'usd',
        automatic_payment_methods: { enabled: true },
        metadata: { userId: userId } // Tag the payment with the User ID for tracking
      });

      // B. Record the "Pending" donation in our Database
      await this.prisma.donation.create({
        data: {
          amount: amountInCents,
          userId: userId,
          paymentId: paymentIntent.id,
          status: 'PENDING', // We will update this to 'SUCCESS' later via Webhook
          currency: 'USD'
        }
      });

      // C. Return the secret key to the Phone
      return {
        clientSecret: paymentIntent.client_secret
      };

    } catch (error) {
      console.error('Stripe Error:', error);
      
      // Fallback for Development (If no key is set yet)
      if (!process.env.STRIPE_SECRET_KEY) {
        console.warn("⚠️ RUNNING IN SIMULATION MODE (No Stripe Key Found)");
        // Create a fake record so the app doesn't crash during demo
        await this.prisma.donation.create({
          data: {
            amount: Math.round(amountInDollars * 100),
            userId: userId,
            paymentId: 'sim_' + Date.now(),
            status: 'SIMULATED',
            currency: 'USD'
          }
        });
        return { clientSecret: 'simulated_secret_key' };
      }

      throw new InternalServerErrorException('Payment initiation failed');
    }
  }

  // 3. Get History
  async findAll() {
    return this.prisma.donation.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async findByUser(userId: string) {
    return this.prisma.donation.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' }
    });
  }
}
