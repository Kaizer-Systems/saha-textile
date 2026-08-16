import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { OAuthService, OAuthStateInvalidError } from '../src/auth/oauth.service';
import { loadConfig } from '../src/config/app-config';

/**
 * The state round-trip, without a provider in sight.
 *
 * Every case here is about what happens BEFORE a token is ever verified — configuration,
 * replay, expiry, provider mismatch and nonce binding. The provider adapters have their own
 * fixture suites in `packages/adapters-auth`; duplicating them here would test the mock.
 */

const config = (overrides: NodeJS.ProcessEnv = {}) =>
	loadConfig({ JWT_ACCESS_SECRET: 'a'.repeat(32), JWT_REFRESH_SECRET: 'b'.repeat(32), ...overrides });

const CONFIGURED = {
	GOOGLE_OAUTH_CLIENT_ID: '1234.apps.googleusercontent.com',
	FACEBOOK_OAUTH_APP_ID: '1234567890',
	FACEBOOK_OAUTH_APP_SECRET: 'app-secret-not-a-real-one',
};

/**
 * A REAL digest, not a label.
 *
 * An earlier version used `h(${value})`, which quietly defeated the test below: a stub that
 * embeds its input means "the row does not contain the plaintext" can never fail, however the
 * service behaves. The stub only has to be deterministic and one-way, so sha256 is both.
 */
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const authStub = { hash: digest };

function build(env: NodeJS.ProcessEnv, stateRows: Record<string, Record<string, unknown>> = {}) {
	const rows = new Map<string, Record<string, unknown>>(Object.entries(stateRows));
	const states = {
		create: vi.fn(async (row: Record<string, unknown>) => {
			rows.set(String(row.stateHash), row);
			return row;
		}),
		// Atomic single-use in the real adapter; here, read-and-remove models the same contract.
		consume: vi.fn(async (stateHash: string) => {
			const row = rows.get(stateHash);
			if (!row) return null;
			rows.delete(stateHash);
			return row;
		}),
		deleteExpired: vi.fn(),
	};
	const identities = {
		findByProviderSubject: vi.fn(async () => null),
		listForSubject: vi.fn(async () => []),
		link: vi.fn(async (i: unknown) => i),
		unlink: vi.fn(async () => true),
		touch: vi.fn(),
	};

	const service = new OAuthService(config(env) as never, states as never, identities as never, authStub as never);
	return { service, states, identities, rows };
}

describe('provider availability', () => {
	/**
	 * Fails CLOSED, and before anything else happens. An unconfigured provider is unavailable —
	 * never partially working, because a verifier missing its app secret cannot run the app-binding
	 * check and would accept any token at all.
	 */
	it('refuses to mint state for an unconfigured provider', async () => {
		const { service, states } = build({});

		await expect(service.start({ provider: 'google' })).rejects.toThrow(/not configured/);
		expect(states.create).not.toHaveBeenCalled();
	});

	it('treats a half-configured Facebook app as unavailable', () => {
		// App id without the secret: enough to render a button, not enough to verify anything.
		const { service } = build({ FACEBOOK_OAUTH_APP_ID: '1234567890' });
		expect(service.isConfigured('facebook')).toBe(false);
	});

	it('reports a fully configured provider as available', () => {
		const { service } = build(CONFIGURED);
		expect(service.isConfigured('google')).toBe(true);
		expect(service.isConfigured('facebook')).toBe(true);
	});
});

describe('state minting', () => {
	it('stores only hashes, never the state value or the nonce', async () => {
		const { service, states } = build(CONFIGURED);

		const started = await service.start({ provider: 'google' });
		const stored = states.create.mock.calls[0]?.[0] as Record<string, string>;

		expect(stored.stateHash).toBe(digest(started.stateId));
		expect(stored.nonceHash).toBe(digest(started.nonce as string));
		// A database dump must not yield a usable state: the row is a check, not a credential.
		expect(JSON.stringify(stored)).not.toContain(started.stateId);
		expect(JSON.stringify(stored)).not.toContain(started.nonce);
	});

	/** Google's ID token carries a nonce back for comparison; Meta has no such concept. */
	it('mints a nonce for Google and none for Facebook', async () => {
		const { service } = build(CONFIGURED);

		expect((await service.start({ provider: 'google' })).nonce).toBeTruthy();
		expect((await service.start({ provider: 'facebook' })).nonce).toBeNull();
	});

	it('carries the guest cart through the round-trip', async () => {
		const { service, states } = build(CONFIGURED);

		await service.start({ provider: 'google', guestCartId: 'cart_1' });

		expect((states.create.mock.calls[0]?.[0] as Record<string, string>).guestCartId).toBe('cart_1');
	});
});

