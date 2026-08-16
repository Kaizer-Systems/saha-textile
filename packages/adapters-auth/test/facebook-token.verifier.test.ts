import { describe, expect, it, vi } from 'vitest';

import { FacebookTokenVerifier } from '../src/facebook-token.verifier';

/**
 * Meta's network is mocked throughout. CI must never need a real app, a real token or a
 * credential of any kind — a suite that depends on a provider being reachable is a suite that
 * goes red when somebody else has an outage.
 */

const APP_ID = '1234567890';
const SECRET = 'app-secret-not-a-real-one';

/** Builds a fetch that answers debug_token then /me, so a case only states what it changes. */
function fakeFetch(options: {
	debug?: Record<string, unknown>;
	profile?: Record<string, unknown>;
	debugStatus?: number;
	throwOn?: 'debug' | 'profile';
}) {
	return vi.fn(async (url: string | URL | Request) => {
		const href = String(url);
		if (href.includes('debug_token')) {
			if (options.throwOn === 'debug') throw new Error('socket hang up');
			return new Response(JSON.stringify({ data: options.debug ?? {} }), {
				status: options.debugStatus ?? 200,
			});
		}
		if (options.throwOn === 'profile') throw new Error('socket hang up');
		return new Response(JSON.stringify(options.profile ?? {}), { status: 200 });
	}) as unknown as typeof fetch;
}

const validDebug = { app_id: APP_ID, is_valid: true, user_id: 'fb_sub_1', expires_at: 0 };

