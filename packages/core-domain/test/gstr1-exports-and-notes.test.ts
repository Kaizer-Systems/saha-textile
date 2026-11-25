import { describe, expect, it } from 'vitest';

import { annualRows, annualSupplies } from '../src/gst/gst-annual';
import { exportType, gstr1 } from '../src/gst/gstr1-rules';
import { saleFromTaxInvoice } from '../src/invoicing/invoice-edoc';

import type { CreditNote, CreditNoteLine, DebitNote, TaxInvoice } from '@saha-textile/contracts';

/**
 * GSTR-1 and GSTR-9 after the fixes, checked against the law: an export with IGST charged (no LUT) is zero-rated with
 * payment of tax (6A WPAY, notes EXPWP, GSTR-9 table 4C), one under a LUT without it (WOPAY, EXPWOP, table 5A); a
 * credit note cancelled outright never happened (only table 13 counts it, as cancelled); a price adjustment moves
 * money, not goods; a debit note finds its invoice by its own invoice id. The e-invoice's supply type follows suit.
 */

const SELLER = '19DBYPS6736R1ZZ';
const SILK = '50072010';
const KURTA = '62114290';
const rs = (p: number) => p / 100;

interface Money {
	hsn: string;
	quantity: number;
	taxable: number;
	igst?: number;
	cgst?: number;
	sgst?: number;
}

function money(pos: string, m: Money, outcome: CreditNoteLine['outcome'] = 'restock') {
	const total = m.taxable + (m.igst ?? 0) + (m.cgst ?? 0) + (m.sgst ?? 0);
	const line = {
		lineId: 'l1',
		sku: 'SKU',
		title: 'Saree',
		hsn: m.hsn,
		quantity: m.quantity,
		unit: 'PCS' as const,
		unitPriceINR: rs(total) / m.quantity,
		ratePercent: 5,
		taxableINR: rs(m.taxable),
		igstINR: rs(m.igst ?? 0),
		cgstINR: rs(m.cgst ?? 0),
		sgstINR: rs(m.sgst ?? 0),
		totalINR: rs(total),
	};
	return {
		line,
		noteLine: { ...line, outcome, unitCostINR: null, layerId: null, holdId: null, delivery: false, note: '' },
		totals: {
			buyer: { name: 'Buyer', gstin: null, address: '', stateCode: pos },
			placeOfSupply: pos,
			interState: pos !== '19',
			taxableINR: line.taxableINR,
			igstINR: line.igstINR,
			cgstINR: line.cgstINR,
			sgstINR: line.sgstINR,
			roundOffINR: 0,
			totalINR: line.totalINR,
		},
	};
}

const base = { gstRegistrationId: 'gst_wb', gstin: SELLER, locationId: 'loc', orderId: 'ord', orderNumber: 'ST-1' };

const invoice = (id: string, number: string, pos: string, m: Money): TaxInvoice => {
	const { line, totals } = money(pos, m);
	return {
		...base,
		...totals,
		billOfSupply: false,
		id,
		number,
		date: '2026-11-10',
		shipmentId: null,
		seller: { name: 'Saha Textile', gstin: SELLER, address: '', stateCode: '19' },
		lines: [line],
		shippingINR: 0,
		ratesPendingCa: false,
		status: 'issued',
		cancellation: null,
		voucherId: null,
		createdBy: null,
		createdAt: '2026-11-10T06:00:00.000Z',
	};
};

const creditNote = (
	id: string,
	number: string,
	invoiceId: string,
	pos: string,
	m: Money,
	over: Partial<CreditNote> = {},
): CreditNote => {
	const { noteLine, totals } = money(pos, m);
	return {
		...base,
		...totals,
		id,
		number,
		status: 'issued',
		kind: 'goods_returned',
		date: '2026-11-20',
		invoiceId,
		invoiceNumber: 'TI/1',
		invoiceDate: '2026-11-10',
		returnId: null,
		shipmentId: null,
		reason: 'Returned',
		refundTo: 'original_payment',
		lines: [noteLine],
		deadline: '2027-11-30',
		ratesPendingCa: false,
		voucherId: null,
		refund: null,
		cancellation: null,
		debitNoteId: null,
		version: 0,
		createdAt: '2026-11-20T06:00:00.000Z',
		createdBy: null,
		issuedAt: '2026-11-20T06:00:00.000Z',
		issuedBy: null,
		...over,
	};
};

