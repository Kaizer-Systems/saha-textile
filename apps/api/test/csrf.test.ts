import { ForbiddenException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { describe, expect, it } from 'vitest';

import { cookieName, cookieNames, csrfCookieOptions, sessionCookieOptions, useHostPrefix } from '../src/common/cookies';
import { CsrfGuard } from '../src/common/csrf.guard';
import { loadConfig } from '../src/config/app-config';

const config = (overrides: NodeJS.ProcessEnv = {}) =>
	loadConfig({ JWT_ACCESS_SECRET: 'a'.repeat(32), JWT_REFRESH_SECRET: 'b'.repeat(32), ...overrides });

const dev = config();
const prod = config({ NODE_ENV: 'production' });
const prodWithDomain = config({ NODE_ENV: 'production', COOKIE_DOMAIN: '.sahatextile.com' });

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

	it('marks cookies Secure only where the browser can deliver them', () => {
		expect(sessionCookieOptions(dev).secure).toBe(false);
		expect(sessionCookieOptions(prod).secure).toBe(true);
		expect(csrfCookieOptions(prod).secure).toBe(true);
	});

	it('uses the __Host- prefix in production without a pinned domain', () => {
		expect(useHostPrefix(prod)).toBe(true);
		expect(cookieName('st_access', prod)).toBe('__Host-st_access');
		expect(cookieNames(prod)).toEqual({
			access: '__Host-st_access',
			refresh: '__Host-st_refresh',
			csrf: '__Host-st_csrf',
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

	it('keeps the plain name in development, where __Host- would be rejected over HTTP', () => {
		expect(cookieName('st_csrf', dev)).toBe('st_csrf');
	});
});

describe('CsrfGuard', () => {
	const contextFor = (request: Partial<FastifyRequest> & { cookies?: Record<string, string> }) =>
		({ switchToHttp: () => ({ getRequest: () => request }) }) as unknown as ExecutionContext;

	const guard = new CsrfGuard(dev);
	const names = cookieNames(dev);

	it('allows safe methods without a token', () => {
		for (const method of ['GET', 'HEAD', 'OPTIONS']) {
			expect(guard.canActivate(contextFor({ method, headers: {}, cookies: { [names.access]: 'session' } }))).toBe(
				true,
			);
		}
	});

	it('allows an unsafe method when there is no session to forge', () => {
		expect(guard.canActivate(contextFor({ method: 'POST', headers: {}, cookies: {} }))).toBe(true);
	});

	it('rejects a session-bearing unsafe request with no token at all', () => {
		expect(() =>
			guard.canActivate(contextFor({ method: 'POST', headers: {}, cookies: { [names.access]: 'session' } })),
		).toThrow(ForbiddenException);
	});

	it('rejects when the header is missing but the cookie is present', () => {
		expect(() =>
			guard.canActivate(
				contextFor({
					method: 'POST',
					headers: {},
					cookies: { [names.access]: 'session', [names.csrf]: 'token' },
				}),
			),
		).toThrow(ForbiddenException);
	});

	it('rejects when the header does not match the cookie', () => {
		expect(() =>
			guard.canActivate(
				contextFor({
					method: 'POST',
					headers: { 'x-csrf-token': 'a-different-token' },
					cookies: { [names.access]: 'session', [names.csrf]: 'token' },
				}),
			),
		).toThrow(ForbiddenException);
	});

	it('accepts a matching double-submit pair', () => {
		expect(
			guard.canActivate(
				contextFor({
					method: 'POST',
					headers: { 'x-csrf-token': 'matching-token' },
					cookies: { [names.access]: 'session', [names.csrf]: 'matching-token' },
				}),
			),
		).toBe(true);
	});

	it('enforces on every state-changing method, not just POST', () => {
		for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
			expect(() =>
				guard.canActivate(contextFor({ method, headers: {}, cookies: { [names.refresh]: 'session' } })),
			).toThrow(ForbiddenException);
		}
	});

	it('treats a refresh cookie alone as a session worth protecting', () => {
		expect(() =>
			guard.canActivate(contextFor({ method: 'POST', headers: {}, cookies: { [names.refresh]: 'session' } })),
		).toThrow(ForbiddenException);
	});
});
