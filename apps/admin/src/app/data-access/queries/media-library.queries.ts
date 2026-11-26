import { inject } from '@angular/core';

import { injectQuery } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import {
	type EmailPictureQuery,
	type MediaBrowseQuery,
	type MediaCleanUpQuery,
	MediaLibraryGateway,
} from '@core/media-library/media-library.gateway';

/** Every Media page query sits under this key, so one change refreshes them all. */
export const MEDIA_LIBRARY_KEY = ['media-library'] as const;

export const mediaBrowseKey = (query: Partial<MediaBrowseQuery>) => [...MEDIA_LIBRARY_KEY, 'browse', query] as const;
export const MEDIA_TREE_KEY = [...MEDIA_LIBRARY_KEY, 'tree'] as const;
export const MEDIA_STORAGE_KEY = [...MEDIA_LIBRARY_KEY, 'storage'] as const;

/** One view of the Media page: a folder, a search, a category, Recent, Favourites or Trash. */
export function injectMediaBrowseQuery(query: () => Partial<MediaBrowseQuery>, enabled: () => boolean = () => true) {
	const gateway = inject(MediaLibraryGateway);
	return injectQuery(() => ({
		queryKey: mediaBrowseKey(query()),
		queryFn: () => lastValueFrom(gateway.browse(query())),
		enabled: enabled(),
		// Moving between folders keeps the last view on screen until the next arrives: no flicker.
		placeholderData: (previous) => previous,
	}));
}

/** The folder tree for the sidebar (A36). */
export function injectMediaTreeQuery() {
	const gateway = inject(MediaLibraryGateway);
	return injectQuery(() => ({ queryKey: MEDIA_TREE_KEY, queryFn: () => lastValueFrom(gateway.tree()) }));
}

/** The storage box (A46) and its details (A47). */
export function injectMediaStorageQuery(enabled: () => boolean = () => true) {
	const gateway = inject(MediaLibraryGateway);
	return injectQuery(() => ({
		queryKey: MEDIA_STORAGE_KEY,
		queryFn: () => lastValueFrom(gateway.storage()),
		staleTime: 60_000,
		enabled: enabled(),
	}));
}

/** Activity (S9, A43), one page at a time. */
export function injectMediaActivityQuery(page: () => number, enabled: () => boolean) {
	const gateway = inject(MediaLibraryGateway);
	return injectQuery(() => ({
		queryKey: [...MEDIA_LIBRARY_KEY, 'activity', page()] as const,
		queryFn: () => lastValueFrom(gateway.activity(page())),
		enabled: enabled(),
	}));
}

/** A file's share links and public address (A35–A35D). */
export function injectShareLinksQuery(fileId: () => string | null) {
	const gateway = inject(MediaLibraryGateway);
	return injectQuery(() => ({
		queryKey: [...MEDIA_LIBRARY_KEY, 'links', fileId()] as const,
		queryFn: () => lastValueFrom(gateway.links(fileId() as string)),
		enabled: !!fileId(),
	}));
}

/** Clean up › Email pictures (A50): one filter's page. */
/** The nightly Spaces check's last result (R5-5): read once an hour at most. */
export function injectNightlyCheckQuery(enabled: () => boolean = () => true) {
	const gateway = inject(MediaLibraryGateway);
	return injectQuery(() => ({
		queryKey: [...MEDIA_LIBRARY_KEY, 'nightly-check'] as const,
		queryFn: () => lastValueFrom(gateway.nightlyCheck()),
		staleTime: 3_600_000,
		enabled: enabled(),
	}));
}

/** Clean up's other lists (A44), one page at a time. */
export function injectCleanUpQuery(query: () => MediaCleanUpQuery) {
	const gateway = inject(MediaLibraryGateway);
	return injectQuery(() => ({
		queryKey: [...MEDIA_LIBRARY_KEY, 'clean-up', query()] as const,
		queryFn: () => lastValueFrom(gateway.cleanUp(query())),
		placeholderData: (previous) => previous,
	}));
}

export function injectEmailPicturesQuery(query: () => EmailPictureQuery) {
	const gateway = inject(MediaLibraryGateway);
	return injectQuery(() => ({
		queryKey: [...MEDIA_LIBRARY_KEY, 'email-pictures', query()] as const,
		queryFn: () => lastValueFrom(gateway.emailPictures(query())),
		placeholderData: (previous) => previous,
	}));
}
