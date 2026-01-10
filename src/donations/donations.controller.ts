import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { DonationsService } from './donations.service';
import { CreateDonationDto } from './dto/create-donation.dto';

@Controller('donations')
export class DonationsController {
  constructor(private readonly donationsService: DonationsService) {}

  @Post()
  create(@Body() createDonationDto: CreateDonationDto) {
    // Extract amount and userId from DTO
    const amountInDollars = createDonationDto.amount || 0;
    const userId = createDonationDto.userId || 'guest';
    return this.donationsService.createPaymentIntent(amountInDollars, userId);
  }

  @Get()
  findAll(@Query('userId') userId?: string) {
    if (userId) {
      return this.donationsService.findByUser(userId);
    }
    return this.donationsService.findAll();
  }
}