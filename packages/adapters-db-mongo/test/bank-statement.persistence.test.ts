import type { BankLine } from '@saha-textile/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { connectMongo, disconnectMongo } from '../src/connection';
import { BankImportModel, BankLayoutModel, BankLineModel, BankMatchRuleModel } from '../src/models/bank.model';
import { MongoBankStatementRepository } from '../src/repositories/bank-statement.repository';
import { MongoTransactionManager } from '../src/transaction-manager';

import { hasMongoEnv } from './mongo-test-env';

/**
 * Bank statements (accounts brief BA4–BA7) in MongoDB:
 *   node scripts/secrets/test-login.mjs run saha_textile_bank_test -- pnpm --filter @saha-textile/adapters-db-mongo exec vitest run test/bank-statement.persistence.test.ts
 */
describe.skipIf(!hasMongoEnv())('bank statements (integration, rs0)', () => {
	const repo = new MongoBankStatementRepository();
	const tx = new MongoTransactionManager();
	const at = '2026-11-28T06:00:00.000Z';
	const line = (id: string, over: Partial<BankLine> = {}): BankLine =>
		({
			id,
			bankAccountId: 'bank_1',
			date: '2026-11-25',
			description: 'NEFT CR CCAVENUE',
			reference: id,
			outPaise: 0,
			inPaise: 100,
			balancePaise: null,
			key: `k_${id}`,
			importId: 'imp_1',
			status: 'unmatched',
			match: null,
			createdAt: at,
			...over,
		}) as BankLine;

	beforeAll(async () => {
		await connectMongo();
		await BankLineModel.syncIndexes();
		await Promise.all(
			[BankLayoutModel, BankLineModel, BankImportModel, BankMatchRuleModel].map((m) => m.deleteMany({})),
		);
	});
	afterAll(async () => {
		await Promise.all(
			[BankLayoutModel, BankLineModel, BankImportModel, BankMatchRuleModel].map((m) => m.deleteMany({})),
		);
		await disconnectMongo();
	});

	it('saves and replaces a layout, and lists them by name', async () => {
		const layout = {
			id: 'lay_hdfc',
			name: 'HDFC Excel',
			skipRows: 21,
			dateFormat: 'DD/MM/YY' as const,
			money: 'split' as const,
			columns: {
				date: 0,
				description: 1,
				reference: 2,
				withdrawal: 4,
				deposit: 5,
				amount: null,
				drcr: null,
				balance: 6,
			},
			updatedAt: at,
		};
		await repo.saveLayout(layout);
		await repo.saveLayout({ ...layout, skipRows: 20 });
		await repo.saveLayout({ ...layout, id: 'lay_axis', name: 'Axis CSV' });
		expect((await repo.layouts()).map((l) => [l.name, l.skipRows])).toEqual([
			['Axis CSV', 21],
			['HDFC Excel', 20],
		]);
	});

	it('keeps each line once per account, pages by status, and sums what is still to match per account', async () => {
		await tx.withTransaction(async (context) => {
			await repo.insertLines(
				[
					line('a'),
					line('b', { status: 'suggested', date: '2026-11-26' }),
					line('c', { status: 'accepted', date: '2026-11-27' }),
					line('d', { bankAccountId: 'bank_2', date: '2026-11-20' }),
				],
				context,
			);
			await repo.insertImport(
				{
					id: 'imp_1',
					bankAccountId: 'bank_1',
					fileName: 'x.csv',
					openingPaise: 0,
					closingPaise: 300,
					saved: 3,
					skipped: 0,
					lastDate: '2026-11-27',
					at,
					by: null,
				},
				context,
			);
		});
		await expect(repo.insertLines([line('a2', { key: 'k_a' })])).rejects.toMatchObject({ code: 11000 });
		expect([...(await repo.keysIn('bank_1', ['k_a', 'k_d', 'k_new']))]).toEqual(['k_a']);
		const all = await repo.lines('bank_1', {
			from: '2026-11-01',
			to: '2026-11-30',
			status: null,
			page: 1,
			pageSize: 2,
		});
		expect([all.total, all.items.map((l) => l.id), all.counts]).toEqual([
			3,
			['c', 'b'],
			{ unmatched: 1, suggested: 1, accepted: 1, rejected: 0 },
		]);
		const open = await repo.lines('bank_1', {
			from: '2026-11-01',
			to: '2026-11-30',
			status: 'unmatched',
			page: 1,
			pageSize: 10,
		});
		expect(open.items.map((l) => l.id)).toEqual(['a']);
		expect(await repo.summary()).toEqual({
			bank_1: { lastDate: '2026-11-27', toMatch: 2 },
			bank_2: { lastDate: '2026-11-20', toMatch: 1 },
		});
		expect(await BankImportModel.countDocuments({}).exec()).toBe(1);
	});

	it('keeps matching rules in order, and updates a line’s match inside or outside a transaction (BA7, BA10)', async () => {
		const rule = (id: string, order: number) => ({
			id,
			order,
			builtIn: false,
			when: 'words' as const,
			words: ['RENT'],
			onlyIn: false,
			then: 'leave' as const,
			gstPercent: null,
			on: true,
			updatedAt: at,
		});
		await repo.saveRule(rule('r_b', 6));
		await repo.saveRule(rule('r_a', 5));
		await repo.saveRule({ ...rule('r_b', 6), on: false });
		expect((await repo.rules()).map((r) => [r.id, r.on])).toEqual([
			['r_a', true],
			['r_b', false],
		]);
		await BankLineModel.deleteMany({}).exec();
		await repo.insertLines([
			line('m1', { key: 'k_m1', date: '2026-11-03' }),
			line('m2', {
				key: 'k_m2',
				date: '2026-11-01',
				status: 'accepted',
				match: { voucherIds: ['jv_1', 'jv_2'], why: 'upi_ref', sure: true, by: null, at } as never,
			}),
			line('m3', {
				key: 'k_m3',
				date: '2026-12-05',
				status: 'suggested',
				match: { voucherIds: ['jv_3'], why: 'amount_party', sure: false, by: null, at: null } as never,
			}),
		]);
		expect(await repo.line('nope')).toBeNull();
		const first = await repo.line('m1');
		expect(first?.rejectedKeys).toEqual([]);
		await repo.saveLine({ ...first!, status: 'suggested', rejectedKeys: ['jv_9'] });
		await tx.withTransaction(async (context) => {
			const again = await repo.line('m1', context);
			await repo.saveLine({ ...again!, status: 'unmatched' }, context);
		});
		expect(await repo.line('m1')).toMatchObject({ status: 'unmatched', rejectedKeys: ['jv_9'] });
		expect((await repo.inPeriod('bank_1', '2026-11-01', '2026-11-30')).map((l) => l.id)).toEqual(['m2', 'm1']);
		expect([...(await repo.heldVoucherIds('bank_1', ['accepted', 'suggested']))].sort()).toEqual([
			'jv_1',
			'jv_2',
			'jv_3',
		]);
		expect([...(await repo.heldVoucherIds('bank_1', ['accepted']))].sort()).toEqual(['jv_1', 'jv_2']);
	});
});
