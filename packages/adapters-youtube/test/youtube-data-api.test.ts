import { describe, expect, it, vi } from 'vitest';

import { YouTubeApiError, YouTubeDataApi } from '../src/index.js';

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
