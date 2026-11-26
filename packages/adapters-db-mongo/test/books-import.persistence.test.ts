import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { connectMongo, disconnectMongo } from '../src/connection';
import { BooksImportModel } from '../src/models/bank.model';
import { MongoBooksImportRepository } from '../src/repositories/books-import.repository';

import { hasMongoEnv, insertRaw } from './mongo-test-env';

/**
 * Books brought in from another program (accounts brief I1, W3), with the count of vouchers kept for undoing:
 *   MONGODB_DB_NAME=saha_textile_test node scripts/secrets/test-login.mjs run saha_textile_test -- pnpm --filter @saha-textile/adapters-db-mongo exec vitest run test/books-import.persistence.test.ts
 */
describe.skipIf(!hasMongoEnv())('books imports (integration, rs0)', () => {
	/** Ids no other suite uses, so only this file's rows are cleared and listed. */
	const wipe = () => BooksImportModel.deleteMany({ _id: { $regex: /^imp_dbtest_/ } });
	const repo = new MongoBooksImportRepository();
	const mine = async () => (await repo.list()).filter((e) => e.id.startsWith('imp_dbtest_'));
	const entry = (id: string, createdAt: string) => ({
		id: `imp_dbtest_${id}`,
		source: 'template_csv' as const,
		fileName: 'trial-balance.csv',
		startOn: '2099-04-01',
		locationId: 'loc_bar',
		voucherId: `jv_${id}`,
		ledgersMade: ['led_made_1'],
		debitPaise: 2_025_000,
		createdBy: 'adm_owner',
		createdAt,
		undoneAt: null,
		undoneBy: null,
		vouchersAtImport: 7,
	});

	beforeAll(async () => {
		await connectMongo();
		await wipe();
	});
	afterAll(async () => {
		await wipe();
		await disconnectMongo();
	});

	it('keeps imports newest first, saving over one by its id', async () => {
		await repo.save(entry('a', '2099-04-01T06:00:00.000Z'));
		await repo.save(entry('b', '2099-04-02T06:00:00.000Z'));
		expect((await mine()).map((e) => e.id)).toEqual(['imp_dbtest_b', 'imp_dbtest_a']);
		expect(await repo.get('imp_dbtest_a')).toEqual(entry('a', '2099-04-01T06:00:00.000Z'));
		expect(await repo.get('imp_dbtest_gone')).toBeNull();
		const undone = {
			...entry('a', '2099-04-01T06:00:00.000Z'),
			undoneAt: '2099-04-03T06:00:00.000Z',
			undoneBy: 'adm_owner',
		};
		await repo.save(undone);
		expect(await repo.get('imp_dbtest_a')).toEqual(undone);
		expect(await BooksImportModel.countDocuments({ _id: 'imp_dbtest_a' })).toBe(1);
	});

	it('reads an import saved before the voucher count was kept as counting none', async () => {
		const { id, vouchersAtImport: _count, ...rest } = entry('old', '2099-03-01T06:00:00.000Z');
		await insertRaw(BooksImportModel, { _id: id, ...rest });
		expect((await repo.get(id))?.vouchersAtImport).toBe(0);
	});
});
