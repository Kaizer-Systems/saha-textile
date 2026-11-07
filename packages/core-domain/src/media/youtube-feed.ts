import type { YouTubeSettings } from '@saha-textile/contracts';

import type { SiteSettingsRepository } from '../ports/site-settings.repository';
import type { YouTubePort } from '../ports/youtube.port';

/** Fetched and cached every refresh; the rail shows `displayCount` of them (owner lock). */
export const YOUTUBE_FEED_SIZE = 10;

const DEFAULT_SETTINGS: YouTubeSettings = {
	channelHandle: '@SahaTextile',
	channelId: null,
	uploadsPlaylistId: null,
	displayCount: 8,
	railPlacements: ['home'],
};

/**
 * The daily 00:00 IST refresh. Resolves the channel handle to its uploads playlist once (and
 * again only if the handle changes), then stores the 10 latest uploads in `youtube.feed`.
 * A failed fetch leaves yesterday's cache in place: the rail shows slightly old videos rather
 * than none.
 */
export const refreshYouTubeFeed = async (deps: {
	youtube: YouTubePort;
	settings: SiteSettingsRepository;
	now: () => Date;
}): Promise<{ videos: number } | { skipped: 'channel_not_found' }> => {
	const settings = (await deps.settings.get('youtube')) ?? DEFAULT_SETTINGS;
	let { uploadsPlaylistId } = settings;
	if (!uploadsPlaylistId) {
		const channel = await deps.youtube.resolveChannel(settings.channelHandle);
		if (!channel) return { skipped: 'channel_not_found' };
		uploadsPlaylistId = channel.uploadsPlaylistId;
		await deps.settings.set('youtube', { ...settings, channelId: channel.channelId, uploadsPlaylistId });
	}
	const videos = await deps.youtube.listPlaylistVideos({ playlistId: uploadsPlaylistId, limit: YOUTUBE_FEED_SIZE });
	await deps.settings.set('youtube.feed', {
		videos: videos.slice(0, YOUTUBE_FEED_SIZE).map((video) => ({
			videoId: video.videoId,
			title: video.title,
			publishedAt: video.publishedAt,
			thumbnailUrl: video.thumbnailUrl,
		})),
		fetchedAt: deps.now().toISOString(),
	});
	return { videos: videos.length };
};

export { DEFAULT_SETTINGS as DEFAULT_YOUTUBE_SETTINGS };
