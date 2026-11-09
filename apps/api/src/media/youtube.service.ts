import { mediaRefusal } from './media-refusal';
import { Inject, Injectable } from '@nestjs/common';
import { HttpStatus } from '@nestjs/common';
import {
	type YouTubeRailResponse,
	type YouTubeSettings,
	type YouTubeSettingsUpdate,
	type YouTubeValidateResponse,
	type YouTubeFeedStatus,
	type YouTubeVideoSummary,
	type YouTubeVideosResponse,
	normalizeYouTubeVideoId,
} from '@saha-textile/contracts';
import {
	DEFAULT_YOUTUBE_SETTINGS,
	type MediaJobQueuePort,
	type SiteSettingsRepository,
	type YouTubePort,
} from '@saha-textile/core-domain';

import { MEDIA_JOB_QUEUE, SITE_SETTINGS_REPOSITORY, YOUTUBE_PORT } from '../infra/tokens';

/** Our CDN copy of a poster when the refresh has made one, else YouTube's own picture. */
const withPoster = (video: YouTubeVideoSummary): YouTubeVideoSummary =>
	video.posterUrl ? { ...video, thumbnailUrl: video.posterUrl } : video;

/** The product video check, the home rail and `/videos` (owner log § Media → Video and YouTube). */
@Injectable()
export class YouTubeService {
	constructor(
		@Inject(YOUTUBE_PORT) private readonly youtube: YouTubePort,
		@Inject(SITE_SETTINGS_REPOSITORY) private readonly settings: SiteSettingsRepository,
		@Inject(MEDIA_JOB_QUEUE) private readonly queue: MediaJobQueuePort,
	) {}

	/** Normalises whatever was pasted and confirms the video exists and can be embedded. */
	async validate(input: string): Promise<YouTubeValidateResponse> {
		const videoId = normalizeYouTubeVideoId(input);
		if (!videoId) {
			throw mediaRefusal(
				HttpStatus.UNPROCESSABLE_ENTITY,
				'not_a_youtube_video',
				'Paste a YouTube link or video id.',
			);
		}
		const video = await this.youtube.findVideo(videoId);
		if (!video)
			throw mediaRefusal(HttpStatus.NOT_FOUND, 'video_not_found', 'No public, embeddable video has that id.');
		return {
			videoId: video.videoId,
			title: video.title,
			thumbnailUrl: video.thumbnailUrl,
			kind: video.kind,
			durationSeconds: video.durationSeconds,
			publishedAt: video.publishedAt,
		};
	}

	async getSettings(): Promise<YouTubeSettings> {
		return (await this.settings.get('youtube')) ?? DEFAULT_YOUTUBE_SETTINGS;
	}

	/** A changed handle forgets the resolved playlist, so the next refresh resolves it again. */
	async updateSettings(update: YouTubeSettingsUpdate): Promise<YouTubeSettings> {
		const current = await this.getSettings();
		const handleChanged = update.channelHandle !== undefined && update.channelHandle !== current.channelHandle;
		const next: YouTubeSettings = {
			...current,
			...update,
			...(handleChanged ? { channelId: null, uploadsPlaylistId: null } : {}),
		};
		await this.settings.set('youtube', next);
		return next;
	}

	/** The cached rail for a placement; empty when the placement is not switched on. */
	async rail(placement: string): Promise<YouTubeRailResponse> {
		const settings = await this.getSettings();
		if (!settings.railPlacements.includes(placement)) return { videos: [] };
		const feed = await this.settings.get('youtube.feed');
		return { videos: (feed?.videos ?? []).slice(0, settings.displayCount).map(withPoster) };
	}

	/** What admin's YouTube tab shows: when the cache was last filled, and the last error. */
	async status(): Promise<YouTubeFeedStatus> {
		const feed = await this.settings.get('youtube.feed');
		return {
			fetchedAt: feed?.fetchedAt ?? null,
			lastAttemptAt: feed?.lastAttemptAt ?? null,
			lastError: feed?.lastError ?? null,
			videos: feed?.videos.length ?? 0,
			shorts: feed?.shorts.length ?? 0,
		};
	}

	/** Admin's "Refresh now": the worker runs the daily refresh at once (2 quota units). */
	async refreshNow(): Promise<void> {
		await this.queue.enqueue({ type: 'youtube-refresh' });
	}

	/** Everything `/videos` shows. Empty lists until the first refresh, which the page says plainly. */
	async videos(): Promise<YouTubeVideosResponse> {
		const [settings, feed] = await Promise.all([this.getSettings(), this.settings.get('youtube.feed')]);
		return {
			videos: (feed?.videos ?? []).map(withPoster),
			shorts: (feed?.shorts ?? []).map(withPoster),
			channelUrl: `https://www.youtube.com/${settings.channelHandle}`,
		};
	}
}
