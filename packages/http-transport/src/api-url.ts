/**
 * Base-URL resolution for API calls.
 *
 * Both apps read `apiUrl` from their runtime `public/config.json` at app init, so the base
 * is a deploy-time value joined to a compile-time route path. Doing that with template
 * strings scattered through the app is how a double slash, or worse an absolute URL, ends up
 * in a request.
 */

/**
 * Joins a configured base URL and an API route path.
 *
 * `path` MUST be a relative route. An absolute URL or a protocol-relative `//host` path is
 * rejected rather than passed through, because requests from these apps carry
 * `withCredentials: true`: a path that silently became another origin would attempt to send
 * session cookies there. The same guard makes an unvalidated value from a response or a
 * query parameter unusable as a route.
 *
 * A trailing slash on the base and a leading slash on the path are normalized so callers
 * need not agree on a convention.
 */
export function joinApiUrl(baseUrl: string, path: string): string {
	if (isAbsoluteOrProtocolRelative(path)) {
		throw new Error(`API route path must be relative, received "${path}"`);
	}

	const base = baseUrl.replace(/\/+$/, '');
	const suffix = path.replace(/^\/+/, '');
	return suffix ? `${base}/${suffix}` : base;
}

/**
 * Whether a value is safe to use as an API route path.
 *
 * Exposed so a caller can check without catching: `joinApiUrl` throws on purpose (a bad
 * route is a programming error, not a runtime condition), but a value arriving from
 * configuration or a redirect target deserves a boolean.
 */
export function isRelativeApiPath(path: string): boolean {
	return !isAbsoluteOrProtocolRelative(path);
}

/**
 * Matches `http://`, `https://`, any other `scheme:` form, and protocol-relative `//host`.
 *
 * Backslashes are treated as slashes because browsers normalize `\\host` to `//host` in
 * URLs — a rule that has repeatedly turned "we block `//`" checks into open redirects.
 */
function isAbsoluteOrProtocolRelative(path: string): boolean {
	const normalized = path.replace(/\\/g, '/');
	return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(normalized) || normalized.startsWith('//');
}
