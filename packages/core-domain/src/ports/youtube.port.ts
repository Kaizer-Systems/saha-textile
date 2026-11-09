import type { YouTubeVideoKind } from '@saha-textile/contracts';

/** A public, embeddable video as returned by the YouTube Data API. */
export interface YouTubeVideo {
	videoId: string;
	title: string;
	/** ISO-8601 publish timestamp. */
	publishedAt: string;
	thumbnailUrl: string;
	/** A Short is vertical and at most three minutes long; the adapter decides. */
	kind: YouTubeVideoKind;
	durationSeconds: number;
}

/** One upload in the channel's uploads playlist, before its details are read. */
export interface YouTubePlaylistItem {
	videoId: string;
	title: string;
	publishedAt: string;
	thumbnailUrl: string;
}

/**
 * YouTube Data API v3 (`YouTubePort`).
 *
 * Owner lock: the channel handle resolves once to its uploads playlist; the daily 00:00 IST
 * refresh reads the latest 50 uploads (`playlistItems.list`, one quota unit) and their details
 * (`videos.list`, one unit for up to 50), and splits them into videos and Shorts. The product
 * video field's check looks one id up. The refresh SCHEDULE belongs to the job and the cache to
 * `siteSettings`; the API key lives in server env inside the adapter and never reaches the browser.
 */
export interface YouTubePort {
	resolveChannel(handle: string): Promise<{ channelId: string; uploadsPlaylistId: string } | null>;
	listPlaylistVideos(input: { playlistId: string; limit: number }): Promise<YouTubePlaylistItem[]>;
	/** Details of up to 50 ids, in the order asked; private, deleted and non-embeddable ones are left out. */
	describeVideos(videoIds: readonly string[]): Promise<YouTubeVideo[]>;
	findVideo(videoId: string): Promise<YouTubeVideo | null>;
}
