import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { COLLECTION_NAMES } from '../src/collection-names';
import { connectMongo, disconnectMongo, getMongoose } from '../src/connection';
import { MongoPendingSignupRepository } from '../src/repositories/pending-signup.repository';

const runDb = process.env.RUN_DB_IT === '1';

const minutes = (n: number) => new Date(Date.now() + n * 60_000).toISOString();

const pending = (overrides: Record<string, unknown> = {}) => ({
	id: `psu_${Math.random().toString(36).slice(2)}`,
	sessionKey: `sess_${Math.random().toString(36).slice(2)}`,
	origin: 'password' as const,
	email: { value: null, verified: false, locked: false, sends: 0, lastSentAt: null },
	phone: { value: null, verified: false, locked: false, sends: 0, lastSentAt: null },
	displayName: null,
	marketingOptIn: false,
	guestCartId: null,
	provider: null,
	providerSubject: null,
	createdAt: new Date().toISOString(),
	expiresAt: minutes(15),
	absoluteExpiresAt: minutes(30),
	...overrides,
});

describe.runIf(runDb)('MongoPendingSignupRepository (rs0)', () => {
	const repository = new MongoPendingSignupRepository();

	beforeAll(async () => {
		await connectMongo();
	});

	afterAll(async () => {
		await getMongoose().connection.collection(COLLECTION_NAMES.PendingSignup).deleteMany({});
		await disconnectMongo();
	});

	beforeEach(async () => {
		await getMongoose().connection.collection(COLLECTION_NAMES.PendingSignup).deleteMany({});
	});

	it('round-trips a pending signup through the port shape', async () => {
		const created = await repository.start(pending({ displayName: 'Rina', marketingOptIn: true }));

		const found = await repository.findBySessionKey(created.sessionKey);
		expect(found?.displayName).toBe('Rina');
		expect(found?.marketingOptIn).toBe(true);
		expect(found?.email.verified).toBe(false);
	});

	/**
	 * Starting over replaces the abandoned attempt rather than colliding with it. Someone who
	 * walked away from a form should not be refused by their own ghost.
	 */
	it('replaces an abandoned attempt for the same session', async () => {
		const first = await repository.start(pending({ sessionKey: 'sess_same', displayName: 'First' }));
		const second = await repository.start(pending({ sessionKey: 'sess_same', displayName: 'Second' }));

		expect(second.displayName).toBe('Second');
		const rows = await getMongoose().connection.collection(COLLECTION_NAMES.PendingSignup).countDocuments();
		expect(rows).toBe(1);
		expect(first.sessionKey).toBe(second.sessionKey);
	});

	/**
	 * The property that makes editing a verified field safe: the value and the cleared flag move
	 * in ONE update, so there is no window in which a new address wears the old one's proof.
	 */
	it('clears the verified flag in the same write that changes the value', async () => {
		const created = await repository.start(pending());
		await repository.setFieldValue(created.id, 'email', 'a@example.test');
		const verified = await repository.markVerified(created.id, 'email', minutes(15));
		expect(verified?.email.verified).toBe(true);

		const edited = await repository.setFieldValue(created.id, 'email', 'b@example.test');
		expect(edited?.email.value).toBe('b@example.test');
		expect(edited?.email.verified).toBe(false);
	});

	it('counts sends per field and slides the expiry', async () => {
		const created = await repository.start(pending());

		await repository.recordSend(created.id, 'email', new Date().toISOString(), minutes(20));
		const after = await repository.recordSend(created.id, 'email', new Date().toISOString(), minutes(25));

		expect(after?.email.sends).toBe(2);
		expect(after?.phone.sends).toBe(0);
		expect(new Date(after!.expiresAt).getTime()).toBeGreaterThan(new Date(created.expiresAt).getTime());
	});

	it('attaches a provider identity server-side', async () => {
		const created = await repository.start(pending({ origin: 'google' }));

		const attached = await repository.attachProvider(created.id, 'google', 'g_sub_1', minutes(20));

		expect(attached?.provider).toBe('google');
		expect(attached?.providerSubject).toBe('g_sub_1');
	});

	/**
	 * Single use, proven by racing it. Two finalise requests on one proof must not both mint an
	 * account — exactly one caller may win, and the loser is told the signup expired.
	 */
	it('lets exactly one of two concurrent consumers win', async () => {
		const created = await repository.start(pending());

		const [a, b] = await Promise.all([repository.consume(created.id), repository.consume(created.id)]);

		expect([a, b].filter(Boolean)).toHaveLength(1);
		expect(await repository.findBySessionKey(created.sessionKey)).toBeNull();
	});

	/**
	 * A pending row must NOT reserve its email or phone. Reserving would let one caller park
	 * thousands of addresses in fifteen-minute blocks and stall real signups — a denial of
	 * service dressed as a safety feature. Uniqueness belongs to `customers` alone.
	 */
	it('permits two sessions to hold the same address at once', async () => {
		await repository.start(
			pending({
				sessionKey: 'sess_a',
				email: { value: 'shared@example.test', verified: true, locked: false, sends: 1, lastSentAt: null },
			}),
		);

		const second = repository.start(
			pending({
				sessionKey: 'sess_b',
				email: { value: 'shared@example.test', verified: true, locked: false, sends: 1, lastSentAt: null },
			}),
		);

		await expect(second).resolves.toBeDefined();
	});

	it('reports nothing for an unknown session rather than throwing', async () => {
		expect(await repository.findBySessionKey('sess_never_existed')).toBeNull();
		expect(await repository.consume('psu_never_existed')).toBeNull();
	});
});
