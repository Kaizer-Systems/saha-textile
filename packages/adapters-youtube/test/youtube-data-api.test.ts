import { describe, expect, it, vi } from 'vitest';

import { YouTubeApiError, YouTubeDataApi, isoDurationSeconds } from '../src/index.js';

const responder = (routes: Record<string, unknown>, status = 200) => {
	const urls: string[] = [];
	const fetchImpl = (async (url: string) => {
		urls.push(url);
		const resource = new URL(url).pathname.split('/').at(-1) ?? '';
		return new Response(JSON.stringify(routes[resource] ?? {}), { status });
	}) as unknown as typeof fetch;
	return { urls, fetchImpl };
};

describe('YouTubeDataApi', () => {
	it('resolves a handle to its uploads playlist', async () => {
		const { fetchImpl, urls } = responder({
			channels: { items: [{ id: 'UC123', contentDetails: { relatedPlaylists: { uploads: 'UU123' } } }] },
		});
		const api = new YouTubeDataApi({ apiKey: 'k', fetch: fetchImpl });
		expect(await api.resolveChannel('@SahaTextile')).toEqual({ channelId: 'UC123', uploadsPlaylistId: 'UU123' });
		expect(new URL(urls[0] ?? '').searchParams.get('forHandle')).toBe('@SahaTextile');
	});

	it('lists published uploads with the best thumbnail', async () => {
		const { fetchImpl } = responder({
			playlistItems: {
				items: [
					{
						snippet: {
							title: 'Festive drape',
							thumbnails: { high: { url: 'https://i.ytimg.com/a/hq.jpg' } },
						},
						contentDetails: { videoId: 'dQw4w9WgXcQ', videoPublishedAt: '2026-10-01T10:00:00Z' },
					},
					{ snippet: { title: 'Scheduled', thumbnails: {} }, contentDetails: { videoId: 'xxxxxxxxxxx' } },
				],
			},
		});
		const videos = await new YouTubeDataApi({ apiKey: 'k', fetch: fetchImpl }).listPlaylistVideos({
			playlistId: 'UU1',
			limit: 10,
		});
		expect(videos).toEqual([
			{
				videoId: 'dQw4w9WgXcQ',
				title: 'Festive drape',
				publishedAt: '2026-10-01T10:00:00Z',
				thumbnailUrl: 'https://i.ytimg.com/a/hq.jpg',
			},
		]);
	});

	it('treats private and non-embeddable videos as not found', async () => {
		const video = (status: Record<string, unknown>) =>
			responder({
				videos: {
					items: [{ id: 'dQw4w9WgXcQ', snippet: { title: 't', publishedAt: 'p', thumbnails: {} }, status }],
				},
			});
		expect(
			await new YouTubeDataApi({
				apiKey: 'k',
				fetch: video({ privacyStatus: 'public', embeddable: true }).fetchImpl,
			}).findVideo('dQw4w9WgXcQ'),
		).not.toBeNull();
		expect(
			await new YouTubeDataApi({ apiKey: 'k', fetch: video({ privacyStatus: 'private' }).fetchImpl }).findVideo(
				'dQw4w9WgXcQ',
			),
		).toBeNull();
		expect(
			await new YouTubeDataApi({
				apiKey: 'k',
				fetch: video({ privacyStatus: 'public', embeddable: false }).fetchImpl,
			}).findVideo('dQw4w9WgXcQ'),
		).toBeNull();
	});

	it('reports failures without the key', async () => {
		const { fetchImpl } = responder({}, 403);
		const error = await new YouTubeDataApi({ apiKey: 'secret-key', fetch: fetchImpl })
			.findVideo('dQw4w9WgXcQ')
			.catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(YouTubeApiError);
		expect((error as Error).message).not.toContain('secret-key');
	});
});

