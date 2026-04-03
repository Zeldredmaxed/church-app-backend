import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { SupabaseJwtPayload } from '../types/jwt-payload.type';

/**
 * Extracts the authenticated user's decoded JWT payload from the request.
 * Only usable on routes protected by JwtAuthGuard.
 *
 * Usage:
 *   @Get('profile')
 *   @UseGuards(JwtAuthGuard)
 *   getProfile(@CurrentUser() user: SupabaseJwtPayload) { ... }
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): SupabaseJwtPayload => {
    const request = ctx.switchToHttp().getRequest();
    return request.user as SupabaseJwtPayload;
  },
);
