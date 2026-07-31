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

/** Cookies are only marked `Secure` where the browser can actually deliver them. */
export function isSecureContext(config: AppConfig): boolean {
	return config.nodeEnv === 'production';
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
 * Deliberately NOT `httpOnly`: the double-submit pattern requires the browser app to
 * read this value and echo it in a header, which is precisely what a cross-site attacker
 * cannot do — they can make the browser SEND cookies, but the same-origin policy stops
 * them reading one. It is a CSRF token, not a credential: on its own it authenticates
 * nothing.
 */
export function csrfCookieOptions(config: AppConfig): CookieSerializeOptions {
	return {
		httpOnly: false,
		secure: isSecureContext(config),
		sameSite: 'lax',
		path: '/',
		...(useHostPrefix(config) ? {} : config.cookies.domain ? { domain: config.cookies.domain } : {}),
	};
}

/** Every cookie name this API sets, resolved for the current environment. */
export function cookieNames(config: AppConfig): { access: string; refresh: string; csrf: string } {
	return {
		access: cookieName(config.cookies.accessName, config),
		refresh: cookieName(config.cookies.refreshName, config),
		csrf: cookieName(config.cookies.csrfName, config),
	};
}
