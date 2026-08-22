import { describe, expect, it } from 'vitest';

import type { Customer } from '@saha-textile/contracts';
import { DuplicateIdentifierError, type PendingContactChange } from '@saha-textile/core-domain';

import { ContactChangeService } from '../src/storefront/contact-change.service';

/**
 * Moving the email or phone on an account.
 *
 * This is the request an attacker with a live session makes FIRST: take the recovery channel and
 * a five-minute theft becomes permanent ownership. So the cases below are about what the flow
 * refuses to do, and in particular about the window between asking and proving — during which
 * the account must be completely unchanged.
 *
 * The fakes are deliberately shallow. Argon2, the OTP challenge store and Mongo all have their
 * own coverage; what has never been pinned down is the ORDER of this flow's decisions, which is
 * where its security lives.
 */

const CUSTOMER_ID = 'cus_1';
const OTHER_ID = 'cus_2';
const RIGHT_CODE = '424242';

function customer(over: Partial<Customer> = {}): Customer {
	return {
		id: CUSTOMER_ID,
		email: 'old@example.test',
		emailVerified: true,
		phone: '+919900000001',
		phoneVerified: true,
		displayName: 'Ada',
		status: 'active',
		identities: [],
		addresses: [],
		contacts: [],
		savedSizes: [],
		measurementProfiles: [],
		guestCartId: null,
		createdAt: '2026-01-01T00:00:00.000Z',
		updatedAt: '2026-01-01T00:00:00.000Z',
		...over,
	};
}

type Harness = {
	service: ContactChangeService;
	/** Every OTP actually dispatched, in order. */
	sent: Array<{ identifier: string; purpose: string; channel: string }>;
	/** Every non-OTP notification — the warning to the value being replaced. */
	notified: Array<{ destination: string; templateKey: string; variables: Record<string, unknown> }>;
	audits: Array<{ action: string; before: unknown; after: unknown; retentionTier: string }>;
	/** What the customer row now holds — the thing that must not move early. */
	row: Customer;
	pending: PendingContactChange | null;
	stepUpCalls: number;
};

/**
 * @param options.hasPassword drives which step-up proof the account requires.
 * @param options.takenBy an account already holding the value the caller will ask for.
 */
function harness(
	options: {
		hasPassword?: boolean;
		takenBy?: string;
		password?: string;
		writeFails?: unknown;
		auditFails?: boolean;
	} = {},
): Harness {
	const password = options.password ?? 'the-current-passphrase';
	const result = {
		sent: [],
		notified: [],
		audits: [],
		row: customer(),
		pending: null,
		stepUpCalls: 0,
	} as unknown as Harness;

	const auth = {
		normalizeEmail: (value: string) => value.trim().toLowerCase(),
		publicCustomer: async () => result.row,
		assertStepUp: async (_id: string, proof: { password?: string; otpCode?: string }) => {
			result.stepUpCalls += 1;
			// Mirrors the real rule closely enough to test ORDER: the password path when one
			// exists, an OTP otherwise, and the wrong kind of proof is never accepted.
			const ok = options.hasPassword === false ? proof.otpCode === RIGHT_CODE : proof.password === password;
			if (!ok) throw new Error('step_up_required');
		},
		issueOtp: async (input: { identifier: string; purpose: string; channel: string }) => {
			result.sent.push(input);
		},
		verifyOtp: async ({ identifier, purpose, code }: { identifier: string; purpose: string; code: string }) => {
			// Keyed on the destination AND the purpose, as the real store is: a code is only
			// good for the value it was sent to.
			const issued = result.sent.some((s) => s.identifier === identifier && s.purpose === purpose);
			return issued && code === RIGHT_CODE ? { userId: CUSTOMER_ID } : null;
		},
	};

	const pending = {
		start: async (record: PendingContactChange) => {
			result.pending = record;
			return record;
		},
		findByCustomerId: async () => result.pending,
		recordSend: async (_id: string, sentAt: string, expiresAt: string) => {
			if (!result.pending) return null;
			result.pending = { ...result.pending, sends: result.pending.sends + 1, lastSentAt: sentAt, expiresAt };
			return result.pending;
		},
		consume: async () => {
			const held = result.pending;
			result.pending = null;
			return held;
		},
		deleteByCustomerId: async () => {
			const had = result.pending !== null;
			result.pending = null;
			return had;
		},
	};

	const owner = options.takenBy ? { id: options.takenBy } : null;
	const customers = { findByEmail: async () => owner, findByPhone: async () => owner };

	const customerAuth = {
		markEmailVerified: async (_id: string, email: string) => {
			if (options.writeFails) throw options.writeFails;
			result.row = { ...result.row, email, emailVerified: true };
		},
		markPhoneVerified: async (_id: string, phone: string) => {
			if (options.writeFails) throw options.writeFails;
			result.row = { ...result.row, phone, phoneVerified: true };
		},
	};

	const notifications = {
		send: async (message: { destination: string; templateKey: string; variables?: Record<string, unknown> }) => {
			result.notified.push({
				destination: message.destination,
				templateKey: message.templateKey,
				variables: message.variables ?? {},
			});
			return { status: 'sent', providerMessageId: 'x', outboxEntryId: 'y' };
		},
	};

	const audit = {
		append: async (entry: {
			action: string;
			retentionTier: string;
			diffs: Array<{ before?: unknown; after?: unknown }>;
		}) => {
			if (options.auditFails) throw new Error('audit store unavailable');
			result.audits.push({
				action: entry.action,
				before: entry.diffs[0]?.before,
				after: entry.diffs[0]?.after,
				retentionTier: entry.retentionTier,
			});
			return entry as never;
		},
	};

	/**
	 * Models the port's own contract: the work runs, and a thrown error ABORTS it and propagates
	 * unchanged. Snapshotting the three pieces of state the callback can touch is what lets these
	 * cases assert the guarantee the service is relying on rather than merely that it called
	 * something named `withTransaction`.
	 */
	const transactions = {
		withTransaction: async <T>(work: () => Promise<T>): Promise<T> => {
			const before = { row: result.row, pending: result.pending, audits: [...result.audits] };
			try {
				return await work();
			} catch (error) {
				result.row = before.row;
				result.pending = before.pending;
				result.audits = before.audits;
				throw error;
			}
		},
	};

	result.service = new ContactChangeService(
		pending as never,
		customers as never,
		customerAuth as never,
		notifications as never,
		audit as never,
		transactions as never,
		auth as never,
	);
	return result;
}

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

