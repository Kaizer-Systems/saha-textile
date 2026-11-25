import { describe, expect, it } from 'vitest';

import { gstinCheckCharacter } from '../src/company/gst-identity';
import { B2CL_ABOVE_PAISE, gstr1, rateItems, saleClass, type Gstr1Input } from '../src/gst/gstr1-rules';

import type { CreditNote, CreditNoteLine, DebitNote, TaxInvoice, TaxInvoiceLine } from '@saha-textile/contracts';

/**
 * GSTR-1 from the books (accounts brief G4): every table worked from a month's invoices and notes, with the figures
 * checked by hand against the return's rules: B2CL above ₹1,00,000 inter-state (Notification 12/2024-CT, from
 * 1 August 2024), notes on small B2C sales netted into Table 7, CDNUR only for B2CL and exports, the HSN summary split
 * for registered and unregistered buyers, and Table 13's document series.
 */

const SELLER = '19DBYPS6736R1ZZ';
/** A GSTIN with its right check character. */
const valid = (first14: string) => `${first14}${gstinCheckCharacter(first14)}`;
const RANG_MUMBAI = valid('27AAKFR1234M1Z');
const BOUTIQUE_KOLKATA = valid('19AAGCB5678K1Z');
const SILK = '50072010';
const KURTA = '62114290';

/** One line's money, in paise so the sums are exact. */
interface Money {
	hsn?: string;
	unit?: 'PCS' | 'MTR';
	quantity?: number;
	rate: number;
	taxable: number;
	igst?: number;
	cgst?: number;
	sgst?: number;
}
type Charge = Omit<Money, 'hsn' | 'unit' | 'quantity' | 'rate'>;

const rs = (p: number) => p / 100;
const all = (m: Charge) => m.taxable + (m.igst ?? 0) + (m.cgst ?? 0) + (m.sgst ?? 0);

const line = (m: Money, at: number): TaxInvoiceLine => ({
	lineId: `l${at}`,
	sku: `SKU-${at}`,
	title: 'Silk saree',
	hsn: m.hsn ?? SILK,
	quantity: m.quantity ?? 1,
	unit: m.unit ?? 'PCS',
	unitPriceINR: rs(all(m)) / (m.quantity ?? 1),
	ratePercent: m.rate,
	taxableINR: rs(m.taxable),
	igstINR: rs(m.igst ?? 0),
	cgstINR: rs(m.cgst ?? 0),
	sgstINR: rs(m.sgst ?? 0),
	totalINR: rs(all(m)),
});

interface Spec {
	id: string;
	number: string;
	pos?: string;
	gstin?: string | null;
	lines: Money[];
	/** What the totals hold beyond the lines: the delivery charge, or a paisa of rounding. */
	extra?: Charge;
	date?: string;
}

/** A document's money: its lines, and totals that add the extra to them. */
function money(spec: Spec) {
	const lines = spec.lines.map(line);
	const extra = spec.extra ?? { taxable: 0 };
	const sum = (pick: (m: Charge) => number) => spec.lines.reduce((s, m) => s + pick(m), pick(extra));
	const pos = spec.pos ?? '19';
	return {
		lines,
		buyer: { name: 'Buyer', gstin: spec.gstin ?? null, address: '', stateCode: pos },
		placeOfSupply: pos,
		interState: pos !== '19',
		taxableINR: rs(sum((m) => m.taxable)),
		igstINR: rs(sum((m) => m.igst ?? 0)),
		cgstINR: rs(sum((m) => m.cgst ?? 0)),
		sgstINR: rs(sum((m) => m.sgst ?? 0)),
		roundOffINR: 0,
		totalINR: rs(sum(all)),
	};
}

const place = { gstRegistrationId: 'gst_wb', gstin: SELLER, locationId: 'loc_kolkata', orderNumber: 'ST-2611-482190' };

