import { AccountsListQuery } from '@saha-textile/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { connectMongo, disconnectMongo } from '../src/connection';
import { PaymentVoucherModel } from '../src/models/self-invoices.model';
import { MongoAccountsListsReader } from '../src/repositories/accounts-lists.reader';

import { hasMongoEnv, insertRaw, runPrefix } from './mongo-test-env';

/**
 * Accounts › Payment vouchers › Supplier bills (brief 25 EB2): payments of purchase bills and of expense bills, not
 * reverse-charge ones:
 *   MONGODB_DB_NAME=saha_textile_test node scripts/secrets/test-login.mjs run saha_textile_test -- pnpm --filter @saha-textile/adapters-db-mongo exec vitest run test/accounts-lists-supplier-bills.persistence.test.ts
 */
describe.skipIf(!hasMongoEnv())('payment vouchers list, Supplier bills (integration, rs0)', () => {
	const P = runPrefix('al_sup');
	const tag = P.replace(/_/g, '');
	const reader = new MongoAccountsListsReader();
	const voucher = (name: string, date: string, against: { kind: string; id: string; number: string }) =>
		insertRaw(PaymentVoucherModel, {
			_id: `${P}${name}`,
			number: `PV/98-99/${name}`,
			date,
			supplierId: `${P}sup`,
			payeeName: `Payee ${tag}`,
			against,
			amountINR: 1_000,
			mode: 'bank_transfer',
			reference: `NEFT ${name}`,
			reverseChargeTaxINR: against.kind === 'selfInvoice' ? 180 : 0,
			status: 'paid',
			createdBy: 'adm_accountant',
			createdAt: `${date}T05:00:00.000Z`,
		});
	const query = (chip: string) =>
		AccountsListQuery.parse({ from: '2098-11-01', to: '2098-11-30', chip, search: tag });

	beforeAll(async () => {
		await connectMongo();
		await voucher('purchase', '2098-11-10', { kind: 'purchaseEntry', id: `${P}pe`, number: 'PE/98-99/000001' });
		await voucher('expense', '2098-11-12', { kind: 'expenseBill', id: `${P}eb`, number: 'EB/98-99/000001' });
		await voucher('rcm', '2098-11-14', { kind: 'selfInvoice', id: `${P}si`, number: 'SI/98-99/000001' });
	});
	afterAll(async () => {
		await PaymentVoucherModel.deleteMany({ _id: { $regex: `^${P}` } }).exec();
		await disconnectMongo();
	});

	it('lists payments of purchase bills and expense bills under Supplier bills, and counts both', async () => {
		const bills = await reader.list('paymentVouchers', query('supplier_bills'), '2098-11-24');
		expect(bills.items.map((row) => [row.number, row.extra['againstKind']])).toEqual([
			['PV/98-99/expense', 'expenseBill'],
			['PV/98-99/purchase', 'purchaseEntry'],
		]);
		expect(bills.total).toBe(2);
		expect(bills.counts).toEqual({ all: 3, reverse_charge: 1, supplier_bills: 2, cancelled: 0 });
	});

	it('keeps the reverse-charge payment to its own chip, and every payment under All', async () => {
		const rcm = await reader.list('paymentVouchers', query('reverse_charge'), '2098-11-24');
		expect(rcm.items.map((row) => row.number)).toEqual(['PV/98-99/rcm']);
		const all = await reader.list('paymentVouchers', query('all'), '2098-11-24');
		expect(all.items.map((row) => row.number)).toEqual(['PV/98-99/rcm', 'PV/98-99/expense', 'PV/98-99/purchase']);
	});
});
