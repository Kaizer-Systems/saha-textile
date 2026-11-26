import { HttpClient } from '@angular/common/http';
import { inject } from '@angular/core';

import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { runtimeConfig, runtimeConfigReady } from '@core/config/runtime-config';
import { IChannelVideos, IVideo } from '@data-access/interfaces/video.interface';

const EMPTY: IChannelVideos = { videos: [], shorts: [], channelUrl: 'https://www.youtube.com/@SahaTextile' };

/**
 * The channel's cached videos and Shorts for `/videos` (`GET /storefront/youtube/videos`).
 * The API serves what the 00:00 IST refresh saved; it never calls YouTube per shopper. An
 * unreachable API answers "no videos", which the page shows as its empty state.
 */
export function injectChannelVideosQuery() {
	const http = inject(HttpClient);
	return injectQuery(() => ({
		queryKey: ['youtube', 'videos'],
		queryFn: async (): Promise<IChannelVideos> => {
			await runtimeConfigReady;
			try {
				return await firstValueFrom(
					http.get<IChannelVideos>(`${runtimeConfig.apiUrl}/storefront/youtube/videos`),
				);
			} catch {
				return EMPTY;
			}
		},
		staleTime: 10 * 60_000,
	}));
}

/** A placement's rail (`GET /storefront/youtube/rail`): empty when admin has not switched it on there. */
export function injectVideoRailQuery(placement: () => string) {
	const http = inject(HttpClient);
	return injectQuery(() => ({
		queryKey: ['youtube', 'rail', placement()],
		queryFn: async (): Promise<IVideo[]> => {
			await runtimeConfigReady;
			try {
				const body = await firstValueFrom(
					http.get<{ videos: IVideo[] }>(`${runtimeConfig.apiUrl}/storefront/youtube/rail`, {
						params: { placement: placement() },
					}),
				);
				return body.videos;
			} catch {
				return [];
			}
		},
		staleTime: 10 * 60_000,
	}));
}