function invoice(spec: Spec, status: TaxInvoice['status'] = 'issued'): TaxInvoice {
	return {
		...place,
		billOfSupply: false,
		...money(spec),
		id: spec.id,
		number: spec.number,
		date: spec.date ?? '2026-11-10',
		orderId: `ord_${spec.id}`,
		shipmentId: null,
		seller: { name: 'Saha Textile', gstin: SELLER, address: '', stateCode: '19' },
		shippingINR: rs(all(spec.extra ?? { taxable: 0 })),
		ratesPendingCa: false,
		status,
		cancellation: null,
		voucherId: null,
		createdBy: null,
		createdAt: '2026-11-10T06:00:00.000Z',
	};
}

const noteLines = (lines: TaxInvoiceLine[]): CreditNoteLine[] =>
	lines.map((l) => ({
		...l,
		outcome: null,
		unitCostINR: null,
		layerId: null,
		holdId: null,
		delivery: false,
		note: '',
	}));

function creditNote(spec: Spec & { invoiceId: string }, undoneBy: string | null = null): CreditNote {
	const m = money(spec);
	return {
		...place,
		...m,
		lines: noteLines(m.lines),
		id: spec.id,
		number: spec.number,
		status: undoneBy ? 'cancelled' : 'issued',
		kind: 'goods_returned',
		date: spec.date ?? '2026-11-20',
		invoiceId: spec.invoiceId,
		invoiceNumber: 'TI/26-27/000001',
		invoiceDate: '2026-11-10',
		orderId: 'ord_1',
		returnId: null,
		shipmentId: null,
		reason: 'Returned by the buyer',
		refundTo: 'original_payment',
		deadline: '2027-11-30',
		ratesPendingCa: false,
		voucherId: null,
		refund: null,
		cancellation: null,
		debitNoteId: undoneBy,
		version: 0,
		createdAt: '2026-11-20T06:00:00.000Z',
		createdBy: null,
		issuedAt: '2026-11-20T06:00:00.000Z',
		issuedBy: null,
	};
}

function debitNote(spec: Spec & { creditNoteId: string; invoiceId: string }): DebitNote {
	const m = money(spec);
	return {
		...place,
		...m,
		// Undoing a goods return: the lines keep where the pieces had gone.
		lines: noteLines(m.lines).map((line) => ({ ...line, outcome: 'restock' as const })),
		id: spec.id,
		number: spec.number,
		date: spec.date ?? '2026-11-24',
		orderId: 'ord_1',
		invoiceId: spec.invoiceId,
		invoiceNumber: 'TI/26-27/000001',
		creditNoteId: spec.creditNoteId,
		creditNoteNumber: 'CN/26-27/000002',
		reason: 'Credit note undone',
		voucherId: null,
		createdAt: '2026-11-24T06:00:00.000Z',
		createdBy: null,
	};
}

const input = (over: Partial<Gstr1Input>): Gstr1Input => ({
	gstin: SELLER,
	month: '2026-11',
	invoices: [],
	creditNotes: [],
	debitNotes: [],
	originals: new Map(),
	hsnDigits: 6,
	...over,
});

describe('which table a sale belongs to', () => {
	const sale = (gstin: string | null, placeOfSupply: string, interState: boolean, totalINR: number) => ({
		buyer: { name: 'Buyer', gstin, address: '', stateCode: placeOfSupply },
		placeOfSupply,
		interState,
		totalINR,
	});

	it('puts B2CL’s floor at ₹1,00,000 in paise', () => {
		expect(B2CL_ABOVE_PAISE).toBe(10_000_000);
	});

	it('reports a buyer with a GSTIN in B2B, whatever the place or value', () => {
		expect(saleClass(sale(RANG_MUMBAI, '27', true, 5_00_000))).toBe('b2b');
		expect(saleClass(sale(BOUTIQUE_KOLKATA, '19', false, 500))).toBe('b2b');
	});

	it('reports a sale with place of supply 96 as an export', () => {
		expect(saleClass(sale(null, '96', true, 6_000))).toBe('exp');
		expect(saleClass(sale(null, '96', true, 5_00_000))).toBe('exp');
	});

	it('reports an unregistered buyer in another State in B2CL only above ₹1,00,000, exactly ₹1,00,000 in B2CS', () => {
		expect(saleClass(sale(null, '27', true, 100_000.01))).toBe('b2cl');
		expect(saleClass(sale(null, '27', true, 100_000))).toBe('b2cs');
		expect(saleClass(sale(null, '27', true, 99_999.99))).toBe('b2cs');
	});

	it('keeps a sale in the seller’s own State in B2CS however large', () => {
		expect(saleClass(sale(null, '19', false, 5_00_000))).toBe('b2cs');
	});
});

