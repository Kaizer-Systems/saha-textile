import { describe, expect, it } from 'vitest';

import { DuplicateIdentifierError } from '@saha-textile/core-domain';

import { SignupError } from '../src/auth/signup.service';
import { StorefrontAuthController } from '../src/auth/storefront-auth.controller';
import { cookieNames } from '../src/common/cookies';
import { loadConfig } from '../src/config/app-config';

/**
 * What signup finalisation spends, and when.
 *
 * The proof is one-shot: two OTPs, on two channels, that cannot be replayed. It used to be
 * consumed BEFORE anybody asked whether the address was already taken — so the commonest refusal
 * on this route, "somebody registered that in the meantime", cost the person both verifications
 * and returned them to an empty form. Nothing failed; the flow simply charged for an answer it
 * could have given for free.
 *
 * Moving the question earlier widens the gap between asking and writing, so the other half of
 * these cases is the unique index having the final word: a pre-check is a courtesy, and the
 * courtesy must not become the decision.
 */

const config = loadConfig({ JWT_ACCESS_SECRET: 'a'.repeat(32), JWT_REFRESH_SECRET: 'b'.repeat(32) });
const SIGNUP_COOKIE = cookieNames(config).signup;

interface Harness {
	controller: StorefrontAuthController;
	/** True once the one-shot record has been spent. */
	consumed: boolean;
	/** Cookies the handler wrote — the signup cookie clearing is the visible half of consuming. */
	cookies: Array<{ name: string; value: string }>;
	saves: number;
	cartMerges: number;
}

function harness(
	options: {
		resolution?: { kind: 'create' } | { kind: 'existing'; customerId: string } | { kind: 'conflict' };
		saveFails?: unknown;
		consumeFails?: boolean;
		cartFails?: boolean;
	} = {},
): Harness {
	const result = { consumed: false, cookies: [], saves: 0, cartMerges: 0 } as unknown as Harness;

	const record = {
		id: 'psu_1',
		origin: 'password',
		email: { value: 'proven@example.test', verified: true },
		phone: { value: '+919900000001', verified: true },
		displayName: 'Ada',
		guestCartId: null,
		provider: null,
		providerSubject: null,
	};

	const signup = {
		require: async () => record,
		resolve: async () => options.resolution ?? { kind: 'create' as const },
		consume: async () => {
			// What the loser of a race is told: the record is gone, so from here it expired.
			if (options.consumeFails) throw new SignupError('signup_expired');
			result.consumed = true;
			return record;
		},
	};

	const auth = {
		normalizeEmail: (value: string) => value.trim().toLowerCase(),
		hashPassword: async (plain: string) => `hashed:${plain}`,
		customerRepository: {
			save: async (customer: { id: string }) => {
				result.saves += 1;
				if (options.saveFails) throw options.saveFails;
				return { ...customer, id: 'cus_new' };
			},
		},
		customerAuthRepository: {
			setPasswordHash: async () => undefined,
			findAuthStateById: async () => ({ id: 'cus_new', status: 'active', tokenVersion: 0 }),
		},
		publicCustomer: async () => ({ id: 'cus_new' }),
	};

	const sessions = {
		establish: async () => ({
			session: {
				audience: 'storefront',
				expiresAt: '2026-01-02T00:00:00.000Z',
				absoluteExpiresAt: '2026-04-01T00:00:00.000Z',
			},
		}),
	};

	const carts = {
		mergeGuestCartForUser: async () => {
			result.cartMerges += 1;
			if (options.cartFails) throw new Error('cart store unavailable');
		},
	};

	/**
	 * Models the port's contract: the work runs, and a thrown error aborts it and propagates
	 * unchanged. The rollback is modelled by the individual fakes' own state below.
	 */
	const transactions = { withTransaction: async <T>(work: () => Promise<T>): Promise<T> => work() };

	result.controller = new StorefrontAuthController(
		auth as never,
		sessions as never,
		carts as never,
		signup as never,
		{ link: async () => undefined } as never,
		transactions as never,
		config,
	);
	return result;
}

