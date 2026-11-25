import type { CreditNote, DebitNote, TaxInvoice, TaxInvoiceLine } from '@saha-textile/contracts';

import { gstinProblem } from '../company/gst-identity';
import { DELIVERY_SAC } from '../invoicing/invoice-edoc';
import { documentQuantity } from '../invoicing/tax-invoice-rules';

/**
 * GSTR-1 from the books (accounts brief G4, addendum). Pure: a GSTIN's tax invoices, credit and debit notes of a
 * month become the return's tables, the checks it must pass, and the file the GST portal takes. Amounts are worked in
 * paise and given back in rupees, as the portal wants them.
 *
 * - 4A B2B: invoices to a buyer with a GSTIN, item by rate.
 * - 5 B2CL: to an unregistered buyer in another State, invoice value over ₹1,00,000 (from 1 August 2024).
 * - 6A exports (place of supply 96): with payment of IGST (WPAY) when the invoice carries IGST, as ours do without a
 *   LUT; under a LUT or bond without it (WOPAY).
 * - 7 B2CS: every other sale to an unregistered buyer, summed by kind of supply, place of supply and rate; credit
 *   and debit notes on such sales net into it.
 * - 9B: notes to a registered buyer (CDNR), and to an unregistered one only when the invoice was B2CL or an export
 *   (CDNUR). A credit note cancelled outright never happened and stays out of every table but 13, where it counts as
 *   cancelled; one undone by a debit note stays, with the debit note adding the money back.
 * - 12 HSN summary, separately for supplies to registered and to unregistered buyers, by HSN, unit and rate. A price
 *   adjustment moves money, not goods, so its quantity is 0.
 * - 13 Documents issued: each series' first and last number, how many, how many cancelled.
 */

/** B2CL's floor: an invoice to an unregistered buyer in another State above this is reported invoice by invoice. */
export const B2CL_ABOVE_PAISE = 1_00_000_00;

export type Gstr1Table = '4A' | '5' | '6A' | '7' | '9B' | '12' | '13';
export type SaleClass = 'b2b' | 'b2cl' | 'exp' | 'b2cs';

const paise = (rupees: number): number => Math.round(rupees * 100);
const rupees = (p: number): number => Math.round(p) / 100;

/** One rate's money on a document, in paise. */
export interface RateItem {
	rate: number;
	taxable: number;
	igst: number;
	cgst: number;
	sgst: number;
}

type Document = Pick<
	TaxInvoice,
	'lines' | 'taxableINR' | 'igstINR' | 'cgstINR' | 'sgstINR' | 'buyer' | 'placeOfSupply' | 'interState' | 'totalINR'
>;

/** How an export is reported: with IGST paid (WPAY) or under a LUT or bond without it (WOPAY). */
export function exportType(doc: Pick<TaxInvoice, 'igstINR'>): 'WPAY' | 'WOPAY' {
	return paise(doc.igstINR) > 0 ? 'WPAY' : 'WOPAY';
}

/** Which table a sale belongs to. */
export function saleClass(invoice: Pick<TaxInvoice, 'buyer' | 'placeOfSupply' | 'interState' | 'totalINR'>): SaleClass {
	if (invoice.buyer.gstin) return 'b2b';
	if (invoice.placeOfSupply === '96') return 'exp';
	return invoice.interState && paise(invoice.totalINR) > B2CL_ABOVE_PAISE ? 'b2cl' : 'b2cs';
}

/**
 * A document's money by rate. Its lines are grouped by rate; what the totals hold beyond the lines (the delivery
 * charge, taxed at the document's highest rate) joins that rate, so the items always add up to the totals.
 */