describe('a document’s money by rate', () => {
	it('groups the lines by rate, lowest rate first', () => {
		const doc = money({
			id: 'd',
			number: 'n',
			pos: '27',
			lines: [
				{ rate: 18, taxable: 300_000, igst: 54_000 },
				{ rate: 5, taxable: 100_000, igst: 5_000 },
				{ rate: 5, taxable: 200_000, igst: 10_000 },
			],
		});
		expect(rateItems(doc)).toEqual([
			{ rate: 5, taxable: 300_000, igst: 15_000, cgst: 0, sgst: 0 },
			{ rate: 18, taxable: 300_000, igst: 54_000, cgst: 0, sgst: 0 },
		]);
	});

	it('adds the delivery charge to the highest rate, so the items add up to the totals', () => {
		const doc = money({
			id: 'd',
			number: 'n',
			lines: [
				{ rate: 5, taxable: 100_000, cgst: 2_500, sgst: 2_500 },
				{ rate: 18, hsn: KURTA, taxable: 200_000, cgst: 18_000, sgst: 18_000 },
			],
			// ₹105 delivery at 18%: 105 ÷ 1.18 = 88.98 taxable, 16.02 tax split 8.01 + 8.01.
			extra: { taxable: 8_898, cgst: 801, sgst: 801 },
		});
		const items = rateItems(doc);
		expect(items).toEqual([
			{ rate: 5, taxable: 100_000, igst: 0, cgst: 2_500, sgst: 2_500 },
			{ rate: 18, taxable: 208_898, igst: 0, cgst: 18_801, sgst: 18_801 },
		]);
		expect(items.reduce((s, i) => s + i.taxable, 0)).toBe(Math.round(doc.taxableINR * 100));
	});

	it('gives a document without lines one item at rate 0 for what its totals hold', () => {
		expect(rateItems({ lines: [], taxableINR: 50, igstINR: 0, cgstINR: 0, sgstINR: 0 })).toEqual([
			{ rate: 0, taxable: 5_000, igst: 0, cgst: 0, sgst: 0 },
		]);
		expect(rateItems({ lines: [], taxableINR: 0, igstINR: 0, cgstINR: 0, sgstINR: 0 })).toEqual([]);
	});

	it('carries a paisa of rounding found in one tax alone to the highest rate', () => {
		for (const tax of ['igst', 'cgst', 'sgst'] as const) {
			const doc = money({
				id: 'd',
				number: 'n',
				lines: [{ rate: 5, taxable: 10_000, [tax]: 500 }],
				extra: { taxable: 0, [tax]: 1 },
			});
			expect(rateItems(doc)).toEqual([{ rate: 5, taxable: 10_000, igst: 0, cgst: 0, sgst: 0, [tax]: 501 }]);
		}
	});
});

