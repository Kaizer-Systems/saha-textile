import { describe, expect, it, vi } from 'vitest';

import { SignupError, SignupService } from '../src/auth/signup.service';
import { StorefrontAuthController } from '../src/auth/storefront-auth.controller';
import { cookieNames } from '../src/common/cookies';
import { loadConfig } from '../src/config/app-config';

/**
 * Signing in to the account a signup code has just proven (`DEC-SIGNUP-VERIFICATION`: "sign-in is
 * granted directly, because the OTP already served as the proof").
 *
 * The refusals matter as much as the success: this route opens an account on the strength of a
 * pending record, so anything short of a proven value owned by an active customer must open nothing.
 */
const config = loadConfig({ JWT_ACCESS_SECRET: 'a'.repeat(32), JWT_REFRESH_SECRET: 'b'.repeat(32) });

const field = (value: string | null, verified: boolean) => ({
	value,
	verified,
	locked: false,
	sends: 1,
	lastSentAt: null,
});

function pending(over: { emailVerified?: boolean } = {}) {
	return {
		id: 'psu_1',
		sessionKey: 'psk_1',
		origin: 'facebook',
		email: field('ada@example.test', over.emailVerified ?? true),
		phone: field('+919900000009', true),
		displayName: 'Ada',
		marketingOptIn: false,
		guestCartId: null,
		provider: 'facebook',
		providerSubject: 'fb-sub-1',
		createdAt: new Date().toISOString(),
		expiresAt: new Date(Date.now() + 600_000).toISOString(),
		absoluteExpiresAt: new Date(Date.now() + 1_200_000).toISOString(),
	};
}

function harness(options: { record?: ReturnType<typeof pending>; owner?: { id: string; status: string } | null }) {
	const record = options.record ?? pending();
	const owner = options.owner === undefined ? { id: 'cus_1', status: 'active' } : options.owner;
	const consume = vi.fn(async () => record);
	const establish = vi.fn(async () => ({
		session: { audience: 'storefront', expiresAt: 'later', absoluteExpiresAt: 'much-later' },
	}));
	const cookies: Array<[string, string]> = [];

	const auth = {
		normalizeEmail: (value: string) => value.trim().toLowerCase(),
		customerAuthRepository: {
			findAuthStateByEmail: async () => (owner ? { id: owner.id } : null),
			findAuthStateById: async () => (owner ? { ...owner, tokenVersion: 3 } : null),
		},
		publicCustomer: async (id: string) => ({ id }),
	};
	// The real service, so `provenOwner` is the code under test; only its stores are stubbed.
	const signup = new SignupService(
		config,
		{ findBySessionKey: async () => record, consume } as never,
		{ findByPhone: async () => (owner ? { id: owner.id } : null) } as never,
		auth.customerAuthRepository as never,
		auth as never,
	);
	const controller = new StorefrontAuthController(
		auth as never,
		{ establish } as never,
		{ mergeGuestCartForUser: async () => undefined } as never,
		signup,
		{} as never,
		{} as never,
		config,
	);
	const request = { cookies: { [cookieNames(config).signup]: 'psk_1' }, ip: '127.0.0.1' } as never;
	const reply = { setCookie: (name: string, value: string) => cookies.push([name, value]) } as never;
	return {
		signIn: (name: 'email' | 'phone' = 'email') => controller.signInFromSignup({ field: name }, request, reply),
		consume,
		establish,
		cookies,
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

describe('signing in from a signup code', () => {
	it('opens the account that owns the proven value, once', async () => {
		const h = harness({});

		const result = await h.signIn('email');

		expect(result.user).toEqual({ id: 'cus_1' });
		expect(h.establish).toHaveBeenCalledWith(
			expect.objectContaining({
				user: expect.objectContaining({ id: 'cus_1', tokenVersion: 3 }),
				audience: 'storefront',
			}),
		);
		// Consumed, so the same proof cannot open a second session, and the cookie goes with it.
		expect(h.consume).toHaveBeenCalledTimes(1);
		expect(h.cookies).toContainEqual([cookieNames(config).signup, '']);
	});

	/** Without the verified flag this would sign anybody in to an address they merely typed. */
	it('refuses a value the signup has not proven', async () => {
		const h = harness({ record: pending({ emailVerified: false }) });

		expect(await refusalCodeOf(h.signIn('email'))).toBe('signup_incomplete');
		expect(h.establish).not.toHaveBeenCalled();
		expect(h.consume).not.toHaveBeenCalled();
	});

	it('refuses a disabled or locked account, and keeps the record', async () => {
		const h = harness({ owner: { id: 'cus_1', status: 'disabled' } });

		expect(await refusalCodeOf(h.signIn('email'))).toBe('account_not_accessible');
		expect(h.establish).not.toHaveBeenCalled();
		expect(h.consume).not.toHaveBeenCalled();
	});

	it('refuses when the proven value belongs to nobody', async () => {
		const h = harness({ owner: null });

		expect(await refusalCodeOf(h.signIn('email'))).toBe('signup_no_existing_account');
		expect(h.establish).not.toHaveBeenCalled();
	});

	it('names an unproven field as such even when the service is asked directly', async () => {
		const service = new SignupService(config, {} as never, {} as never, {} as never, {} as never);

		await expect(service.provenOwner(pending({ emailVerified: false }) as never, 'email')).rejects.toBeInstanceOf(
			SignupError,
		);
	});
});