export function rateItems(doc: Pick<Document, 'lines' | 'taxableINR' | 'igstINR' | 'cgstINR' | 'sgstINR'>): RateItem[] {
	const byRate = new Map<number, RateItem>();
	const add = (rate: number, taxable: number, igst: number, cgst: number, sgst: number) => {
		const item = byRate.get(rate) ?? { rate, taxable: 0, igst: 0, cgst: 0, sgst: 0 };
		item.taxable += taxable;
		item.igst += igst;
		item.cgst += cgst;
		item.sgst += sgst;
		byRate.set(rate, item);
	};
	for (const line of doc.lines)
		add(line.ratePercent, paise(line.taxableINR), paise(line.igstINR), paise(line.cgstINR), paise(line.sgstINR));
	const sum = (pick: (item: RateItem) => number) => [...byRate.values()].reduce((s, item) => s + pick(item), 0);
	const rest = {
		taxable: paise(doc.taxableINR) - sum((i) => i.taxable),
		igst: paise(doc.igstINR) - sum((i) => i.igst),
		cgst: paise(doc.cgstINR) - sum((i) => i.cgst),
		sgst: paise(doc.sgstINR) - sum((i) => i.sgst),
	};
	if (rest.taxable || rest.igst || rest.cgst || rest.sgst)
		add(Math.max(0, ...doc.lines.map((l) => l.ratePercent)), rest.taxable, rest.igst, rest.cgst, rest.sgst);
	return [...byRate.values()].sort((a, b) => a.rate - b.rate);
}

export interface HsnRow {
	hsn: string;
	uqc: 'PCS' | 'MTR' | 'NA';
	rate: number;
	qty: number;
	taxable: number;
	igst: number;
	cgst: number;
	sgst: number;
}

/**
 * A document's lines in the HSN summary, with its delivery charge as the courier service. `goods` is false for a
 * price adjustment, which moves no goods.
 */
function hsnLines(doc: Document, sign: 1 | -1, goods = true): HsnRow[] {
	const rows: HsnRow[] = doc.lines.map((line: TaxInvoiceLine) => ({
		hsn: line.hsn,
		uqc: line.unit,
		rate: line.ratePercent,
		qty: goods ? sign * documentQuantity(line) : 0,
		taxable: sign * paise(line.taxableINR),
		igst: sign * paise(line.igstINR),
		cgst: sign * paise(line.cgstINR),
		sgst: sign * paise(line.sgstINR),
	}));
	const items = rateItems(doc);
	const delivery = {
		taxable: items.reduce((s, i) => s + i.taxable, 0) - rows.reduce((s, r) => s + sign * r.taxable, 0),
		igst: items.reduce((s, i) => s + i.igst, 0) - rows.reduce((s, r) => s + sign * r.igst, 0),
		cgst: items.reduce((s, i) => s + i.cgst, 0) - rows.reduce((s, r) => s + sign * r.cgst, 0),
		sgst: items.reduce((s, i) => s + i.sgst, 0) - rows.reduce((s, r) => s + sign * r.sgst, 0),
	};
	if (delivery.taxable || delivery.igst || delivery.cgst || delivery.sgst)
		rows.push({
			hsn: DELIVERY_SAC,
			uqc: 'NA',
			rate: Math.max(0, ...doc.lines.map((l) => l.ratePercent)),
			qty: 0,
			taxable: sign * delivery.taxable,
			igst: sign * delivery.igst,
			cgst: sign * delivery.cgst,
			sgst: sign * delivery.sgst,
		});
	return rows;
}

function addHsn(into: Map<string, HsnRow>, rows: readonly HsnRow[]) {
	for (const row of rows) {
		const key = `${row.hsn}|${row.uqc}|${row.rate}`;
		const at = into.get(key) ?? { ...row, qty: 0, taxable: 0, igst: 0, cgst: 0, sgst: 0 };
		at.qty = Math.round((at.qty + row.qty) * 1000) / 1000;
		at.taxable += row.taxable;
		at.igst += row.igst;
		at.cgst += row.cgst;
		at.sgst += row.sgst;
		into.set(key, at);
	}
}

export interface Gstr1Input {
	gstin: string;
	/** `YYYY-MM`. */
	month: string;
	/** The GSTIN's tax invoices dated in the month, cancelled ones too (table 13 counts them). */
	invoices: readonly TaxInvoice[];
	/** Credit notes with a number dated in the month, cancelled ones too (table 13 counts them). */
	creditNotes: readonly CreditNote[];
	debitNotes: readonly DebitNote[];
	/** The invoices the credit and debit notes are against, whichever month they were issued in. */
	originals: ReadonlyMap<string, TaxInvoice>;
	/** HSN digits the registration must show (4 up to ₹5 crore turnover, 6 above). */
	hsnDigits: 4 | 6;
	/**
	 * QRMP: invoice and note numbers a filed IFF already reported, left out of 4A and 9B (CDNR) of the quarter's
	 * GSTR-1; the HSN summary and table 13 still count them, since IFF has neither.
	 */
	reportedInIff?: ReadonlySet<string>;
}

