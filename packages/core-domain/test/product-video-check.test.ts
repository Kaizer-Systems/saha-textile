import { describe, expect, it, vi } from 'vitest';

import { checkProductVideos } from '../src/media/product-video-check';
import type { YouTubeVideo } from '../src/ports/youtube.port';

const video = (videoId: string, unavailableSince: string | null = null) => ({
	videoId,
	title: videoId,
	thumbnailUrl: '',
	kind: 'video' as const,
	durationSeconds: 60,
	unavailableSince,
});
const now = () => new Date('2026-11-16T23:00:00.000Z');

describe('checkProductVideos', () => {
	it('marks what YouTube no longer plays, clears what came back, and saves only changed products', async () => {
		const products = [
			{ id: 'p1', videos: [video('aaaaaaaaaaa'), video('bbbbbbbbbbb')] },
			{ id: 'p2', videos: [video('ccccccccccc', '2026-11-09T23:00:00.000Z'), video('aaaaaaaaaaa')] },
			{ id: 'p3', videos: [video('ddddddddddd'), video('eeeeeeeeeee', '2026-11-09T23:00:00.000Z')] },
		];
		const save = vi.fn(async (row: unknown) => row);
		const playable = new Set(['aaaaaaaaaaa', 'ccccccccccc', 'ddddddddddd']);
		const describeVideos = vi.fn(async (ids: readonly string[]) =>
			ids.filter((id) => playable.has(id)).map((id) => ({ videoId: id }) as YouTubeVideo),
		);
		const result = await checkProductVideos({
			products: { listWithVideos: async () => products as never, save: save as never },
			youtube: { describeVideos },
			now,
		});
		expect(result).toEqual({ checked: 5, gone: 1, back: 1, products: 2 });
		expect(describeVideos).toHaveBeenCalledOnce();
		const saved = save.mock.calls.map(
			([row]) => row as { id: string; videos: { videoId: string; unavailableSince: string | null }[] },
		);
		expect(saved.map((row) => row.id)).toEqual(['p1', 'p2']);
		expect(saved[0]?.videos[1]).toMatchObject({
			videoId: 'bbbbbbbbbbb',
			unavailableSince: '2026-11-16T23:00:00.000Z',
		});
		expect(saved[1]?.videos[0]).toMatchObject({ videoId: 'ccccccccccc', unavailableSince: null });
	});

	it('asks YouTube 50 ids at a time', async () => {
		const many = Array.from({ length: 120 }, (_, index) => video(`v${String(index).padStart(10, '0')}`));
		const describeVideos = vi.fn(async (_ids: readonly string[]) => [] as YouTubeVideo[]);
		const result = await checkProductVideos({
			products: { listWithVideos: async () => [{ id: 'p', videos: many }] as never, save: vi.fn() as never },
			youtube: { describeVideos },
			now,
		});
		expect(describeVideos.mock.calls.map(([ids]) => ids.length)).toEqual([50, 50, 20]);
		expect(result).toMatchObject({ checked: 120, gone: 120, products: 1 });
	});

	it('does nothing without products that have videos', async () => {
		const describeVideos = vi.fn();
		expect(
			await checkProductVideos({
				products: { listWithVideos: async () => [], save: vi.fn() as never },
				youtube: { describeVideos },
				now,
			}),
		).toEqual({ checked: 0, gone: 0, back: 0, products: 0 });
		expect(describeVideos).not.toHaveBeenCalled();
	});
});
