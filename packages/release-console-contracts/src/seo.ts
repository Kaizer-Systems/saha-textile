import { z } from 'zod';

/**
 * Search engines, our own checks (brief 26gq3NbcbBESea6abRtsa3, screen 5): the sitemap crawled
 * politely by the Mac helper, and the shop's "page not found" answers counted from the edge's request
 * log. Google's own figures wait for the Search Console key. Names, paths and counts only: no query
 * strings, no visitor data, only the host a visitor came from.
 */

/** Start a sitemap check for one environment of a repository; the API finds that environment's site. */
export const sitemapCheckSchema = z.object({
	projectId: z.string().min(1).max(80),
	repositoryId: z.string().min(1).max(80),
	environment: z.string().min(1).max(40),
});
export type SitemapCheck = z.infer<typeof sitemapCheckSchema>;

/** What one sitemap check found: counts by answer, and the pages that did not answer 200. */
export const sitemapResultSchema = z.object({
	origin: z.string(),
	sitemap: z.string(),
	at: z.string(),
	listed: z.number().int(),
	checked: z.number().int(),
	ok: z.number().int(),
	redirects: z.number().int(),
	notFound: z.number().int(),
	other: z.number().int(),
	/** Up to 50 paths that did not answer 200, with what they answered (0 = no answer). */
	failures: z.array(z.object({ path: z.string(), status: z.number().int() })),
	/** Every path the sitemap lists (up to the page cap), so the 404 table can say "in the sitemap". */
	paths: z.array(z.string()),
	note: z.string(),
});
export type SitemapResult = z.infer<typeof sitemapResultSchema>;

/** The shop's "page not found" answers in the last hours, by path and where visitors came from. */
export const notFoundQuerySchema = z.object({
	hours: z.coerce.number().int().min(1).max(168).default(24),
});
export const notFoundViewSchema = z.object({
	source: z.enum(['edge', 'none']),
	since: z.string(),
	total: z.number().int(),
	paths: z.array(
		z.object({
			route: z.string(),
			count: z.number().int(),
			/** Hosts visitors came from (the referrer's host only), most frequent first. */
			from: z.array(z.string()),
			lastAt: z.string(),
		}),
	),
});
export type NotFoundView = z.infer<typeof notFoundViewSchema>;
