import type { CookieSerializeOptions } from '@fastify/cookie';

import type { AppConfig } from '../config/app-config';

/**
 * `__Host-` is the strongest cookie prefix a browser enforces: it REFUSES the cookie
 * unless it is Secure, `Path=/`, and carries no `Domain`. That last condition is what
 * makes it valuable — a subdomain (or anything that manages to control one) cannot
 * overwrite the session cookie of the parent site.
 *
 * It therefore only applies when we are on HTTPS and have NOT pinned a cookie domain.
 * Over plain-HTTP localhost the browser would reject the cookie outright, so the plain
 * `st_*` name is used in development (owner lock allows both spellings).
 */
export function useHostPrefix(config: AppConfig): boolean {
	return isSecureContext(config) && !config.cookies.domain;
}

/**
 * Whether session cookies are marked `Secure` — and so whether `__Host-` may be used.
 *
 * Configuration, not environment. This read `config.nodeEnv === 'production'` until
 * 2026-08-15, which meant local development ran a quietly different cookie model: no
 * `Secure`, no `__Host-` prefix, and therefore a production-only code path that nothing
 * outside production ever executed. Local development now serves TLS
 * (`pnpm setup:local-https`), so the honest answer is the configured one, it defaults to
 * `true`, and turning it off is a deliberate `COOKIE_SECURE=false` that shows up in a diff.
 */
export function isSecureContext(config: AppConfig): boolean {
	return config.cookies.secure;
}

/**
 * Resolves the wire name of a cookie, adding the `__Host-` prefix when the conditions
 * that make it valid hold. Callers always pass the compact base name (`st_access`).
 */
export function cookieName(base: string, config: AppConfig): string {
	return useHostPrefix(config) ? `__Host-${base}` : base;
}

/**
 * Attributes for a SESSION cookie: `httpOnly` so no script can read the credential even
 * if the page is XSS'd, `sameSite: lax` so it is not attached to cross-site POSTs (the
 * first line of CSRF defence, with double-submit as the second), and `Secure` outside
 * development. `Domain` is omitted whenever `__Host-` is in play, because the prefix
 * forbids it.
 */
export function sessionCookieOptions(config: AppConfig, maxAgeSeconds?: number): CookieSerializeOptions {
	return {
		httpOnly: true,
		secure: isSecureContext(config),
		sameSite: 'lax',
		path: '/',
		...(useHostPrefix(config) ? {} : config.cookies.domain ? { domain: config.cookies.domain } : {}),
		...(maxAgeSeconds === undefined ? {} : { maxAge: maxAgeSeconds }),
	};
}

/**
 * Attributes for the CSRF cookie.
 *
 * `httpOnly` because no script needs it: the browser app gets the token from the CSRF route's
 * response and echoes that in a header. This cookie is the API's half of the double-submit
 * pair, sent back automatically. It could not be read across hosts anyway, since it belongs
 * to the API host.
 */
export function csrfCookieOptions(config: AppConfig): CookieSerializeOptions {
	return {
		httpOnly: true,
		secure: isSecureContext(config),
		sameSite: 'lax',
		path: '/',
		...(useHostPrefix(config) ? {} : config.cookies.domain ? { domain: config.cookies.domain } : {}),
	};
}

/** Which session a request is about; decided per route by `@Audience` (see `CookieAudienceGuard`). */
export type CookieAudience = 'storefront' | 'admin';

/** Set on the request by `CookieAudienceGuard` before any other guard runs. */
export type RequestWithCookieAudience = { cookieAudience?: CookieAudience };

export const requestCookieAudience = (request: unknown): CookieAudience =>
	(request as RequestWithCookieAudience | null | undefined)?.cookieAudience ?? 'storefront';

/**
 * Admin sessions carry their own cookie names (`st_admin_access`, `st_admin_refresh`,
 * `st_admin_csrf`).
 *
 * Both audiences' cookies are set by the one API host, so they share one browser cookie jar
 * however the apps' own hostnames differ. With shared names, an operator who opened the
 * storefront was signed out of admin: the storefront saw no shopper session, refreshed with
 * the operator's token, was refused, and the refusal cleared the shared cookies (found while
 * testing, 2026-11-02). Separate names make the two sessions independent; the storefront keeps
 * the original names, so existing shopper sessions are unaffected.
 */
const forAudience = (base: string, audience: CookieAudience): string =>
	audience === 'admin' ? (base.startsWith('st_') ? `st_admin_${base.slice(3)}` : `admin_${base}`) : base;

/** Every cookie name this API sets, resolved for the current environment and audience. */
export function cookieNames(
	config: AppConfig,
	audience: CookieAudience = 'storefront',
): {
	access: string;
	refresh: string;
	csrf: string;
	guest: string;
	signup: string;
} {
	return {
		access: cookieName(forAudience(config.cookies.accessName, audience), config),
		refresh: cookieName(forAudience(config.cookies.refreshName, audience), config),
		csrf: cookieName(forAudience(config.cookies.csrfName, audience), config),
		guest: cookieName(config.cookies.guestName, config),
		signup: cookieName(config.cookies.signupName, config),
	};
}
