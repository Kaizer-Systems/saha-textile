/** A video as returned by the YouTube Data API. */
export interface YouTubeVideo {
	videoId: string;
	title: string;
	/** ISO-8601 publish timestamp. */
	publishedAt: string;
	thumbnailUrl: string;
}

/**
 * YouTube Data API v3 (`YouTubePort`).
 *
 * Owner lock: the home rail resolves the channel handle once to its uploads playlist, then
 * refreshes the 10 latest daily at 00:00 IST (`playlistItems.list`, one quota unit). The PDP
 * video field's Validate button looks a single id up. The refresh SCHEDULE belongs to the
 * job and the cache to `siteSettings`; the API key lives in server env inside the adapter
 * and never reaches the browser.
 */
export interface YouTubePort {
	resolveChannel(handle: string): Promise<{ channelId: string; uploadsPlaylistId: string } | null>;
	listPlaylistVideos(input: { playlistId: string; limit: number }): Promise<YouTubeVideo[]>;
	findVideo(videoId: string): Promise<YouTubeVideo | null>;
}
