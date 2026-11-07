/**
 * Double-submit CSRF policy for cookie-authenticated browser calls.
 *
 * The API returns the token in the body of its CSRF route and also sets it as a cookie; the
 * client echoes the returned value in the `x-csrf-token` header. The client must NOT read the
 * cookie: in every deployment the cookie belongs to the API host (`__Host-` prefix, no
 * `Domain`), so `document.cookie` on the storefront or admin host can never see it. It only
 * ever looked readable on `localhost`, where all ports count as one host.
 *
 * This module holds the POLICY, not the wiring. Each app's HTTP interceptor decides when to
 * call it; nothing here knows about Angular, RxJS or a particular app's routes.
 */

/** Header the API reads the echoed token from. Must match `CSRF_HEADER_NAME` in the API. */
export const CSRF_HEADER_NAME = 'x-csrf-token';

/** Methods the API treats as safe, and therefore does not CSRF-protect. */
const SAFE_METHODS: readonly string[] = ['GET', 'HEAD', 'OPTIONS'];

/** Methods the API treats as state-changing, and therefore CSRF-protected. */
export function isUnsafeMethod(method: string): boolean {
	return !SAFE_METHODS.includes(method.toUpperCase());
}

/**
 * The current CSRF token, held in memory only.
 *
 * Memory is enough because the token is cheap to get back: a reload starts empty and the app
 * asks the API again, and a token another tab rotated is refused once and re-fetched. Each
 * app provides one instance per application (per request under SSR), never a module-level
 * one, because a server process must not share a token between visitors.
 */
export class CsrfTokenHolder {
	private token: string | null = null;
	private inFlight: Promise<void> | null = null;

	current(): string | null {
		return this.token;
	}

	remember(token: string): void {
		this.token = token;
	}

	/**
	 * Runs one fetch for all concurrent callers.
	 *
	 * Not an optimisation: when the API's stored token no longer matches, each fetch rotates
	 * it, so two racing fetches could leave this tab holding the one that lost.
	 */
	acquire(fetchToken: () => Promise<void>): Promise<void> {
		this.inFlight ??= fetchToken().finally(() => {
			this.inFlight = null;
		});
		return this.inFlight;
	}
}

/**
 * Whether this runtime has a browser cookie jar at all.
 *
 * Server rendering has no jar to populate and no user agent to carry cookies, so session
 * recovery there is meaningless rather than merely missing a value. Without this check SSR
 * would issue requests it can never benefit from.
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
