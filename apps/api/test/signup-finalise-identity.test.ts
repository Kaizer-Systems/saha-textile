import { describe, expect, it } from 'vitest';

import type { AuthIdentity } from '@saha-textile/core-domain';

import { OAuthService } from '../src/auth/oauth.service';
import { StorefrontAuthController } from '../src/auth/storefront-auth.controller';
import { cookieNames } from '../src/common/cookies';
import { loadConfig } from '../src/config/app-config';

/**
 * What signup finalisation writes as the account's login methods.
 *
 * A social signup used to produce NO provider link at all: `attachProvider` parked the provider
 * and subject on the pending record, and finalisation never read them back. The next Google or
 * Facebook click therefore did not recognise the account it had just created — and the address was
 * by then taken, so signup refused it too. That is a lockout, and no existing test noticed it
 * because nothing asserted what `authIdentities` ends up holding.
 *
 * So these cases are about the identity ROWS, and the last one closes the loop: the same lookup
 * sign-in performs must resolve to the customer finalisation just made.
 *
 * `OAuthService` is the REAL one, over a fake identity store. Stubbing `link` would have meant
 * asserting that the controller calls a mock, which is exactly what the bug already satisfied —
 * the linking rule, its conflict check, and its keying on subject rather than email are the parts
 * worth pinning.
 */

const config = loadConfig({ JWT_ACCESS_SECRET: 'a'.repeat(32), JWT_REFRESH_SECRET: 'b'.repeat(32) });

const PROVEN_EMAIL = 'proven@example.test';
const PROVEN_PHONE = '+919900000001';
const GOOGLE_SUBJECT = 'google-sub-12345';

/** A pending record as `SignupService.finalise` hands it back — every value already proven. */
function consumedRecord(over: Record<string, unknown> = {}) {
	return {
		id: 'psu_1',
		sessionKey: 'psk_1',
		origin: 'password',
		email: { value: PROVEN_EMAIL, verified: true, locked: false, sends: 1, lastSentAt: null },
		phone: { value: PROVEN_PHONE, verified: true, locked: false, sends: 1, lastSentAt: null },
		displayName: 'Ada',
		marketingOptIn: false,
		guestCartId: null,
		provider: null,
		providerSubject: null,
		createdAt: '2026-01-01T00:00:00.000Z',
		expiresAt: '2026-01-01T00:15:00.000Z',
		absoluteExpiresAt: '2026-01-01T00:30:00.000Z',
		...over,
	};
}

type Harness = {
	controller: StorefrontAuthController;
	oauth: OAuthService;
	/** Rows the identity repository actually holds — the thing sign-in reads. */
	rows: AuthIdentity[];
	/** The `identities` array handed to `CustomerRepository.save()`, write-through only. */
	savedIdentities: Array<{ provider: string; email?: string | null; providerId?: string | null }>;
	passwordsWritten: number;
};

function harness(options: { consumed?: Record<string, unknown>; preclaimedBy?: string } = {}): Harness {
	const rows: AuthIdentity[] = [];
	const result = { rows, savedIdentities: [], passwordsWritten: 0 } as unknown as Harness;

	if (options.preclaimedBy) {
		rows.push({
			id: 'aid_existing',
			subjectType: 'customer',
			subjectId: options.preclaimedBy,
			provider: 'google',
			providerSubject: GOOGLE_SUBJECT,
			email: null,
			linkedAt: '2026-01-01T00:00:00.000Z',
			lastUsedAt: null,
		});
	}

	const identities = {
		findByProviderSubject: async (provider: string, providerSubject: string) =>
			rows.find((row) => row.provider === provider && row.providerSubject === providerSubject) ?? null,
		link: async (identity: AuthIdentity) => {
			// The unique index the real collection carries, modelled: a second row for one pair is
			// exactly what `link`'s conflict check exists to prevent reaching.
			if (
				rows.some(
					(row) => row.provider === identity.provider && row.providerSubject === identity.providerSubject,
				)
			) {
				throw new Error('E11000 duplicate key');
			}
			rows.push(identity);
			return identity;
		},
		listForSubject: async (subjectType: string, subjectId: string) =>
			rows.filter((row) => row.subjectType === subjectType && row.subjectId === subjectId),
		unlink: async () => true,
		touch: async () => undefined,
	};

	const oauth = new OAuthService(config, {} as never, identities as never, { hash: (v: string) => v } as never);

	const consumed = consumedRecord(options.consumed);
	const signup = {
		require: async () => consumed,
		resolve: async () => ({ kind: 'create' as const }),
		consume: async () => consumed,
	};

	const auth = {
		normalizeEmail: (value: string) => value.trim().toLowerCase(),
		hashPassword: async (plain: string) => `hashed:${plain}`,
		customerRepository: {
			save: async (customer: { id: string; identities?: Harness['savedIdentities'] }) => {
				result.savedIdentities = customer.identities ?? [];
				return { ...customer, id: 'cus_new' };
			},
		},
		customerAuthRepository: {
			setPasswordHash: async () => {
				result.passwordsWritten += 1;
			},
			findAuthStateById: async () => ({ id: 'cus_new', status: 'active', tokenVersion: 0, passwordHash: null }),
		},
		publicCustomer: async () => ({ id: 'cus_new', email: PROVEN_EMAIL, phone: PROVEN_PHONE }),
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

	const carts = { mergeGuestCartForUser: async () => undefined };

	result.oauth = oauth;
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
		oauth,
		transactions as never,
		config,
	);
	return result;
}

