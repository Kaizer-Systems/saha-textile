import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Customer, OtpChallenge } from '@saha-textile/contracts';
import { DuplicateIdentifierError } from '@saha-textile/core-domain';

import { buildMongoConfig } from '../src/config';
import { connectMongo, disconnectMongo } from '../src/connection';
import {
	AuditLogModel,
	AuthIdentityModel,
	CustomerModel,
	EmailVerificationTokenModel,
	OtpChallengeModel,
	PasswordResetTokenModel,
} from '../src/models/index';
import { MongoAuthIdentityRepository } from '../src/repositories/auth-identity.repository';
import {
	MongoEmailVerificationTokenRepository,
	MongoOtpChallengeRepository,
	MongoPasswordResetTokenRepository,
} from '../src/repositories/auth.repository';
import { MongoCustomerRepository } from '../src/repositories/customer.repository';
import { MongoTransactionManager } from '../src/transaction-manager';

/**
 * Customer soft delete and restore against a REAL replica set (`DEC-CUSTOMER-SOFT-DELETE-OPS`,
 * `DEC-SOFT-DELETED-IDENTITY-REUSE`).
 *
 * Live because what matters here is decided by the server, not by code: the partial unique
 * indexes that release and re-claim an email or phone, the pipeline update that remembers the
 * replaced status, and a provider release that rolls back with its transaction.
 *
 * Refuses any database that is not a throwaway one — `syncIndexes` drops indexes the schema does
 * not declare, and a test once wiped a developer database.
 *
 *   MONGODB_PORT=27018 MONGODB_DB_NAME=saha_textile_it RUN_DB_IT=1 \
 *     pnpm --filter @saha-textile/adapters-db-mongo test
 */
function hasTestMongo(): boolean {
	if (process.env.RUN_DB_IT !== '1') return false;
	try {
		return /_(it|e2e)$/.test(buildMongoConfig().dbName);
	} catch {
		return false;
	}
}

const PREFIX = 'cus_softdel_it_';

