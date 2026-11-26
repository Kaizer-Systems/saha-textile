import { describe, expect, it, vi } from 'vitest';

import { cutSwatch } from '../src/media/swatch-cut';
import { copyYouTubePosters } from '../src/media/youtube-posters';

describe('cutting a swatch: the remaining cases', () => {
	it('cuts a square for a swatch that has no versions yet', async () => {
		const cut = {
			id: 'med_cut',
			cutFrom: { assetId: 'med_photo', region: { x: 0, y: 0, size: 100 } },
			originalStorageKey: 'media/med_cut/original.jpg',
			deletedAt: null,
			derivatives: [],
			processing: { state: 'ready' },
		};
		const photo = { id: 'med_photo', originalStorageKey: 'media/med_photo/original.jpg' };
		const update = vi.fn();
		const outcome = await cutSwatch(
			{
				assets: { findById: async (id: string) => (id === 'med_cut' ? cut : photo), update },
				storage: { download: async () => new Uint8Array(4), upload: vi.fn() },
				cutter: { cut: async () => ({ bytes: new Uint8Array(4), width: 600, height: 600 }) },
				now: () => new Date('2026-11-20T00:00:00Z'),
				process: async () => ({ status: 'ready', rendered: 1, skipped: 0 }),
			} as never,
			{ assetId: 'med_cut' },
		);
		expect(outcome).toEqual({ status: 'made', px: 600 });
		expect(update).toHaveBeenCalledWith(expect.objectContaining({ versions: [] }));
		expect(update.mock.calls[0]?.[0]).not.toHaveProperty('keptFiles');
	});
});

describe('copying YouTube posters: the remaining cases', () => {
	const row = (videoId: string) => ({ videoId, kind: 'video', title: videoId, posterKey: null, posterUrl: null });
	const world = (reread: unknown) => {
		const feed = { videos: [row('a')], shorts: [] };
		const get = vi.fn().mockResolvedValueOnce(feed).mockResolvedValueOnce(reread);
		const set = vi.fn();
		return {
			set,
			deps: {
				youtube: { downloadThumbnail: async () => new Uint8Array(4) },
				codec: {
					render: async () => ({ bytes: new Uint8Array(4), width: 960, height: 540, sha256: '1234567890' }),
				},
				storage: { upload: vi.fn(), getUrl: (key: string) => `https://cdn.example/${key}` },
				queue: { enqueue: vi.fn() },
				settings: { get, set },
			} as never,
		};
	};

	it('writes onto the feed it read first when the second read finds none', async () => {
		const run = world(null);
		expect(await copyYouTubePosters(run.deps)).toEqual({ copied: 1, kept: 0, removed: 0 });
		expect(run.set.mock.calls[0]?.[1].videos[0].posterKey).toBe('youtube/a-12345678.webp');
	});

	it('leaves a video added by a newer refresh as it is', async () => {
		const run = world({ videos: [row('a'), row('new')], shorts: [] });
		await copyYouTubePosters(run.deps);
		expect(run.set.mock.calls[0]?.[1].videos[1]).toEqual(row('new'));
	});
});
