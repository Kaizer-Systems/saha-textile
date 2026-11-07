import { describe, expect, it } from 'vitest';

import type { PendingSignup } from '@saha-textile/core-domain';

import { SignupService } from '../src/auth/signup.service';
import { StorefrontAuthController } from '../src/auth/storefront-auth.controller';
import { cookieNames } from '../src/common/cookies';
import { loadConfig } from '../src/config/app-config';

/**
 * Reading back, and throwing away, the signup a browser has in flight.
 *
 * `GET /auth/storefront/signup` is the route whose ABSENCE broke the social flow. A provider
 * round trip left a complete pending record on the server — a verified, locked email, a display
 * name, the provider subject — keyed to an httpOnly cookie, and then handed the browser to a
 * registration page that had no way to ask about any of it. The page rendered empty. Nothing was
 * lost; nothing could be read.
 *
 * The cases here pin the three answers that route has to get right — a live record, no record,
 * and a record whose time is up — and the two the `DELETE` beside it has to: leaving discards,
 * and discarding is silent about whether there was anything to discard.
 *
 * The real `SignupService` is used over a fake repository. The expiry rule and the browser-facing
 * projection are the parts under test, and stubbing the service would have asserted only that the
 * controller calls a mock.
 */

const config = loadConfig({ JWT_ACCESS_SECRET: 'a'.repeat(32), JWT_REFRESH_SECRET: 'b'.repeat(32) });
const SIGNUP_COOKIE = cookieNames(config).signup;
const SESSION_KEY = 'psk_live';

function record(over: Partial<PendingSignup> = {}): PendingSignup {
	const now = Date.now();
	return {
		id: 'psu_1',
		sessionKey: SESSION_KEY,
		origin: 'google',
		email: {
			value: 'someone@example.test',
			verified: true,
			locked: true,
			sends: 0,
			lastSentAt: null,
		},
		phone: { value: null, verified: false, locked: false, sends: 0, lastSentAt: null },
		displayName: 'Someone Example',
		marketingOptIn: false,
		guestCartId: null,
		provider: 'google',
		providerSubject: 'google-sub-1',
		createdAt: new Date(now).toISOString(),
		expiresAt: new Date(now + 15 * 60_000).toISOString(),
		absoluteExpiresAt: new Date(now + 30 * 60_000).toISOString(),
		...over,
	} as PendingSignup;
}

interface Harness {
	controller: StorefrontAuthController;
	/** Session keys the repository was asked to delete, in order. */
	deleted: string[];
	/** Cookies the reply was told to write, so expiry can be asserted rather than assumed. */
	cookies: Array<{ name: string; value: string; maxAge?: number }>;
}

function harness(stored: PendingSignup | null): Harness {
	const result = { deleted: [], cookies: [] } as unknown as Harness;

	const pending = {
		findBySessionKey: async (sessionKey: string) => (stored && stored.sessionKey === sessionKey ? stored : null),
		deleteBySessionKey: async (sessionKey: string) => {
			result.deleted.push(sessionKey);
			return stored !== null;
		},
	};

	const auth = { normalizeEmail: (value: string) => value.trim().toLowerCase() };
	const signup = new SignupService(config, pending as never, {} as never, {} as never, auth as never);

	result.controller = new StorefrontAuthController(
		auth as never,
		{} as never,
		{} as never,
		signup,
		{} as never,
		{} as never,
		config,
	);
	return result;
}

const request = (sessionKey: string | null) =>
	({ cookies: sessionKey ? { [SIGNUP_COOKIE]: sessionKey } : {}, ip: '127.0.0.1' }) as never;

const reply = (h: Harness) =>
	({
		setCookie: (name: string, value: string, options?: { maxAge?: number }) => {
			h.cookies.push({ name, value, maxAge: options?.maxAge });
		},
	}) as never;

describe('GET /auth/storefront/signup', () => {
	it('answers with the record this browser has in flight', async () => {
		const h = harness(record());

		const response = await h.controller.currentSignup(request(SESSION_KEY));

		expect(response.pending).toMatchObject({
			origin: 'google',
			displayName: 'Someone Example',
			email: { value: 'someone@example.test', verified: true, locked: true },
			phone: { value: null, verified: false },
			complete: false,
		});
	});

	/**
	 * The projection is what the FORM may see, and it stops short of what the server is holding
	 * it to. A provider subject reaching the browser would be a value a tampered client could
	 * then claim, which is the same reasoning that keeps identifiers out of
	 * `FinaliseSignupRequest`.
	 */
	it('does not hand the browser the provider subject it is bound to', async () => {
		const h = harness(record());

		const response = await h.controller.currentSignup(request(SESSION_KEY));

		expect(JSON.stringify(response)).not.toContain('google-sub-1');
	});

	it('answers null when this browser has no signup', async () => {
		const h = harness(null);

		await expect(h.controller.currentSignup(request(null))).resolves.toEqual({ pending: null });
	});

	it('answers null for another browser’s key', async () => {
		const h = harness(record());

		await expect(h.controller.currentSignup(request('psk_someone_else'))).resolves.toEqual({
			pending: null,
		});
	});

	/**
	 * Expiry is applied in the service rather than left to Mongo's TTL sweep, which runs on its
	 * own schedule and can leave a record readable for up to a minute past its time. Prefilling
	 * a form from proof the next write is going to refuse is worse than prefilling nothing.
	 */
	it('answers null for a record whose time is up, however it is still stored', async () => {
		const stale = record({ expiresAt: new Date(Date.now() - 1_000).toISOString() });
		const h = harness(stale);

		await expect(h.controller.currentSignup(request(SESSION_KEY))).resolves.toEqual({ pending: null });
	});
});

describe('DELETE /auth/storefront/signup', () => {
	it('drops the record and expires the cookie that pointed at it', async () => {
		const h = harness(record());

		await h.controller.discardSignup(request(SESSION_KEY), reply(h));

		expect(h.deleted).toEqual([SESSION_KEY]);
		expect(h.cookies).toEqual([{ name: SIGNUP_COOKIE, value: '', maxAge: 0 }]);
	});

	/**
	 * Silent either way. The caller is saying "I am done", not asserting that a record exists,
	 * and a refusal would tell an unauthenticated caller whether a given `st_signup` value is
	 * live — an oracle on a route that needs no credential at all.
	 */
	it('accepts a call with nothing to drop, and still clears the cookie', async () => {
		const h = harness(null);

		await expect(h.controller.discardSignup(request(null), reply(h))).resolves.toBeUndefined();

		expect(h.deleted).toEqual([]);
		expect(h.cookies).toEqual([{ name: SIGNUP_COOKIE, value: '', maxAge: 0 }]);
	});
});
