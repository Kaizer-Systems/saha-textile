import { ForbiddenException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { describe, expect, it } from 'vitest';

import { cookieName, cookieNames, csrfCookieOptions, sessionCookieOptions, useHostPrefix } from '../src/common/cookies';
import { CsrfGuard } from '../src/common/csrf.guard';
import type { SessionService } from '../src/auth/session.service';
import { loadConfig } from '../src/config/app-config';

const config = (overrides: NodeJS.ProcessEnv = {}) =>
	loadConfig({ JWT_ACCESS_SECRET: 'a'.repeat(32), JWT_REFRESH_SECRET: 'b'.repeat(32), ...overrides });

const dev = config();
const prod = config({ NODE_ENV: 'production' });
const prodWithDomain = config({ NODE_ENV: 'production', COOKIE_DOMAIN: '.sahatextile.com' });
/** The only way to get insecure cookies now: an explicit, visible opt-out. */
const insecureOptOut = config({ COOKIE_SECURE: 'false' });

describe('cookie attributes', () => {
	it('marks session cookies httpOnly and same-site lax', () => {
		const options = sessionCookieOptions(dev);
		expect(options.httpOnly).toBe(true);
		expect(options.sameSite).toBe('lax');
		expect(options.path).toBe('/');
	});

	it('leaves the CSRF cookie readable — double-submit requires the app to echo it', () => {
		expect(csrfCookieOptions(dev).httpOnly).toBe(false);
	});

	/**
	 * The property that replaced "Secure in production only" on 2026-08-15.
	 *
	 * Deriving this from `NODE_ENV` meant development ran a second cookie model nobody
	 * exercised — no `Secure`, no `__Host-` — so the production attributes were first
	 * executed in production. Local development now serves TLS, and the default is `true`
	 * everywhere: a forgotten variable fails CLOSED.
	 */
	it('marks cookies Secure by default, in every environment', () => {
		expect(sessionCookieOptions(dev).secure).toBe(true);
		expect(sessionCookieOptions(prod).secure).toBe(true);
		expect(csrfCookieOptions(dev).secure).toBe(true);
		expect(csrfCookieOptions(prod).secure).toBe(true);
	});

	it('drops Secure only for an explicit COOKIE_SECURE=false opt-out', () => {
		expect(sessionCookieOptions(insecureOptOut).secure).toBe(false);
		expect(csrfCookieOptions(insecureOptOut).secure).toBe(false);
	});

	/**
	 * `z.coerce.boolean()` would make the STRING `'false'` truthy, so an operator disabling
	 * the flag would have silently enabled it. Pinned because the failure is invisible.
	 */
	it('reads COOKIE_SECURE=false as false, not as a truthy string', () => {
		expect(config({ COOKIE_SECURE: 'false' }).cookies.secure).toBe(false);
		expect(config({ COOKIE_SECURE: 'true' }).cookies.secure).toBe(true);
		expect(config({}).cookies.secure).toBe(true);
	});

	it('uses the __Host- prefix in production without a pinned domain', () => {
		expect(useHostPrefix(prod)).toBe(true);
		expect(cookieName('st_access', prod)).toBe('__Host-st_access');
		expect(cookieNames(prod)).toEqual({
			access: '__Host-st_access',
			refresh: '__Host-st_refresh',
			csrf: '__Host-st_csrf',
			guest: '__Host-st_guest',
			// Ties an in-progress signup to one browser before any account exists
			// (`DEC-SIGNUP-VERIFICATION`). Prefixed like the rest: it locates the server's
			// record of what a visitor has proven, so it must not be settable by a subdomain.
			signup: '__Host-st_signup',
		});
	});

	it('drops the prefix when a domain is pinned, because __Host- forbids Domain', () => {
		expect(useHostPrefix(prodWithDomain)).toBe(false);
		expect(cookieName('st_access', prodWithDomain)).toBe('st_access');
		expect(sessionCookieOptions(prodWithDomain).domain).toBe('.sahatextile.com');
	});

	it('never emits Domain alongside a __Host- name', () => {
		expect(sessionCookieOptions(prod).domain).toBeUndefined();
		expect(csrfCookieOptions(prod).domain).toBeUndefined();
	});

	/**
	 * Development now gets the SAME prefixed names as production, because it serves TLS.
	 * The plain spelling survives only for the explicit insecure opt-out, where `__Host-`
	 * would be rejected by the browser outright.
	 */
	it('uses the prefixed name in development too, now that development is HTTPS', () => {
		expect(cookieName('st_csrf', dev)).toBe('__Host-st_csrf');
		expect(cookieName('st_csrf', insecureOptOut)).toBe('st_csrf');
		expect(useHostPrefix(insecureOptOut)).toBe(false);
	});
});

describe('CsrfGuard', () => {
	const contextFor = (request: Partial<FastifyRequest> & { cookies?: Record<string, string> }) =>
		({ switchToHttp: () => ({ getRequest: () => request }) }) as unknown as ExecutionContext;

	const liveSession = {
		id: 'sess_live',
		csrfSecretHash: 'hash',
	};

	const sessionsStub = {
		resolveLiveSessionFromRequest: async () => liveSession,
		verifyCsrfForSession: () => true,
	} as unknown as SessionService;

	const guard = new CsrfGuard(dev, sessionsStub);
	const names = cookieNames(dev);

	it('allows safe methods without a token', async () => {
		for (const method of ['GET', 'HEAD', 'OPTIONS']) {
			await expect(
				guard.canActivate(contextFor({ method, headers: {}, cookies: { [names.access]: 'session' } })),
			).resolves.toBe(true);
		}
	});

	it('allows an unsafe method when there is no session to forge', async () => {
		await expect(guard.canActivate(contextFor({ method: 'POST', headers: {}, cookies: {} }))).resolves.toBe(true);
	});

	it('rejects a session-bearing unsafe request with no token at all', async () => {
		await expect(
			guard.canActivate(contextFor({ method: 'POST', headers: {}, cookies: { [names.access]: 'session' } })),
		).rejects.toThrow(ForbiddenException);
	});

	it('rejects when the header is missing but the cookie is present', async () => {
		await expect(
			guard.canActivate(
				contextFor({
					method: 'POST',
					headers: {},
					cookies: { [names.access]: 'session', [names.csrf]: 'token' },
				}),
			),
		).rejects.toThrow(ForbiddenException);
	});

	it('rejects when the header does not match the cookie', async () => {
		await expect(
			guard.canActivate(
				contextFor({
					method: 'POST',
					headers: { 'x-csrf-token': 'a-different-token' },
					cookies: { [names.access]: 'session', [names.csrf]: 'token' },
				}),
			),
		).rejects.toThrow(ForbiddenException);
	});

	it('accepts a matching double-submit pair bound to a live session', async () => {
		await expect(
			guard.canActivate(
				contextFor({
					method: 'POST',
					headers: { 'x-csrf-token': 'matching-token' },
					cookies: { [names.access]: 'session', [names.csrf]: 'matching-token' },
				}),
			),
		).resolves.toBe(true);
	});

	it('fails closed when session credentials are present but no live session resolves', async () => {
		const failClosed = new CsrfGuard(dev, {
			resolveLiveSessionFromRequest: async () => null,
			verifyCsrfForSession: () => true,
		} as unknown as SessionService);

		await expect(
			failClosed.canActivate(
				contextFor({
					method: 'POST',
					headers: { 'x-csrf-token': 'matching-token' },
					cookies: { [names.access]: 'session', [names.csrf]: 'matching-token' },
				}),
			),
		).rejects.toThrow(ForbiddenException);
	});

	it('rejects a CSRF token that does not belong to the resolved session', async () => {
		const rebound = new CsrfGuard(dev, {
			resolveLiveSessionFromRequest: async () => liveSession,
			verifyCsrfForSession: () => false,
		} as unknown as SessionService);

		await expect(
			rebound.canActivate(
				contextFor({
					method: 'POST',
					headers: { 'x-csrf-token': 'session-a-token' },
					cookies: { [names.access]: 'session-b', [names.csrf]: 'session-a-token' },
				}),
			),
		).rejects.toThrow(ForbiddenException);
	});

	it('enforces on every state-changing method, not just POST', async () => {
		for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
			await expect(
				guard.canActivate(contextFor({ method, headers: {}, cookies: { [names.refresh]: 'session' } })),
			).rejects.toThrow(ForbiddenException);
		}
	});

	it('treats a refresh cookie alone as a session worth protecting', async () => {
		await expect(
			guard.canActivate(contextFor({ method: 'POST', headers: {}, cookies: { [names.refresh]: 'session' } })),
		).rejects.toThrow(ForbiddenException);
	});
});
