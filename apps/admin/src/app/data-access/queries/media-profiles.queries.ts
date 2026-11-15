import { type Signal, inject } from '@angular/core';

import { injectQuery } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { MediaProfilesGateway } from '@core/media-profiles/media-profiles.gateway';

export const MEDIA_PROFILES_QUERY_KEY = ['media-profiles'] as const;

export function injectMediaProfilesQuery() {
	const gateway = inject(MediaProfilesGateway);
	return injectQuery(() => ({
		queryKey: MEDIA_PROFILES_QUERY_KEY,
		queryFn: () => lastValueFrom(gateway.list()),
	}));
}

/** One profile for the edit form; off until there is a key (adding a profile reads nothing). */
export function injectMediaProfileQuery(key: Signal<string | null>) {
	const gateway = inject(MediaProfilesGateway);
	return injectQuery(() => ({
		queryKey: [...MEDIA_PROFILES_QUERY_KEY, key()],
		queryFn: () => lastValueFrom(gateway.get(key() as string)),
		enabled: !!key(),
	}));
}
