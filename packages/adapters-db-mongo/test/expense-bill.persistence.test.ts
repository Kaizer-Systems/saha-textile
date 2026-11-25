import { ExpenseBill } from '@saha-textile/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { connectMongo, disconnectMongo } from '../src/connection';
import { ExpenseBillModel } from '../src/models/index';
import { MongoExpenseBillRepository } from '../src/repositories/expense-bill.repository';
import { MongoTransactionManager } from '../src/transaction-manager';

import { hasMongoEnv, runPrefix } from './mongo-test-env';

/**
 * Expense bills (brief 25 EB1), saved over the version read:
 *   MONGODB_DB_NAME=saha_textile_test node scripts/secrets/test-login.mjs run saha_textile_test -- pnpm --filter @saha-textile/adapters-db-mongo exec vitest run test/expense-bill.persistence.test.ts
 */
describe.skipIf(!hasMongoEnv())('expense bills store (integration, rs0)', () => {
	const P = runPrefix('expense_bill');
	const id = (name: string) => `${P}${name}`;
	const repo = new MongoExpenseBillRepository();
	const tx = new MongoTransactionManager();
	const bill = (name: string, over: Partial<ExpenseBill> = {}): ExpenseBill =>
		ExpenseBill.parse({
			id: id(name),
			supplierId: id('sup_landlord'),
			billNumber: `R-${name}`,
			billDate: '2026-11-01',
			locationId: 'loc_kolkata',
			lines: [
				{
					expenseLedgerId: 'led_rent',
					what: 'Shop rent, November',
					sac: '997212',
					taxableINR: 50_000,
					gstRatePct: 18,
				},
			],
			status: 'draft',
			interState: false,
			taxableINR: 50_000,
			cgstINR: 4_500,
			sgstINR: 4_500,
			igstINR: 0,
			blockedTaxINR: 0,
			totalINR: 59_000,
			createdAt: '2026-11-02T05:00:00.000Z',
			updatedAt: '2026-11-02T05:00:00.000Z',
			version: 0,
			...over,
		});
	const mine = (rows: readonly ExpenseBill[]) => rows.filter((row) => row.id.startsWith(P)).map((row) => row.id);

	beforeAll(async () => {
		await connectMongo();
	});
	afterAll(async () => {
		await ExpenseBillModel.deleteMany({ _id: { $regex: `^${P}` } }).exec();
		await disconnectMongo();
	});

	it('makes a bill at version 0, in a transaction or not, and reads it back as it was', async () => {
		expect(await repo.save(bill('rent'), null)).toMatchObject({ id: id('rent'), version: 0 });
		const inTx = await tx.withTransaction((context) =>
			repo.save(
				bill('ca_fees', { supplierId: id('sup_ca'), createdAt: '2026-11-02T06:00:00.000Z' }),
				null,
				context,
			),
		);
		expect(inTx.version).toBe(0);
		expect(await repo.get(id('rent'))).toEqual(bill('rent'));
		expect(await repo.get(id('ca_fees'))).toMatchObject({ supplierId: id('sup_ca'), version: 0 });
	});

	it('keeps nothing of a bill made in a transaction that fails', async () => {
		await expect(
			tx.withTransaction(async (context) => {
				await repo.save(bill('rolled_back'), null, context);
				throw new Error('stop');
			}),
		).rejects.toThrow('stop');
		expect(await repo.get(id('rolled_back'))).toBeNull();
	});

	it('finds no bill by an id it does not have', async () => {
		expect(await repo.get(id('missing'))).toBeNull();
	});

	it('saves over the version read, a step on, and refuses a version someone else moved past', async () => {
		const posted = bill('rent', { status: 'posted', number: 'EB/26-27/000001', voucherId: 'vch_eb_1' });
		expect(await repo.save(posted, 0)).toEqual({ ...posted, version: 1 });
		expect(await repo.get(id('rent'))).toMatchObject({ status: 'posted', number: 'EB/26-27/000001', version: 1 });
		await expect(repo.save({ ...posted, note: 'Too late' }, 0)).rejects.toThrow('expense_bill_changed');
		await expect(repo.save(bill('never_made'), 3)).rejects.toThrow('expense_bill_changed');
		const cancelled = await tx.withTransaction((context) =>
			repo.save({ ...posted, status: 'cancelled', version: 1 }, 1, context),
		);
		expect(cancelled.version).toBe(2);
		expect((await repo.get(id('rent')))?.status).toBe('cancelled');
	});

	it('lists by supplier or status only when asked, the latest bill day first, then the latest made', async () => {
		await repo.save(bill('courier', { billDate: '2026-11-20', supplierId: id('sup_courier') }), null);
		await repo.save(bill('rent_dec', { billDate: '2026-12-01', createdAt: '2026-12-01T05:00:00.000Z' }), null);
		await repo.save(bill('rent_dec_late', { billDate: '2026-12-01', createdAt: '2026-12-01T09:00:00.000Z' }), null);
		expect(mine(await repo.list({}))).toEqual([
			id('rent_dec_late'),
			id('rent_dec'),
			id('courier'),
			id('ca_fees'),
			id('rent'),
		]);
		expect(mine(await repo.list({ supplierId: id('sup_landlord') }))).toEqual([
			id('rent_dec_late'),
			id('rent_dec'),
			id('rent'),
		]);
		expect(mine(await repo.list({ status: 'cancelled' }))).toEqual([id('rent')]);
		expect(mine(await repo.list({ supplierId: id('sup_landlord'), status: 'draft' }))).toEqual([
			id('rent_dec_late'),
			id('rent_dec'),
		]);
		expect(await repo.list({ supplierId: id('sup_nobody') })).toEqual([]);
	});
});
