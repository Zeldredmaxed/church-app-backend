import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';
import { SupabaseJwtPayload } from '../types/jwt-payload.type';

/**
 * Verifies the Supabase-issued JWT in the Authorization header and attaches
 * the decoded payload to request.user.
 *
 * Supabase signs JWTs with HS256 using the project's JWT Secret, which is
 * available at: Supabase Dashboard > Settings > API > JWT Secret.
 * Set it as SUPABASE_JWT_SECRET in .env.
 *
 * Apply this guard to any route that requires authentication:
 *   @UseGuards(JwtAuthGuard)
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const token = this.extractBearerToken(request);

    if (!token) {
      throw new UnauthorizedException('Missing or malformed Authorization header');
    }

    try {
      const payload = jwt.verify(
        token,
        this.config.getOrThrow<string>('SUPABASE_JWT_SECRET'),
        { algorithms: ['HS256'] },
      ) as SupabaseJwtPayload;

      // Attach decoded payload — available via @CurrentUser() in controllers
      request.user = payload;
      return true;
    } catch (err) {
      if (err instanceof jwt.TokenExpiredError) {
        throw new UnauthorizedException('Token expired — call POST /api/auth/refresh');
      }
      throw new UnauthorizedException('Invalid token');
    }
  }

  private extractBearerToken(request: Record<string, any>): string | null {
    const authHeader: string | undefined = request.headers?.['authorization'];
    if (!authHeader?.startsWith('Bearer ')) return null;
    return authHeader.substring(7);
  }
}
