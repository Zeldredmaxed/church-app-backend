import {
  Controller,
  Post,
  Delete,
  Get,
  Param,
  Query,
  ParseUUIDPipe,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { FollowsService } from './follows.service';
import { PaginationDto } from './dto/pagination.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SupabaseJwtPayload } from '../common/types/jwt-payload.type';

@ApiTags('Follows')
@ApiBearerAuth()
@Controller('users')
@UseGuards(JwtAuthGuard)
export class FollowsController {
  constructor(private readonly followsService: FollowsService) {}

  @Post(':id/follow')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Follow a user (platform-wide, not tenant-scoped)' })
  @ApiResponse({ status: 201, description: 'Now following the user' })
  @ApiResponse({ status: 409, description: 'Already following this user' })
  follow(
    @Param('id', ParseUUIDPipe) followingId: string,
    @CurrentUser() user: SupabaseJwtPayload,
  ) {
    return this.followsService.follow(user.sub, followingId);
  }

  @Delete(':id/follow')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Unfollow a user' })
  @ApiResponse({ status: 200, description: 'Unfollowed successfully' })
  unfollow(
    @Param('id', ParseUUIDPipe) followingId: string,
    @CurrentUser() user: SupabaseJwtPayload,
  ) {
    return this.followsService.unfollow(user.sub, followingId);
  }

  @Get(':id/followers')
  @ApiOperation({ summary: 'List users who follow the specified user' })
  @ApiResponse({ status: 200, description: 'Paginated follower list' })
  getFollowers(
    @Param('id', ParseUUIDPipe) userId: string,
    @Query() query: PaginationDto,
  ) {
    return this.followsService.getFollowers(userId, query.limit, query.offset);
  }

  @Get(':id/following')
  @ApiOperation({ summary: 'List users the specified user is following' })
  @ApiResponse({ status: 200, description: 'Paginated following list' })
  getFollowing(
    @Param('id', ParseUUIDPipe) userId: string,
    @Query() query: PaginationDto,
  ) {
    return this.followsService.getFollowing(userId, query.limit, query.offset);
  }
}
