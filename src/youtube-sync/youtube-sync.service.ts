import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

/**
 * YouTubeSyncService
 *
 * Automatically detects live streams and new video uploads from the church's
 * YouTube channel and syncs them to the Media table in the database.
 *
 * Environment Variables Required:
 *   YOUTUBE_API_KEY     - Google YouTube Data API v3 key (free from Google Cloud Console)
 *   YOUTUBE_CHANNEL_ID  - The church's YouTube channel ID
 *
 * How it works:
 *   1. Every 2 minutes: Checks if the channel is currently live streaming.
 *      - If live → creates a LIVESTREAM media entry + sends push notification.
 *      - If was live but now ended → converts the entry to a SERMON.
 *   2. Every 15 minutes: Checks the YouTube RSS feed for new uploaded videos.
 *      - If a new video is found that isn't already in the DB → creates a SERMON entry.
 */
@Injectable()
export class YouTubeSyncService implements OnModuleInit {
  private readonly logger = new Logger(YouTubeSyncService.name);

  // Track the currently active live stream to detect when it ends
  private currentLiveVideoId: string | null = null;
  private currentLiveMediaId: string | null = null;

  private readonly apiKey = process.env.YOUTUBE_API_KEY || '';
  private readonly channelId = process.env.YOUTUBE_CHANNEL_ID || '';

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit() {
    if (!this.apiKey || !this.channelId) {
      this.logger.warn(
        '⚠️  YOUTUBE_API_KEY or YOUTUBE_CHANNEL_ID not set. YouTube sync is DISABLED.',
      );
    } else {
      this.logger.log(
        `✅ YouTube Sync initialized for channel: ${this.channelId}`,
      );
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CRON JOB 1: Live Stream Detection (every 2 minutes)
  // ─────────────────────────────────────────────────────────────────────────
  @Cron('0 */2 * * * *') // Every 2 minutes
  async checkForLiveStream() {
    if (!this.apiKey || !this.channelId) return;

    try {
      this.logger.debug('🔍 Checking for live stream...');

      // Use YouTube Data API search.list to find active live broadcasts
      const searchUrl =
        `https://www.googleapis.com/youtube/v3/search` +
        `?part=snippet` +
        `&channelId=${this.channelId}` +
        `&eventType=live` +
        `&type=video` +
        `&key=${this.apiKey}`;

      const response = await fetch(searchUrl);
      const data = await response.json();

      if (!response.ok) {
        this.logger.error(`YouTube API error: ${JSON.stringify(data.error?.message)}`);
        return;
      }

      const liveItems = data.items || [];

      if (liveItems.length > 0) {
        // ── Channel IS live ──
        const liveVideo = liveItems[0];
        const videoId = liveVideo.id.videoId;
        const title = liveVideo.snippet.title;
        const channelTitle = liveVideo.snippet.channelTitle;
        const thumbnailUrl =
          liveVideo.snippet.thumbnails?.high?.url ||
          liveVideo.snippet.thumbnails?.default?.url ||
          '';

        if (this.currentLiveVideoId === videoId) {
          this.logger.debug('📡 Still live, no action needed.');
          return;
        }

        this.logger.log(`🔴 LIVE DETECTED: "${title}" (${videoId})`);

        // Check if this video already exists in the database
        const existing = await this.prisma.media.findFirst({
          where: { url: { contains: videoId } },
        });

        if (existing) {
          // Already tracked — just update our local state
          this.currentLiveVideoId = videoId;
          this.currentLiveMediaId = existing.id;

          // Make sure it's marked as LIVESTREAM
          if (existing.type !== 'LIVESTREAM') {
            await this.prisma.media.update({
              where: { id: existing.id },
              data: { type: 'LIVESTREAM' },
            });
          }
          return;
        }

        // Create a new LIVESTREAM media entry
        const media = await this.prisma.media.create({
          data: {
            title: title,
            type: 'LIVESTREAM',
            url: `https://www.youtube.com/watch?v=${videoId}`,
            speaker: channelTitle || 'New Birth Praise and Worship Center',
          },
        });

        this.currentLiveVideoId = videoId;
        this.currentLiveMediaId = media.id;

        // Send push notification to all users
        await this.notifyAllUsers(
          'sermons',
          "🔴 We're Live!",
          `"${title}" is streaming now. Tap to watch.`,
        );
      } else {
        // ── Channel is NOT live ──
        if (this.currentLiveVideoId && this.currentLiveMediaId) {
          this.logger.log(
            `⏹️ Live stream ended: ${this.currentLiveVideoId}. Converting to SERMON.`,
          );

          // Convert the LIVESTREAM entry to a SERMON
          await this.prisma.media.update({
            where: { id: this.currentLiveMediaId },
            data: {
              type: 'SERMON',
              publishedAt: new Date(),
            },
          });

          // Optionally fetch the updated video details (title may have changed)
          await this.updateVideoDetails(
            this.currentLiveMediaId,
            this.currentLiveVideoId,
          );

          // Notify users that the sermon is now available
          await this.notifyAllUsers(
            'sermons',
            '🎬 New Sermon Available',
            'The latest service recording is now available in the app.',
          );

          // Reset tracking
          this.currentLiveVideoId = null;
          this.currentLiveMediaId = null;
        }
      }
    } catch (error) {
      this.logger.error('Live stream check failed:', error);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CRON JOB 2: New Video Detection via RSS (every 15 minutes)
  // ─────────────────────────────────────────────────────────────────────────
  @Cron('0 */15 * * * *') // Every 15 minutes
  async checkForNewVideos() {
    if (!this.channelId) return;

    try {
      this.logger.debug('📺 Checking RSS feed for new videos...');

      // YouTube RSS feed is FREE — no API key needed
      const rssUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${this.channelId}`;
      const response = await fetch(rssUrl);
      const xmlText = await response.text();

      // Parse the XML manually (lightweight, no dependency needed)
      const entries = this.parseRssEntries(xmlText);

      if (entries.length === 0) {
        this.logger.debug('No videos found in RSS feed.');
        return;
      }

      // Check each video against the database
      for (const entry of entries) {
        // Skip if this is the current live stream
        if (entry.videoId === this.currentLiveVideoId) continue;

        // Check if already in database
        const existing = await this.prisma.media.findFirst({
          where: { url: { contains: entry.videoId } },
        });

        if (existing) continue; // Already tracked

        this.logger.log(`📥 New video found: "${entry.title}" (${entry.videoId})`);

        // Create a new SERMON media entry
        await this.prisma.media.create({
          data: {
            title: entry.title,
            type: 'SERMON',
            url: `https://www.youtube.com/watch?v=${entry.videoId}`,
            speaker: entry.author || 'New Birth Praise and Worship Center',
            publishedAt: entry.published ? new Date(entry.published) : new Date(),
          },
        });

        // Notify users about the new sermon
        await this.notifyAllUsers(
          'sermons',
          '🎬 New Sermon Uploaded',
          `"${entry.title}" is now available to watch.`,
        );
      }
    } catch (error) {
      this.logger.error('RSS feed check failed:', error);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // HELPER: Update video details from YouTube API after live stream ends
  // ─────────────────────────────────────────────────────────────────────────
  private async updateVideoDetails(mediaId: string, videoId: string) {
    if (!this.apiKey) return;

    try {
      const url =
        `https://www.googleapis.com/youtube/v3/videos` +
        `?part=snippet` +
        `&id=${videoId}` +
        `&key=${this.apiKey}`;

      const response = await fetch(url);
      const data = await response.json();

      if (data.items && data.items.length > 0) {
        const video = data.items[0].snippet;
        await this.prisma.media.update({
          where: { id: mediaId },
          data: {
            title: video.title || undefined,
            summary: video.description
              ? video.description.substring(0, 500)
              : undefined,
          },
        });
      }
    } catch (error) {
      this.logger.error('Failed to update video details:', error);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // HELPER: Send push notification to ALL users
  // ─────────────────────────────────────────────────────────────────────────
  private async notifyAllUsers(
    type: 'chat' | 'sermons' | 'announcements',
    title: string,
    body: string,
  ) {
    try {
      const users = await this.prisma.user.findMany({
        where: {
          fcmToken: { not: null },
        },
        select: { id: true },
      });

      this.logger.log(`📣 Sending "${title}" notification to ${users.length} users.`);

      // Send notifications in parallel (batched)
      const batchSize = 50;
      for (let i = 0; i < users.length; i += batchSize) {
        const batch = users.slice(i, i + batchSize);
        await Promise.allSettled(
          batch.map((user) =>
            this.notifications.send(user.id, type, title, body),
          ),
        );
      }
    } catch (error) {
      this.logger.error('Failed to send bulk notifications:', error);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // HELPER: Parse YouTube RSS XML without external dependencies
  // ─────────────────────────────────────────────────────────────────────────
  private parseRssEntries(
    xml: string,
  ): Array<{
    videoId: string;
    title: string;
    author: string;
    published: string;
  }> {
    const entries: Array<{
      videoId: string;
      title: string;
      author: string;
      published: string;
    }> = [];

    // Split by <entry> tags
    const entryBlocks = xml.split('<entry>').slice(1); // Skip the first part (before first entry)

    for (const block of entryBlocks) {
      const videoIdMatch = block.match(/<yt:videoId>([^<]+)<\/yt:videoId>/);
      const titleMatch = block.match(/<title>([^<]+)<\/title>/);
      const authorMatch = block.match(/<name>([^<]+)<\/name>/);
      const publishedMatch = block.match(/<published>([^<]+)<\/published>/);

      if (videoIdMatch) {
        entries.push({
          videoId: videoIdMatch[1],
          title: titleMatch ? titleMatch[1] : 'Untitled',
          author: authorMatch ? authorMatch[1] : '',
          published: publishedMatch ? publishedMatch[1] : '',
        });
      }
    }

    return entries;
  }
}