export interface Gstr1Problem {
	table: Gstr1Table;
	problem: 'gstin_invalid' | 'hsn_digits' | 'note_invoice_missing';
	document: string;
}

/** A note in the return: which invoice, its class, and its money signed (a credit note reduces). */
interface NoteRow {
	ntty: 'C' | 'D';
	number: string;
	date: string;
	doc: Document;
	original: TaxInvoice | undefined;
	sign: 1 | -1;
	/** False for a price adjustment (and a debit note undoing one): money only, no goods. */
	goods: boolean;
}

export function gstr1(input: Gstr1Input) {
	const problems: Gstr1Problem[] = [];
	const live = input.invoices.filter((invoice) => invoice.status !== 'cancelled');
	const byClass = (cls: SaleClass) => live.filter((invoice) => saleClass(invoice) === cls);
	const inIff = (number: string) => input.reportedInIff?.has(number) ?? false;
	const b2b = byClass('b2b').filter((invoice) => !inIff(invoice.number));
	for (const invoice of b2b)
		if (gstinProblem(invoice.buyer.gstin as string))
			problems.push({ table: '4A', problem: 'gstin_invalid', document: invoice.number });

	// Cancelled outright: never happened. Undone by a debit note: stands, and the debit note adds the money back.
	const outright = (note: CreditNote) => note.status === 'cancelled' && !note.debitNoteId;
	const kept = input.creditNotes.filter((note) => !outright(note));
	const notes: NoteRow[] = [
		...kept.map((note) => ({
			ntty: 'C' as const,
			number: note.number as string,
			date: note.date,
			doc: note,
			original: input.originals.get(note.invoiceId),
			sign: -1 as const,
			goods: note.kind !== 'price_adjustment',
		})),
		...input.debitNotes.map((note) => ({
			ntty: 'D' as const,
			number: note.number,
			date: note.date,
			doc: note,
			original: input.originals.get(note.invoiceId),
			sign: 1 as const,
			goods: note.lines.some((line) => line.outcome !== null),
		})),
	];
	for (const note of notes)
		if (!note.original) problems.push({ table: '9B', problem: 'note_invoice_missing', document: note.number });
	const noteClass = (note: NoteRow): SaleClass => (note.original ? saleClass(note.original) : saleClass(note.doc));
	const cdnr = notes.filter((n) => noteClass(n) === 'b2b' && !inIff(n.number));
	const cdnur = notes.filter((n) => noteClass(n) === 'b2cl' || noteClass(n) === 'exp');
	const notesIntoB2cs = notes.filter((n) => noteClass(n) === 'b2cs');

	// 7 B2CS: sales and the notes on them, by kind of supply, place of supply and rate.
	const b2csMap = new Map<string, RateItem & { interState: boolean; pos: string }>();
	const addB2cs = (doc: Document, sign: 1 | -1) => {
		for (const item of rateItems(doc)) {
			const key = `${doc.interState ? 'INTER' : 'INTRA'}|${doc.placeOfSupply}|${item.rate}`;
			const at = b2csMap.get(key) ?? {
				rate: item.rate,
				taxable: 0,
				igst: 0,
				cgst: 0,
				sgst: 0,
				interState: doc.interState,
				pos: doc.placeOfSupply,
			};
			at.taxable += sign * item.taxable;
			at.igst += sign * item.igst;
			at.cgst += sign * item.cgst;
			at.sgst += sign * item.sgst;
			b2csMap.set(key, at);
		}
	};
	byClass('b2cs').forEach((invoice) => addB2cs(invoice, 1));
	notesIntoB2cs.forEach((note) => addB2cs(note.doc, note.sign));
	const b2cs = [...b2csMap.values()].sort((a, b) => a.pos.localeCompare(b.pos) || a.rate - b.rate);

	// 12 HSN summary, registered and unregistered buyers apart.
	const hsnB2b = new Map<string, HsnRow>();
	const hsnB2c = new Map<string, HsnRow>();
	for (const invoice of live) addHsn(saleClass(invoice) === 'b2b' ? hsnB2b : hsnB2c, hsnLines(invoice, 1));
	for (const note of notes)
		addHsn(noteClass(note) === 'b2b' ? hsnB2b : hsnB2c, hsnLines(note.doc, note.sign, note.goods));
	const hsnRows = (map: Map<string, HsnRow>) =>
		[...map.values()].sort((a, b) => a.hsn.localeCompare(b.hsn) || a.rate - b.rate);
	for (const row of [...hsnRows(hsnB2b), ...hsnRows(hsnB2c)])
		if (row.hsn !== DELIVERY_SAC && row.hsn.replace(/\D/g, '').length < input.hsnDigits)
			problems.push({ table: '12', problem: 'hsn_digits', document: row.hsn });

	// 13 Documents issued: per kind and series, by the number's prefix.
	const series = (kind: number, numbers: readonly { number: string; cancelled: boolean }[]) => {
		const bySeries = new Map<string, { number: string; cancelled: boolean }[]>();
		for (const doc of numbers) {
			const prefix = doc.number.replace(/\d+$/, '');
			bySeries.set(prefix, [...(bySeries.get(prefix) ?? []), doc]);
		}
		return [...bySeries.values()].map((docs) => {
			const sorted = [...docs].sort((a, b) => a.number.localeCompare(b.number, 'en', { numeric: true }));
			const cancelled = docs.filter((d) => d.cancelled).length;
			return {
				kind,
				from: (sorted[0] as { number: string }).number,
				to: (sorted.at(-1) as { number: string }).number,
				total: docs.length,
				cancelled,
				net: docs.length - cancelled,
			};
		});
	};
	const documents = [
		...series(
			1,
			input.invoices.map((i) => ({ number: i.number, cancelled: i.status === 'cancelled' })),
		),
		...series(
			5,
			input.creditNotes.map((n) => ({ number: n.number as string, cancelled: outright(n) })),
		),
		...series(
			4,
			input.debitNotes.map((n) => ({ number: n.number, cancelled: false })),
		),
	];

	const docTotals = (docs: readonly Document[], sign: (i: number) => number = () => 1) =>
		docs.reduce(
			(sum, doc, i) => {
				for (const item of rateItems(doc)) {
					sum.taxable += sign(i) * item.taxable;
					sum.tax += sign(i) * (item.igst + item.cgst + item.sgst);
				}
				return sum;
			},
			{ taxable: 0, tax: 0 },
		);
	const noteDocs = [...cdnr, ...cdnur];
	const hsnAll = [...hsnRows(hsnB2b), ...hsnRows(hsnB2c)];
	const summary = [
		{ table: '4A' as const, records: b2b.length, ...docTotals(b2b) },
		{ table: '5' as const, records: byClass('b2cl').length, ...docTotals(byClass('b2cl')) },
		{ table: '6A' as const, records: byClass('exp').length, ...docTotals(byClass('exp')) },
		{
			table: '7' as const,
			records: b2cs.length,
			taxable: b2cs.reduce((s, r) => s + r.taxable, 0),
			tax: b2cs.reduce((s, r) => s + r.igst + r.cgst + r.sgst, 0),
		},
		{
			table: '9B' as const,
			records: noteDocs.length,
			...docTotals(
				noteDocs.map((n) => n.doc),
				(i) => (noteDocs[i] as NoteRow).sign,
			),
		},
		{
			table: '12' as const,
			records: hsnAll.length,
			taxable: hsnAll.reduce((s, r) => s + r.taxable, 0),
			tax: hsnAll.reduce((s, r) => s + r.igst + r.cgst + r.sgst, 0),
		},
		{ table: '13' as const, records: documents.length, taxable: 0, tax: 0 },
	];

	return {
		summary: summary.map((row) => ({ ...row, taxable: rupees(row.taxable), tax: rupees(row.tax) })),
		problems,
		portal: portalJson(input, {
			b2b,
			b2cl: byClass('b2cl'),
			exp: byClass('exp'),
			b2cs,
			cdnr,
			cdnur: cdnur.map((note) => ({ ...note, exported: noteClass(note) === 'exp' })),
			hsnB2b: hsnRows(hsnB2b),
			hsnB2c: hsnRows(hsnB2c),
			documents,
		}),
	};
}

