import { JournalVoucher } from '@saha-textile/contracts';
import type { YearCloseRecord } from '@saha-textile/core-domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { connectMongo, disconnectMongo } from '../src/connection';
import { YearCloseModel } from '../src/models/bank.model';
import { JournalLineModel, JournalVoucherModel } from '../src/models/ledger.model';
import { MongoGeneralLedgerRepository } from '../src/repositories/ledger.repository';
import { MongoYearCloseRepository } from '../src/repositories/year-close.repository';

import { hasMongoEnv } from './mongo-test-env';

/**
 * Closing a financial year (accounts brief T3): the year's record, and the closing entries, which show on ledger
 * statements but never count in balances:
 *   MONGODB_DB_NAME=saha_textile_test node scripts/secrets/test-login.mjs run saha_textile_test -- pnpm --filter @saha-textile/adapters-db-mongo exec vitest run test/year-close.persistence.test.ts
 */
describe.skipIf(!hasMongoEnv())('year close (integration, rs0)', () => {
	const at = '2099-04-20T06:00:00.000Z';
	/** A year, vouchers and a location no other suite uses, so only this file's rows are cleared and read. */
	const YEAR = '2098-99';
	const PLACE = 'loc_ycdbtest';
	const wipe = () =>
		Promise.all([
			YearCloseModel.deleteMany({ _id: YEAR }),
			JournalVoucherModel.deleteMany({ _id: { $regex: /^jv_ycdbtest_/ } }),
			JournalLineModel.deleteMany({ voucherId: { $regex: /^jv_ycdbtest_/ } }),
		]);
	const years = new MongoYearCloseRepository();
	const books = new MongoGeneralLedgerRepository();

	beforeAll(async () => {
		await connectMongo();
		await wipe();
	});
	afterAll(async () => {
		await wipe();
		await disconnectMongo();
	});

	it('has no record for a year until it is saved, then saves over it, keyed by the year', async () => {
		expect(await years.get(YEAR)).toBeNull();
		const record: YearCloseRecord = {
			year: YEAR,
			accrualsConfirmedBy: 'adm_acc',
			accrualsConfirmedAt: at,
			suspenseNote: null,
			closingVoucherId: null,
			profitPaise: null,
			closedBy: null,
			closedAt: null,
			updatedAt: at,
		};
		await years.save(record);
		expect(await years.get(YEAR)).toEqual(record);
		await years.save({ ...record, closingVoucherId: 'jv_close', profitPaise: 60_000 });
		expect(await years.get(YEAR)).toMatchObject({ year: YEAR, closingVoucherId: 'jv_close', profitPaise: 60_000 });
		expect(await YearCloseModel.countDocuments({ _id: YEAR })).toBe(1);
	});

	it('marks the closing entries’ lines and leaves them out of balances, but not out of statements', async () => {
		const voucher = (id: string, date: string, source: { type: string; id: string; number: null } | null) =>
			JournalVoucher.parse({
				id: `jv_ycdbtest_${id}`,
				number: `JV/98-99/${id}`,
				kind: 'journal',
				date,
				narration: 'Year close test',
				source,
				lines: [
					{ ledgerId: 'led_ycdbtest_sales', locationId: PLACE, creditPaise: 100_000 },
					{ ledgerId: 'led_ycdbtest_cash', locationId: PLACE, debitPaise: 100_000 },
				],
				idempotencyKey: `ycdbtest-${id}`,
				totalPaise: 100_000,
				createdAt: at,
			});
		await books.insertVoucher(voucher('sale', '2099-03-10', null));
		await books.insertVoucher(
			JournalVoucher.parse({
				...voucher('close', '2099-03-31', { type: 'yearClose', id: YEAR, number: null }),
				lines: [
					{ ledgerId: 'led_ycdbtest_sales', locationId: PLACE, debitPaise: 100_000 },
					{ ledgerId: 'led_ycdbtest_pl', locationId: PLACE, creditPaise: 100_000 },
				],
			}),
		);
		const lines = await JournalLineModel.find({ voucherId: { $regex: /^jv_ycdbtest_/ } })
			.sort({ _id: 1 })
			.lean()
			.exec();
		expect(lines.map((l) => [l['voucherId'], l['closing'] ?? false])).toEqual([
			['jv_ycdbtest_close', true],
			['jv_ycdbtest_close', true],
			['jv_ycdbtest_sale', false],
			['jv_ycdbtest_sale', false],
		]);
		// Balances read the year as it was: sales still ₹1,000 and nothing in Profit and loss.
		expect(await books.balancesAt('2099-03-31', [PLACE])).toEqual({
			led_ycdbtest_sales: -100_000,
			led_ycdbtest_cash: 100_000,
		});
		// The ledger's statement and its balance before a day still show the closing entry.
		expect(await books.balanceBefore('led_ycdbtest_sales', '2099-04-01', [PLACE])).toBe(0);
		expect(
			(await books.statementLines('led_ycdbtest_sales', '2099-03-01', '2099-03-31', [PLACE])).map(
				(l) => l.voucherId,
			),
		).toEqual(['jv_ycdbtest_sale', 'jv_ycdbtest_close']);
	});
});
