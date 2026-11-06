import { isPlatformBrowser } from '@angular/common';
import { HttpRequest } from '@angular/common/http';
import { InjectionToken, PLATFORM_ID, TransferState, inject, makeStateKey } from '@angular/core';

import { QueryClient, hydrate, type DehydratedState } from '@tanstack/angular-query-experimental';

export const QUERY_STATE = makeStateKey<DehydratedState>('st-query-state');

/** Fresh long enough that a hydrated page does not refetch what the server just read. */
const STALE_TIME_MS = 30_000;

/**
 * Query roots whose data is public catalogue or content, and so safe to ship in the
 * server HTML. Anything else, including every account, cart, order and wallet query,
 * stays out: an allow-list fails closed when a new personal query is added.
 */
const PUBLIC_QUERY_ROOTS = new Set([
	'catalog',
	'categories',
	'blogs',
	'banners',
	'static-page',
	'faqs',
	'tags',
	'attributes',
	'countries',
	'states',
	'currencies',
	'reviews',
	'qna',
]);

export const isPublicQuery = (queryKey: readonly unknown[]): boolean =>
	typeof queryKey[0] === 'string' && PUBLIC_QUERY_ROOTS.has(queryKey[0]);

/**
 * Public GETs the HTTP transfer cache may replay in the browser.
 */
const PUBLIC_REQUESTS = [
	/\/catalog\//,
	/\/storefront\/(banners|youtube)\b/,
	/\/config\.json$/,
	/\/assets\/i18n\/[a-z]{2}\.json$/,
	/\/assets\/data\/(setting|site-config|theme-option|menu|category|currency|blog|tag|country|state|attribute|page)\.json$/,
	/\/assets\/data\/pages\/[a-z0-9-]+\.json$/,
];

export const isPublicRequest = (request: HttpRequest<unknown>): boolean =>
	!request.withCredentials && PUBLIC_REQUESTS.some((pattern) => pattern.test(request.url));

/**
 * One QueryClient per application injector, so every server render gets its own cache.
 * A module-level client was shared by every request: it kept serving a product after it
 * was disabled and grew until the dev server ran out of memory.
 */
export const QUERY_CLIENT = new InjectionToken<QueryClient>('st QueryClient', {
	providedIn: 'root',
	factory: () => {
		const browser = isPlatformBrowser(inject(PLATFORM_ID));
		const client = new QueryClient({
			defaultOptions: { queries: { staleTime: STALE_TIME_MS, retry: browser ? 3 : false } },
		});
		if (browser) {
			const transfer = inject(TransferState);
			const state = transfer.get(QUERY_STATE, null);
			if (state) {
				hydrate(client, state);
				transfer.remove(QUERY_STATE);
			}
		}
		return client;
	},
});
