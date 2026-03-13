import { Controller, Get, Post } from '@nestjs/common';
import { YouTubeSyncService } from './youtube-sync.service';

/**
 * YouTubeSyncController
 *
 * Provides manual trigger endpoints for admins to force a sync check,
 * and a status endpoint to see the current sync state.
 */
@Controller('youtube-sync')
export class YouTubeSyncController {
  constructor(private readonly youtubeSyncService: YouTubeSyncService) {}

  /**
   * GET /youtube-sync/status
   * Returns the current sync status (is a live stream active, etc.)
   */
  @Get('status')
  getStatus() {
    return {
      configured:
        !!process.env.YOUTUBE_API_KEY && !!process.env.YOUTUBE_CHANNEL_ID,
      channelId: process.env.YOUTUBE_CHANNEL_ID || null,
      currentlyLive: !!this.youtubeSyncService['currentLiveVideoId'],
      liveVideoId: this.youtubeSyncService['currentLiveVideoId'] || null,
    };
  }

  /**
   * POST /youtube-sync/check-live
   * Manually triggers a live stream check (useful for testing)
   */
  @Post('check-live')
  async triggerLiveCheck() {
    await this.youtubeSyncService.checkForLiveStream();
    return { message: 'Live stream check completed.' };
  }

  /**
   * POST /youtube-sync/check-videos
   * Manually triggers a new video check (useful for testing)
   */
  @Post('check-videos')
  async triggerVideoCheck() {
    await this.youtubeSyncService.checkForNewVideos();
    return { message: 'New video check completed.' };
  }
}
