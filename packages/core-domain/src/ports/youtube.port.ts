/** A video as returned by channel-feed discovery. */
export interface YouTubeVideo {
	videoId: string;
	title: string;
	description: string;
	/** ISO-8601 publish timestamp. */
	publishedAt: string;
	thumbnailUrl: string;
	/** Canonical watch URL; the storefront embeds via its own player wrapper. */
	watchUrl: string;
}

/**
 * YouTube channel-feed discovery (`YouTubePort`).
 *
 * Owner lock: latest-video discovery uses Data API v3 through this port, cached and
 * refreshed daily at 00:00 IST. The refresh SCHEDULE belongs to the job that calls this,
 * and the cache belongs to the adapter — core just asks for the latest videos.
 *
 * The API key lives in server env inside the adapter and never reaches the browser.
 */
export interface YouTubePort {
	fetchLatestVideos(input: { channelId: string; limit: number }): Promise<YouTubeVideo[]>;
}