const request = () => ({ cookies: { [SIGNUP_COOKIE]: 'psk_1' }, ip: '127.0.0.1' }) as never;
const reply = (h: Harness) =>
	({ setCookie: (name: string, value: string) => h.cookies.push({ name, value }) }) as never;

const finalise = (h: Harness, body: Record<string, unknown> = { password: 'a-perfectly-adequate-passphrase' }) =>
	h.controller.finaliseSignup(body as never, request(), reply(h));

/** The stable code, read where `domainRefusal` puts it rather than off the message. */
async function refusalCodeOf(work: Promise<unknown>): Promise<string> {
	try {
		await work;
		return 'did-not-throw';
	} catch (error) {
		const body = (error as { getResponse?: () => unknown }).getResponse?.() as
			| { issues?: Array<{ code?: string }> }
			| undefined;
		return body?.issues?.[0]?.code ?? String((error as Error).message);
	}
}

/** Clearing the signup cookie is how the browser learns the record is gone. */
const clearedSignupCookie = (h: Harness) => h.cookies.some((c) => c.name === SIGNUP_COOKIE && c.value === '');

describe('a refusal that was knowable in advance keeps the proof', () => {
	it('does not spend the record when the identifier already belongs to somebody', async () => {
		const h = harness({ resolution: { kind: 'existing', customerId: 'cus_other' } });

		expect(await refusalCodeOf(finalise(h))).toBe('signup_identifier_taken');
		expect(h.consumed).toBe(false);
		expect(h.saves).toBe(0);
	});

	it('leaves the signup cookie alone so the form can be corrected and re-verified', async () => {
		const h = harness({ resolution: { kind: 'existing', customerId: 'cus_other' } });
		await finalise(h).catch(() => undefined);

		expect(clearedSignupCookie(h)).toBe(false);
	});

	it('does the same for an email and phone owned by different accounts', async () => {
		const h = harness({ resolution: { kind: 'conflict' } });

		expect(await refusalCodeOf(finalise(h))).toBe('signup_identifier_conflict');
		expect(h.consumed).toBe(false);
		expect(clearedSignupCookie(h)).toBe(false);
	});
});

describe('the record is still spent exactly once', () => {
	it('consumes and clears the cookie on the path that creates an account', async () => {
		const h = harness();
		await finalise(h);

		expect(h.consumed).toBe(true);
		expect(clearedSignupCookie(h)).toBe(true);
		expect(h.saves).toBe(1);
	});

	/** Two submits racing one record: the loser finds it gone and is told so, without writing. */
	it('refuses the loser of a race before it can create anything', async () => {
		const h = harness({ consumeFails: true });

		expect(await refusalCodeOf(finalise(h))).toBe('signup_expired');
		expect(h.saves).toBe(0);
	});
});

describe('the unique index has the last word', () => {
	/**
	 * The window the earlier check opens: resolve said the address was free, and between then and
	 * the insert somebody else took it. Without translation this is a driver error and a 500.
	 */
	it('reports a lost race as the same refusal the pre-check would have given', async () => {
		const h = harness({ saveFails: new DuplicateIdentifierError('email') });

		expect(await refusalCodeOf(finalise(h))).toBe('signup_identifier_taken');
	});

	it('does the same for a phone', async () => {
		const h = harness({ saveFails: new DuplicateIdentifierError('phone') });

		expect(await refusalCodeOf(finalise(h))).toBe('signup_identifier_taken');
	});

	/** Anything that is not an identifier collision must keep propagating, not be relabelled. */
	it('leaves an unrelated storage failure alone', async () => {
		const h = harness({ saveFails: new Error('replica set unavailable') });

		expect(await refusalCodeOf(finalise(h))).toBe('replica set unavailable');
	});
});

describe('a cart merge cannot undo a completed signup', () => {
	it('still returns the new session when the merge fails', async () => {
		const h = harness({ cartFails: true });

		const response = await finalise(h);
		expect(h.cartMerges).toBe(1);
		expect(response.session.audience).toBe('storefront');
	});
});
