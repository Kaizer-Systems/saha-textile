import { describe, expect, it, vi } from 'vitest';

import { StorefrontAuthController } from '../src/auth/storefront-auth.controller';
import { loadConfig } from '../src/config/app-config';

/**
 * A provider-proven address that already has an account is answered at the callback.
 *
 * The OAuth service and repositories are stubbed at the seam the controller calls: what is under
 * test is the DECISION — which provider identities may be told, and that no signup is begun for
 * them — not token verification, which `oauth-service.test.ts` covers.
 */
const config = loadConfig({ JWT_ACCESS_SECRET: 'a'.repeat(32), JWT_REFRESH_SECRET: 'b'.repeat(32) });

type Owner = { id: string; status: string; email?: string } | null;

function harness(identity: { emailVerified: boolean; email: string | null }, owner: Owner) {
	const findAuthStateByEmail = vi.fn(async () => owner);
	const start = vi.fn(async () => ({ id: 'psu_1' }));
	const oauth = {
		verify: async () => ({
			identity: { provider: 'google', subject: 'sub_1', displayName: 'Ada', ...identity },
			guestCartId: null,
		}),
		signInCustomerIdFor: async () => null,
	};
	const auth = {
		normalizeEmail: (value: string) => value.trim().toLowerCase(),
		customerAuthRepository: { findAuthStateByEmail },
	};
	const signup = {
		newSessionKey: () => 'psk_1',
		start,
		attachProvider: async (record: unknown) => record,
		toState: () => ({ origin: 'google' }),
	};
	const controller = new StorefrontAuthController(
		auth as never,
		{} as never,
		{} as never,
		signup as never,
		oauth as never,
		{} as never,
		config,
	);
	const request = { cookies: {}, ip: '127.0.0.1' } as never;
	const reply = { setCookie: () => undefined } as never;
	return {
		google: () =>
			controller.verifyGoogle({ stateId: 'oas_1', credential: 'tok', nonce: 'n' } as never, request, reply),
		facebook: () => controller.verifyFacebook({ stateId: 'oas_1', accessToken: 'tok' } as never, request, reply),
		findAuthStateByEmail,
		start,
	};
}

async function refusalCodeOf(work: Promise<unknown>): Promise<string> {
	try {
		await work;
		return 'did-not-throw';
	} catch (error) {
		const response = (error as { getResponse?: () => { issues?: { code?: string }[] } }).getResponse?.();
		return response?.issues?.[0]?.code ?? 'no-code';
	}
}

describe('a provider-proven email that already has an account', () => {
	/**
	 * Offered a code, not signed in: Google's claim about a non-Google address can be stale, so the
	 * one-time code to that address is what opens the account.
	 */
	it('is answered at the callback with the address to send a code to, and no signup is begun', async () => {
		const h = harness(
			{ emailVerified: true, email: 'Ada@Example.test' },
			{ id: 'cus_1', status: 'active', email: 'ada@example.test' },
		);

		const result = await h.google();

		expect(result).toMatchObject({
			outcome: 'account_exists',
			customer: null,
			session: null,
			existingAccountEmail: 'ada@example.test',
		});
		expect(h.findAuthStateByEmail).toHaveBeenCalledWith('ada@example.test');
		expect(h.start).not.toHaveBeenCalled();
	});

	/** The owner of a disabled account is not offered a sign-in that would be refused. */
	it('says the account cannot be used when it is disabled or locked', async () => {
		const h = harness({ emailVerified: true, email: 'ada@example.test' }, { id: 'cus_1', status: 'disabled' });

		expect(await refusalCodeOf(h.google())).toBe('account_not_accessible');
		expect(h.start).not.toHaveBeenCalled();
	});

	it('begins a signup as before when the address is free', async () => {
		const h = harness({ emailVerified: true, email: 'ada@example.test' }, null);

		const result = await h.google();

		expect(result.outcome).toBe('signup_required');
		expect(h.start).toHaveBeenCalledTimes(1);
	});

	/**
	 * Meta proves nothing about its address. Answering here would tell anybody whether an address
	 * they merely typed into a Facebook profile shops with us — so ownership waits for the email code.
	 */
	it('is never answered for an unproven address', async () => {
		const h = harness({ emailVerified: false, email: 'ada@example.test' }, { id: 'cus_1', status: 'active' });

		const result = await h.facebook();

		expect(result.outcome).toBe('signup_required');
		expect(h.findAuthStateByEmail).not.toHaveBeenCalled();
		expect(h.start).toHaveBeenCalledTimes(1);
	});
});