/** `dd-mm-yyyy`, as the portal writes days. */
const portalDay = (day: string) => `${day.slice(8, 10)}-${day.slice(5, 7)}-${day.slice(0, 4)}`;
const itms = (doc: Document) =>
	rateItems(doc).map((item, index) => ({
		num: index + 1,
		itm_det: {
			txval: rupees(item.taxable),
			rt: item.rate,
			iamt: rupees(item.igst),
			camt: rupees(item.cgst),
			samt: rupees(item.sgst),
			csamt: 0,
		},
	}));

function portalJson(
	input: Gstr1Input,
	t: {
		b2b: readonly TaxInvoice[];
		b2cl: readonly TaxInvoice[];
		exp: readonly TaxInvoice[];
		b2cs: readonly (RateItem & { interState: boolean; pos: string })[];
		cdnr: readonly NoteRow[];
		cdnur: readonly (NoteRow & { exported: boolean })[];
		hsnB2b: readonly HsnRow[];
		hsnB2c: readonly HsnRow[];
		documents: readonly { kind: number; from: string; to: string; total: number; cancelled: number; net: number }[];
	},
) {
	const group = <T, K extends string>(rows: readonly T[], key: (row: T) => K) => {
		const out = new Map<K, T[]>();
		rows.forEach((row) => out.set(key(row), [...(out.get(key(row)) ?? []), row]));
		return [...out.entries()];
	};
	const hsn = (rows: readonly HsnRow[]) =>
		rows.map((row, index) => ({
			num: index + 1,
			hsn_sc: row.hsn,
			uqc: row.uqc,
			qty: row.qty,
			rt: row.rate,
			txval: rupees(row.taxable),
			iamt: rupees(row.igst),
			camt: rupees(row.cgst),
			samt: rupees(row.sgst),
			csamt: 0,
		}));
	const [year, month] = input.month.split('-');
	return {
		gstin: input.gstin,
		fp: `${month}${year}`,
		b2b: group(t.b2b, (i) => i.buyer.gstin as string).map(([ctin, invoices]) => ({
			ctin,
			inv: invoices.map((i) => ({
				inum: i.number,
				idt: portalDay(i.date),
				val: i.totalINR,
				pos: i.placeOfSupply,
				rchrg: 'N',
				inv_typ: 'R',
				itms: itms(i),
			})),
		})),
		b2cl: group(t.b2cl, (i) => i.placeOfSupply).map(([pos, invoices]) => ({
			pos,
			inv: invoices.map((i) => ({ inum: i.number, idt: portalDay(i.date), val: i.totalINR, itms: itms(i) })),
		})),
		exp: group(t.exp, exportType).map(([exp_typ, invoices]) => ({
			exp_typ,
			inv: invoices.map((i) => ({
				inum: i.number,
				idt: portalDay(i.date),
				val: i.totalINR,
				itms: rateItems(i).map((item) => ({
					txval: rupees(item.taxable),
					rt: item.rate,
					iamt: rupees(item.igst),
					csamt: 0,
				})),
			})),
		})),
		b2cs: t.b2cs.map((row) => ({
			sply_ty: row.interState ? 'INTER' : 'INTRA',
			pos: row.pos,
			typ: 'OE',
			txval: rupees(row.taxable),
			rt: row.rate,
			iamt: rupees(row.igst),
			camt: rupees(row.cgst),
			samt: rupees(row.sgst),
			csamt: 0,
		})),
		cdnr: group(t.cdnr, (n) => (n.original?.buyer.gstin ?? n.doc.buyer.gstin) as string).map(([ctin, notes]) => ({
			ctin,
			nt: notes.map((n) => ({
				ntty: n.ntty,
				nt_num: n.number,
				nt_dt: portalDay(n.date),
				val: n.doc.totalINR,
				pos: n.doc.placeOfSupply,
				rchrg: 'N',
				inv_typ: 'R',
				itms: itms(n.doc),
			})),
		})),
		cdnur: t.cdnur.map((n) => ({
			typ: n.exported ? (exportType(n.original ?? n.doc) === 'WPAY' ? 'EXPWP' : 'EXPWOP') : 'B2CL',
			ntty: n.ntty,
			nt_num: n.number,
			nt_dt: portalDay(n.date),
			val: n.doc.totalINR,
			pos: n.doc.placeOfSupply,
			itms: itms(n.doc),
		})),
		hsn: { hsn_b2b: hsn(t.hsnB2b), hsn_b2c: hsn(t.hsnB2c) },
		doc_issue: {
			doc_det: group(t.documents, (d) => String(d.kind)).map(([kind, docs]) => ({
				doc_num: Number(kind),
				docs: docs.map((d, index) => ({
					num: index + 1,
					from: d.from,
					to: d.to,
					totnum: d.total,
					cancel: d.cancelled,
					net_issue: d.net,
				})),
			})),
		},
	};
}
