/**
 * Double-submit CSRF policy for cookie-authenticated browser calls.
 *
 * The API sets the CSRF cookie WITHOUT `httpOnly` precisely so the client can echo it back
 * in the `x-csrf-token` header; on its own it authenticates nothing, which is why exposing
 * it is safe while the session cookies stay `httpOnly`. The API accepts two spellings — the
 * plain `st_csrf` name and the `__Host-st_csrf` prefixed form it uses in HTTPS deployments
 * without a pinned cookie domain — so both are tried rather than assuming one.
 *
 * This module holds the POLICY, not the wiring. Each app's HTTP interceptor decides when to
 * call it; nothing here knows about Angular, RxJS or a particular app's routes.
 */

/** Header the API reads the echoed token from. Must match `CSRF_HEADER_NAME` in the API. */
export const CSRF_HEADER_NAME = 'x-csrf-token';

/**
 * Cookie names the API may have used, most-likely first.
 *
 * `__Host-st_csrf` is only valid when the cookie carries no `Domain` and the connection is
 * HTTPS, so the API falls back to the compact `st_*` spelling when a domain is pinned. A
 * client that knew only one name would silently stop sending the header in one of those
 * deployments and every mutation would 403.
 */
export const CSRF_COOKIE_NAMES = ['st_csrf', '__Host-st_csrf'] as const;

/** Methods the API treats as safe, and therefore does not CSRF-protect. */
const SAFE_METHODS: readonly string[] = ['GET', 'HEAD', 'OPTIONS'];

/** Methods the API treats as state-changing, and therefore CSRF-protected. */
export function isUnsafeMethod(method: string): boolean {
	return !SAFE_METHODS.includes(method.toUpperCase());
}

/**
 * Parses a `document.cookie`-shaped string and returns the first CSRF value found.
 *
 * Pure and jar-in/value-out so it is testable without a DOM. Splitting on a semicolon plus
 * optional whitespace, rather than the literal `'; '`, matters: the separator is only
 * conventionally a space, and a jar written by another library may omit it — in which case
 * the token would be invisible and every mutation would fail closed with no obvious cause.
 *
 * The name is compared exactly (split at the first `=`) rather than by prefix, so a
 * differently-named cookie that merely starts with `st_csrf` can never be mistaken for it.
 */
export function readCsrfTokenFrom(cookieJar: string | null | undefined): string | null {
	if (!cookieJar) return null;

	const entries = cookieJar.split(/;\s*/);
	for (const name of CSRF_COOKIE_NAMES) {
		for (const entry of entries) {
			const separator = entry.indexOf('=');
			if (separator === -1) continue;
			if (entry.slice(0, separator) !== name) continue;

			const raw = entry.slice(separator + 1);
			if (raw === '') return null;
			return safeDecode(raw);
		}
	}
	return null;
}

/**
 * Reads the CSRF cookie from the ambient browser jar, or `null` when there is none.
 *
 * Returns `null` under SSR by construction: there is no cookie jar during server rendering,
 * and an unsafe request does not originate there. Reached through `globalThis` with a narrow
 * local type so this package needs no `DOM` lib and stays compilable in a Node test run.
 */
export function readCsrfToken(): string | null {
	return readCsrfTokenFrom(ambientCookieJar());
}

/**
 * Whether this runtime has a browser cookie jar at all.
 *
 * Distinct from "is there a CSRF cookie": an empty jar in a browser is recoverable — the app
 * can ask the API for a token — whereas server rendering has no jar to populate and no user
 * agent to carry cookies, so session recovery there is meaningless rather than merely
 * missing a value. Collapsing the two makes SSR issue requests it can never benefit from.
 */
export function hasBrowserCookieJar(): boolean {
	return ambientCookieJar() !== null;
}

interface CookieCarrier {
	readonly cookie?: unknown;
}

function ambientCookieJar(): string | null {
	const doc = (globalThis as { document?: CookieCarrier }).document;
	return typeof doc?.cookie === 'string' ? doc.cookie : null;
}

/**
 * A cookie value is percent-encoded by the API, but a malformed jar must not throw out of an
 * interceptor and take down an otherwise fine request; an undecodable value is treated as
 * absent so the request fails closed at the API instead of failing hard in the browser.
 */
function safeDecode(value: string): string | null {
	try {
		return decodeURIComponent(value);
	} catch {
		return null;
	}
}