const debitNote = (
	id: string,
	number: string,
	invoiceId: string,
	pos: string,
	m: Money,
	outcome: CreditNoteLine['outcome'],
): DebitNote => {
	const { noteLine, totals } = money(pos, m, outcome);
	return {
		...base,
		...totals,
		id,
		number,
		date: '2026-11-24',
		invoiceId,
		invoiceNumber: 'TI/1',
		creditNoteId: 'cn_of_an_earlier_month',
		creditNoteNumber: 'CN/0',
		reason: 'Credit note undone',
		lines: [noteLine],
		voucherId: null,
		createdAt: '2026-11-24T06:00:00.000Z',
		createdBy: null,
	};
};

// Two exports with IGST charged (export is off: no LUT), one under a LUT, and a sale in West Bengal.
const e1 = invoice('ti_e1', 'TI/1', '96', { hsn: SILK, quantity: 2, taxable: 600_000, igst: 30_000 });
const e2 = invoice('ti_e2', 'TI/2', '96', { hsn: SILK, quantity: 1, taxable: 400_000 });
const e3 = invoice('ti_e3', 'TI/3', '96', { hsn: SILK, quantity: 1, taxable: 200_000, igst: 10_000 });
const d1 = invoice('ti_d1', 'TI/4', '19', { hsn: KURTA, quantity: 3, taxable: 300_000, cgst: 7_500, sgst: 7_500 });

const notes = {
	creditNotes: [
		creditNote('cn_1', 'CN/1', 'ti_e1', '96', { hsn: SILK, quantity: 1, taxable: 300_000, igst: 15_000 }),
		creditNote('cn_2', 'CN/2', 'ti_e2', '96', { hsn: SILK, quantity: 1, taxable: 400_000 }),
		// On an export not in the books' reach, IGST charged.
		creditNote('cn_3', 'CN/3', 'ti_gone', '96', { hsn: SILK, quantity: 1, taxable: 100_000, igst: 5_000 }),
		// Cancelled outright before the month was filed: it never happened.
		creditNote(
			'cn_4',
			'CN/4',
			'ti_e2',
			'96',
			{ hsn: SILK, quantity: 1, taxable: 400_000 },
			{ status: 'cancelled' },
		),
		// A price agreed lower on the West Bengal sale: money back, no goods.
		creditNote(
			'cn_5',
			'CN/5',
			'ti_d1',
			'19',
			{ hsn: KURTA, quantity: 3, taxable: 30_000, cgst: 750, sgst: 750 },
			{ kind: 'price_adjustment' },
		),
	],
	debitNotes: [
		// Undoing an earlier month's goods return on an export: its invoice found by its own id.
		debitNote('dn_1', 'DN/1', 'ti_e1', '96', { hsn: SILK, quantity: 1, taxable: 300_000, igst: 15_000 }, 'restock'),
		// Undoing an earlier price adjustment: money only.
		debitNote(
			'dn_2',
			'DN/2',
			'ti_d1',
			'19',
			{ hsn: KURTA, quantity: 3, taxable: 30_000, cgst: 750, sgst: 750 },
			null,
		),
	],
};

const month = gstr1({
	gstin: SELLER,
	month: '2026-11',
	invoices: [e1, e2, e3, d1],
	...notes,
	originals: new Map([e1, e2, e3, d1].map((i) => [i.id, i])),
	hsnDigits: 6,
});

