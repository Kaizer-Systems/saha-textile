/** Server environments whose shop search engines must never list: only production is public (owner, 2026-11-24). */
const HIDDEN_ENVIRONMENTS = ['staging', 'development'];

/**
 * Whether this shop is kept out of search engines: on staging and a development server. Production is listed, and a
 * run on this computer is unreachable from outside, so it keeps the production behaviour its tests check. Keep this
 * file free of TypeScript-only syntax: middleware imports it.
 */
export function hiddenFromSearch() {
	const env = typeof process === 'undefined' ? undefined : process.env;
	return HIDDEN_ENVIRONMENTS.includes(env?.['DEPLOY_ENV'] ?? '');
}
