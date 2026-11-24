import { CreditNote, DebitNote, TaxInvoice } from '@saha-textile/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { connectMongo, disconnectMongo } from '../src/connection';
import { TaxInvoiceModel } from '../src/models/ledger.model';
import { CreditNoteModel, DebitNoteModel } from '../src/models/returns.model';
import { MongoTaxInvoiceRepository } from '../src/repositories/ledger.repository';
import { MongoCreditNoteRepository, MongoDebitNoteRepository } from '../src/repositories/returns.repository';

import { hasMongoEnv } from './mongo-test-env';

/**
 * A GSTIN's tax invoices, credit notes and debit notes between two days, as GSTR-1 reads them (accounts brief G):
 *   node scripts/secrets/test-login.mjs run saha_textile_gst_test -- pnpm --filter @saha-textile/adapters-db-mongo exec vitest run test/gstin-documents.persistence.test.ts
 */
describe.skipIf(!hasMongoEnv())('a GSTIN’s invoices and notes for a month (integration, rs0)', () => {
	const at = '2026-11-25T10:00:00.000Z';
	/** GSTINs no other suite uses, so only this file's rows are cleared. */
	const HOME = '19AABCG1234A1Z5';
	const OTHER = '27AABCG1234A1Z5';
	const models = [TaxInvoiceModel, CreditNoteModel, DebitNoteModel];
	const wipe = () => Promise.all(models.map((m) => m.deleteMany({ gstin: { $in: [HOME, OTHER] } })));

	const party = { name: 'K.R. Marketing', gstin: HOME, address: 'Barasat', stateCode: '19' };
	const buyer = { name: 'Ananya Das', gstin: null, address: 'Kolkata', stateCode: '19' };
	const money = {
		taxableINR: 100,
		cgstINR: 2.5,
		sgstINR: 2.5,
		igstINR: 0,
		roundOffINR: 0,
		totalINR: 105,
	};
	const line = {
		lineId: 'a',
		sku: 'BAN-3',
		title: 'Banarasi Silk Saree',
		hsn: '5007',
		quantity: 1,
		unitPriceINR: 105,
		ratePercent: 5,
		taxableINR: 100,
		cgstINR: 2.5,
		sgstINR: 2.5,
		totalINR: 105,
	};

	const invoice = (id: string, number: string, date: string, over: Partial<TaxInvoice> = {}): TaxInvoice =>
		TaxInvoice.parse({
			id,
			number,
			date,
			gstRegistrationId: 'reg_wb',
			gstin: HOME,
			locationId: 'loc_bar',
			orderId: `ord_${id}`,
			orderNumber: `ST-${id}`,
			shipmentId: `shp_${id}`,
			seller: party,
			buyer,
			placeOfSupply: '19',
			interState: false,
			lines: [{ ...line, unit: 'PCS', igstINR: 0 }],
			shippingINR: 0,
			...money,
			createdAt: at,
			...over,
		});

	const creditNote = (id: string, number: string | null, date: string, over: Partial<CreditNote> = {}) =>
		CreditNote.parse({
			id,
			number,
			status: number ? 'issued' : 'draft',
			kind: 'goods_returned',
			date,
			invoiceId: 'ti_gst_b',
			invoiceNumber: 'TI/26-27/000001',
			invoiceDate: '2026-11-01',
			gstRegistrationId: 'reg_wb',
			gstin: HOME,
			locationId: 'loc_bar',
			orderId: 'ord_ti_gst_b',
			orderNumber: 'ST-ti_gst_b',
			buyer,
			placeOfSupply: '19',
			interState: false,
			reason: 'Damaged on arrival',
			refundTo: 'original_payment',
			lines: [line],
			...money,
			deadline: '2027-11-30',
			createdAt: at,
			...over,
		});

	const debitNote = (id: string, number: string, date: string, over: Partial<DebitNote> = {}) =>
		DebitNote.parse({
			id,
			number,
			date,
			gstRegistrationId: 'reg_wb',
			gstin: HOME,
			locationId: 'loc_bar',
			orderId: 'ord_ti_gst_b',
			orderNumber: 'ST-ti_gst_b',
			invoiceId: 'ti_gst_b',
			invoiceNumber: 'TI/26-27/000001',
			creditNoteId: 'cn_gst_1',
			creditNoteNumber: 'CN/26-27/000001',
			buyer,
			placeOfSupply: '19',
			interState: false,
			reason: 'Made against the wrong invoice',
			lines: [line],
			...money,
			createdAt: at,
			...over,
		});

	beforeAll(async () => {
		await connectMongo();
		await Promise.all(models.map((m) => m.syncIndexes()));
		await wipe();
	});
	afterAll(async () => {
		await wipe();
		await disconnectMongo();
	});

	it('lists the GSTIN’s invoices from the first day to the last, cancelled ones too, by date then number', async () => {
		const invoices = new MongoTaxInvoiceRepository();
		for (const next of [
			invoice('ti_gst_c', 'TI/26-27/000002', '2026-11-01'),
			invoice('ti_gst_b', 'TI/26-27/000001', '2026-11-01'),
			invoice('ti_gst_last', 'TI/26-27/000009', '2026-11-30'),
			invoice('ti_gst_d', 'TI/26-27/000005', '2026-11-20', {
				status: 'cancelled',
				cancellation: { at, by: 'adm_1', reason: 'Wrong buyer' },
			}),
			invoice('ti_gst_oct', 'TI/26-27/000000', '2026-10-31'),
			invoice('ti_gst_dec', 'TI/26-27/000010', '2026-12-01'),
			invoice('ti_gst_other', 'TI/26-27/000003', '2026-11-10', { gstin: OTHER }),
		])
			await invoices.insert(next);
		const november = await invoices.listForGstin(HOME, '2026-11-01', '2026-11-30');
		expect(november.map((i) => [i.id, i.number, i.status])).toEqual([
			['ti_gst_b', 'TI/26-27/000001', 'issued'],
			['ti_gst_c', 'TI/26-27/000002', 'issued'],
			['ti_gst_d', 'TI/26-27/000005', 'cancelled'],
			['ti_gst_last', 'TI/26-27/000009', 'issued'],
		]);
		expect(november[2]?.cancellation).toEqual({ at, by: 'adm_1', reason: 'Wrong buyer' });
		expect((await invoices.listForGstin(OTHER, '2026-11-01', '2026-11-30')).map((i) => i.id)).toEqual([
			'ti_gst_other',
		]);
		expect(await invoices.listForGstin(HOME, '2027-01-01', '2027-01-31')).toEqual([]);
	});

	it('lists the GSTIN’s numbered credit notes in the days, never a draft, by date then number', async () => {
		const notes = new MongoCreditNoteRepository();
		for (const next of [
			creditNote('cn_gst_draft', null, '2026-11-10'),
			creditNote('cn_gst_2', 'CN/26-27/000002', '2026-11-12'),
			creditNote('cn_gst_1', 'CN/26-27/000001', '2026-11-12'),
			creditNote('cn_gst_cancelled', 'CN/26-27/000003', '2026-11-25', {
				status: 'cancelled',
				cancellation: { at, by: 'adm_1', reason: 'Made twice' },
			}),
			creditNote('cn_gst_dec', 'CN/26-27/000004', '2026-12-01'),
			creditNote('cn_gst_other', 'CN/26-27/000001', '2026-11-12', { gstin: OTHER }),
		])
			await notes.insert(next);
		const november = await notes.listForGstin(HOME, '2026-11-01', '2026-11-30');
		expect(november.map((n) => [n.id, n.number, n.status])).toEqual([
			['cn_gst_1', 'CN/26-27/000001', 'issued'],
			['cn_gst_2', 'CN/26-27/000002', 'issued'],
			['cn_gst_cancelled', 'CN/26-27/000003', 'cancelled'],
		]);
		expect((await notes.listForGstin(OTHER, '2026-11-01', '2026-11-30')).map((n) => n.id)).toEqual([
			'cn_gst_other',
		]);
	});

	it('lists the GSTIN’s debit notes in the days, by date then number', async () => {
		const notes = new MongoDebitNoteRepository();
		for (const next of [
			debitNote('dn_gst_2', 'DN/26-27/000002', '2026-11-15'),
			debitNote('dn_gst_1', 'DN/26-27/000001', '2026-11-15'),
			debitNote('dn_gst_oct', 'DN/26-27/000000', '2026-10-15'),
			debitNote('dn_gst_other', 'DN/26-27/000003', '2026-11-15', { gstin: OTHER }),
		])
			await notes.insert(next);
		const november = await notes.listForGstin(HOME, '2026-11-01', '2026-11-30');
		expect(november.map((n) => [n.id, n.number, n.date])).toEqual([
			['dn_gst_1', 'DN/26-27/000001', '2026-11-15'],
			['dn_gst_2', 'DN/26-27/000002', '2026-11-15'],
		]);
		expect((await notes.listForGstin(OTHER, '2026-11-01', '2026-11-30')).map((n) => n.id)).toEqual([
			'dn_gst_other',
		]);
	});
});