const startEmail = (h: Harness, over: Record<string, unknown> = {}) =>
	h.service.start({
		customerId: CUSTOMER_ID,
		field: 'email',
		rawValue: 'new@example.test',
		proof: { password: 'the-current-passphrase' },
		...over,
	} as never);

describe('proof is required before anything happens', () => {
	it('refuses without step-up, and sends nothing', async () => {
		const h = harness();

		await expect(startEmail(h, { proof: {} })).rejects.toThrow();
		expect(h.sent).toHaveLength(0);
		expect(h.notified).toHaveLength(0);
		expect(h.pending).toBeNull();
	});

	it('refuses proof of the wrong kind — a code where a password exists', async () => {
		const h = harness({ hasPassword: true });

		await expect(startEmail(h, { proof: { otpCode: RIGHT_CODE } })).rejects.toThrow();
		expect(h.sent).toHaveLength(0);
	});

	it('takes a code when the account has no password', async () => {
		const h = harness({ hasPassword: false });

		await expect(startEmail(h, { proof: { otpCode: RIGHT_CODE } })).resolves.toBeTruthy();
		expect(h.sent).toHaveLength(1);
	});

	/**
	 * Ordering, stated on its own: the proof is checked BEFORE a message is dispatched, so this
	 * route cannot be used to mail an arbitrary address without a credential.
	 */
	it('proves the caller before it will send anywhere', async () => {
		const h = harness();
		await expect(startEmail(h, { proof: { password: 'wrong' } })).rejects.toThrow();

		expect(h.stepUpCalls).toBe(1);
		expect(h.sent).toHaveLength(0);
	});
});

