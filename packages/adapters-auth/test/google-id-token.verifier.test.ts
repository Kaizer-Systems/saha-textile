import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GoogleIdTokenVerifier } from '../src/google-id-token.verifier';

/**
 * `google-auth-library` is mocked, not the network.
 *
 * The signature check itself is Google's code and is not ours to re-test; forging a token that
 * genuinely verifies would mean holding Google's signing key. What IS ours — and what these
 * cases cover — is everything the library deliberately does not check: the nonce we minted,
 * whether the address was confirmed, and whether a subject came back at all.
 */
/**
 * `vi.hoisted` because `vi.mock` is lifted above the imports: a plain `const` declared here
 * would not exist yet when the factory runs. This is also why the verifier is imported
 * statically rather than with a top-level `await import` — under `nodenext` the test file is a
 * CommonJS module, where top-level await is not available.
 */
const { verifyIdToken } = vi.hoisted(() => ({ verifyIdToken: vi.fn() }));

vi.mock('google-auth-library', () => ({
	OAuth2Client: class {
		verifyIdToken = verifyIdToken;
	},
}));

const CLIENT_ID = '1234.apps.googleusercontent.com';

/** Shapes a ticket the way the library returns one. */
const ticket = (payload: Record<string, unknown> | undefined) => ({ getPayload: () => payload });

describe('GoogleIdTokenVerifier', () => {
	/**
	 * Braces matter here. `mockReset()` returns the mock, and an arrow returning it implicitly
	 * hands Vitest a FUNCTION — which it registers as a teardown callback and invokes after each
	 * test. With a throwing implementation set, that teardown call threw, and the error surfaced
	 * against a test whose own behaviour was correct.
	 */
	beforeEach(() => {
		verifyIdToken.mockReset();
	});

	it('accepts a verified token and returns the subject as the identity key', async () => {
		verifyIdToken.mockResolvedValue(
			ticket({ sub: 'g_sub_1', email: 'a@example.test', email_verified: true, name: 'A', nonce: 'n1' }),
		);

		const identity = await new GoogleIdTokenVerifier(CLIENT_ID).verify({
			credential: 'jwt',
			expectedNonce: 'n1',
		});

		expect(identity).toEqual({
			provider: 'google',
			subject: 'g_sub_1',
			email: 'a@example.test',
			emailVerified: true,
			displayName: 'A',
		});
	});

	/** The audience check is what proves the token was minted for US, so it must be passed. */
	it('passes our client id as the audience', async () => {
		verifyIdToken.mockResolvedValue(ticket({ sub: 'g_sub_1', email_verified: true, nonce: null }));

		await new GoogleIdTokenVerifier(CLIENT_ID).verify({ credential: 'jwt', expectedNonce: null });

		expect(verifyIdToken).toHaveBeenCalledWith({ idToken: 'jwt', audience: CLIENT_ID });
	});

	/**
	 * Replay. A valid token captured from another session would pass every signature, issuer,
	 * audience and expiry check — the nonce is the only thing that ties it to THIS attempt.
	 */
	it('rejects a token whose nonce is not the one we minted', async () => {
		verifyIdToken.mockResolvedValue(ticket({ sub: 'g_sub_1', email_verified: true, nonce: 'someone-elses' }));

		await expect(
			new GoogleIdTokenVerifier(CLIENT_ID).verify({ credential: 'jwt', expectedNonce: 'n1' }),
		).rejects.toThrow(/nonce mismatch/);
	});

	it('rejects a token carrying a nonce when none was expected', async () => {
		verifyIdToken.mockResolvedValue(ticket({ sub: 'g_sub_1', email_verified: true, nonce: 'unexpected' }));

		await expect(
			new GoogleIdTokenVerifier(CLIENT_ID).verify({ credential: 'jwt', expectedNonce: null }),
		).rejects.toThrow(/nonce mismatch/);
	});

	/**
	 * An unverified address is DROPPED rather than carried with a false flag. Passing the value
	 * along invites a later reader to use it and forget the flag, which is how an unconfirmed
	 * address ends up attached to an account.
	 */
	it('discards an unverified email instead of passing it through', async () => {
		verifyIdToken.mockResolvedValue(
			ticket({ sub: 'g_sub_1', email: 'unconfirmed@example.test', email_verified: false, nonce: null }),
		);

		const identity = await new GoogleIdTokenVerifier(CLIENT_ID).verify({ credential: 'jwt', expectedNonce: null });

		expect(identity.email).toBeNull();
		expect(identity.emailVerified).toBe(false);
	});

	it('treats a missing email_verified claim as unverified', async () => {
		verifyIdToken.mockResolvedValue(ticket({ sub: 'g_sub_1', email: 'a@example.test', nonce: null }));

		expect(
			(await new GoogleIdTokenVerifier(CLIENT_ID).verify({ credential: 'jwt', expectedNonce: null }))
				.emailVerified,
		).toBe(false);
	});

	it('rejects a token with no subject', async () => {
		verifyIdToken.mockResolvedValue(ticket({ email_verified: true, nonce: null }));

		await expect(
			new GoogleIdTokenVerifier(CLIENT_ID).verify({ credential: 'jwt', expectedNonce: null }),
		).rejects.toThrow(/no subject/);
	});

	it('rejects a ticket with no payload at all', async () => {
		verifyIdToken.mockResolvedValue(ticket(undefined));

		await expect(
			new GoogleIdTokenVerifier(CLIENT_ID).verify({ credential: 'jwt', expectedNonce: null }),
		).rejects.toThrow(/no payload/);
	});

	/** Whatever the library rejected — signature, issuer, audience, expiry — surfaces as one refusal. */
	it('converts a library rejection into a token-invalid refusal', async () => {
		verifyIdToken.mockImplementation(() => {
			throw new Error('Wrong recipient, payload audience != requiredAudience');
		});

		// The reason survives into OUR refusal type — useful in a log, and never in a response,
		// because a caller who learns WHY a token was rejected learns how to build a better one.
		await expect(
			new GoogleIdTokenVerifier(CLIENT_ID).verify({ credential: 'jwt', expectedNonce: null }),
		).rejects.toThrow(/Wrong recipient/);
	});

	/** Unconfigured fails closed, and before the library is ever asked. */
	it('refuses when no client id is configured, without calling the library', async () => {
		await expect(
			new GoogleIdTokenVerifier(undefined).verify({ credential: 'jwt', expectedNonce: null }),
		).rejects.toThrow(/not configured/);
		expect(verifyIdToken).not.toHaveBeenCalled();
	});
});