describe('a month’s return', () => {
	// 4A: two registered buyers, one in Maharashtra (₹105 delivery at 18%) and one in West Bengal.
	const i1 = invoice({
		id: 'ti_1',
		number: 'TI/26-27/000001',
		pos: '27',
		gstin: RANG_MUMBAI,
		lines: [
			{ rate: 5, taxable: 100_000, igst: 5_000 },
			{ hsn: KURTA, quantity: 2, rate: 18, taxable: 300_000, igst: 54_000 },
		],
		extra: { taxable: 8_898, igst: 1_602 },
	});
	const i2 = invoice({
		id: 'ti_2',
		number: 'TI/26-27/000002',
		gstin: BOUTIQUE_KOLKATA,
		lines: [{ rate: 5, taxable: 200_000, cgst: 5_000, sgst: 5_000 }],
	});
	// 5: unregistered, Maharashtra, ₹2,10,000.
	const i3 = invoice({
		id: 'ti_3',
		number: 'TI/26-27/000003',
		pos: '27',
		lines: [{ quantity: 4, rate: 5, taxable: 20_000_000, igst: 1_000_000 }],
	});
	// 7: 2.5 m of silk in West Bengal with ₹105 delivery at 5%; and exactly ₹1,00,000 to Maharashtra.
	const i4 = invoice({
		id: 'ti_4',
		number: 'TI/26-27/000004',
		lines: [{ unit: 'MTR', quantity: 25, rate: 5, taxable: 100_000, cgst: 2_500, sgst: 2_500 }],
		extra: { taxable: 10_000, cgst: 250, sgst: 250 },
	});
	const i5 = invoice({
		id: 'ti_5',
		number: 'TI/26-27/000005',
		pos: '27',
		lines: [{ rate: 5, taxable: 9_523_810, igst: 476_190 }],
	});
	// 6A: an export under LUT, no IGST.
	const i6 = invoice({
		id: 'ti_6',
		number: 'TI/26-27/000006',
		pos: '96',
		lines: [{ quantity: 2, rate: 5, taxable: 600_000 }],
	});
	const i7 = invoice(
		{ id: 'ti_7', number: 'TI/26-27/000007', lines: [{ rate: 5, taxable: 50_000, cgst: 1_250, sgst: 1_250 }] },
		'cancelled',
	);

	// 1 m of i4 back; a kurta of i1 back, then undone by a debit note; part of i3 and of the export back; and a note
	// on an invoice that is not in the books' reach.
	const c1 = creditNote({
		id: 'cn_1',
		number: 'CN/26-27/000001',
		invoiceId: 'ti_4',
		lines: [{ unit: 'MTR', quantity: 10, rate: 5, taxable: 40_000, cgst: 1_000, sgst: 1_000 }],
	});
	const c2 = creditNote(
		{
			id: 'cn_2',
			number: 'CN/26-27/000002',
			invoiceId: 'ti_1',
			pos: '27',
			gstin: RANG_MUMBAI,
			lines: [{ hsn: KURTA, rate: 18, taxable: 150_000, igst: 27_000 }],
		},
		'dn_1',
	);
	const c3 = creditNote({
		id: 'cn_3',
		number: 'CN/26-27/000003',
		invoiceId: 'ti_3',
		pos: '27',
		lines: [{ rate: 5, taxable: 5_000_000, igst: 250_000 }],
	});
	const c4 = creditNote({
		id: 'cn_4',
		number: 'CN/26-27/000004',
		invoiceId: 'ti_6',
		pos: '96',
		lines: [{ rate: 5, taxable: 300_000 }],
	});
	const c5 = creditNote({
		id: 'cn_5',
		number: 'CN/26-27/000005',
		invoiceId: 'ti_older',
		lines: [{ rate: 5, taxable: 20_000, cgst: 500, sgst: 500 }],
	});
	const d1 = debitNote({
		id: 'dn_1',
		number: 'DN/26-27/000001',
		invoiceId: 'ti_1',
		creditNoteId: 'cn_2',
		pos: '27',
		gstin: RANG_MUMBAI,
		lines: [{ hsn: KURTA, rate: 18, taxable: 150_000, igst: 27_000 }],
	});
	// Undoes a credit note of an earlier month, not in this input: its own buyer has a GSTIN.
	const d2 = debitNote({
		id: 'dn_2',
		number: 'DN/26-27/000002',
		invoiceId: 'ti_older',
		creditNoteId: 'cn_earlier',
		gstin: BOUTIQUE_KOLKATA,
		lines: [{ rate: 5, taxable: 10_000, cgst: 250, sgst: 250 }],
	});

	const month = gstr1(
		input({
			invoices: [i1, i2, i3, i4, i5, i6, i7],
			creditNotes: [c1, c2, c3, c4, c5],
			debitNotes: [d1, d2],
			originals: new Map([i1, i2, i3, i4, i5, i6].map((i) => [i.id, i])),
		}),
	);
	const portal = month.portal;
	const item = (txval: number, rt: number, iamt: number, camt: number, samt: number) => ({
		txval,
		rt,
		iamt,
		camt,
		samt,
		csamt: 0,
	});

	it('sums each table in rupees, the notes signed, the cancelled invoice left out', () => {
		expect(month.summary).toEqual([
			{ table: '4A', records: 2, taxable: 6_088.98, tax: 706.02 },
			{ table: '5', records: 1, taxable: 200_000, tax: 10_000 },
			{ table: '6A', records: 1, taxable: 6_000, tax: 0 },
			{ table: '7', records: 2, taxable: 95_738.1, tax: 4_786.9 },
			{ table: '9B', records: 5, taxable: -52_900, tax: -2_495 },
			{ table: '12', records: 6, taxable: 254_927.08, tax: 12_997.92 },
			{ table: '13', records: 3, taxable: 0, tax: 0 },
		]);
	});

	it('makes the HSN summary agree with the other tables, as the portal checks', () => {
		const rows = Object.fromEntries(month.summary.map((row) => [row.table, row]));
		const paise = (pick: 'taxable' | 'tax') =>
			['4A', '5', '6A', '7', '9B'].reduce((s, table) => s + Math.round((rows[table]?.[pick] ?? 0) * 100), 0);
		expect(paise('taxable')).toBe(Math.round((rows['12']?.taxable ?? 0) * 100));
		expect(paise('tax')).toBe(Math.round((rows['12']?.tax ?? 0) * 100));
	});

	it('flags each note whose invoice is not in the books', () => {
		expect(month.problems).toEqual([
			{ table: '9B', problem: 'note_invoice_missing', document: 'CN/26-27/000005' },
			{ table: '9B', problem: 'note_invoice_missing', document: 'DN/26-27/000002' },
		]);
	});

	it('names the GSTIN and the month as MMYYYY', () => {
		expect(portal.gstin).toBe(SELLER);
		expect(portal.fp).toBe('112026');
	});

	it('lists B2B invoices by buyer GSTIN, items by rate with the delivery charge at the highest', () => {
		expect(portal.b2b).toEqual([
			{
				ctin: RANG_MUMBAI,
				inv: [
					{
						inum: 'TI/26-27/000001',
						idt: '10-11-2026',
						val: 4_695,
						pos: '27',
						rchrg: 'N',
						inv_typ: 'R',
						itms: [
							{ num: 1, itm_det: item(1_000, 5, 50, 0, 0) },
							{ num: 2, itm_det: item(3_088.98, 18, 556.02, 0, 0) },
						],
					},
				],
			},
			{
				ctin: BOUTIQUE_KOLKATA,
				inv: [
					{
						inum: 'TI/26-27/000002',
						idt: '10-11-2026',
						val: 2_100,
						pos: '19',
						rchrg: 'N',
						inv_typ: 'R',
						itms: [{ num: 1, itm_det: item(2_000, 5, 0, 50, 50) }],
					},
				],
			},
		]);
	});

	it('lists B2CL invoices by place of supply, and an export under LUT without payment of tax', () => {
		expect(portal.b2cl).toEqual([
			{
				pos: '27',
				inv: [
					{
						inum: 'TI/26-27/000003',
						idt: '10-11-2026',
						val: 210_000,
						itms: [{ num: 1, itm_det: item(200_000, 5, 10_000, 0, 0) }],
					},
				],
			},
		]);
		expect(portal.exp).toEqual([
			{
				exp_typ: 'WOPAY',
				inv: [
					{
						inum: 'TI/26-27/000006',
						idt: '10-11-2026',
						val: 6_000,
						itms: [{ txval: 6_000, rt: 5, iamt: 0, csamt: 0 }],
					},
				],
			},
		]);
	});

	it('nets the small B2C sales and the notes on them by kind of supply, place and rate', () => {
		// INTRA 19 at 5%: ₹1,100 sold (₹1,000 + ₹100 delivery) less ₹400 back and ₹200 on an older invoice.
		expect(portal.b2cs).toEqual([
			{ sply_ty: 'INTRA', pos: '19', typ: 'OE', ...item(500, 5, 0, 12.5, 12.5) },
			{ sply_ty: 'INTER', pos: '27', typ: 'OE', ...item(95_238.1, 5, 4_761.9, 0, 0) },
		]);
	});

	it('lists notes to registered buyers by GSTIN: the original’s, else the note’s own', () => {
		expect(portal.cdnr).toEqual([
			{
				ctin: RANG_MUMBAI,
				nt: [
					{
						ntty: 'C',
						nt_num: 'CN/26-27/000002',
						nt_dt: '20-11-2026',
						val: 1_770,
						pos: '27',
						rchrg: 'N',
						inv_typ: 'R',
						itms: [{ num: 1, itm_det: item(1_500, 18, 270, 0, 0) }],
					},
					{
						ntty: 'D',
						nt_num: 'DN/26-27/000001',
						nt_dt: '24-11-2026',
						val: 1_770,
						pos: '27',
						rchrg: 'N',
						inv_typ: 'R',
						itms: [{ num: 1, itm_det: item(1_500, 18, 270, 0, 0) }],
					},
				],
			},
			{
				ctin: BOUTIQUE_KOLKATA,
				nt: [
					{
						ntty: 'D',
						nt_num: 'DN/26-27/000002',
						nt_dt: '24-11-2026',
						val: 105,
						pos: '19',
						rchrg: 'N',
						inv_typ: 'R',
						itms: [{ num: 1, itm_det: item(100, 5, 0, 2.5, 2.5) }],
					},
				],
			},
		]);
	});

	it('lists notes to unregistered buyers only for B2CL invoices and exports', () => {
		expect(portal.cdnur).toEqual([
			{
				typ: 'B2CL',
				ntty: 'C',
				nt_num: 'CN/26-27/000003',
				nt_dt: '20-11-2026',
				val: 52_500,
				pos: '27',
				itms: [{ num: 1, itm_det: item(50_000, 5, 2_500, 0, 0) }],
			},
			{
				typ: 'EXPWOP',
				ntty: 'C',
				nt_num: 'CN/26-27/000004',
				nt_dt: '20-11-2026',
				val: 3_000,
				pos: '96',
				itms: [{ num: 1, itm_det: item(3_000, 5, 0, 0, 0) }],
			},
		]);
	});

	it('summarises HSN for registered and unregistered buyers apart, metres in metres, delivery as a service', () => {
		const row = (num: number, hsn_sc: string, uqc: string, qty: number, rt: number, money: object) => ({
			num,
			hsn_sc,
			uqc,
			qty,
			rt,
			...money,
		});
		expect(portal.hsn).toEqual({
			hsn_b2b: [
				// i1 + i2 + the debit note on an older invoice; the kurta back and undone again.
				row(1, SILK, 'PCS', 3, 5, item(3_100, 5, 50, 52.5, 52.5)),
				row(2, KURTA, 'PCS', 2, 18, item(3_000, 18, 540, 0, 0)),
				row(3, '996812', 'NA', 0, 18, item(88.98, 18, 16.02, 0, 0)),
			],
			hsn_b2c: [
				// 4 + 1 + 2 pieces sold, 3 back.
				row(1, SILK, 'PCS', 4, 5, item(248_038.1, 5, 12_261.9, -5, -5)),
				// 2.5 m sold, 1 m back.
				row(2, SILK, 'MTR', 1.5, 5, item(600, 5, 0, 15, 15)),
				row(3, '996812', 'NA', 0, 5, item(100, 5, 0, 2.5, 2.5)),
			],
		});
	});

	it('counts each kind of document issued, the cancelled invoice among them', () => {
		expect(portal.doc_issue).toEqual({
			doc_det: [
				{
					doc_num: 1,
					docs: [
						{ num: 1, from: 'TI/26-27/000001', to: 'TI/26-27/000007', totnum: 7, cancel: 1, net_issue: 6 },
					],
				},
				{
					doc_num: 5,
					docs: [
						{ num: 1, from: 'CN/26-27/000001', to: 'CN/26-27/000005', totnum: 5, cancel: 0, net_issue: 5 },
					],
				},
				{
					doc_num: 4,
					docs: [
						{ num: 1, from: 'DN/26-27/000001', to: 'DN/26-27/000002', totnum: 2, cancel: 0, net_issue: 2 },
					],
				},
			],
		});
	});
});

