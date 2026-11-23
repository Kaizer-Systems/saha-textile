import { defineEventHandler, setResponseHeaders } from 'h3';

import { hiddenFromSearch } from '../search-visibility';

/**
 * On staging and a development server every shop answer says `noindex, nofollow`, so a search engine that reaches it
 * (past the login wall, or after the wall is switched off) lists nothing; `robots.txt` also asks crawlers to stay out
 * (seo-files.ts). Production answers are untouched. Keep this file free of TypeScript-only syntax: the dev server
 * loads middleware without compiling it.
 */
export default defineEventHandler((event) => {
	if (hiddenFromSearch()) setResponseHeaders(event, { 'X-Robots-Tag': 'noindex, nofollow' });
});