describe('how an export is reported', () => {
	it('is with payment of tax when the invoice carries IGST, even a paisa, and under a LUT at nothing', () => {
		expect(exportType({ igstINR: 300 })).toBe('WPAY');
		expect(exportType({ igstINR: 0.01 })).toBe('WPAY');
		expect(exportType({ igstINR: 0 })).toBe('WOPAY');
		expect(exportType({ igstINR: 0.004 })).toBe('WOPAY');
	});

	it('groups 6A’s exports by kind, those with IGST first as they came', () => {
		expect(month.portal.exp.map((g) => [g.exp_typ, g.inv.map((i) => i.inum)])).toEqual([
			['WPAY', ['TI/1', 'TI/3']],
			['WOPAY', ['TI/2']],
		]);
		expect(month.portal.exp[0]?.inv[0]?.itms).toEqual([{ txval: 6_000, rt: 5, iamt: 300, csamt: 0 }]);
		expect(month.summary.find((r) => r.table === '6A')).toEqual({
			table: '6A',
			records: 3,
			taxable: 12_000,
			tax: 400,
		});
	});

	it('types a note on an export by the IGST its invoice carried, or its own when the invoice is missing', () => {
		expect(month.portal.cdnur.map((n) => [n.nt_num, n.ntty, n.typ])).toEqual([
			['CN/1', 'C', 'EXPWP'],
			['CN/2', 'C', 'EXPWOP'],
			['CN/3', 'C', 'EXPWP'],
			['DN/1', 'D', 'EXPWP'],
		]);
		expect(month.problems).toEqual([{ table: '9B', problem: 'note_invoice_missing', document: 'CN/3' }]);
	});
});

describe('notes cancelled, on prices, and undoing earlier ones', () => {
	it('leaves a credit note cancelled outright out of every table, and counts it cancelled in table 13', () => {
		expect(month.portal.cdnur.some((n) => n.nt_num === 'CN/4')).toBe(false);
		expect(month.summary.find((r) => r.table === '9B')).toEqual({
			table: '9B',
			records: 4,
			taxable: -5_000,
			tax: -50,
		});
		expect(month.portal.doc_issue.doc_det.find((d) => d.doc_num === 5)?.docs).toEqual([
			{ num: 1, from: 'CN/1', to: 'CN/5', totnum: 5, cancel: 1, net_issue: 4 },
		]);
	});

	it('moves no quantity for a price adjustment or a debit note undoing one, only money', () => {
		const kurta = month.portal.hsn.hsn_b2c.find((r) => r.hsn_sc === KURTA);
		// 3 pieces sold; ₹300 off and ₹300 back on, no pieces either way.
		expect(kurta).toMatchObject({ qty: 3, txval: 3_000, camt: 75, samt: 75 });
		expect(month.portal.b2cs).toEqual([
			{ sply_ty: 'INTRA', pos: '19', typ: 'OE', txval: 3_000, rt: 5, iamt: 0, camt: 75, samt: 75, csamt: 0 },
		]);
	});

	it('counts goods back and forth for returns and a debit note undoing one, never the cancelled note', () => {
		// 4 pieces exported; 3 back (the cancelled note’s piece not among them); 1 again by the debit note.
		expect(month.portal.hsn.hsn_b2c.find((r) => r.hsn_sc === SILK)).toMatchObject({
			qty: 2,
			txval: 7_000,
			iamt: 350,
		});
	});
});

describe('GSTR-9 tables 4 and 5 from the same month', () => {
	it('puts taxed exports and their notes in table 4 and the LUT export and its note in table 5', () => {
		// Taxed: ₹3,000 at home + ₹8,000 exported with IGST − ₹3,000 and ₹1,000 back + ₹3,000 again = ₹10,000.
		expect(annualSupplies({ summary: month.summary, portal: month.portal })).toEqual({
			taxed: 1_000_000,
			zeroRatedWithoutTax: 0,
		});
		const rows = annualRows({
			gstr1: [{ summary: month.summary, portal: month.portal }],
			gstr3b: [],
			books: { summary: month.summary, portal: month.portal, inputCredit: 0, reversed: 0 },
		});
		expect(rows.slice(0, 2)).toEqual([
			{ table: '4', returns: 1_000_000, books: 1_000_000, unit: 'paise' },
			{ table: '5', returns: 0, books: 0, unit: 'paise' },
		]);
	});
});

describe('the e-invoice’s supply type', () => {
	const party = (stateCode: string) => ({
		gstin: null,
		legalName: 'P',
		line1: 'S',
		city: 'T',
		pin: '700124',
		stateCode,
	});

	it('is an export with payment when IGST is charged, without payment at nothing, and B2B at home', () => {
		expect(saleFromTaxInvoice(e1, { seller: party('19'), buyer: party('96') }).supplyType).toBe('EXPWP');
		expect(saleFromTaxInvoice(e2, { seller: party('19'), buyer: party('96') }).supplyType).toBe('EXPWOP');
		expect(saleFromTaxInvoice(d1, { seller: party('19'), buyer: party('19') }).supplyType).toBe('B2B');
	});
});
