import type { TaxInvoice } from '@saha-textile/contracts';
import { describe, expect, it, vi } from 'vitest';

import { GstReturnsService } from '../src/gst/gst-returns.service';

/**
 * GSTR-1 finds the invoice a debit note is against too, not only a credit note's (found by the full accounts run): a
 * debit note on last month's invoice was reported as "invoice missing" in table 9B.
 */

const at = '2026-11-28T06:00:00.000Z';
const GSTIN = '19DBYPS6736R1ZZ';
const REGISTRATION = {
	id: 'reg_wb',
	gstin: GSTIN,
	stateCode: '19',
	terms: [{ from: '2026-04-01', kind: 'regular', scheme: 'monthly', hsnDigits: 4 }],
} as never;

const line = {
	lineId: 'a',
	sku: 'S',
	title: 'Saree',
	hsn: '50071090',
	quantity: 1,
	unit: 'PCS',
	unitPriceINR: 1050,
	ratePercent: 5,
	taxableINR: 1000,
	cgstINR: 25,
	sgstINR: 25,
	igstINR: 0,
	totalINR: 1050,
};
const invoice = (id: string, number: string, date: string) =>
	({
		id,
		number,
		date,
		gstRegistrationId: 'reg_wb',
		gstin: GSTIN,
		locationId: 'loc_bar',
		seller: { name: 'K.R. Marketing', gstin: GSTIN, address: '', stateCode: '19' },
		buyer: { name: 'Ananya Das', gstin: null, address: '', stateCode: '19' },
		placeOfSupply: '19',
		interState: false,
		lines: [line],
		shippingINR: 0,
		taxableINR: 1000,
		cgstINR: 25,
		sgstINR: 25,
		igstINR: 0,
		roundOffINR: 0,
		totalINR: 1050,
		status: 'issued',
		cancellation: null,
		createdAt: at,
	}) as unknown as TaxInvoice;
const note = (id: string, number: string, invoiceId: string, extra: Record<string, unknown>) => ({
	...invoice(id, number, '2026-11-20'),
	invoiceId,
	invoiceNumber: `TI/${invoiceId}`,
	invoiceDate: '2026-10-10',
	...extra,
});

/** October's invoice, which November's notes are against; ti_gone was never found. */
const OCTOBER = invoice('ti_oct', 'TI/26-27/000090', '2026-10-10');

function build(creditNotes: unknown[], debitNotes: unknown[]) {
	const invoices = {
		listForGstin: vi.fn(async () => []),
		get: vi.fn(async (id: string) => (id === OCTOBER.id ? OCTOBER : null)),
	};
	const service = new GstReturnsService(
		{} as never,
		{} as never,
		{} as never,
		invoices as never,
		{ listForGstin: async () => creditNotes } as never,
		{ listForGstin: async () => debitNotes } as never,
		{} as never,
		{} as never,
		{} as never,
		// The schemes service (QRMP, composition, ISD): a monthly GSTIN's GSTR-1 never reaches it.
		{} as never,
	);
	return { service, invoices };
}

describe('the invoices GSTR-1 reads for the month’s notes', () => {
	it('reads each note’s invoice once, a debit note’s as well as a credit note’s', async () => {
		const { service, invoices } = build(
			[note('cn_1', 'CN/26-27/000001', 'ti_oct', { kind: 'goods_returned' })],
			[
				note('dn_1', 'DN/26-27/000001', 'ti_oct', { lines: [{ ...line, outcome: null }] }),
				note('dn_2', 'DN/26-27/000002', 'ti_gone', { lines: [{ ...line, outcome: null }] }),
			],
		);
		const result = await service.gstr1Between(REGISTRATION, '2026-11-01', '2026-11-30', '2026-11');
		expect(invoices.get.mock.calls.map(([id]) => id)).toEqual(['ti_oct', 'ti_gone']);
		// The debit note on October's invoice is found; only the one whose invoice is gone is reported.
		expect(result.problems.filter((p) => p.problem === 'note_invoice_missing')).toEqual([
			{ table: '9B', problem: 'note_invoice_missing', document: 'DN/26-27/000002' },
		]);
	});

	it('reads a debit note’s invoice when the month has no credit note', async () => {
		const { service, invoices } = build(
			[],
			[note('dn_1', 'DN/26-27/000001', 'ti_oct', { lines: [{ ...line, outcome: null }] })],
		);
		const result = await service.gstr1Between(REGISTRATION, '2026-11-01', '2026-11-30', '2026-11');
		expect(invoices.get).toHaveBeenCalledExactlyOnceWith('ti_oct');
		expect(result.problems.filter((p) => p.problem === 'note_invoice_missing')).toEqual([]);
	});
});
