import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { ThrottlerModule } from '@nestjs/throttler';
import { RedisThrottlerStorage } from './common/storage/redis-throttler.storage';
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
import { SupabaseAdminModule } from './common/services/supabase-admin.service';
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
import { RegistrationKey } from './tenants/entities/registration-key.entity';
import { Role } from './tenants/entities/role.entity';
import { PrayersModule } from './prayers/prayers.module';
import { Prayer } from './prayers/entities/prayer.entity';
import { PrayerPray } from './prayers/entities/prayer-pray.entity';
import { EventsModule } from './events/events.module';
import { Event } from './events/entities/event.entity';
import { EventRsvp } from './events/entities/event-rsvp.entity';
import { GroupsModule } from './groups/groups.module';
import { Group } from './groups/entities/group.entity';
import { GroupMember } from './groups/entities/group-member.entity';
import { GroupMessage } from './groups/entities/group-message.entity';
import { AnnouncementsModule } from './announcements/announcements.module';
import { Announcement } from './announcements/entities/announcement.entity';
import { SermonsModule } from './sermons/sermons.module';
import { Sermon } from './sermons/entities/sermon.entity';
import { SermonLike } from './sermons/entities/sermon-like.entity';
import { VolunteerModule } from './volunteer/volunteer.module';
import { Opportunity } from './volunteer/entities/opportunity.entity';
import { VolunteerSignup } from './volunteer/entities/volunteer-signup.entity';
import { VolunteerHours } from './volunteer/entities/volunteer-hours.entity';
import { GivingFund } from './giving/entities/giving-fund.entity';
import { CheckinModule } from './checkin/checkin.module';
import { ServiceSchedule } from './checkin/entities/service-schedule.entity';
import { CheckIn } from './checkin/entities/check-in.entity';
import { GalleryModule } from './gallery/gallery.module';
import { GalleryPhoto } from './gallery/entities/gallery-photo.entity';
import { ModerationModule } from './moderation/moderation.module';
import { PostReport } from './moderation/entities/post-report.entity';
import { RecurringGivingModule } from './recurring-giving/recurring-giving.module';
import { RecurringGift } from './recurring-giving/entities/recurring-gift.entity';
import { TagsModule } from './tags/tags.module';
import { Tag } from './tags/entities/tag.entity';
import { MemberTag } from './tags/entities/member-tag.entity';
import { StoriesModule } from './stories/stories.module';
import { Story } from './stories/entities/story.entity';
import { StoryView } from './stories/entities/story-view.entity';
import { DashboardModule } from './dashboard/dashboard.module';
import { FacilitiesModule } from './facilities/facilities.module';
import { Room } from './facilities/entities/room.entity';
import { RoomBooking } from './facilities/entities/room-booking.entity';
import { TasksModule } from './tasks/tasks.module';
import { Task } from './tasks/entities/task.entity';
import { CareCasesModule } from './care-cases/care-cases.module';
import { CareCase } from './care-cases/entities/care-case.entity';
import { CareNote } from './care-cases/entities/care-note.entity';
import { UserSettings } from './users/entities/user-settings.entity';
import { LoginStreak } from './users/entities/login-streak.entity';
import { CommunicationsModule } from './communications/communications.module';
import { AudienceSegment } from './communications/entities/audience-segment.entity';
import { MessageTemplate } from './communications/entities/message-template.entity';
import { SentMessage } from './communications/entities/sent-message.entity';
import { ReportsModule } from './reports/reports.module';
import { AssistantModule } from './assistant/assistant.module';
import { MemberProfilesModule } from './member-profiles/member-profiles.module';
import { MemberJourney } from './member-profiles/entities/member-journey.entity';
import { MemberNote } from './member-profiles/entities/member-note.entity';
import { WorkflowsModule } from './workflows/workflows.module';
import { Workflow } from './workflows/entities/workflow.entity';
import { WorkflowNode } from './workflows/entities/workflow-node.entity';
import { WorkflowConnection } from './workflows/entities/workflow-connection.entity';
import { WorkflowExecution } from './workflows/entities/workflow-execution.entity';
import { WorkflowExecutionLog } from './workflows/entities/workflow-execution-log.entity';
import { BadgesModule } from './badges/badges.module';
import { Badge } from './badges/entities/badge.entity';
import { MemberBadge } from './badges/entities/member-badge.entity';
import { MarketplaceModule } from './workflow-marketplace/marketplace.module';
import { WorkflowTemplate } from './workflow-marketplace/entities/workflow-template.entity';
import { TemplateInstall } from './workflow-marketplace/entities/template-install.entity';
import { TemplateRating } from './workflow-marketplace/entities/template-rating.entity';
import { LeaderboardModule } from './leaderboard/leaderboard.module';
import { LeaderboardSettings } from './leaderboard/entities/leaderboard-settings.entity';
import { CheckinConfig } from './leaderboard/entities/checkin-config.entity';
import { DailyAppOpen } from './leaderboard/entities/daily-app-open.entity';
import { OnboardingModule } from './onboarding/onboarding.module';
import { OnboardingForm } from './onboarding/entities/onboarding-form.entity';
import { OnboardingResponse } from './onboarding/entities/onboarding-response.entity';
import { FeedbackModule } from './feedback/feedback.module';
import { Feedback } from './feedback/entities/feedback.entity';
import { FamilyModule } from './family/family.module';
import { FamilyConnection } from './family/entities/family-relationship.entity';
import { StorageModule } from './storage/storage.module';
import { TenantStorageUsage } from './storage/entities/tenant-storage-usage.entity';
import { StorageFile } from './storage/entities/storage-file.entity';

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
        entities: [
          Tenant, User, TenantMembership, Post, Invitation, Comment, Notification,
          Follow, ChatChannel, ChannelMember, ChatMessage, Transaction, RegistrationKey, Role,
          Prayer, PrayerPray, Event, EventRsvp,
          Group, GroupMember, GroupMessage, Announcement, Sermon, SermonLike,
          Opportunity, VolunteerSignup, ServiceSchedule, CheckIn,
          GalleryPhoto, PostReport, RecurringGift, Tag, MemberTag,
          Story, StoryView,
          UserSettings, LoginStreak,
          GivingFund, VolunteerHours,
          Room, RoomBooking,
          Task, CareCase, CareNote,
          AudienceSegment, MessageTemplate, SentMessage,
          MemberJourney, MemberNote,
          Workflow, WorkflowNode, WorkflowConnection, WorkflowExecution, WorkflowExecutionLog,
          Badge, MemberBadge,
          WorkflowTemplate, TemplateInstall, TemplateRating,
          LeaderboardSettings, CheckinConfig, DailyAppOpen,
          OnboardingForm, OnboardingResponse,
          Feedback,
          FamilyConnection,
          TenantStorageUsage,
          StorageFile,
        ],

        // CRITICAL: synchronize must ALWAYS be false.
        // Schema changes are managed exclusively by migration scripts.
        // Setting this to true would let TypeORM overwrite or drop columns.
        synchronize: false,

        // Supabase Postgres uses a self-signed certificate chain.
        // rejectUnauthorized must be false for Supabase connections.
        ssl: { rejectUnauthorized: false },

        // Retry quickly on startup to avoid Render port scan timeout.
        retryAttempts: 3,
        retryDelay: 2000,

        // Connection pool configuration.
        // Keep extra connections low — Supabase free/pro plans have connection limits.
        // Use PgBouncer in Phase 2 (100k users) to multiplex connections.
        extra: {
          max: 10,
          idleTimeoutMillis: 30000,
          connectionTimeoutMillis: 10000,
        },
      }),
    }),

    // BullMQ — Redis-backed job queue for async notification processing.
    // Gracefully uses localhost if REDIS_HOST is not configured.
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get<string>('REDIS_HOST', 'localhost'),
          port: config.get<number>('REDIS_PORT', 6379),
          password: config.get<string>('REDIS_PASSWORD'),
          maxRetriesPerRequest: 3,
          tls: config.get<string>('REDIS_HOST', '').includes('upstash.io') ? {} : undefined,
        },
      }),
    }),

    // Rate Limiting — Redis-backed when REDIS_HOST is set, in-memory otherwise.
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const redisHost = config.get<string>('REDIS_HOST');
        const hasRedis = redisHost && !redisHost.includes('placeholder');
        return {
          throttlers: [
            { name: 'default', ttl: 60000, limit: 100 },
            { name: 'auth', ttl: 60000, limit: 5 },
          ],
          ...(hasRedis
            ? {
                storage: new RedisThrottlerStorage(
                  redisHost,
                  config.get<number>('REDIS_PORT', 6379),
                  config.get<string>('REDIS_PASSWORD'),
                ),
              }
            : {}),
        };
      },
    }),

    // GraphQL — Apollo Driver (code-first)
    // The schema is auto-generated from TypeScript decorators (@ObjectType, @Resolver, etc.)
    // Playground is enabled in non-production for debugging.
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      autoSchemaFile: join(process.cwd(), 'src/schema.gql'),
      sortSchema: true,
      playground: process.env.NODE_ENV !== 'production',
      context: ({ req }: { req: any }) => ({ req }),
    }),

    SupabaseAdminModule,
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
    PrayersModule,
    EventsModule,
    GroupsModule,
    AnnouncementsModule,
    SermonsModule,
    VolunteerModule,
    CheckinModule,
    GalleryModule,
    ModerationModule,
    RecurringGivingModule,
    TagsModule,
    StoriesModule,
    DashboardModule,
    FacilitiesModule,
    TasksModule,
    CareCasesModule,
    CommunicationsModule,
    ReportsModule,
    AssistantModule,
    MemberProfilesModule,
    WorkflowsModule,
    BadgesModule,
    MarketplaceModule,
    LeaderboardModule,
    OnboardingModule,
    FeedbackModule,
    FamilyModule,
    StorageModule,

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
