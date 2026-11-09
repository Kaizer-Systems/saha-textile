/** A YouTube long video or Short, as the API sends it (`YouTubeVideoSummary` / `ProductVideo`). */
export interface IVideo {
	videoId: string;
	title: string;
	/** Our CDN copy when the daily refresh has made one, else YouTube's own picture. */
	thumbnailUrl: string;
	kind: 'video' | 'short';
	durationSeconds: number;
	/** Channel feed only: when it went up. */
	publishedAt?: string;
}

/** `GET /storefront/youtube/videos`. */
export interface IChannelVideos {
	videos: IVideo[];
	shorts: IVideo[];
	channelUrl: string;
}
