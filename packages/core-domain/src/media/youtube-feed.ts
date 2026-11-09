import type { YouTubeSettings, YouTubeVideoSummary } from '@saha-textile/contracts';

import type { SiteSettingsRepository } from '../ports/site-settings.repository';
import type { YouTubePort, YouTubeVideo } from '../ports/youtube.port';

/** Videos and Shorts kept, newest first (owner, 2026-11-10); the `youtube.feed` schema caps the same. */
export const YOUTUBE_FEED_VIDEOS = 24;
export const YOUTUBE_FEED_SHORTS = 12;

/** Uploads read per refresh: one `playlistItems.list` page, enough to find 24 videos and 12 Shorts. */
export const YOUTUBE_UPLOADS_READ = 50;

const DEFAULT_SETTINGS: YouTubeSettings = {
	channelHandle: '@SahaTextile',
	channelId: null,
	uploadsPlaylistId: null,
	displayCount: 8,
	railPlacements: ['home'],
};

const summary = (video: YouTubeVideo): YouTubeVideoSummary => ({
	videoId: video.videoId,
	title: video.title,
	publishedAt: video.publishedAt,
	thumbnailUrl: video.thumbnailUrl,
	posterUrl: null,
	kind: video.kind,
	durationSeconds: video.durationSeconds,
});

/**
 * The daily 00:00 IST refresh. Resolves the channel handle to its uploads playlist once (and
 * again only if the handle changes), reads the latest uploads and their details, and stores the
 * 24 newest videos and 12 newest Shorts in `youtube.feed`. Private and non-embeddable uploads are
 * left out. A failed fetch leaves yesterday's cache in place: pages show slightly old videos
 * rather than none.
 */
export const refreshYouTubeFeed = async (deps: {
	youtube: YouTubePort;
	settings: SiteSettingsRepository;
	now: () => Date;
}): Promise<{ videos: number; shorts: number } | { skipped: 'channel_not_found' }> => {
	const settings = (await deps.settings.get('youtube')) ?? DEFAULT_SETTINGS;
	let { uploadsPlaylistId } = settings;
	if (!uploadsPlaylistId) {
		const channel = await deps.youtube.resolveChannel(settings.channelHandle);
		if (!channel) return { skipped: 'channel_not_found' };
		uploadsPlaylistId = channel.uploadsPlaylistId;
		await deps.settings.set('youtube', { ...settings, channelId: channel.channelId, uploadsPlaylistId });
	}
	const uploads = await deps.youtube.listPlaylistVideos({
		playlistId: uploadsPlaylistId,
		limit: YOUTUBE_UPLOADS_READ,
	});
	const described = await deps.youtube.describeVideos(uploads.map((upload) => upload.videoId));
	// Newest first, whatever order the API answered in.
	const newest = [...described].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
	const videos = newest.filter((video) => video.kind === 'video').slice(0, YOUTUBE_FEED_VIDEOS);
	const shorts = newest.filter((video) => video.kind === 'short').slice(0, YOUTUBE_FEED_SHORTS);
	await deps.settings.set('youtube.feed', {
		videos: videos.map(summary),
		shorts: shorts.map(summary),
		fetchedAt: deps.now().toISOString(),
	});
	return { videos: videos.length, shorts: shorts.length };
};

export { DEFAULT_SETTINGS as DEFAULT_YOUTUBE_SETTINGS };
