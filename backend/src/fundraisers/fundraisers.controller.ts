import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
  UseGuards,
  UseInterceptors,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { FundraisersService } from './fundraisers.service';
import { CreateFundraiserDto } from './dto/create-fundraiser.dto';
import { UpdateFundraiserDto } from './dto/update-fundraiser.dto';
import { CreateDonationDto } from './dto/create-donation.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SupabaseJwtPayload } from '../common/types/jwt-payload.type';

@ApiTags('Fundraisers')
@ApiBearerAuth()
@Controller('fundraisers')
@UseGuards(JwtAuthGuard)
@UseInterceptors(RlsContextInterceptor)
export class FundraisersController {
  constructor(private readonly fundraisersService: FundraisersService) {}

  @Get()
  @ApiOperation({ summary: 'List fundraisers with optional filters' })
  @ApiResponse({ status: 200, description: 'Paginated fundraiser list' })
  listFundraisers(
    @CurrentUser() user: SupabaseJwtPayload,
    @Query('category') category?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.fundraisersService.listFundraisers(
      user.sub,
      category,
      status,
      search,
      parseInt(page ?? '1', 10) || 1,
      Math.min(parseInt(limit ?? '20', 10) || 20, 100),
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get fundraiser detail with recent backers' })
  @ApiResponse({ status: 200, description: 'Fundraiser detail' })
  @ApiResponse({ status: 404, description: 'Fundraiser not found' })
  getFundraiser(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: SupabaseJwtPayload,
  ) {
    return this.fundraisersService.getFundraiser(id, user.sub);
  }

  @Get(':id/backers')
  @ApiOperation({ summary: 'List fundraiser backers (paginated)' })
  @ApiResponse({ status: 200, description: 'Paginated backer list' })
  getBackers(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.fundraisersService.getBackers(
      id,
      parseInt(page ?? '1', 10) || 1,
      Math.min(parseInt(limit ?? '50', 10) || 50, 100),
    );
  }

  @Post(':id/donate')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Donate to a fundraiser (creates Stripe PaymentIntent)' })
  @ApiResponse({ status: 201, description: '{ donationId, clientSecret, status }' })
  @ApiResponse({ status: 400, description: 'Fundraiser inactive/expired or payment not set up' })
  createDonation(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateDonationDto,
    @CurrentUser() user: SupabaseJwtPayload,
  ) {
    return this.fundraisersService.createDonation(id, dto, user.sub);
  }

  @Post(':id/bookmark')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Toggle bookmark on a fundraiser' })
  @ApiResponse({ status: 200, description: '{ bookmarked: true/false }' })
  toggleBookmark(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: SupabaseJwtPayload,
  ) {
    return this.fundraisersService.toggleBookmark(id, user.sub);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a fundraiser (admin only, premium+ tier)' })
  @ApiResponse({ status: 201, description: 'Fundraiser created' })
  @ApiResponse({ status: 403, description: 'Requires Premium or Enterprise plan' })
  createFundraiser(
    @Body() dto: CreateFundraiserDto,
    @CurrentUser() user: SupabaseJwtPayload,
  ) {
    return this.fundraisersService.createFundraiser(dto, user.sub);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a fundraiser (admin only)' })
  @ApiResponse({ status: 200, description: 'Updated fundraiser' })
  @ApiResponse({ status: 404, description: 'Fundraiser not found' })
  updateFundraiser(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFundraiserDto,
  ) {
    return this.fundraisersService.updateFundraiser(id, dto);
  }
}
