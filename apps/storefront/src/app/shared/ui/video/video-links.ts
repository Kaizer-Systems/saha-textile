import { IVideo } from '@data-access/interfaces/video.interface';

/** The video's own page on YouTube: a plain link that works without any script. */
export const watchUrl = (video: Pick<IVideo, 'videoId' | 'kind'>): string =>
	video.kind === 'short'
		? `https://www.youtube.com/shorts/${video.videoId}`
		: `https://www.youtube.com/watch?v=${video.videoId}`;

const YOUTUBE_IMAGES = /^https:\/\/i\.ytimg\.com\/vi\//;

/**
 * The picture for a card or poster. Our CDN copy is used as it is. A YouTube picture is
 * swapped for the size the place needs: Shorts get YouTube's true 9:16 picture (`oar2`), small
 * cards the 320×180 one, large posters the API's best one.
 */
export const posterFor = (video: Pick<IVideo, 'videoId' | 'kind' | 'thumbnailUrl'>, size: 'card' | 'large'): string => {
	if (video.thumbnailUrl && !YOUTUBE_IMAGES.test(video.thumbnailUrl)) return video.thumbnailUrl;
	if (video.kind === 'short') return `https://i.ytimg.com/vi/${video.videoId}/oar2.jpg`;
	if (size === 'card') return `https://i.ytimg.com/vi/${video.videoId}/mqdefault.jpg`;
	return video.thumbnailUrl || `https://i.ytimg.com/vi/${video.videoId}/hqdefault.jpg`;
};

/** ISO-8601 duration for VideoObject data: 1521 → `PT25M21S`. */
export const isoDuration = (seconds: number): string => {
	const hours = Math.floor(seconds / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	const rest = seconds % 60;
	return `PT${hours ? `${hours}H` : ''}${minutes ? `${minutes}M` : ''}${rest || (!hours && !minutes) ? `${rest}S` : ''}`;
};