describe('YouTubeDataApi edges', () => {
	it('uses the global fetch when none is supplied', async () => {
		const { fetchImpl, urls } = responder({ channels: { items: [] } });
		vi.stubGlobal('fetch', fetchImpl);
		const channel = await new YouTubeDataApi({ apiKey: 'k' }).resolveChannel('@none');
		vi.unstubAllGlobals();
		expect(channel).toBeNull();
		expect(urls).toHaveLength(1);
	});

	it('wraps a network failure without the key', async () => {
		const fetchImpl = (async () => {
			throw new Error('socket hang up');
		}) as unknown as typeof fetch;
		const error = await new YouTubeDataApi({ apiKey: 'secret-key', fetch: fetchImpl })
			.findVideo('dQw4w9WgXcQ')
			.catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(YouTubeApiError);
		expect((error as Error).message).toBe('YouTube videos request failed');
	});

	it('treats an unknown video as not found', async () => {
		const { fetchImpl } = responder({ videos: { items: [] } });
		expect(await new YouTubeDataApi({ apiKey: 'k', fetch: fetchImpl }).findVideo('dQw4w9WgXcQ')).toBeNull();
	});

	it.each([
		['maxres', 'https://i.ytimg.com/max.jpg'],
		['medium', 'https://i.ytimg.com/med.jpg'],
		['default', 'https://i.ytimg.com/def.jpg'],
	])('falls back through the thumbnails to %s', async (size, url) => {
		const { fetchImpl } = responder({
			videos: {
				items: [
					{
						id: 'dQw4w9WgXcQ',
						snippet: { title: 't', publishedAt: 'p', thumbnails: { [size]: { url } } },
						status: { privacyStatus: 'public', embeddable: true },
					},
				],
			},
		});
		const video = await new YouTubeDataApi({ apiKey: 'k', fetch: fetchImpl }).findVideo('dQw4w9WgXcQ');
		expect(video?.thumbnailUrl).toBe(url);
	});

	it('answers an empty thumbnail when a video has none', async () => {
		const { fetchImpl } = responder({
			videos: {
				items: [{ id: 'dQw4w9WgXcQ', snippet: { title: 't', publishedAt: 'p', thumbnails: {} } }],
			},
		});
		const video = await new YouTubeDataApi({ apiKey: 'k', fetch: fetchImpl }).findVideo('dQw4w9WgXcQ');
		expect(video?.thumbnailUrl).toBe('');
	});
});

const apiVideo = (id: string, duration: string, extra: Record<string, unknown> = {}) => ({
	id,
	snippet: { title: `title ${id}`, publishedAt: '2026-11-01T00:00:00Z', thumbnails: {} },
	contentDetails: { duration },
	status: { privacyStatus: 'public', embeddable: true },
	...extra,
});

/** Data API answers plus YouTube's `/shorts/<id>` page: 200 for a Short, 303 for anything else. */
const withShortsPage = (videos: unknown[], shorts: Record<string, number | 'down'>) => {
	const heads: string[] = [];
	const fetchImpl = (async (url: string) => {
		const { hostname, pathname } = new URL(url);
		if (hostname === 'www.youtube.com') {
			const id = pathname.split('/').at(-1) ?? '';
			heads.push(id);
			const status = shorts[id];
			if (status === 'down') throw new Error('offline');
			return new Response(null, { status: status ?? 303 });
		}
		return new Response(JSON.stringify({ items: videos }), { status: 200 });
	}) as unknown as typeof fetch;
	return { heads, api: new YouTubeDataApi({ apiKey: 'k', fetch: fetchImpl }) };
};