describe.skipIf(!hasTestMongo())('customer soft delete and restore (integration, rs0)', () => {
	const customers = new MongoCustomerRepository();
	const identities = new MongoAuthIdentityRepository();
	const otps = new MongoOtpChallengeRepository();
	const resets = new MongoPasswordResetTokenRepository();
	const verifications = new MongoEmailVerificationTokenRepository();
	const transactions = new MongoTransactionManager();

	const unique = () => randomUUID().slice(0, 8);

	const newCustomer = (overrides: Partial<Customer> = {}): Customer => {
		const tag = unique();
		return {
			id: `${PREFIX}${tag}`,
			email: `${tag}@softdel-it.test`,
			emailVerified: true,
			phone: `+9170${tag.replace(/\D/g, '0').padEnd(8, '0').slice(0, 8)}`,
			phoneVerified: true,
			status: 'active',
			identities: [],
			addresses: [],
			contacts: [],
			savedSizes: [],
			measurementProfiles: [],
			guestCartId: null,
			...overrides,
		} as Customer;
	};

	const link = (subjectId: string, provider: string, providerSubject: string) =>
		identities.link({
			id: `aid_softdel_it_${randomUUID()}`,
			subjectType: 'customer',
			subjectId,
			provider,
			providerSubject,
			email: null,
			linkedAt: new Date().toISOString(),
			lastUsedAt: null,
		});

	const challenge = (identifier: string, userId: string | null): OtpChallenge => ({
		id: `otp_softdel_it_${randomUUID()}`,
		identifier,
		purpose: 'login',
		channel: 'email',
		codeHash: 'hmac:it',
		userId,
		attempts: 0,
		maxAttempts: 5,
		resendCount: 0,
		lastSentAt: null,
		ipHash: null,
		userAgentHash: null,
		createdAt: new Date().toISOString(),
		expiresAt: new Date(Date.now() + 600_000).toISOString(),
		consumedAt: null,
		blockedAt: null,
	});

	beforeAll(async () => {
		await connectMongo();
		await Promise.all([
			CustomerModel.syncIndexes(),
			AuthIdentityModel.syncIndexes(),
			OtpChallengeModel.syncIndexes(),
			PasswordResetTokenModel.syncIndexes(),
			EmailVerificationTokenModel.syncIndexes(),
		]);
	});

	afterAll(async () => {
		await Promise.all([
			CustomerModel.deleteMany({ _id: new RegExp(`^${PREFIX}`) }).exec(),
			AuthIdentityModel.deleteMany({ subjectId: new RegExp(`^${PREFIX}`) }).exec(),
			OtpChallengeModel.deleteMany({ _id: /^otp_softdel_it_/ }).exec(),
			PasswordResetTokenModel.deleteMany({ userId: new RegExp(`^${PREFIX}`) }).exec(),
			EmailVerificationTokenModel.deleteMany({ userId: new RegExp(`^${PREFIX}`) }).exec(),
			AuditLogModel.deleteMany({ targetUserId: new RegExp(`^${PREFIX}`) }).exec(),
		]);
		await disconnectMongo();
	});

	it('remembers the replaced status, bumps the token version, and frees the email and phone', async () => {
		const row = await customers.save(newCustomer({ status: 'locked' }));
		const before = await CustomerModel.findById(row.id).lean().exec();

		const deleted = await customers.softDelete(row.id, new Date().toISOString());
		const stored = await CustomerModel.findById(row.id).lean().exec();

		expect(deleted?.status).toBe('deleted');
		expect(stored).toMatchObject({ status: 'deleted', statusBeforeDelete: 'locked' });
		expect(stored?.deletedAt).toBeInstanceOf(Date);
		expect(stored?.tokenVersion).toBe((before?.tokenVersion ?? 0) + 1);

		// The address is released: a new customer may take it.
		const reuser = await customers.save(newCustomer({ email: row.email, phone: row.phone }));
		expect(reuser.email).toBe(row.email);
	});

	it('refuses a second delete of the same row', async () => {
		const row = await customers.save(newCustomer());
		await customers.softDelete(row.id, new Date().toISOString());
		expect(await customers.softDelete(row.id, new Date().toISOString())).toBeNull();
	});

	it('restores the remembered status and clears the tombstone', async () => {
		const row = await customers.save(newCustomer({ status: 'pending' }));
		await customers.softDelete(row.id, new Date().toISOString());

		const restored = await customers.restore(row.id);
		const stored = await CustomerModel.findById(row.id).lean().exec();

		expect(restored?.status).toBe('pending');
		expect(stored).toMatchObject({ status: 'pending', statusBeforeDelete: null, deletedAt: null });
		expect(await customers.restore(row.id)).toBeNull();
	});

	it('restores a row deleted before the status was remembered as disabled', async () => {
		const row = await customers.save(newCustomer());
		await CustomerModel.updateOne({ _id: row.id }, { $set: { status: 'deleted' } }).exec();

		expect((await customers.restore(row.id))?.status).toBe('disabled');
	});

	it('lets the unique index refuse a restore when another live customer took the email or phone', async () => {
		const gone = await customers.save(newCustomer());
		await customers.softDelete(gone.id, new Date().toISOString());
		await customers.save(newCustomer({ email: gone.email }));

		await expect(customers.restore(gone.id)).rejects.toEqual(new DuplicateIdentifierError('email'));
		expect((await CustomerModel.findById(gone.id).lean().exec())?.status).toBe('deleted');

		const phoneGone = await customers.save(newCustomer());
		await customers.softDelete(phoneGone.id, new Date().toISOString());
		await customers.save(newCustomer({ phone: phoneGone.phone }));
		await expect(customers.restore(phoneGone.id)).rejects.toEqual(new DuplicateIdentifierError('phone'));
	});

	it('releases Google and Facebook links so the same provider account can sign up again', async () => {
		const row = await customers.save(newCustomer());
		const googleSubject = `google_it_${unique()}`;
		await link(row.id, 'google', googleSubject);
		await link(row.id, 'facebook', `facebook_it_${unique()}`);
		await link(row.id, 'password', row.email ?? '');

		const released = await transactions.withTransaction(() =>
			identities.releaseForSubject('customer', row.id, ['google', 'facebook']),
		);

		expect(released.map((identity) => identity.provider).sort()).toEqual(['facebook', 'google']);
		expect((await identities.listForSubject('customer', row.id)).map((identity) => identity.provider)).toEqual([
			'password',
		]);

		// The pair is unique: this would throw if the old link still existed.
		const newcomer = await customers.save(newCustomer());
		await expect(link(newcomer.id, 'google', googleSubject)).resolves.toMatchObject({ subjectId: newcomer.id });
	});

	it('keeps the links when the delete transaction rolls back', async () => {
		const row = await customers.save(newCustomer());
		await link(row.id, 'google', `google_it_${unique()}`);

		await expect(
			transactions.withTransaction(async () => {
				await customers.softDelete(row.id, new Date().toISOString());
				await identities.releaseForSubject('customer', row.id, ['google', 'facebook']);
				throw new Error('deliberate failure after the release');
			}),
		).rejects.toThrow(/deliberate failure/);

		expect((await CustomerModel.findById(row.id).lean().exec())?.status).toBe('active');
		expect(await identities.listForSubject('customer', row.id)).toHaveLength(1);
	});

	it('ends open codes for the customer and frees the slot for the address', async () => {
		const row = await customers.save(newCustomer());
		const email = row.email ?? '';
		await otps.upsertActive(challenge(email, row.id));
		const unrelated = challenge(`other_${unique()}@softdel-it.test`, null);
		await otps.upsertActive(unrelated);

		const ended = await otps.revokeOpenFor({ userId: row.id, identifiers: [email] }, new Date().toISOString());

		expect(ended).toBe(1);
		expect(await otps.findActive(email, 'login')).toBeNull();
		expect(await otps.findActive(unrelated.identifier, 'login')).not.toBeNull();
		await expect(otps.upsertActive(challenge(email, null))).resolves.toBeDefined();
	});

	it('spends unused activation, reset and verification links for the customer only', async () => {
		const row = await customers.save(newCustomer());
		const now = Date.now();
		const token = (userId: string) => ({
			id: `prt_softdel_it_${randomUUID()}`,
			userId,
			tokenHash: `hash_${randomUUID()}`,
			audience: 'storefront' as const,
			ipHash: null,
			userAgentHash: null,
			createdAt: new Date(now).toISOString(),
			expiresAt: new Date(now + 600_000).toISOString(),
			consumedAt: null,
		});
		const mine = token(row.id);
		const theirs = token(`${PREFIX}someone_else`);
		await resets.create(mine);
		await resets.create(theirs);
		await verifications.create({
			id: `evt_softdel_it_${randomUUID()}`,
			userId: row.id,
			emailNormalized: row.email ?? '',
			tokenHash: `hash_${randomUUID()}`,
			createdAt: new Date(now).toISOString(),
			expiresAt: new Date(now + 600_000).toISOString(),
			consumedAt: null,
		});

		const at = new Date().toISOString();
		expect(await resets.revokeAllForUser(row.id, at)).toBe(1);
		expect(await verifications.revokeAllForUser(row.id, at)).toBe(1);

		expect(await resets.consume(mine.tokenHash, new Date().toISOString())).toBeNull();
		expect(await resets.consume(theirs.tokenHash, new Date().toISOString())).not.toBeNull();
	});
});