describe('the return’s checks', () => {
	it('flags a B2B invoice whose buyer GSTIN fails its check character', () => {
		const wrong = `${RANG_MUMBAI.slice(0, 14)}${RANG_MUMBAI[14] === 'A' ? 'B' : 'A'}`;
		const out = gstr1(
			input({
				invoices: [
					invoice({
						id: 'a',
						number: 'TI/1',
						pos: '27',
						gstin: wrong,
						lines: [{ rate: 5, taxable: 100, igst: 5 }],
					}),
					invoice({
						id: 'b',
						number: 'TI/2',
						pos: '27',
						gstin: RANG_MUMBAI,
						lines: [{ rate: 5, taxable: 100, igst: 5 }],
					}),
				],
			}),
		);
		expect(out.problems).toEqual([{ table: '4A', problem: 'gstin_invalid', document: 'TI/1' }]);
	});

	it('flags an HSN with fewer digits than the registration must show, never the delivery service', () => {
		const sales = [
			invoice({
				id: 'a',
				number: 'TI/1',
				lines: [
					{ hsn: '5007', rate: 5, taxable: 100, cgst: 2.5, sgst: 2.5 },
					{ hsn: '5007.20', rate: 5, taxable: 100, cgst: 2.5, sgst: 2.5 },
				],
				extra: { taxable: 100, cgst: 2.5, sgst: 2.5 },
			}),
		];
		expect(gstr1(input({ invoices: sales, hsnDigits: 6 })).problems).toEqual([
			{ table: '12', problem: 'hsn_digits', document: '5007' },
		]);
		expect(gstr1(input({ invoices: sales, hsnDigits: 4 })).problems).toEqual([]);
	});
});