describe('YouTubeDataApi kinds and lengths', () => {
	it.each([
		['PT25M21S', 1521],
		['PT48S', 48],
		['PT1H2M3S', 3723],
		['P1DT1S', 86401],
		['P0D', 0],
		['nonsense', 0],
		[undefined, 0],
	])('reads the length %s as %i seconds', (value, seconds) => {
		expect(isoDurationSeconds(value)).toBe(seconds);
	});

	it('tells a Short from a video by its /shorts/ page, and checks only short ones', async () => {
		const { api, heads } = withShortsPage(
			[apiVideo('aaaaaaaaaaa', 'PT48S'), apiVideo('bbbbbbbbbbb', 'PT2M'), apiVideo('ccccccccccc', 'PT25M21S')],
			{ aaaaaaaaaaa: 200 },
		);
		const videos = await api.describeVideos(['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc']);
		expect(videos.map((video) => [video.videoId, video.kind, video.durationSeconds])).toEqual([
			['aaaaaaaaaaa', 'short', 48],
			['bbbbbbbbbbb', 'video', 120],
			['ccccccccccc', 'video', 1521],
		]);
		expect(heads).toEqual(['aaaaaaaaaaa', 'bbbbbbbbbbb']);
	});

	it('falls back to the player shape when YouTube cannot be reached', async () => {
		const { api } = withShortsPage(
			[
				apiVideo('aaaaaaaaaaa', 'PT30S', { player: { embedWidth: '608', embedHeight: '1080' } }),
				apiVideo('bbbbbbbbbbb', 'PT30S', { player: { embedWidth: 1080, embedHeight: 608 } }),
				apiVideo('ccccccccccc', 'PT30S'),
				apiVideo('ddddddddddd', 'PT30S'),
			],
			{ aaaaaaaaaaa: 'down', bbbbbbbbbbb: 'down', ccccccccccc: 'down', ddddddddddd: 500 },
		);
		const kinds = (await api.describeVideos(['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc', 'ddddddddddd'])).map(
			(video) => video.kind,
		);
		expect(kinds).toEqual(['short', 'video', 'video', 'video']);
	});

	it('answers in the order asked, once each, leaving out what cannot play', async () => {
		const { api } = withShortsPage(
			[
				apiVideo('ccccccccccc', 'PT10M'),
				apiVideo('aaaaaaaaaaa', 'PT10M'),
				apiVideo('bbbbbbbbbbb', 'PT10M', { status: { privacyStatus: 'private' } }),
			],
			{},
		);
		const ids = (await api.describeVideos(['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc', 'aaaaaaaaaaa'])).map(
			(video) => video.videoId,
		);
		expect(ids).toEqual(['aaaaaaaaaaa', 'ccccccccccc']);
	});

	it('asks nothing for no ids', async () => {
		const { api, heads } = withShortsPage([], {});
		expect(await api.describeVideos([])).toEqual([]);
		expect(heads).toEqual([]);
	});
});

describe('YouTubeDataApi thumbnails', () => {
	const serving = (available: Record<string, number | 'down'>) => {
		const asked: string[] = [];
		const fetchImpl = (async (url: string) => {
			const name = new URL(url).pathname.split('/').at(-1) ?? '';
			asked.push(name);
			const status = available[name];
			if (status === 'down') throw new Error('offline');
			return new Response(status === 200 ? new Uint8Array([7, 8]) : null, { status: status ?? 404 });
		}) as unknown as typeof fetch;
		return { asked, api: new YouTubeDataApi({ apiKey: 'k', fetch: fetchImpl }) };
	};

	it("takes a Short's 9:16 picture", async () => {
		const { api, asked } = serving({ 'oar2.jpg': 200 });
		expect(await api.downloadThumbnail('aaaaaaaaaaa', 'short')).toEqual(new Uint8Array([7, 8]));
		expect(asked).toEqual(['oar2.jpg']);
	});

	it("falls back through a video's sizes, and answers null when there is none", async () => {
		const { api, asked } = serving({ 'maxresdefault.jpg': 'down', 'hqdefault.jpg': 200 });
		expect(await api.downloadThumbnail('aaaaaaaaaaa', 'video')).toEqual(new Uint8Array([7, 8]));
		expect(asked).toEqual(['maxresdefault.jpg', 'sddefault.jpg', 'hqdefault.jpg']);
		expect(await serving({}).api.downloadThumbnail('aaaaaaaaaaa', 'short')).toBeNull();
	});
});
