import { Gstr2bImport } from '@saha-textile/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { connectMongo, disconnectMongo } from '../src/connection';
import { Gstr2bImportModel } from '../src/models/bank.model';
import { MongoGstr2bRepository } from '../src/repositories/gst-draft.repository';

import { hasMongoEnv } from './mongo-test-env';

/**
 * Imported GSTR-2B files (accounts brief G5), one per registration and month, saved over the version read:
 *   node scripts/secrets/test-login.mjs run saha_textile_gst_test -- pnpm --filter @saha-textile/adapters-db-mongo exec vitest run test/gstr2b-imports.persistence.test.ts
 */
describe.skipIf(!hasMongoEnv())('GSTR-2B imports (integration, rs0)', () => {
	const at = '2026-12-14T06:00:00.000Z';
	/** Registrations no other suite uses, so only this file's rows are cleared. */
	const REG = 'reg_gstr2b_a';
	const OTHER = 'reg_gstr2b_b';
	const wipe = () => Gstr2bImportModel.deleteMany({ gstRegistrationId: { $in: [REG, OTHER] } });
	const repo = new MongoGstr2bRepository();

	const doc = (id: string, over: Partial<Gstr2bImport> = {}): Gstr2bImport =>
		Gstr2bImport.parse({
			id,
			gstRegistrationId: REG,
			gstin: '19AABCG1234A1Z5',
			month: '2026-11',
			generatedOn: '2026-12-14',
			lines: [
				{
					key: '27AAKFR1234M1Z2|invoice|RM101',
					kind: 'invoice',
					supplierGstin: '27AAKFR1234M1Z2',
					supplierName: 'Rang Mahal',
					number: 'RM/101',
					date: '2026-11-05',
					supplierPeriod: '2026-11',
					filedOn: '2026-12-11',
					taxable: 10_000,
					igst: 500,
					cgst: 0,
					sgst: 0,
					reverseCharge: false,
					itcAvailable: true,
					reason: null,
				},
			],
			notRead: [{ section: 'b2ba', count: 1 }],
			decisions: { '27AAKFR1234M1Z2|invoice|RM101': 'pending' },
			importedBy: 'adm_1',
			importedByName: 'Sudip Ghosh',
			importedAt: at,
			version: 0,
			...over,
		});

	beforeAll(async () => {
		await connectMongo();
		await Gstr2bImportModel.syncIndexes();
		await wipe();
	});
	afterAll(async () => {
		await wipe();
		await disconnectMongo();
	});

	it('keeps a month’s import at version 0, finds it by registration and month, and refuses a second', async () => {
		expect((await repo.save(doc('g2b_t1', { version: 4 }), null)).version).toBe(0);
		expect(await repo.find(REG, '2026-11')).toEqual(doc('g2b_t1'));
		expect(await repo.find(REG, '2026-10')).toBeNull();
		await expect(repo.save(doc('g2b_t2'), null)).rejects.toThrow('gstr2b_exists');
		const noId = repo.save({ ...doc('g2b_x', { month: '2026-08' }), id: undefined as never }, null);
		await expect(noId).rejects.toThrow();
		await expect(noId).rejects.not.toThrow('gstr2b_exists');
	});

	it('saves over the version read, one higher, and refuses a version someone saved over', async () => {
		const decided = await repo.save(doc('g2b_t1', { decisions: { '27AAKFR1234M1Z2|invoice|RM101': 'reject' } }), 0);
		expect(decided.version).toBe(1);
		expect(await repo.find(REG, '2026-11')).toMatchObject({
			decisions: { '27AAKFR1234M1Z2|invoice|RM101': 'reject' },
			version: 1,
		});
		await expect(repo.save(doc('g2b_t1'), 0)).rejects.toThrow('gstr2b_changed');
	});

	it('lists a registration’s imports, oldest month first', async () => {
		await repo.save(doc('g2b_t3', { month: '2026-09' }), null);
		await repo.save(doc('g2b_t4', { gstRegistrationId: OTHER }), null);
		expect((await repo.listForRegistration(REG)).map((d) => [d.id, d.month])).toEqual([
			['g2b_t3', '2026-09'],
			['g2b_t1', '2026-11'],
		]);
		expect((await repo.listForRegistration(OTHER)).map((d) => d.id)).toEqual(['g2b_t4']);
	});
});
