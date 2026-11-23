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
			against: { kind: 'purchaseEntry' as const, id: 'pe_31', number: 'PE/26-27/00031' },
			supplierPaymentId: 'pay_1',
			reverseChargeTaxINR: null,
		};
		await vouchers.insert(forBill);
		await expect(vouchers.insert({ ...forBill, id: 'pv_3', number: 'PV/26-27/000009' })).rejects.toThrow(
			'duplicate_payment_voucher',
		);
		await expect(vouchers.insert({ ...voucher, id: 'pv_4', number: undefined as never })).rejects.toThrow(/number/);
		expect((await vouchers.forDocument('selfInvoice', 'si_1')).map((v) => v.id)).toEqual(['pv_1']);
		expect(await vouchers.get('pv_2')).toMatchObject({ supplierPaymentId: 'pay_1' });
		expect(await vouchers.get('pv_x')).toBeNull();
	});
});