describe('state consumption', () => {
	/**
	 * Replay is refused BEFORE a provider is contacted. Otherwise resending an old callback would
	 * spend our Graph quota — and our credits — on a request we were always going to reject.
	 */
	it('refuses a replayed state without calling a provider', async () => {
		const { service } = build(CONFIGURED);
		const started = await service.start({ provider: 'google' });

		// First use consumes it; the verifier is never reached because the credential is nonsense
		// and the state is already gone on the second attempt.
		await service
			.verify({ provider: 'google', stateId: started.stateId, credential: 'x', nonce: started.nonce })
			.catch(() => undefined);

		await expect(
			service.verify({ provider: 'google', stateId: started.stateId, credential: 'x', nonce: started.nonce }),
		).rejects.toBeInstanceOf(OAuthStateInvalidError);
	});

	it('refuses an unknown state', async () => {
		const { service } = build(CONFIGURED);

		await expect(
			service.verify({ provider: 'google', stateId: 'never-minted', credential: 'x', nonce: null }),
		).rejects.toBeInstanceOf(OAuthStateInvalidError);
	});

	/** A Google state answered with a Facebook token is a mismatch, not a near miss. */
	it('refuses a state minted for the other provider', async () => {
		const { service } = build(CONFIGURED);
		const started = await service.start({ provider: 'google' });

		await expect(
			service.verify({ provider: 'facebook', stateId: started.stateId, credential: 'x', nonce: null }),
		).rejects.toBeInstanceOf(OAuthStateInvalidError);
	});

	it('refuses an expired state even though it was never used', async () => {
		const { service, rows } = build(CONFIGURED);
		const started = await service.start({ provider: 'google' });
		const row = rows.get(digest(started.stateId))!;
		row.expiresAt = new Date(Date.now() - 1000).toISOString();

		await expect(
			service.verify({ provider: 'google', stateId: started.stateId, credential: 'x', nonce: started.nonce }),
		).rejects.toBeInstanceOf(OAuthStateInvalidError);
	});

	/**
	 * The replay defence. A token captured from another session passes every signature, issuer,
	 * audience and expiry check — the nonce is the only thing tying it to THIS attempt.
	 */
	it('refuses when the nonce does not match the state that expected one', async () => {
		const { service } = build(CONFIGURED);
		const started = await service.start({ provider: 'google' });

		await expect(
			service.verify({ provider: 'google', stateId: started.stateId, credential: 'x', nonce: 'someone-elses' }),
		).rejects.toBeInstanceOf(OAuthStateInvalidError);
	});

	it('refuses when a state expected a nonce and none was returned', async () => {
		const { service } = build(CONFIGURED);
		const started = await service.start({ provider: 'google' });

		await expect(
			service.verify({ provider: 'google', stateId: started.stateId, credential: 'x', nonce: null }),
		).rejects.toBeInstanceOf(OAuthStateInvalidError);
	});
});

describe('identity linking', () => {
	/**
	 * An identity belonging to somebody else is a REFUSAL, not a duplicate-key error. The unique
	 * index would stop it either way; the difference is whether the customer sees an explanation
	 * or a 500.
	 */
	it('refuses to link an identity already held by another customer', async () => {
		const { service, identities } = build(CONFIGURED);
		identities.findByProviderSubject.mockResolvedValue({
			subjectType: 'customer',
			subjectId: 'cus_other',
		} as never);

		await expect(
			service.link('cus_mine', {
				provider: 'google',
				subject: 'g_sub_1',
				email: null,
				emailVerified: true,
				displayName: null,
			}),
		).rejects.toThrow(/oauth_identity_conflict/);
		expect(identities.link).not.toHaveBeenCalled();
	});

	it('is idempotent when the identity is already linked to this customer', async () => {
		const { service, identities } = build(CONFIGURED);
		identities.findByProviderSubject.mockResolvedValue({
			subjectType: 'customer',
			subjectId: 'cus_mine',
		} as never);

		await service.link('cus_mine', {
			provider: 'google',
			subject: 'g_sub_1',
			email: null,
			emailVerified: true,
			displayName: null,
		});

		expect(identities.link).not.toHaveBeenCalled();
	});

	/**
	 * Populations do not meet. An identity attached to an OPERATOR must never resolve to a
	 * customer session — that would be exactly the cross-population authentication the account
	 * split exists to prevent.
	 */
	it('ignores an identity that belongs to an operator', async () => {
		const { service, identities } = build(CONFIGURED);
		identities.findByProviderSubject.mockResolvedValue({
			subjectType: 'admin_user',
			subjectId: 'adm_1',
		} as never);

		const found = await service.findCustomerIdFor({
			provider: 'google',
			subject: 'g_sub_1',
			email: null,
			emailVerified: true,
			displayName: null,
		});

		expect(found).toBeNull();
	});
});