const request = () => ({ cookies: { [cookieNames(config).signup]: 'psk_1' }, ip: '127.0.0.1' }) as never;
const reply = () => ({ setCookie: () => undefined }) as never;

const finalise = (h: Harness, body: Record<string, unknown> = {}) =>
	h.controller.finaliseSignup(body as never, request(), reply());

const google = { origin: 'google', provider: 'google', providerSubject: GOOGLE_SUBJECT };

/**
 * The stable code, read where `domainRefusal` actually puts it.
 *
 * Not `error.message` — the filter replaces that with 'Validation failed' on purpose, so the code
 * travels in `issues[].code`. Asserting the message would pass against any refusal at all, which
 * is the whole failure mode §2.5 fixed; asserting the code is what distinguishes this refusal from
 * the duplicate-key 500 the other linking path produces.
 */
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

describe('a social signup', () => {
	it('links the provider identity it was created from', async () => {
		const h = harness({ consumed: google });
		await finalise(h);

		expect(h.rows).toHaveLength(1);
		expect(h.rows[0]).toMatchObject({
			subjectType: 'customer',
			subjectId: 'cus_new',
			provider: 'google',
			providerSubject: GOOGLE_SUBJECT,
		});
	});

	/**
	 * The lockout, stated as the lookup that was failing. `findCustomerIdFor` is what the OAuth
	 * verify path calls on the NEXT provider click; before the fix it answered null forever.
	 */
	it('is recognised by the same lookup the next provider sign-in performs', async () => {
		const h = harness({ consumed: google });
		expect(
			await h.oauth.findCustomerIdFor({ provider: 'google', subject: GOOGLE_SUBJECT, email: null }),
		).toBeNull();

		await finalise(h);

		expect(await h.oauth.findCustomerIdFor({ provider: 'google', subject: GOOGLE_SUBJECT, email: null })).toBe(
			'cus_new',
		);
	});

	/** Keyed on the SUBJECT, never the proven email — the port says so and this holds it to it. */
	it('keys the link on the provider subject rather than the address', async () => {
		const h = harness({ consumed: google });
		await finalise(h);

		expect(h.rows[0]?.providerSubject).toBe(GOOGLE_SUBJECT);
		expect(h.rows[0]?.providerSubject).not.toBe(PROVEN_EMAIL);
	});

	it('writes no password identity when no password was set', async () => {
		const h = harness({ consumed: google });
		await finalise(h);

		expect(h.savedIdentities).toEqual([]);
		expect(h.passwordsWritten).toBe(0);
	});

	/**
	 * A password is a CREDENTIAL, not an identity. `authIdentities` holds provider links only, so
	 * a social signup that also sets a password ends with one identity row and one credential —
	 * never a second row claiming `provider: 'password'`.
	 */
	it('records the password as a credential and leaves the identity list to the provider', async () => {
		const h = harness({ consumed: google });
		await finalise(h, { password: 'a-perfectly-adequate-passphrase' });

		expect(h.rows.map((row) => row.provider)).toEqual(['google']);
		expect(h.passwordsWritten).toBe(1);
		expect(h.savedIdentities).toEqual([]);
	});

	/**
	 * Refused as a stable code, not a duplicate-key 500 — which is what the `identities` array
	 * path would have produced, because `insertMany` reaches the unique index with no check.
	 */
	it('refuses a subject another customer has claimed, and writes no password for it', async () => {
		const h = harness({ consumed: google, preclaimedBy: 'cus_somebody_else' });

		expect(await refusalCodeOf(finalise(h, { password: 'a-perfectly-adequate-passphrase' }))).toBe(
			'oauth_identity_conflict',
		);
		expect(h.rows).toHaveLength(1);
		expect(h.rows[0]?.subjectId).toBe('cus_somebody_else');
		expect(h.passwordsWritten).toBe(0);
	});
});

describe('a password signup', () => {
	it('writes a credential and no identity rows at all', async () => {
		const h = harness();
		await finalise(h, { password: 'a-perfectly-adequate-passphrase' });

		expect(h.passwordsWritten).toBe(1);
		expect(h.rows).toEqual([]);
	});

	/**
	 * `save` used to take an `identities` array and replace the whole set from it. It no longer
	 * accepts instructions that way, so nothing a caller passes there can reach the collection —
	 * which is what stops a partial list from erasing a link it did not know about.
	 */
	it('sends no identities through the customer save at all', async () => {
		const h = harness({ consumed: google });
		await finalise(h, { password: 'a-perfectly-adequate-passphrase' });

		expect(h.savedIdentities).toEqual([]);
	});
});
