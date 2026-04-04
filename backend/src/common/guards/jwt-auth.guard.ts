import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';
import { JwksClient } from 'jwks-rsa';
import { SupabaseJwtPayload } from '../types/jwt-payload.type';

/**
 * Verifies the Supabase-issued JWT in the Authorization header and attaches
 * the decoded payload to request.user.
 *
 * Supports both:
 *   - ES256 (asymmetric) — newer Supabase projects use ECDSA signing.
 *     The public key is fetched from the Supabase JWKS endpoint and cached.
 *   - HS256 (symmetric) — legacy Supabase projects use HMAC with JWT Secret.
 *
 * Apply this guard to any route that requires authentication:
 *   @UseGuards(JwtAuthGuard)
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(JwtAuthGuard.name);
  private readonly jwksClient: JwksClient | null;
  private readonly jwtSecret: string;

  constructor(private readonly config: ConfigService) {
    this.jwtSecret = this.config.getOrThrow<string>('SUPABASE_JWT_SECRET');
    const supabaseUrl = this.config.get<string>('SUPABASE_URL');
    if (supabaseUrl) {
      this.jwksClient = new JwksClient({
        jwksUri: `${supabaseUrl}/auth/v1/.well-known/jwks.json`,
        cache: true,
        cacheMaxAge: 600000, // 10 minutes
        rateLimit: true,
      });
    } else {
      this.jwksClient = null;
    }
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const token = this.extractBearerToken(request);

    if (!token) {
      throw new UnauthorizedException('Missing or malformed Authorization header');
    }

    try {
      const header = jwt.decode(token, { complete: true })?.header;
      let payload: SupabaseJwtPayload;

      if (header?.alg === 'ES256' && header.kid && this.jwksClient) {
        // Asymmetric verification via JWKS public key
        const signingKey = await this.jwksClient.getSigningKey(header.kid);
        const publicKey = signingKey.getPublicKey();
        payload = jwt.verify(token, publicKey, {
          algorithms: ['ES256'],
        }) as SupabaseJwtPayload;
      } else {
        // Symmetric verification via JWT secret (HS256 fallback)
        payload = jwt.verify(token, this.jwtSecret, {
          algorithms: ['HS256'],
        }) as SupabaseJwtPayload;
      }

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
