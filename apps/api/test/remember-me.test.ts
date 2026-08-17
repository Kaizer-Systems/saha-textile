import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import type { AuthSession } from '@saha-textile/contracts';

import { cookieNames } from '../src/common/cookies';

import {
	ADMIN_IDLE_TTL_SECONDS,
	STOREFRONT_IDLE_TTL_SECONDS,
	STOREFRONT_TRANSIENT_IDLE_TTL_SECONDS,
	SessionService,
} from '../src/auth/session.service';
import { loadConfig } from '../src/config/app-config';

/**
 * "Remember me" has to move BOTH halves or it is decoration.
 *
 * The visible half is the cookie: dated, so the browser keeps it across restarts, or undated,
 * so it dies with the window. The half that actually matters is the server-side idle TTL — if
 * only the cookie were shortened, a refresh token lifted off the wire would still be honoured
 * for the full thirty days, which is precisely what somebody declining "remember me" on a
 * shared machine is trying to avoid.
 *
 * The subtle one is rotation. A refresh re-issues the cookie, so a rotation that recomputed the
 * TTL from the audience alone would silently promote a browser-session login into a remembered
 * one on its first renewal, and the person would never see it happen.
 */

const config = loadConfig({
	JWT_ACCESS_SECRET: 'a'.repeat(32),
	JWT_REFRESH_SECRET: 'b'.repeat(32),
	CSRF_SECRET: 'c'.repeat(32),
});

/** Records what was written rather than serialising a real response. */
function recordingReply() {
	const cookies: { name: string; options: { maxAge?: number } }[] = [];
	const reply = {
		setCookie(name: string, _value: string, options: { maxAge?: number }) {
			cookies.push({ name, options });
			return reply;
		},
	};
	return { reply, cookies };
}

const request = { headers: { 'user-agent': 'probe' }, ip: '203.0.113.7' };

function serviceWith(onCreate: (session: AuthSession) => void) {
	const sessions = {
		create: async (session: AuthSession) => {
			onCreate(session);
			return session;
		},
	};
	const auth = { signAccessToken: async () => 'access-token' };
	return new SessionService(config, auth as never, sessions as never, {} as never, {} as never);
}

async function establish(audience: 'storefront' | 'admin', persistent?: boolean) {
	let created: AuthSession | null = null;
	const { reply, cookies } = recordingReply();
	const service = serviceWith((session) => (created = session));

	await service.establish({
		user: { id: 'cus_1', role: null, tokenVersion: 0, permissionsVersion: 0 },
		audience,
		request: request as never,
		reply: reply as never,
		...(persistent === undefined ? {} : { persistent }),
	});

	const session = created as unknown as AuthSession;
	const idleSeconds = Math.round(
		(new Date(session.expiresAt).getTime() - new Date(session.createdAt).getTime()) / 1000,
	);
	return { session, cookies, idleSeconds };
}

/** The access and refresh cookies; the CSRF cookie is undated by design either way. */
const sessionCookies = (cookies: { name: string; options: { maxAge?: number } }[]) =>
	cookies.filter((cookie) => !cookie.name.toLowerCase().includes('csrf'));

describe('remember me', () => {
	it('gives a remembered session a dated cookie and the long idle TTL', async () => {
		const { session, cookies, idleSeconds } = await establish('storefront', true);

		expect(session.persistent).toBe(true);
		expect(idleSeconds).toBe(STOREFRONT_IDLE_TTL_SECONDS);
		for (const cookie of sessionCookies(cookies)) expect(cookie.options.maxAge).toBeGreaterThan(0);
	});

	it('gives a declined session a session cookie AND a short idle TTL', async () => {
		const { session, cookies, idleSeconds } = await establish('storefront', false);

		expect(session.persistent).toBe(false);
		// The half that matters: a captured refresh token expires in a day, not a month.
		expect(idleSeconds).toBe(STOREFRONT_TRANSIENT_IDLE_TTL_SECONDS);
		expect(idleSeconds).toBeLessThan(STOREFRONT_IDLE_TTL_SECONDS);
		// `undefined`, not 0 — a zero max-age would delete the cookie outright.
		for (const cookie of sessionCookies(cookies)) expect(cookie.options.maxAge).toBeUndefined();
	});

	/**
	 * An omitted answer must read as "no". A caller that forgets to pass the flag should hand
	 * out a browser session, never a month on somebody else's machine.
	 */
	it('treats an absent choice as declined', async () => {
		const { session, cookies, idleSeconds } = await establish('storefront');

		expect(session.persistent).toBe(false);
		expect(idleSeconds).toBe(STOREFRONT_TRANSIENT_IDLE_TTL_SECONDS);
		for (const cookie of sessionCookies(cookies)) expect(cookie.options.maxAge).toBeUndefined();
	});

	/** Operators have no such control; the hour bounds them whatever the flag says. */
	it('leaves the admin idle TTL alone in both directions', async () => {
		const remembered = await establish('admin', true);
		const declined = await establish('admin', false);

		expect(remembered.idleSeconds).toBe(ADMIN_IDLE_TTL_SECONDS);
		expect(declined.idleSeconds).toBe(ADMIN_IDLE_TTL_SECONDS);
	});

	/**
	 * The regression this pass could most easily have shipped: rotation must carry the original
	 * choice forward rather than recomputing it from the audience.
	 *
	 * Driven through the real `refresh()` rather than a shortcut, because the point is that the
	 * production path reads `current.persistent`. `rotate` is stubbed to resolve null, so the
	 * call refuses immediately AFTER recording the expiry it asked for — which is the value
	 * under test.
	 */
	it.each([
		['declined', false, STOREFRONT_TRANSIENT_IDLE_TTL_SECONDS],
		['remembered', true, STOREFRONT_IDLE_TTL_SECONDS],
	])('carries a %s session forward across rotation', async (_label, persistent, expectedTtl) => {
		const refreshToken = 'opaque-refresh-token';
		const refreshTokenHash = createHmac('sha256', 'c'.repeat(32)).update(refreshToken).digest('hex');
		let rotatedExpiry: string | null = null;

		const current = {
			id: 'sess_1',
			userId: 'cus_1',
			audience: 'storefront',
			persistent,
			refreshFamilyId: 'fam_1',
			refreshTokenHash,
			revokedAt: null,
			expiresAt: new Date(Date.now() + 60_000).toISOString(),
			absoluteExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
		} as unknown as AuthSession;

		const sessions = {
			findByPreviousRefreshTokenHash: async () => null,
			findByRefreshTokenHash: async () => current,
			rotate: async (input: { expiresAt: string }) => {
				rotatedExpiry = input.expiresAt;
				return null;
			},
			revokeFamily: async () => 1,
		};
		const service = new SessionService(config, {} as never, sessions as never, {} as never, {} as never);
		const { reply } = recordingReply();

		await expect(
			service.refresh({
				request: { ...request, cookies: { [cookieNames(config).refresh]: refreshToken } } as never,
				reply: reply as never,
				audience: 'storefront',
			}),
		).rejects.toThrow();

		const seconds = Math.round((new Date(rotatedExpiry!).getTime() - Date.now()) / 1000);
		expect(Math.abs(seconds - expectedTtl)).toBeLessThan(10);
	});
});
