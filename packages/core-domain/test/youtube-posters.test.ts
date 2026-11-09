import { describe, expect, it, vi } from 'vitest';

import { copyYouTubePosters } from '../src/media/youtube-posters';
import { refreshYouTubeFeed } from '../src/media/youtube-feed';

const row = (videoId: string, kind: 'video' | 'short' = 'video', posterKey: string | null = null) => ({
	videoId,
	title: videoId,
	publishedAt: '2026-11-01T00:00:00.000Z',
	thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hq.jpg`,
	posterUrl: posterKey ? `https://cdn.test/${posterKey}` : null,
	posterKey,
	kind,
	durationSeconds: 60,
});

const setup = (feed: object | null, shaFor: (bytes: Uint8Array) => string = () => 'aaaaaaaa1111') => {
	let stored = feed;
	const settings = {
		get: vi.fn(async () => stored),
		set: vi.fn(async (_key: string, value: object) => {
			stored = value;
		}),
	};
	const deps = {
		youtube: {
			downloadThumbnail: vi.fn(async (id: string) => (id.startsWith('none') ? null : new Uint8Array([1]))),
		},
		codec: {
			render: vi.fn(async (bytes: Uint8Array, spec: { width: number; height: number | null }) => ({
				bytes,
				width: spec.width,
				height: spec.height ?? 0,
				sha256: shaFor(bytes),
			})),
		},
		storage: { upload: vi.fn(async () => ({}) as never), getUrl: (key: string) => `https://cdn.test/${key}` },
		queue: { enqueue: vi.fn(async () => {}) },
		settings: settings as never,
	};
	return {
		deps,
		settings,
		stored: () => stored as { videos: ReturnType<typeof row>[]; shorts: ReturnType<typeof row>[] },
	};
};

describe('copyYouTubePosters', () => {
	it('does nothing before the first refresh', async () => {
		const { deps } = setup(null);
		expect(await copyYouTubePosters(deps as never)).toEqual({ copied: 0, kept: 0, removed: 0 });
	});

	it('copies each poster at its shape under a fingerprinted key, once', async () => {
		const { deps, stored } = setup({
			videos: [row('vvvvvvvvvvv')],
			shorts: [row('sssssssssss', 'short')],
			retiredPosters: [],
		});
		expect(await copyYouTubePosters(deps as never)).toEqual({ copied: 2, kept: 0, removed: 0 });
		expect(deps.codec.render.mock.calls.map(([, spec]) => [spec.width, spec.height])).toEqual([
			[960, 540],
			[540, 960],
		]);
		expect(stored().videos[0]).toMatchObject({
			posterKey: 'youtube/vvvvvvvvvvv-aaaaaaaa.webp',
			posterUrl: 'https://cdn.test/youtube/vvvvvvvvvvv-aaaaaaaa.webp',
		});
		expect(deps.storage.upload).toHaveBeenCalledWith(
			expect.objectContaining({ contentType: 'image/webp', cacheControl: 'public, max-age=31536000, immutable' }),
		);
		// The next night the same pictures keep their keys and nothing is uploaded or deleted.
		deps.storage.upload.mockClear();
		expect(await copyYouTubePosters(deps as never)).toEqual({ copied: 0, kept: 2, removed: 0 });
		expect(deps.storage.upload).not.toHaveBeenCalled();
		expect(deps.queue.enqueue).not.toHaveBeenCalled();
	});

	it('replaces a changed picture and deletes the old copy and the posters of videos that left', async () => {
		const { deps, stored } = setup(
			{
				videos: [row('vvvvvvvvvvv', 'video', 'youtube/vvvvvvvvvvv-oldoldol.webp')],
				shorts: [],
				retiredPosters: [{ key: 'youtube/gone-1.webp', url: 'https://cdn.test/youtube/gone-1.webp' }],
			},
			() => 'newnewne9999',
		);
		expect(await copyYouTubePosters(deps as never)).toEqual({ copied: 1, kept: 0, removed: 2 });
		expect(stored().videos[0]?.posterKey).toBe('youtube/vvvvvvvvvvv-newnewne.webp');
		expect(deps.queue.enqueue).toHaveBeenCalledWith({
			type: 'delete-objects',
			keys: ['youtube/vvvvvvvvvvv-oldoldol.webp', 'youtube/gone-1.webp'],
			urls: ['https://cdn.test/youtube/vvvvvvvvvvv-oldoldol.webp', 'https://cdn.test/youtube/gone-1.webp'],
		});
		expect(stored()).toMatchObject({ retiredPosters: [] });
	});

	it("keeps the old copy, or YouTube's picture, when a picture cannot be fetched or decoded", async () => {
		const { deps, stored } = setup({
			videos: [row('none-picture'), row('broken-pict', 'video', 'youtube/broken-pict-keep.webp')],
			shorts: [],
		});
		deps.codec.render.mockRejectedValueOnce(new Error('not an image'));
		expect(await copyYouTubePosters(deps as never)).toMatchObject({ copied: 0 });
		expect(stored().videos.map((video) => video.posterKey)).toEqual([null, 'youtube/broken-pict-keep.webp']);
		expect(deps.queue.enqueue).not.toHaveBeenCalled();
	});
});

describe('refreshYouTubeFeed posters', () => {
	it('keeps the posters of videos that stay, and retires those of videos that leave', async () => {
		const set = vi.fn(async () => {});
		const before = {
			videos: [
				row('stayingvid1', 'video', 'youtube/stayingvid1-a.webp'),
				row('leavingvid1', 'video', 'youtube/leavingvid1-b.webp'),
			],
			shorts: [],
			fetchedAt: null,
			retiredPosters: [],
		};
		const settings = {
			get: async (key: string) =>
				key === 'youtube.feed'
					? before
					: {
							channelHandle: '@a',
							channelId: 'UC',
							uploadsPlaylistId: 'UU',
							displayCount: 8,
							railPlacements: [],
						},
			set,
		};
		const youtube = {
			resolveChannel: vi.fn(),
			listPlaylistVideos: async () => [
				{ videoId: 'stayingvid1', title: 't', publishedAt: 'p', thumbnailUrl: 'u' },
			],
			describeVideos: async () => [
				{
					videoId: 'stayingvid1',
					title: 't',
					publishedAt: '2026-11-02T00:00:00.000Z',
					thumbnailUrl: 'u',
					kind: 'video' as const,
					durationSeconds: 60,
				},
			],
		};
		await refreshYouTubeFeed({
			settings: settings as never,
			youtube: youtube as never,
			now: () => new Date('2026-11-03T00:00:00.000Z'),
		});
		const feed = (
			set.mock.calls.at(-1) as unknown as [string, { videos: { posterKey: string }[]; retiredPosters: unknown[] }]
		)[1];
		expect(feed.videos[0]?.posterKey).toBe('youtube/stayingvid1-a.webp');
		expect(feed.retiredPosters).toEqual([
			{ key: 'youtube/leavingvid1-b.webp', url: 'https://cdn.test/youtube/leavingvid1-b.webp' },
		]);
	});
});
