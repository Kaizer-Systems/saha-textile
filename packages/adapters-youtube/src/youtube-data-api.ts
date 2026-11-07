import type { YouTubePort, YouTubeVideo } from '@saha-textile/core-domain';
import { z } from 'zod';

const API = 'https://www.googleapis.com/youtube/v3';

const Thumbnails = z
	.object({
		maxres: z.object({ url: z.string() }).optional(),
		high: z.object({ url: z.string() }).optional(),
		medium: z.object({ url: z.string() }).optional(),
		default: z.object({ url: z.string() }).optional(),
	})
	.default({});

const ChannelsResponse = z.object({
	items: z
		.array(
			z.object({
				id: z.string(),
				contentDetails: z.object({ relatedPlaylists: z.object({ uploads: z.string() }) }),
			}),
		)
		.default([]),
});

const PlaylistItemsResponse = z.object({
	items: z
		.array(
			z.object({
				snippet: z.object({ title: z.string(), thumbnails: Thumbnails }),
				contentDetails: z.object({ videoId: z.string(), videoPublishedAt: z.string().optional() }),
			}),
		)
		.default([]),
});

const VideosResponse = z.object({
	items: z
		.array(
			z.object({
				id: z.string(),
				snippet: z.object({ title: z.string(), publishedAt: z.string(), thumbnails: Thumbnails }),
				status: z.object({ privacyStatus: z.string(), embeddable: z.boolean().optional() }).optional(),
			}),
		)
		.default([]),
});

const bestThumbnail = (thumbnails: z.infer<typeof Thumbnails>): string =>
	thumbnails.maxres?.url ?? thumbnails.high?.url ?? thumbnails.medium?.url ?? thumbnails.default?.url ?? '';

export class YouTubeApiError extends Error {
	constructor(message: string, cause?: unknown) {
		super(message, { cause });
		this.name = 'YouTubeApiError';
	}
}

/**
 * YouTube Data API v3 implementation of `YouTubePort`.
 *
 * The API key is server env inside this adapter and never appears in a URL that is logged
 * or an error message: errors carry the HTTP status only. Quota use is tiny — channel
 * resolution once, then one `playlistItems.list` (1 unit) per daily refresh and one
 * `videos.list` (1 unit) per admin Validate click.
 */
export class YouTubeDataApi implements YouTubePort {
	private readonly fetchImpl: typeof fetch;

	constructor(private readonly config: { apiKey: string; fetch?: typeof fetch }) {
		this.fetchImpl = config.fetch ?? fetch;
	}

	async resolveChannel(handle: string): Promise<{ channelId: string; uploadsPlaylistId: string } | null> {
		const body = ChannelsResponse.parse(await this.get('channels', { part: 'contentDetails', forHandle: handle }));
		const channel = body.items[0];
		return channel
			? { channelId: channel.id, uploadsPlaylistId: channel.contentDetails.relatedPlaylists.uploads }
			: null;
	}

	async listPlaylistVideos(input: { playlistId: string; limit: number }): Promise<YouTubeVideo[]> {
		const body = PlaylistItemsResponse.parse(
			await this.get('playlistItems', {
				part: 'snippet,contentDetails',
				playlistId: input.playlistId,
				maxResults: String(Math.min(Math.max(input.limit, 1), 50)),
			}),
		);
		return body.items.flatMap((item) => {
			const publishedAt = item.contentDetails.videoPublishedAt;
			if (!publishedAt) return [];
			return [
				{
					videoId: item.contentDetails.videoId,
					title: item.snippet.title,
					publishedAt,
					thumbnailUrl: bestThumbnail(item.snippet.thumbnails),
				},
			];
		});
	}

	/** Null for an unknown, private, or non-embeddable video — none of those can play on a PDP. */
	async findVideo(videoId: string): Promise<YouTubeVideo | null> {
		const body = VideosResponse.parse(await this.get('videos', { part: 'snippet,status', id: videoId }));
		const video = body.items[0];
		if (!video || video.status?.privacyStatus === 'private' || video.status?.embeddable === false) return null;
		return {
			videoId: video.id,
			title: video.snippet.title,
			publishedAt: video.snippet.publishedAt,
			thumbnailUrl: bestThumbnail(video.snippet.thumbnails),
		};
	}

	private async get(resource: string, params: Record<string, string>): Promise<unknown> {
		const query = new URLSearchParams({ ...params, key: this.config.apiKey });
		let response: Response;
		try {
			response = await this.fetchImpl(`${API}/${resource}?${query.toString()}`);
		} catch (error) {
			throw new YouTubeApiError(`YouTube ${resource} request failed`, error);
		}
		if (!response.ok) throw new YouTubeApiError(`YouTube ${resource} answered HTTP ${response.status}`);
		return response.json();
	}
}
