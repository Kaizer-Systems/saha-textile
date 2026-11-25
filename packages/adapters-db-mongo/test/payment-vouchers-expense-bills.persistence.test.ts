import { PaymentVoucher } from '@saha-textile/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { connectMongo, disconnectMongo } from '../src/connection';
import { PaymentVoucherModel } from '../src/models/self-invoices.model';
import { MongoPaymentVoucherRepository } from '../src/repositories/self-invoices.repository';

import { hasMongoEnv, runPrefix } from './mongo-test-env';

/**
 * Payment vouchers that pay expense bills (brief 25 EB2) count under Supplier bills beside purchase bills:
 *   MONGODB_DB_NAME=saha_textile_test node scripts/secrets/test-login.mjs run saha_textile_test -- pnpm --filter @saha-textile/adapters-db-mongo exec vitest run test/payment-vouchers-expense-bills.persistence.test.ts
 */
describe.skipIf(!hasMongoEnv())('payment vouchers for expense bills (integration, rs0)', () => {
	const P = runPrefix('pv_eb');
	const id = (name: string) => `${P}${name}`;
	const payee = `Payee ${P}`;
	const vouchers = new MongoPaymentVoucherRepository();
	const voucher = (name: string, date: string, against: PaymentVoucher['against'], over: object = {}) =>
		PaymentVoucher.parse({
			id: id(name),
			number: `PV/98-99/${P}${name}`,
			date,
			supplierId: id('sup'),
			payeeName: payee,
			payeeAddress: 'Kolkata',
			against,
			amountINR: 59_000,
			mode: 'bank_transfer',
			reference: `NEFT ${name}`,
			paidFromLedgerId: 'led_hdfc',
			reverseChargeTaxINR: 0,
			supplierPaymentId: null,
			journalVoucherId: id(`jv_${name}`),
			locationId: 'loc_kolkata',
			createdAt: `${date}T05:00:00.000Z`,
			createdBy: 'adm_accountant',
			...over,
		});
	const bill = (name: string) => ({
		kind: 'expenseBill' as const,
		id: id(name),
		number: `EB/98-99/${name}`,
		detail: '',
	});

	beforeAll(async () => {
		await connectMongo();
		await vouchers.insert(
			voucher('rcm', '2098-11-05', { kind: 'selfInvoice', id: id('si'), number: 'SI/98-99/1', detail: '' }),
		);
		await vouchers.insert(
			voucher('purchase', '2098-11-10', {
				kind: 'purchaseEntry',
				id: id('pe'),
				number: 'PE/98-99/1',
				detail: '',
			}),
		);
		await vouchers.insert(voucher('rent_part', '2098-11-12', bill('eb_rent')));
		await vouchers.insert(voucher('rent_rest', '2098-11-20', bill('eb_rent')));
		await vouchers.insert(
			voucher('courier', '2098-11-15', bill('eb_courier'), { status: 'cancelled', cancelReason: 'Paid twice' }),
		);
	});
	afterAll(async () => {
		await PaymentVoucherModel.deleteMany({ _id: { $regex: `^${P}` } }).exec();
		await disconnectMongo();
	});

	const query = { from: '2098-11-01', to: '2098-11-30', search: payee, page: 1, pageSize: 25 };

	it('counts payments of expense bills under Supplier bills with purchase bills, cancelled ones too', async () => {
		const all = await vouchers.list({ ...query, filter: 'all' });
		expect(all.counts).toEqual({ all: 5, reverse_charge: 1, supplier_bills: 4, cancelled: 1 });
		const bills = await vouchers.list({ ...query, filter: 'supplier_bills' });
		expect(bills.items.map((v) => v.id)).toEqual([id('rent_rest'), id('courier'), id('rent_part'), id('purchase')]);
		expect(bills.items.every((v) => v.against.kind !== 'selfInvoice')).toBe(true);
	});

	it('finds an expense bill’s payments, first made first, and none for a bill never paid', async () => {
		expect((await vouchers.forDocument('expenseBill', id('eb_rent'))).map((v) => v.id)).toEqual([
			id('rent_part'),
			id('rent_rest'),
		]);
		expect(await vouchers.forDocument('expenseBill', id('eb_unpaid'))).toEqual([]);
		expect(await vouchers.forDocument('purchaseEntry', id('eb_rent'))).toEqual([]);
	});
});