describe('the return’s edges', () => {
	it('sorts B2CS by place of supply, then rate; and the HSN summary by HSN, then rate', () => {
		// Garments of one HSN at 5% up to ₹2,500 and 18% above (GST rates from 22 September 2025).
		const out = gstr1(
			input({
				invoices: [
					invoice({
						id: 'a',
						number: 'TI/1',
						lines: [{ hsn: KURTA, rate: 18, taxable: 300_000, cgst: 27_000, sgst: 27_000 }],
					}),
					invoice({
						id: 'b',
						number: 'TI/2',
						lines: [{ hsn: KURTA, rate: 5, taxable: 200_000, cgst: 5_000, sgst: 5_000 }],
					}),
					invoice({
						id: 'c',
						number: 'TI/3',
						pos: '07',
						lines: [{ rate: 5, taxable: 100_000, igst: 5_000 }],
					}),
				],
			}),
		);
		expect(out.portal.b2cs.map((row) => [row.pos, row.rt])).toEqual([
			['07', 5],
			['19', 5],
			['19', 18],
		]);
		expect(out.portal.hsn.hsn_b2c.map((row) => [row.hsn_sc, row.rt])).toEqual([
			[SILK, 5],
			[KURTA, 5],
			[KURTA, 18],
		]);
	});

	it('groups B2CL invoices of one State together', () => {
		const big = (id: string, pos: string) =>
			invoice({ id, number: `TI/${id}`, pos, lines: [{ rate: 5, taxable: 20_000_000, igst: 1_000_000 }] });
		const out = gstr1(input({ invoices: [big('1', '27'), big('2', '07'), big('3', '27')] }));
		expect(out.portal.b2cl.map((group) => [group.pos, group.inv.map((i) => i.inum)])).toEqual([
			['27', ['TI/1', 'TI/3']],
			['07', ['TI/2']],
		]);
	});

	it('counts each series apart, numbers in number order, not letter order', () => {
		const sale = (id: string, number: string, status: TaxInvoice['status'] = 'issued') =>
			invoice({ id, number, lines: [{ rate: 5, taxable: 100, cgst: 2.5, sgst: 2.5 }] }, status);
		const out = gstr1(
			input({
				invoices: [
					sale('a', 'TI/26-27/000010'),
					sale('b', 'POS/10'),
					sale('c', 'TI/26-27/000009', 'cancelled'),
					sale('d', 'POS/9'),
					sale('e', 'POS/100'),
				],
			}),
		);
		expect(out.portal.doc_issue.doc_det).toEqual([
			{
				doc_num: 1,
				docs: [
					{ num: 1, from: 'TI/26-27/000009', to: 'TI/26-27/000010', totnum: 2, cancel: 1, net_issue: 1 },
					{ num: 2, from: 'POS/9', to: 'POS/100', totnum: 3, cancel: 0, net_issue: 3 },
				],
			},
		]);
	});

	it('adds metres exactly, to three decimals', () => {
		const out = gstr1(
			input({
				invoices: [
					invoice({
						id: 'a',
						number: 'TI/1',
						lines: [
							{ unit: 'MTR', quantity: 1, rate: 5, taxable: 1_000, cgst: 25, sgst: 25 },
							{ unit: 'MTR', quantity: 2, rate: 5, taxable: 2_000, cgst: 50, sgst: 50 },
						],
					}),
				],
			}),
		);
		expect(out.portal.hsn.hsn_b2c[0]?.qty).toBe(0.3);
	});

	it('keeps a paisa of rounding in one tax alone in the HSN summary, as a delivery-service row', () => {
		for (const tax of ['igst', 'cgst', 'sgst'] as const) {
			const out = gstr1(
				input({
					invoices: [
						invoice({
							id: 'a',
							number: 'TI/1',
							pos: tax === 'igst' ? '27' : '19',
							lines: [{ rate: 5, taxable: 10_000, [tax]: 500 }],
							extra: { taxable: 0, [tax]: 1 },
						}),
					],
				}),
			);
			const rest = { iamt: 0, camt: 0, samt: 0, [{ igst: 'iamt', cgst: 'camt', sgst: 'samt' }[tax]]: 0.01 };
			expect(out.portal.hsn.hsn_b2c[1]).toMatchObject({ hsn_sc: '996812', uqc: 'NA', qty: 0, txval: 0, ...rest });
		}
	});

	it('takes a debit note’s original through its credit note, and flags it when the credit note’s invoice is gone', () => {
		const credit = creditNote({
			id: 'cn_1',
			number: 'CN/1',
			invoiceId: 'ti_gone',
			lines: [{ rate: 5, taxable: 1_000, cgst: 25, sgst: 25 }],
		});
		const debit = debitNote({
			id: 'dn_1',
			number: 'DN/1',
			invoiceId: 'ti_gone',
			creditNoteId: 'cn_1',
			lines: [{ rate: 5, taxable: 1_000, cgst: 25, sgst: 25 }],
		});
		const out = gstr1(input({ creditNotes: [credit], debitNotes: [debit] }));
		expect(out.problems.map((p) => p.document)).toEqual(['CN/1', 'DN/1']);
		// Both on a small B2C sale by their own buyer and place: they cancel out in Table 7.
		expect(out.portal.b2cs).toEqual([
			{ sply_ty: 'INTRA', pos: '19', typ: 'OE', txval: 0, rt: 5, iamt: 0, camt: 0, samt: 0, csamt: 0 },
		]);
	});

	it('reports a note on a missing invoice in CDNUR as B2CL when its own sale is B2CL', () => {
		const out = gstr1(
			input({
				creditNotes: [
					creditNote({
						id: 'cn_1',
						number: 'CN/1',
						invoiceId: 'ti_gone',
						pos: '27',
						lines: [{ rate: 5, taxable: 20_000_000, igst: 1_000_000 }],
					}),
				],
			}),
		);
		expect(out.portal.cdnur.map((n) => [n.typ, n.nt_num])).toEqual([['B2CL', 'CN/1']]);
		expect(out.problems).toEqual([{ table: '9B', problem: 'note_invoice_missing', document: 'CN/1' }]);
	});

	it('files an empty month as empty tables', () => {
		const out = gstr1(input({ month: '2027-03' }));
		expect(out.summary.every((row) => row.records === 0 && row.taxable === 0 && row.tax === 0)).toBe(true);
		expect(out.problems).toEqual([]);
		expect(out.portal).toEqual({
			gstin: SELLER,
			fp: '032027',
			b2b: [],
			b2cl: [],
			exp: [],
			b2cs: [],
			cdnr: [],
			cdnur: [],
			hsn: { hsn_b2b: [], hsn_b2c: [] },
			doc_issue: { doc_det: [] },
		});
	});
});
