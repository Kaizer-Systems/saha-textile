import type { YouTubeFeedCache, YouTubeVideoSummary } from '@saha-textile/contracts';

import type { ImageCodecPort } from '../ports/image-codec.port';
import type { MediaJobQueuePort } from '../ports/media-job-queue.port';
import type { SiteSettingsRepository } from '../ports/site-settings.repository';
import type { StoragePort } from '../ports/storage.port';
import type { YouTubePort } from '../ports/youtube.port';

/** Card and player posters: 960×540 for a video, 540×960 for a Short. */
const POSTER = { video: { width: 960, height: 540 }, short: { width: 540, height: 960 } } as const;
const IMMUTABLE = 'public, max-age=31536000, immutable';

/**
 * Copies the cached videos' pictures to our CDN after each refresh (owner V4, 2026-11-10).
 *
 * Each poster is rendered to WebP and stored at `youtube/<id>-<fingerprint>.webp`. The key
 * changes whenever the picture does, so a cached old copy can never be shown in its place, and
 * an unchanged picture keeps its key. Keys no longer used (a changed picture, a video that left
 * the list) are queued for deletion and CDN purge, so the set stays exactly what the shop shows.
 * A picture that cannot be fetched or decoded keeps its old copy, or YouTube's own URL.
 */
export const copyYouTubePosters = async (deps: {
	youtube: Pick<YouTubePort, 'downloadThumbnail'>;
	codec: Pick<ImageCodecPort, 'render'>;
	storage: Pick<StoragePort, 'upload' | 'getUrl'>;
	queue: MediaJobQueuePort;
	settings: SiteSettingsRepository;
}): Promise<{ copied: number; kept: number; removed: number }> => {
	const feed: YouTubeFeedCache | null = await deps.settings.get('youtube.feed');
	if (!feed) return { copied: 0, kept: 0, removed: 0 };
	let copied = 0;
	let kept = 0;
	const poster = async (row: YouTubeVideoSummary): Promise<YouTubeVideoSummary> => {
		try {
			const bytes = await deps.youtube.downloadThumbnail(row.videoId, row.kind);
			if (!bytes) return row;
			const size = POSTER[row.kind];
			const image = await deps.codec.render(bytes, {
				width: size.width,
				height: size.height,
				fit: 'cover',
				format: 'image/webp',
				quality: 78,
			});
			const key = `youtube/${row.videoId}-${image.sha256.slice(0, 8)}.webp`;
			// An unchanged picture keeps its file; its address is written again from this bucket, so a
			// feed copied from another environment's database stops naming the other bucket.
			if (key === row.posterKey) {
				kept += 1;
				return { ...row, posterUrl: deps.storage.getUrl(key) };
			}
			await deps.storage.upload({ key, body: image.bytes, contentType: 'image/webp', cacheControl: IMMUTABLE });
			copied += 1;
			return { ...row, posterKey: key, posterUrl: deps.storage.getUrl(key) };
		} catch {
			return row;
		}
	};
	const videos: YouTubeVideoSummary[] = [];
	for (const row of feed.videos) videos.push(await poster(row));
	const shorts: YouTubeVideoSummary[] = [];
	for (const row of feed.shorts) shorts.push(await poster(row));

	// Re-read so a newer refresh's lists are not overwritten; only the poster fields are applied.
	const latest = (await deps.settings.get('youtube.feed')) ?? feed;
	const done = new Map([...videos, ...shorts].map((row) => [row.videoId, row] as const));
	const withPoster = (row: YouTubeVideoSummary): YouTubeVideoSummary => {
		const made = done.get(row.videoId);
		return made ? { ...row, posterKey: made.posterKey, posterUrl: made.posterUrl } : row;
	};
	const next = {
		...latest,
		videos: latest.videos.map(withPoster),
		shorts: latest.shorts.map(withPoster),
		retiredPosters: [],
	};
	await deps.settings.set('youtube.feed', next);

	const used = new Set([...next.videos, ...next.shorts].flatMap((row) => (row.posterKey ? [row.posterKey] : [])));
	// Old files are named by key; the addresses to purge are this bucket's, not the ones saved.
	const before = [
		...[...feed.videos, ...feed.shorts].flatMap((row) => (row.posterKey ? [row.posterKey] : [])),
		...(latest.retiredPosters ?? []).map((item) => item.key),
	];
	const stale = [...new Set(before.filter((key) => !used.has(key)))];
	if (stale.length) {
		await deps.queue.enqueue({
			type: 'delete-objects',
			keys: stale,
			urls: stale.map((key) => deps.storage.getUrl(key)),
		});
	}
	return { copied, kept, removed: stale.length };
};
