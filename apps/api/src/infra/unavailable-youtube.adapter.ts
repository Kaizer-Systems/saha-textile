import { ServiceUnavailableException } from '@nestjs/common';
import type { YouTubePort, YouTubeVideo } from '@saha-textile/core-domain';

/**
 * Bound when `YOUTUBE_API_KEY` is unset. Validate answers "unavailable" rather than
 * pretending a video exists, and the daily refresh is skipped by the worker — the rail keeps
 * whatever it last cached. Same honesty rule as the unconfigured storage adapter.
 */
export class UnavailableYouTubeAdapter implements YouTubePort {
	private static readonly MESSAGE = 'YouTube lookups are not configured. Set YOUTUBE_API_KEY to enable them.';

	resolveChannel(): Promise<{ channelId: string; uploadsPlaylistId: string } | null> {
		return Promise.reject(new ServiceUnavailableException(UnavailableYouTubeAdapter.MESSAGE));
	}

	listPlaylistVideos(): Promise<YouTubeVideo[]> {
		return Promise.reject(new ServiceUnavailableException(UnavailableYouTubeAdapter.MESSAGE));
	}

	findVideo(): Promise<YouTubeVideo | null> {
		return Promise.reject(new ServiceUnavailableException(UnavailableYouTubeAdapter.MESSAGE));
	}
}
