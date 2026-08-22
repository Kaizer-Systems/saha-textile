import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Address } from '@saha-textile/contracts';

import { buildMongoConfig } from '../src/config';
import { connectMongo, disconnectMongo } from '../src/connection';
import { CustomerModel } from '../src/models/index';
import { MongoCustomerRepository } from '../src/repositories/customer.repository';

/**
 * Saved-address writes against a REAL replica set.
 *
 * These have to run concurrently against a real server, because the bug they pin down is
 * invisible to a fake. Both writers used to read the whole array, rebuild it in JavaScript and
 * `$set` it back, so whoever landed second erased the other's work — and BOTH callers were handed
 * a success response containing the address that was about to vanish. Sequential assertions pass
 * happily against that; only two writes in flight at once show it.
 *
 * The two writers are not hypothetical. The same repository methods serve the customer's own
 * screens and the operator CRM, so the everyday version is support editing an address while the
 * customer edits it at checkout.
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

const address = (label: string, over: Partial<Address> = {}): Address => ({
	id: `adr_it_${randomUUID()}`,
	label,
	fullName: 'Ada Lovelace',
	line1: '12 Analytical Way',
	city: 'Kolkata',
	postalCode: '700001',
	country: 'India',
	isDefault: false,
	...over,
});

describe.skipIf(!hasMongoEnv())('customer address persistence (integration, rs0)', () => {
	const customers = new MongoCustomerRepository();

	/** A fresh account per case, so one test's races cannot colour another's. */
	async function seedCustomer(addresses: Address[] = []): Promise<string> {
		const id = `cus_addr_it_${randomUUID()}`;
		await CustomerModel.create([
			{
				_id: id,
				email: `${id}@address-it.test`,
				emailVerified: true,
				status: 'active',
				addresses,
			},
		]);
		return id;
	}

	beforeAll(async () => {
		await connectMongo();
	});

	afterAll(async () => {
		await CustomerModel.deleteMany({ _id: /^cus_addr_it/ }).exec();
		await disconnectMongo();
	});

	describe('concurrent writes', () => {
		it('keeps both addresses when two are added at the same moment', async () => {
			const customerId = await seedCustomer([address('Home')]);
			const office = address('Office');
			const mums = address("Mum's");

			await Promise.all([customers.addAddress(customerId, office), customers.addAddress(customerId, mums)]);

			const after = await customers.findById(customerId);
			expect(after?.addresses.map((row) => row.label).sort()).toEqual(["Mum's", 'Home', 'Office'].sort());
		});

		it('does not revert a field one writer changed while another was adding', async () => {
			const home = address('Home', { city: 'Kolkata' });
			const customerId = await seedCustomer([home]);

			await Promise.all([
				customers.updateAddress(customerId, home.id, { city: 'Howrah' }),
				customers.addAddress(customerId, address('Office')),
			]);

			const after = await customers.findById(customerId);
			expect(after?.addresses).toHaveLength(2);
			expect(after?.addresses.find((row) => row.id === home.id)?.city).toBe('Howrah');
		});

		it('never leaves two defaults behind when both writers claim it', async () => {
			const home = address('Home', { isDefault: true });
			const customerId = await seedCustomer([home]);

			await Promise.all([
				customers.addAddress(customerId, address('Office', { isDefault: true })),
				customers.addAddress(customerId, address("Mum's", { isDefault: true })),
			]);

			const after = await customers.findById(customerId);
			expect(after?.addresses).toHaveLength(3);
			expect(after?.addresses.filter((row) => row.isDefault)).toHaveLength(1);
		});
	});

	describe('a patch touches only what it names', () => {
		it('leaves unmentioned fields exactly as they were', async () => {
			const home = address('Home', { line2: 'Flat 4', phone: '+919900000001', state: 'West Bengal' });
			const customerId = await seedCustomer([home]);

			await customers.updateAddress(customerId, home.id, { city: 'Howrah' });

			const after = await customers.findById(customerId);
			const row = after?.addresses.find((entry) => entry.id === home.id);
			expect(row).toMatchObject({
				city: 'Howrah',
				line2: 'Flat 4',
				phone: '+919900000001',
				state: 'West Bengal',
				label: 'Home',
			});
		});

		it('demotes the previous default when another is promoted', async () => {
			const home = address('Home', { isDefault: true });
			const office = address('Office');
			const customerId = await seedCustomer([home, office]);

			await customers.updateAddress(customerId, office.id, { isDefault: true });

			const after = await customers.findById(customerId);
			expect(after?.addresses.find((row) => row.id === home.id)?.isDefault).toBe(false);
			expect(after?.addresses.find((row) => row.id === office.id)?.isDefault).toBe(true);
		});
	});

	describe('an address that is not there', () => {
		it('answers null rather than pretending, and changes nothing', async () => {
			const home = address('Home');
			const customerId = await seedCustomer([home]);

			expect(await customers.updateAddress(customerId, 'adr_it_nonexistent', { city: 'Delhi' })).toBeNull();
			const after = await customers.findById(customerId);
			expect(after?.addresses).toHaveLength(1);
			expect(after?.addresses[0]?.city).toBe('Kolkata');
		});

		it('answers null for an id belonging to a different account', async () => {
			const mine = address('Home');
			const theirs = address('Theirs');
			const customerId = await seedCustomer([mine]);
			await seedCustomer([theirs]);

			expect(await customers.updateAddress(customerId, theirs.id, { city: 'Delhi' })).toBeNull();
		});
	});
});
