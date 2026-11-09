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

/** A video already in the cache keeps its CDN poster until the poster step replaces it. */
const summary = (video: YouTubeVideo, before: ReadonlyMap<string, YouTubeVideoSummary>): YouTubeVideoSummary => ({
	videoId: video.videoId,
	title: video.title,
	publishedAt: video.publishedAt,
	thumbnailUrl: video.thumbnailUrl,
	posterUrl: before.get(video.videoId)?.posterUrl ?? null,
	posterKey: before.get(video.videoId)?.posterKey ?? null,
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
	const attemptAt = deps.now().toISOString();
	const previous = await deps.settings.get('youtube.feed');
	const keep = {
		videos: previous?.videos ?? [],
		shorts: previous?.shorts ?? [],
		fetchedAt: previous?.fetchedAt ?? null,
		retiredPosters: previous?.retiredPosters ?? [],
	};
	try {
		const settings = (await deps.settings.get('youtube')) ?? DEFAULT_SETTINGS;
		let { uploadsPlaylistId } = settings;
		if (!uploadsPlaylistId) {
			const channel = await deps.youtube.resolveChannel(settings.channelHandle);
			if (!channel) {
				await deps.settings.set('youtube.feed', {
					...keep,
					lastAttemptAt: attemptAt,
					lastError: `No YouTube channel has the handle ${settings.channelHandle}.`,
				});
				return { skipped: 'channel_not_found' };
			}
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
		const before = new Map([...keep.videos, ...keep.shorts].map((row) => [row.videoId, row] as const));
		const staying = new Set([...videos, ...shorts].map((video) => video.videoId));
		const leaving = [...before.values()].flatMap((row) =>
			!staying.has(row.videoId) && row.posterKey && row.posterUrl
				? [{ key: row.posterKey, url: row.posterUrl }]
				: [],
		);
		await deps.settings.set('youtube.feed', {
			videos: videos.map((video) => summary(video, before)),
			shorts: shorts.map((video) => summary(video, before)),
			fetchedAt: attemptAt,
			lastAttemptAt: attemptAt,
			lastError: null,
			retiredPosters: [...keep.retiredPosters, ...leaving],
		});
		return { videos: videos.length, shorts: shorts.length };
	} catch (error) {
		// Yesterday's videos stay; admin sees why today's refresh failed. The job retries.
		const message = error instanceof Error ? error.message : String(error);
		await deps.settings.set('youtube.feed', {
			...keep,
			lastAttemptAt: attemptAt,
			lastError: message.slice(0, 500),
		});
		throw error;
	}
};

export { DEFAULT_SETTINGS as DEFAULT_YOUTUBE_SETTINGS };
