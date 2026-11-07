import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Customer } from '@saha-textile/contracts';

import { buildMongoConfig } from '../src/config';
import { connectMongo, disconnectMongo } from '../src/connection';
import { AuthIdentityModel, CustomerModel, PasswordCredentialModel } from '../src/models/index';
import { MongoAuthIdentityRepository } from '../src/repositories/auth-identity.repository';
import { MongoCustomerAuthRepository } from '../src/repositories/auth.repository';
import { MongoCustomerRepository } from '../src/repositories/customer.repository';
import { MongoTransactionManager } from '../src/transaction-manager';

/**
 * Creating an account and every way into it, against a REAL replica set.
 *
 * Signup writes three collections: the customer row, its password credential, and its provider
 * identity. Sequentially, each gap left an account that half existed — a row with no credential,
 * or a password with no provider link — and because the address was taken by then, signing up
 * again was refused. Recoverable by one-time code, but not something anybody would guess.
 *
 * These have to be live: the three repositories join one transaction through `AsyncLocalStorage`
 * inside the adapters, which no fake can demonstrate.
 *
 *   MONGODB_PORT=27018 RUN_DB_IT=1 pnpm --filter @saha-textile/adapters-db-mongo test
 */
function hasMongoEnv(): boolean {
	if (process.env.RUN_DB_IT !== '1') return false;
	try {
		buildMongoConfig();
		return true;
	} catch {
		return false;
	}
}

describe.skipIf(!hasMongoEnv())('customer account atomicity (integration, rs0)', () => {
	const customers = new MongoCustomerRepository();
	const customerAuth = new MongoCustomerAuthRepository();
	const identities = new MongoAuthIdentityRepository();
	const transactions = new MongoTransactionManager();

	const newCustomer = (id: string): Customer =>
		({
			id,
			email: `${id}@atomicity-it.test`,
			emailVerified: true,
			phone: null,
			phoneVerified: false,
			status: 'active',
			identities: [],
			addresses: [],
			contacts: [],
			savedSizes: [],
			measurementProfiles: [],
			guestCartId: null,
		}) as Customer;

	/** Everything signup writes, in the order it writes it. */
	async function createAccount(id: string, options: { fail?: boolean } = {}): Promise<void> {
		await transactions.withTransaction(async () => {
			await customers.save(newCustomer(id));
			await identities.link({
				id: `aid_it_${randomUUID()}`,
				subjectType: 'customer',
				subjectId: id,
				provider: 'google',
				providerSubject: `google_it_${id}`,
				email: null,
				linkedAt: new Date().toISOString(),
				lastUsedAt: null,
			});
			await customerAuth.setPasswordHash(id, 'hashed:it');
			if (options.fail) throw new Error('deliberate failure after every write');
		});
	}

	const countsFor = async (id: string) => ({
		customer: await CustomerModel.countDocuments({ _id: id }),
		identity: await AuthIdentityModel.countDocuments({ subjectId: id }),
		credential: await PasswordCredentialModel.countDocuments({ subjectId: id }),
	});

	beforeAll(async () => {
		await connectMongo();
	});

	afterAll(async () => {
		await Promise.all([
			CustomerModel.deleteMany({ _id: /^cus_atom_it/ }).exec(),
			AuthIdentityModel.deleteMany({ subjectId: /^cus_atom_it/ }).exec(),
			PasswordCredentialModel.deleteMany({ subjectId: /^cus_atom_it/ }).exec(),
		]);
		await disconnectMongo();
	});

	it('commits the row, the identity and the credential together', async () => {
		const id = `cus_atom_it_${randomUUID()}`;
		await createAccount(id);

		expect(await countsFor(id)).toEqual({ customer: 1, identity: 1, credential: 1 });
	});

	/** The half-created account, which is the whole point: none of it may survive. */
	it('leaves nothing behind when a later step fails', async () => {
		const id = `cus_atom_it_${randomUUID()}`;

		await expect(createAccount(id, { fail: true })).rejects.toThrow(/deliberate failure/);

		expect(await countsFor(id)).toEqual({ customer: 0, identity: 0, credential: 0 });
	});

	/**
	 * `save` used to replace the whole identity set from its `identities` argument. It no longer
	 * accepts instructions that way, so a caller holding a partial list cannot erase a link.
	 */
	it('does not touch identities when the customer row is saved again', async () => {
		const id = `cus_atom_it_${randomUUID()}`;
		await createAccount(id);

		await customers.save({ ...newCustomer(id), displayName: 'Renamed', identities: [] });

		expect(await countsFor(id)).toMatchObject({ identity: 1 });
		expect((await customers.findById(id))?.displayName).toBe('Renamed');
	});

	it('still reports the identity on the customer read projection', async () => {
		const id = `cus_atom_it_${randomUUID()}`;
		await createAccount(id);

		const read = await customers.findById(id);
		expect(read?.identities.map((row) => row.provider)).toEqual(['google']);
	});
});