describe('the old value keeps working until the new one is proven', () => {
	it('leaves the account untouched when a change is started', async () => {
		const h = harness();
		await startEmail(h);

		expect(h.row.email).toBe('old@example.test');
		expect(h.row.emailVerified).toBe(true);
		expect(h.sent[0]).toMatchObject({ identifier: 'new@example.test', channel: 'email' });
	});

	it('leaves it untouched when the code is wrong', async () => {
		const h = harness();
		await startEmail(h);

		await expect(h.service.confirm(CUSTOMER_ID, '000000')).rejects.toThrow();
		expect(h.row.email).toBe('old@example.test');
	});

	/** A mistyped digit must not end the attempt — the change is still there to try again. */
	it('keeps the change in flight after a wrong code', async () => {
		const h = harness();
		await startEmail(h);
		await h.service.confirm(CUSTOMER_ID, '000000').catch(() => undefined);

		expect(h.pending).not.toBeNull();
		await expect(h.service.confirm(CUSTOMER_ID, RIGHT_CODE)).resolves.toBeTruthy();
	});

	it('moves the value only on confirmation', async () => {
		const h = harness();
		await startEmail(h);
		await h.service.confirm(CUSTOMER_ID, RIGHT_CODE);

		expect(h.row.email).toBe('new@example.test');
		expect(h.row.emailVerified).toBe(true);
	});

	it('does the same for a phone, by SMS', async () => {
		const h = harness();
		await h.service.start({
			customerId: CUSTOMER_ID,
			field: 'phone',
			rawValue: '+919900000002',
			proof: { password: 'the-current-passphrase' },
		});
		expect(h.sent[0]).toMatchObject({ identifier: '+919900000002', channel: 'sms' });
		expect(h.row.phone).toBe('+919900000001');

		await h.service.confirm(CUSTOMER_ID, RIGHT_CODE);
		expect(h.row.phone).toBe('+919900000002');
	});
});

describe('a value another account already holds', () => {
	/**
	 * The anti-enumeration posture, and the case that makes it real: start must look and cost
	 * exactly the same whether or not the value is taken. Only the dispatch is skipped.
	 */
	it('is accepted at start, and reported no differently', async () => {
		const free = harness();
		const taken = harness({ takenBy: OTHER_ID });

		const freeState = await startEmail(free);
		const takenState = await startEmail(taken);

		// Timestamps are dropped, not because they may differ but because they differ by the
		// millisecond the two calls are apart. What must match is every field a caller could
		// read an answer out of: the value, the remaining budget, and whether a wait applies.
		const comparable = (state: typeof freeState) => ({
			...state,
			expiresAt: null,
			resendAvailableAt: state.resendAvailableAt === null ? null : 'set',
		});

		expect(comparable(takenState)).toEqual(comparable(freeState));
		expect(taken.sent).toHaveLength(0);
		expect(free.sent).toHaveLength(1);
	});

	it('spends the send budget anyway, so the countdown cannot be read as an answer', async () => {
		const taken = harness({ takenBy: OTHER_ID });
		const state = await startEmail(taken);

		expect(state.sendsRemaining).toBe(4);
		expect(state.resendAvailableAt).not.toBeNull();
	});

	/**
	 * Refused at CONFIRMATION, where the caller has proven control of the value. That is the
	 * same disclosure rule the signup flow follows: silence before proof, plain speech after.
	 */
	it('is refused once the caller has proven control of it', async () => {
		const h = harness();
		await startEmail(h);
		// The value is claimed between starting and confirming.
		const claimed = harness({ takenBy: OTHER_ID });
		claimed.pending = h.pending;
		claimed.sent.push(...h.sent);

		await expect(claimed.service.confirm(CUSTOMER_ID, RIGHT_CODE)).rejects.toThrow();
		expect(claimed.row.email).toBe('old@example.test');
	});
});

describe('the three writes commit together', () => {
	/**
	 * The sharpest of the failures this replaced: the value moved, the caller was told it had
	 * not, and no audit row recorded that an account's recovery channel had changed.
	 */
	it('does not move the value when the audit write fails', async () => {
		const h = harness({ auditFails: true });
		await startEmail(h);

		await expect(h.service.confirm(CUSTOMER_ID, RIGHT_CODE)).rejects.toThrow();
		expect(h.row.email).toBe('old@example.test');
		expect(h.audits).toEqual([]);
	});

	/** And the proof is not spent either, so the person needs a new code — not a new step-up. */
	it('leaves the pending change in flight when the audit write fails', async () => {
		const h = harness({ auditFails: true });
		await startEmail(h);

		await h.service.confirm(CUSTOMER_ID, RIGHT_CODE).catch(() => undefined);
		expect(h.pending).not.toBeNull();
	});

	it('writes no audit row when the value write fails', async () => {
		const h = harness({ writeFails: new Error('replica set unavailable') });
		await startEmail(h);

		await expect(h.service.confirm(CUSTOMER_ID, RIGHT_CODE)).rejects.toThrow(/replica set unavailable/);
		expect(h.audits).toEqual([]);
		expect(h.pending).not.toBeNull();
	});

	it('applies all three on success', async () => {
		const h = harness();
		await startEmail(h);
		await h.service.confirm(CUSTOMER_ID, RIGHT_CODE);

		expect(h.row.email).toBe('new@example.test');
		expect(h.audits).toHaveLength(1);
		expect(h.pending).toBeNull();
	});
});

