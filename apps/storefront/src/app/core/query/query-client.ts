import { isPlatformBrowser } from '@angular/common';
import { HttpErrorResponse, HttpRequest } from '@angular/common/http';
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
	// Contact Us store cards: without them the browser's first render differs from the
	// server's and hydration can leave a card on the page twice.
	'store-locations',
	// The Brand Kit logo and seal in the header, footer and store cards.
	'brand',
	// The channel's videos and Shorts on /videos and the home rail.
	'youtube',
	// A page's live Page Builder layout: the browser must draw what the server drew, or it redraws the page.
	'page-layout',
]);

export const isPublicQuery = (queryKey: readonly unknown[]): boolean =>
	typeof queryKey[0] === 'string' && PUBLIC_QUERY_ROOTS.has(queryKey[0]);

/**
 * Public GETs the HTTP transfer cache may replay in the browser.
 */
const PUBLIC_REQUESTS = [
	/\/catalog\//,
	/\/storefront\/(banners|youtube|pages)\b/,
	/\/config\.json$/,
	/\/assets\/i18n\/[a-z]{2}\.json$/,
	/\/assets\/data\/(setting|site-config|theme-option|menu|category|currency|blog|tag|country|state|attribute|page)\.json$/,
	/\/assets\/data\/pages\/[a-z0-9-]+\.json$/,
];

export const isPublicRequest = (request: HttpRequest<unknown>): boolean =>
	!request.withCredentials && PUBLIC_REQUESTS.some((pattern) => pattern.test(request.url));

/** A 4xx is the API's answer, not a hiccup: asking again gets the same one. */
const isRefusal = (error: unknown): boolean =>
	error instanceof HttpErrorResponse && error.status >= 400 && error.status < 500;

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
			defaultOptions: {
				queries: {
					staleTime: STALE_TIME_MS,
					retry: (count, error) => browser && count < 3 && !isRefusal(error),
				},
			},
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
