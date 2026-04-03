import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { ThrottlerModule } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nestjs/throttler/dist/throttler-storage-redis.service';
import { APP_GUARD } from '@nestjs/core';
import { join } from 'path';
import { AuthModule } from './auth/auth.module';
import { TenantsModule } from './tenants/tenants.module';
import { UsersModule } from './users/users.module';
import { MembershipsModule } from './memberships/memberships.module';
import { PostsModule } from './posts/posts.module';
import { InvitationsModule } from './invitations/invitations.module';
import { CommentsModule } from './comments/comments.module';
import { NotificationsModule } from './notifications/notifications.module';
import { MediaModule } from './media/media.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { FollowsModule } from './follows/follows.module';
import { FeedModule } from './feed/feed.module';
import { ChatModule } from './chat/chat.module';
import { SearchModule } from './search/search.module';
import { StripeModule } from './stripe/stripe.module';
import { GivingModule } from './giving/giving.module';
import { HealthModule } from './health/health.module';
import { CustomThrottlerGuard } from './common/guards/custom-throttler.guard';
import { Transaction } from './giving/entities/transaction.entity';
import { Follow } from './follows/entities/follow.entity';
import { ChatChannel } from './chat/entities/chat-channel.entity';
import { ChannelMember } from './chat/entities/channel-member.entity';
import { ChatMessage } from './chat/entities/chat-message.entity';
import { Tenant } from './tenants/entities/tenant.entity';
import { User } from './users/entities/user.entity';
import { TenantMembership } from './memberships/entities/tenant-membership.entity';
import { Post } from './posts/entities/post.entity';
import { Invitation } from './invitations/entities/invitation.entity';
import { Comment } from './comments/entities/comment.entity';
import { Notification } from './notifications/entities/notification.entity';

@Module({
  imports: [
    // ConfigModule must be first — other modules depend on ConfigService
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),

    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        url: config.getOrThrow<string>('DATABASE_URL'),
        entities: [Tenant, User, TenantMembership, Post, Invitation, Comment, Notification, Follow, ChatChannel, ChannelMember, ChatMessage, Transaction],

        // CRITICAL: synchronize must ALWAYS be false.
        // Schema changes are managed exclusively by migration scripts.
        // Setting this to true would let TypeORM overwrite or drop columns.
        synchronize: false,

        ssl: config.get('NODE_ENV') === 'production'
          ? { rejectUnauthorized: true }
          : { rejectUnauthorized: false },

        // Connection pool configuration.
        // Keep extra connections low — Supabase free/pro plans have connection limits.
        // Use PgBouncer in Phase 2 (100k users) to multiplex connections.
        extra: {
          max: 10,
          idleTimeoutMillis: 30000,
        },
      }),
    }),

    // BullMQ — Redis-backed job queue for async notification processing.
    // All modules that enqueue jobs register their own queues via BullModule.registerQueue().
    // This forRootAsync provides the shared Redis connection config.
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.getOrThrow<string>('REDIS_HOST'),
          port: config.get<number>('REDIS_PORT', 6379),
          password: config.get<string>('REDIS_PASSWORD'),
        },
      }),
    }),

    // Rate Limiting — Redis-backed, per-IP + per-tenant throttling.
    // Two named throttlers:
    //   - 'default': 100 requests/minute per IP (all endpoints)
    //   - 'auth':    5 requests/minute per IP (auth endpoints only, via @Throttle decorator)
    // Redis storage ensures rate-limit state is shared across all backend instances.
    // Webhook endpoints are excluded via @SkipThrottle() decorator.
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [
          {
            name: 'default',
            ttl: 60000,
            limit: 100,
          },
          {
            name: 'auth',
            ttl: 60000,
            limit: 5,
          },
        ],
        storage: new ThrottlerStorageRedisService({
          host: config.getOrThrow<string>('REDIS_HOST'),
          port: config.get<number>('REDIS_PORT', 6379),
          password: config.get<string>('REDIS_PASSWORD'),
        }),
      }),
    }),

    // GraphQL — Apollo Driver (code-first)
    // The schema is auto-generated from TypeScript decorators (@ObjectType, @Resolver, etc.)
    // Playground is enabled in non-production for debugging.
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      autoSchemaFile: join(process.cwd(), 'src/schema.gql'),
      sortSchema: true,
      playground: process.env.NODE_ENV !== 'production',
      context: ({ req }) => ({ req }),
    }),

    AuthModule,
    TenantsModule,
    UsersModule,
    MembershipsModule,
    PostsModule,
    InvitationsModule,
    CommentsModule,
    NotificationsModule,
    MediaModule,
    WebhooksModule,
    FollowsModule,
    FeedModule,
    ChatModule,
    SearchModule,
    StripeModule,
    GivingModule,
    HealthModule,

    // GraphQL — Apollo Driver (code-first approach)
    // The FeedModule provides the FeedResolver which registers the globalFeed query.
    // GraphQL playground available at /graphql in development.
  ],
  providers: [
    // Global rate-limit guard — applies the 'default' throttler to ALL endpoints.
    // Individual controllers/routes can override via @Throttle() or exclude via @SkipThrottle().
    {
      provide: APP_GUARD,
      useClass: CustomThrottlerGuard,
    },
  ],
})
export class AppModule {}
