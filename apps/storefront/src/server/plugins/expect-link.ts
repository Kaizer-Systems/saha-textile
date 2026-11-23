import { type H3Event, getRequestURL, getResponseStatus } from 'h3';

import { anchorExpectLink } from '../expect-link';

interface NitroAppLike {
	hooks: { hook(name: 'beforeResponse', fn: (event: H3Event, response: { body?: unknown }) => void): void };
}

/**
 * Gives each server-drawn page's expect link the page's own address (see `../expect-link.ts`). Only pages answered
 * as asked: a page drawn under another address (the 410 page) keeps the bare link, which the browser ignores.
 */
export default function expectLink(nitroApp: NitroAppLike): void {
	nitroApp.hooks.hook('beforeResponse', (event, response) => {
		if (typeof response.body !== 'string' || getResponseStatus(event) !== 200) return;
		const url = getRequestURL(event);
		response.body = anchorExpectLink(response.body, `${url.pathname}${url.search}`);
	});
}