describe('FacebookTokenVerifier', () => {
	it('accepts a valid token for our app and returns the app-scoped subject', async () => {
		const verifier = new FacebookTokenVerifier(
			APP_ID,
			SECRET,
			fakeFetch({ debug: validDebug, profile: { id: 'fb_sub_1', email: 'a@example.test', name: 'A' } }),
		);

		const identity = await verifier.verify({ credential: 'tok', expectedNonce: null });

		expect(identity.provider).toBe('facebook');
		expect(identity.subject).toBe('fb_sub_1');
		expect(identity.email).toBe('a@example.test');
		expect(identity.displayName).toBe('A');
	});

	/**
	 * The rule the whole Facebook path is built on. Meta offers no `email_verified` claim, so a
	 * returned address is a PREFILL, never proof — and this flag must not become conditional,
	 * because a caller reading the value while forgetting the flag is how an unverified address
	 * gets attached to an account.
	 */
	it('never reports the email as verified, even when Meta supplies one', async () => {
		const verifier = new FacebookTokenVerifier(
			APP_ID,
			SECRET,
			fakeFetch({ debug: validDebug, profile: { email: 'a@example.test' } }),
		);

		expect((await verifier.verify({ credential: 'tok', expectedNonce: null })).emailVerified).toBe(false);
	});

	it('handles a missing email as routine rather than as a failure', async () => {
		const verifier = new FacebookTokenVerifier(APP_ID, SECRET, fakeFetch({ debug: validDebug, profile: {} }));

		const identity = await verifier.verify({ credential: 'tok', expectedNonce: null });
		expect(identity.email).toBeNull();
		expect(identity.subject).toBe('fb_sub_1');
	});

	/**
	 * The attack `debug_token` exists to stop: an attacker registers their own Meta app, gets a
	 * victim to sign into it, and posts that token here. Using the token would identify the
	 * victim perfectly — only the app binding reveals the substitution.
	 */
	it('rejects a token minted for a different app', async () => {
		const verifier = new FacebookTokenVerifier(
			APP_ID,
			SECRET,
			fakeFetch({ debug: { ...validDebug, app_id: '9999999999' } }),
		);

		await expect(verifier.verify({ credential: 'tok', expectedNonce: null })).rejects.toThrow(/another app/);
	});

	/** Revocation leaves a token unexpired and dead; only `is_valid` catches it. */
	it('rejects a revoked token', async () => {
		const verifier = new FacebookTokenVerifier(
			APP_ID,
			SECRET,
			fakeFetch({ debug: { ...validDebug, is_valid: false } }),
		);

		await expect(verifier.verify({ credential: 'tok', expectedNonce: null })).rejects.toThrow(
			/not valid or was revoked/,
		);
	});

	it('rejects an expired token', async () => {
		const past = Math.floor(Date.now() / 1000) - 60;
		const verifier = new FacebookTokenVerifier(
			APP_ID,
			SECRET,
			fakeFetch({ debug: { ...validDebug, expires_at: past } }),
		);

		await expect(verifier.verify({ credential: 'tok', expectedNonce: null })).rejects.toThrow(/expired/);
	});

	it('rejects a token carrying no user id', async () => {
		const verifier = new FacebookTokenVerifier(
			APP_ID,
			SECRET,
			fakeFetch({ debug: { app_id: APP_ID, is_valid: true } }),
		);

		await expect(verifier.verify({ credential: 'tok', expectedNonce: null })).rejects.toThrow(/no user id/);
	});

	it('surfaces an error object returned by Graph', async () => {
		const verifier = new FacebookTokenVerifier(
			APP_ID,
			SECRET,
			fakeFetch({ debug: { error: { message: 'Invalid OAuth access token' } } }),
		);

		await expect(verifier.verify({ credential: 'tok', expectedNonce: null })).rejects.toThrow(/Invalid OAuth/);
	});

	it('rejects a malformed response with no data envelope', async () => {
		const fetchImpl = vi.fn(
			async () => new Response(JSON.stringify({}), { status: 200 }),
		) as unknown as typeof fetch;
		const verifier = new FacebookTokenVerifier(APP_ID, SECRET, fetchImpl);

		await expect(verifier.verify({ credential: 'tok', expectedNonce: null })).rejects.toThrow(/no data/);
	});

	/**
	 * "We could not check" must never resolve like "we checked and it was fine". A provider
	 * outage that returned a pass would be an outage that logs everybody in.
	 */
	it('refuses when Graph is unreachable', async () => {
		const verifier = new FacebookTokenVerifier(APP_ID, SECRET, fakeFetch({ throwOn: 'debug' }));

		await expect(verifier.verify({ credential: 'tok', expectedNonce: null })).rejects.toThrow(/request failed/);
	});

	it('refuses when Graph answers a non-200', async () => {
		const verifier = new FacebookTokenVerifier(APP_ID, SECRET, fakeFetch({ debugStatus: 500 }));

		await expect(verifier.verify({ credential: 'tok', expectedNonce: null })).rejects.toThrow(/responded 500/);
	});

	/** Unconfigured fails closed, and fails BEFORE any network call is attempted. */
	it('refuses when the app is not configured, without calling Graph', async () => {
		const fetchImpl = vi.fn() as unknown as typeof fetch;
		const verifier = new FacebookTokenVerifier(undefined, undefined, fetchImpl);

		await expect(verifier.verify({ credential: 'tok', expectedNonce: null })).rejects.toThrow(/not configured/);
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	/** The app secret is used to build the app access token and must not appear anywhere else. */
	it('sends the app access token to debug_token and never to the profile call', async () => {
		const fetchImpl = fakeFetch({ debug: validDebug, profile: {} });
		const verifier = new FacebookTokenVerifier(APP_ID, SECRET, fetchImpl);

		await verifier.verify({ credential: 'tok', expectedNonce: null });

		const calls = (fetchImpl as unknown as { mock: { calls: [string][] } }).mock.calls.map(([url]) => url);
		expect(calls[0]).toContain(encodeURIComponent(`${APP_ID}|${SECRET}`));
		expect(calls[1]).not.toContain(SECRET);
		// Commas are legal unencoded in a query string, and Meta documents the field list this way.
		expect(calls[1]).toContain('fields=id,email,name');
	});
});
