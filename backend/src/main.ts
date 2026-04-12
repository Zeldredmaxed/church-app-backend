import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import * as fs from 'fs';
import * as path from 'path';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule, {
    // rawBody: true makes the unmodified request body available as req.rawBody.
    // Required for webhook signature verification (Mux, Stripe) where the HMAC
    // must be computed over the exact bytes received, not the parsed JSON.
    rawBody: true,
  });

  // Security headers — HSTS, X-Frame-Options, X-Content-Type-Options, etc.
  app.use(helmet());

  // Global route prefix — all routes accessible at /api/*
  app.setGlobalPrefix('api');

  // CORS — explicit allowlist only. Never reflect arbitrary origins with credentials.
  const allowedOrigins = process.env.CORS_ORIGINS?.split(',').map(o => o.trim()).filter(Boolean);
  app.enableCors({
    origin: allowedOrigins && allowedOrigins.length > 0 ? allowedOrigins : false,
    credentials: !!(allowedOrigins && allowedOrigins.length > 0),
  });

  // Input validation pipe.
  // whitelist: strips unknown properties from request bodies before they reach handlers.
  // forbidNonWhitelisted: throws 400 if unknown properties are present (fail-fast).
  // transform: automatically converts request body to the DTO class instance.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // --- Swagger / OpenAPI (disabled in production) ---
  if (process.env.NODE_ENV !== 'production') {
  const swaggerConfig = new DocumentBuilder()
    .setTitle('ChurchApp Platform API')
    .setDescription(
      'Multi-tenant church management platform & global social network.\n\n' +
      '**Authentication:** All protected endpoints require a Supabase JWT in the `Authorization: Bearer <token>` header.\n\n' +
      '**Tenant Context:** Most endpoints are tenant-scoped via PostgreSQL Row-Level Security. ' +
      'Call `POST /api/auth/switch-tenant` followed by `POST /api/auth/refresh` to set the active tenant in your JWT.\n\n' +
      '**Rate Limits:** Global: 100 req/min per IP. Auth endpoints: 5 req/min per IP. Webhooks: unlimited.',
    )
    .setVersion('1.0.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Supabase JWT access token',
      },
      'bearer',
    )
    .addTag('Auth', 'User registration, login, token refresh, tenant switching')
    .addTag('Tenants', 'Church/tenant CRUD (super admin)')
    .addTag('Users', 'User profile management & GDPR endpoints')
    .addTag('Memberships', 'Tenant membership management & member listing')
    .addTag('Posts', 'Church-internal and global post CRUD')
    .addTag('Comments', 'Post comments (nested under /posts/:postId)')
    .addTag('Notifications', 'In-app notification listing & read marking')
    .addTag('Media', 'S3 pre-signed upload URL generation')
    .addTag('Follows', 'Platform-wide user follow/unfollow & lists')
    .addTag('Chat', 'Real-time chat channels & messaging')
    .addTag('Search', 'Full-text search for posts & members')
    .addTag('Stripe Connect', 'Stripe Connect onboarding & status (admin)')
    .addTag('Giving', 'Donation/giving flow via Stripe PaymentIntents')
    .addTag('Webhooks', 'External webhook receivers (Stripe, Mux) — signature-verified')
    .addTag('Health', 'Liveness & readiness probes for orchestration')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
      docExpansion: 'none',
      tagsSorter: 'alpha',
      operationsSorter: 'method',
    },
  });

  // Write swagger.json to disk for frontend team handoff
    const outputPath = path.resolve(process.cwd(), 'swagger.json');
    fs.writeFileSync(outputPath, JSON.stringify(document, null, 2), 'utf-8');
    logger.log(`OpenAPI spec written to ${outputPath}`);
  } // end Swagger gate

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  logger.log(`Application running on port ${port}`);
  logger.log(`Swagger UI available at http://localhost:${port}/api/docs`);
}

bootstrap();
