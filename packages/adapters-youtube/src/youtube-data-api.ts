import type { YouTubePlaylistItem, YouTubePort, YouTubeVideo } from '@saha-textile/core-domain';
import type { YouTubeVideoKind } from '@saha-textile/contracts';
import { z } from 'zod';

const API = 'https://www.googleapis.com/youtube/v3';
/** YouTube's own rule: a Short is at most three minutes long. */
const SHORT_MAX_SECONDS = 180;

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
				contentDetails: z.object({ duration: z.string() }).optional(),
				status: z.object({ privacyStatus: z.string(), embeddable: z.boolean().optional() }).optional(),
				player: z
					.object({ embedWidth: z.coerce.number().optional(), embedHeight: z.coerce.number().optional() })
					.optional(),
			}),
		)
		.default([]),
});
type ApiVideo = z.infer<typeof VideosResponse>['items'][number];

const bestThumbnail = (thumbnails: z.infer<typeof Thumbnails>): string =>
	thumbnails.maxres?.url ?? thumbnails.high?.url ?? thumbnails.medium?.url ?? thumbnails.default?.url ?? '';

/** `PT1H2M3S` → 3723. Anything unreadable (a live stream's `P0D`) is 0. */
export const isoDurationSeconds = (value: string | undefined): number => {
	const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value ?? '');
	if (!match) return 0;
	const [, days = '0', hours = '0', minutes = '0', seconds = '0'] = match;
	return ((Number(days) * 24 + Number(hours)) * 60 + Number(minutes)) * 60 + Number(seconds);
};

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
 * or an error message: errors carry the HTTP status only. Quota use is tiny: channel
 * resolution once, then per daily refresh one `playlistItems.list` and one `videos.list`
 * (1 unit each), and one `videos.list` per admin check.
 *
 * Shorts: the Data API has no "is a Short" field. A video of three minutes or less is a Short
 * when `youtube.com/shorts/<id>` answers 200 (YouTube redirects any other video to `/watch`).
 * That check costs no quota. If YouTube cannot be reached for it, the player's embed shape
 * decides: taller than wide is a Short.
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

	async listPlaylistVideos(input: { playlistId: string; limit: number }): Promise<YouTubePlaylistItem[]> {
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

	async describeVideos(videoIds: readonly string[]): Promise<YouTubeVideo[]> {
		const ids = [...new Set(videoIds)].slice(0, 50);
		if (!ids.length) return [];
		const body = VideosResponse.parse(
			await this.get('videos', {
				part: 'snippet,status,contentDetails,player',
				id: ids.join(','),
				maxWidth: '1080',
			}),
		);
		const playable = body.items.filter(
			(video) => video.status?.privacyStatus !== 'private' && video.status?.embeddable !== false,
		);
		const byId = new Map(
			await Promise.all(playable.map(async (video) => [video.id, await this.toVideo(video)] as const)),
		);
		return ids.flatMap((id) => byId.get(id) ?? []);
	}

	/** Null for an unknown, private, or non-embeddable video; none of those can play on a product page. */
	async findVideo(videoId: string): Promise<YouTubeVideo | null> {
		const [video] = await this.describeVideos([videoId]);
		return video ?? null;
	}

	async downloadThumbnail(videoId: string, kind: YouTubeVideoKind): Promise<Uint8Array | null> {
		const names = kind === 'short' ? ['oar2', 'hqdefault'] : ['maxresdefault', 'sddefault', 'hqdefault'];
		for (const name of names) {
			try {
				const response = await this.fetchImpl(`https://i.ytimg.com/vi/${videoId}/${name}.jpg`);
				if (response.ok) return new Uint8Array(await response.arrayBuffer());
			} catch {
				// Try the next size.
			}
		}
		return null;
	}

	private async toVideo(video: ApiVideo): Promise<YouTubeVideo> {
		const durationSeconds = isoDurationSeconds(video.contentDetails?.duration);
		return {
			videoId: video.id,
			title: video.snippet.title,
			publishedAt: video.snippet.publishedAt,
			thumbnailUrl: bestThumbnail(video.snippet.thumbnails),
			kind: await this.kindOf(video, durationSeconds),
			durationSeconds,
		};
	}

	private async kindOf(video: ApiVideo, durationSeconds: number): Promise<YouTubeVideoKind> {
		if (durationSeconds === 0 || durationSeconds > SHORT_MAX_SECONDS) return 'video';
		try {
			const response = await this.fetchImpl(`https://www.youtube.com/shorts/${video.id}`, {
				method: 'HEAD',
				redirect: 'manual',
			});
			if (response.status === 200) return 'short';
			if (response.status >= 300 && response.status < 400) return 'video';
		} catch {
			// Fall through to the embed shape.
		}
		const { embedWidth, embedHeight } = video.player ?? {};
		return embedWidth && embedHeight && embedHeight > embedWidth ? 'short' : 'video';
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