describe('a race lost to the unique index', () => {
	/**
	 * Ownership was free when checked and taken by the time of the write. Reported as the refusal
	 * the check itself would have given, rather than as the driver error the caller cannot read.
	 */
	it('is reported as contact_in_use rather than a storage failure', async () => {
		const h = harness({ writeFails: new DuplicateIdentifierError('email') });
		await startEmail(h);

		expect(await refusalCodeOf(h.service.confirm(CUSTOMER_ID, RIGHT_CODE))).toBe('contact_in_use');
		expect(h.row.email).toBe('old@example.test');
	});

	it('leaves an unrelated storage failure alone', async () => {
		const h = harness({ writeFails: new Error('disk on fire') });
		await startEmail(h);

		expect(await refusalCodeOf(h.service.confirm(CUSTOMER_ID, RIGHT_CODE))).toBe('disk on fire');
	});
});

describe('the rest of the promise', () => {
	it('warns the value being replaced, without handing over the new one', async () => {
		const h = harness();
		await startEmail(h);

		expect(h.notified).toHaveLength(1);
		expect(h.notified[0]?.destination).toBe('old@example.test');
		expect(h.notified[0]?.templateKey).toBe('contact_change_requested');
		expect(JSON.stringify(h.notified[0]?.variables)).not.toContain('new@example.test');
	});

	it('warns before the code goes out, not after the swap', async () => {
		const h = harness();
		await startEmail(h);
		// The warning is the one message that reaches the person being displaced; by the swap it
		// would be a receipt rather than a warning.
		expect(h.notified).toHaveLength(1);
		expect(h.row.email).toBe('old@example.test');
	});

	it('audits the change with both values and the long retention tier', async () => {
		const h = harness();
		await startEmail(h);
		await h.service.confirm(CUSTOMER_ID, RIGHT_CODE);

		expect(h.audits).toEqual([
			{
				action: 'customer.contact.email.change',
				before: 'old@example.test',
				after: 'new@example.test',
				retentionTier: 'financial_security',
			},
		]);
	});

	it('refuses a change to the value the account already has', async () => {
		const h = harness();

		await expect(startEmail(h, { rawValue: 'OLD@example.test' })).rejects.toThrow();
		expect(h.sent).toHaveLength(0);
	});

	it('cannot be confirmed twice from one proof', async () => {
		const h = harness();
		await startEmail(h);
		await h.service.confirm(CUSTOMER_ID, RIGHT_CODE);

		await expect(h.service.confirm(CUSTOMER_ID, RIGHT_CODE)).rejects.toThrow();
	});

	it('refuses to confirm when nothing is in flight', async () => {
		await expect(harness().service.confirm(CUSTOMER_ID, RIGHT_CODE)).rejects.toThrow();
	});

	it('reports nothing pending once the record has expired', async () => {
		const h = harness();
		await startEmail(h);
		h.pending = { ...(h.pending as PendingContactChange), expiresAt: new Date(Date.now() - 1000).toISOString() };

		expect(await h.service.pendingFor(CUSTOMER_ID)).toBeNull();
		await expect(h.service.confirm(CUSTOMER_ID, RIGHT_CODE)).rejects.toThrow();
	});

	it('refuses a resend before the backoff has elapsed', async () => {
		const h = harness();
		await startEmail(h);

		await expect(h.service.resend(CUSTOMER_ID)).rejects.toThrow();
		expect(h.sent).toHaveLength(1);
	});

	it('resends without asking for the password again', async () => {
		const h = harness();
		await startEmail(h);
		h.pending = { ...(h.pending as PendingContactChange), lastSentAt: new Date(0).toISOString() };
		const before = h.stepUpCalls;

		await h.service.resend(CUSTOMER_ID);
		expect(h.sent).toHaveLength(2);
		expect(h.stepUpCalls).toBe(before);
	});

	it('stops sending once the budget is spent', async () => {
		const h = harness();
		await startEmail(h);
		h.pending = { ...(h.pending as PendingContactChange), sends: 5, lastSentAt: new Date(0).toISOString() };

		await expect(h.service.resend(CUSTOMER_ID)).rejects.toThrow();
		expect(h.sent).toHaveLength(1);
	});
});
