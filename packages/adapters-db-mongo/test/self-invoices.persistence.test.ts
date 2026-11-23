import { PaymentVoucher, SelfInvoice } from '@saha-textile/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { connectMongo, disconnectMongo } from '../src/connection';
import { PaymentVoucherModel, SelfInvoiceModel } from '../src/models/self-invoices.model';
import {
	MongoPaymentVoucherRepository,
	MongoSelfInvoiceRepository,
} from '../src/repositories/self-invoices.repository';

import { hasMongoEnv } from './mongo-test-env';

/**
 * Self-invoices and payment vouchers (accounts brief D) against a real replica set:
 *   node scripts/secrets/test-login.mjs run saha_textile_selfinvoices_test -- pnpm --filter @saha-textile/adapters-db-mongo exec vitest run test/self-invoices.persistence.test.ts
 */
describe.skipIf(!hasMongoEnv())('self-invoices and payment vouchers persistence (integration, rs0)', () => {
	const at = '2026-11-21T10:00:00.000Z';
	const models = [SelfInvoiceModel, PaymentVoucherModel];
	const draft = SelfInvoice.parse({
		id: 'si_1',
		number: null,
		status: 'draft',
		supplierId: 'sup_bose',
		supplierName: 'Bose Properties',
		supplierAddress: 'Barasat',
		supplierStateCode: '19',
		rule: {
			templateCode: 'RS-RCM',
			templateVersion: 1,
			key: 'shop_rent',
			name: 'Rent of the shop',
			code: '997212',
			ratePercent: 18,
			expenseRole: 'rent',
			source: '13/2017',
		},
		forMonth: '2026-11',
		receivedOn: '2026-11-01',
		date: null,
		locationId: 'loc_bar',
		gstRegistrationId: 'reg_wb',
		placeOfSupply: '19',
		interState: false,
		taxableINR: 60_000,
		cgstINR: 5_400,
		sgstINR: 5_400,
		igstINR: 0,
		taxINR: 10_800,
		totalINR: 70_800,
		paidINR: 0,
		late: false,
		journalVoucherId: null,
		cancelReason: null,
		version: 0,
		createdAt: at,
		createdBy: 'adm_owner',
		updatedAt: at,
		updatedBy: 'adm_owner',
		issuedAt: null,
		issuedBy: null,
		cancelledAt: null,
		cancelledBy: null,
	});
	const voucher = PaymentVoucher.parse({
		id: 'pv_1',
		number: 'PV/26-27/000007',
		date: '2026-11-21',
		supplierId: 'sup_bose',
		payeeName: 'Bose Properties',
		payeeAddress: 'Barasat',
		against: { kind: 'selfInvoice', id: 'si_1', number: 'SI/26-27/000002' },
		amountINR: 60_000,
		mode: 'bank_transfer',
		reference: 'NEFT 7712',
		paidFromLedgerId: 'led_hdfc',
		reverseChargeTaxINR: 10_800,
		supplierPaymentId: null,
		journalVoucherId: 'jv_1',
		locationId: 'loc_bar',
		createdAt: at,
		createdBy: 'adm_owner',
	});
	const wipe = () => Promise.all(models.map((m) => m.deleteMany({})));

	beforeAll(async () => {
		await connectMongo();
		await Promise.all(models.map((m) => m.syncIndexes()));
		await wipe();
	});
	afterAll(async () => {
		await wipe();
		await disconnectMongo();
	});

	it('keeps drafts by version, numbers them once, lists a supplier’s and deletes only drafts', async () => {
		const invoices = new MongoSelfInvoiceRepository();
		await invoices.insert(draft);
		await invoices.insert({ ...draft, id: 'si_2', createdAt: '2026-11-22T10:00:00.000Z' });
		await expect(invoices.insert(draft)).rejects.toThrow('duplicate_self_invoice');
		await expect(invoices.insert({ ...draft, id: 'si_bad', supplierId: undefined as never })).rejects.toThrow(
			/supplierId/,
		);
		const issued = await invoices.save({ ...draft, status: 'issued', number: 'SI/26-27/000002' }, 0);
		expect(issued.version).toBe(1);
		await expect(invoices.save({ ...draft, taxableINR: 1 }, 0)).rejects.toThrow('self_invoice_changed');
		await expect(invoices.save({ ...draft, id: 'si_2', number: 'SI/26-27/000002' }, 0)).rejects.toThrow(
			'duplicate_self_invoice',
		);
		expect(await invoices.get('si_1')).toMatchObject({ status: 'issued', version: 1 });
		expect(await invoices.get('si_x')).toBeNull();
		expect((await invoices.forSupplier('sup_bose')).map((i) => i.id)).toEqual(['si_1', 'si_2']);
		expect(await invoices.removeDraft('si_1')).toBe(false);
		expect(await invoices.removeDraft('si_2')).toBe(true);
	});

	it('keeps one voucher per number and per supplier payment, found by what it pays', async () => {
		const vouchers = new MongoPaymentVoucherRepository();
		await vouchers.insert(voucher);
		const forBill = {
			...voucher,
			id: 'pv_2',
			number: 'PV/26-27/000008',
			against: { kind: 'purchaseEntry' as const, id: 'pe_31', number: 'PE/26-27/00031', detail: '' },
			supplierPaymentId: 'pay_1',
			reverseChargeTaxINR: null,
		};
		await vouchers.insert(forBill);
		await expect(vouchers.insert({ ...forBill, id: 'pv_3', number: 'PV/26-27/000009' })).rejects.toThrow(
			'duplicate_payment_voucher',
		);
		await expect(vouchers.insert({ ...voucher, id: 'pv_4', number: undefined as never })).rejects.toThrow(/number/);
		expect((await vouchers.forDocument('selfInvoice', 'si_1')).map((v) => v.id)).toEqual(['pv_1']);
		expect((await vouchers.forSupplier('sup_bose')).map((v) => v.id)).toEqual(['pv_1', 'pv_2']);
		expect(await vouchers.forSupplier('sup_none')).toEqual([]);
		expect(await vouchers.get('pv_2')).toMatchObject({ supplierPaymentId: 'pay_1' });
		expect(await vouchers.get('pv_x')).toBeNull();
		const paid = (await vouchers.get('pv_1'))!;
		await vouchers.cancel({ ...paid, status: 'cancelled', cancelledAt: at, cancelReason: 'Wrong supplier' });
		expect(await vouchers.get('pv_1')).toMatchObject({ status: 'cancelled', cancelReason: 'Wrong supplier' });
		await expect(vouchers.cancel({ ...paid, status: 'cancelled' })).rejects.toThrow('payment_voucher_changed');
	});

	it('lists self-invoices by the day received with every chip counted, and vouchers by date', async () => {
		const invoices = new MongoSelfInvoiceRepository();
		await Promise.all([SelfInvoiceModel.deleteMany({}), PaymentVoucherModel.deleteMany({})]);
		const make = (id: string, patch: Partial<SelfInvoice>) => invoices.insert({ ...draft, id, ...patch });
		await make('si_a', { receivedOn: '2026-11-18', supplierName: 'Mitra & Co.' });
		await make('si_old', { receivedOn: '2026-09-01' });
		await make('si_b', { status: 'issued', number: 'SI/26-27/000001', receivedOn: '2026-11-16', paidINR: 60_000 });
		await make('si_c', { status: 'issued', number: 'SI/26-27/000002', receivedOn: '2026-11-01', paidINR: 0 });
		const query = {
			from: '2026-04-01',
			to: '2026-11-30',
			search: '',
			page: 1,
			pageSize: 25,
			dueSoonFrom: '2026-10-25',
		};
		const all = await invoices.list({ ...query, filter: 'all' });
		expect(all.items.map((i) => i.id)).toEqual(['si_a', 'si_b', 'si_c', 'si_old']);
		expect(all.counts).toEqual({ all: 4, drafts: 2, due_soon: 1, unpaid: 1, paid: 1 });
		expect((await invoices.list({ ...query, filter: 'due_soon' })).items.map((i) => i.id)).toEqual(['si_a']);
		const late = await invoices.list({ ...query, from: '2026-11-10', dueSoonFrom: '2026-10-25', filter: 'all' });
		expect(late.counts.due_soon).toBe(1);
		const searched = await invoices.list({ ...query, search: 'mitra', filter: 'all' });
		expect([searched.total, searched.items[0]?.id]).toEqual([1, 'si_a']);
		expect((await invoices.list({ ...query, search: 'SI/26-27/000002', filter: 'unpaid' })).total).toBe(1);

		const vouchers = new MongoPaymentVoucherRepository();
		await vouchers.insert(voucher);
		await vouchers.insert({
			...voucher,
			id: 'pv_b',
			number: 'PV/26-27/000006',
			date: '2026-11-20',
			against: { kind: 'purchaseEntry', id: 'pe_31', number: 'PE/26-27/00031', detail: '' },
			supplierPaymentId: 'pay_9',
			reference: '8821 1092',
		});
		const page = await vouchers.list({
			from: '2026-11-01',
			to: '2026-11-30',
			search: '',
			page: 1,
			pageSize: 25,
			filter: 'all',
		});
		expect(page.items.map((v) => v.number)).toEqual(['PV/26-27/000007', 'PV/26-27/000006']);
		expect(page.counts).toEqual({ all: 2, reverse_charge: 1, supplier_bills: 1, cancelled: 0 });
		const bills = await vouchers.list({
			from: '2026-11-01',
			to: '2026-11-30',
			search: '8821',
			page: 1,
			pageSize: 25,
			filter: 'supplier_bills',
		});
		expect(bills.items.map((v) => v.id)).toEqual(['pv_b']);
	});
});
