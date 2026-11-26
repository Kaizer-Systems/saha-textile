import { normalizeBillNumber } from '../purchasing/purchase-rules';

import type { TaxHeads } from './gstr2b-rules';
import type { Gstr3bInput } from './gstr3b-rules';

/**
 * The other kinds of GST taxpayer (accounts brief G1, G2, G3, G7; owner 25 Nov "yes build it"). Pure; amounts are
 * paise, and the summaries and portal files give rupees.
 *
 * - QRMP (turnover up to ₹5 crore): GSTR-1 and GSTR-3B each quarter; in the quarter's first two months an optional
 *   IFF (B2B invoices and their notes, up to ₹50 lakh a month) and the PMT-06 payment, by fixed sum (35% of the last
 *   quarter's cash) or by the month's own tax (self-assessment). The quarter's GSTR-3B uses what PMT-06 deposited.
 * - Composition (s.10): bills of supply without tax; tax on turnover at the registration's rate, half CGST and half
 *   SGST, paid from the business's own pocket with CMP-08 each quarter (with any reverse-charge tax); GSTR-4 yearly.
 * - Input service distributor (s.20, rule 39 as from 1 April 2025): the credit on common input services in its
 *   GSTR-6A goes to the company's other GSTINs in the ratio of their turnover, IGST as IGST, CGST and SGST as the same
 *   heads in its own State and as IGST elsewhere, one ISD invoice per recipient, reported in GSTR-6.
 */

const HEADS = ['igst', 'cgst', 'sgst'] as const;
const zero = (): TaxHeads => ({ igst: 0, cgst: 0, sgst: 0 });
const total = (t: TaxHeads) => t.igst + t.cgst + t.sgst;
const rupees = (p: number): number => Math.round(p) / 100;
const paise = (inr: unknown): number => (typeof inr === 'number' && Number.isFinite(inr) ? Math.round(inr * 100) : 0);
const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/** The portal's period for a `YYYY-MM` month: `MMYYYY`. */
export const portalPeriod = (month: string): string => `${month.slice(5, 7)}${month.slice(0, 4)}`;

const addMonths = (month: string, n: number): string => {
	const [y, m] = month.split('-').map(Number) as [number, number];
	return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
};

/** Whether a month ends a GST quarter (June, September, December, March). */
export const isQuarterEnd = (month: string): boolean => ['03', '06', '09', '12'].includes(month.slice(5, 7));

/** The quarter a month falls in: its three months in order, and the last one, which names the quarter. */
export function quarterOf(month: string): { months: [string, string, string]; last: string } {
	const into = (Number(month.slice(5, 7)) - 1) % 3;
	const first = addMonths(month, -into);
	return { months: [first, addMonths(first, 1), addMonths(first, 2)], last: addMonths(first, 2) };
}

/** The quarter before a month's quarter, named by its last month. */
export const previousQuarterEnd = (month: string): string => addMonths(quarterOf(month).last, -3);

/* ------------------------------------------------------------------ QRMP: IFF and the quarter's GSTR-1 */

/** IFF's limit: B2B invoices and notes worth up to ₹50 lakh a month (rule 59(2)). */
export const IFF_LIMIT_PAISE = 50_00_000_00;

interface SummaryRow {
	table: string;
	records: number;
	taxable: number;
	tax: number;
}

/** A document's taxable value and tax from its portal items (rupees in, paise out). */
function itemsMoney(doc: unknown): { taxable: number; tax: number } {
	return list(isRecord(doc) ? doc['itms'] : null).reduce<{ taxable: number; tax: number }>(
		(sum, item) => {
			const detail = isRecord(item) && isRecord(item['itm_det']) ? item['itm_det'] : item;
			if (!isRecord(detail)) return sum;
			return {
				taxable: sum.taxable + paise(detail['txval']),
				tax: sum.tax + paise(detail['iamt']) + paise(detail['camt']) + paise(detail['samt']),
			};
		},
		{ taxable: 0, tax: 0 },
	);
}

/**
 * IFF for a month of a QRMP quarter, from that month's GSTR-1 worked out from the books: only the B2B invoices (4A)
 * and the notes to registered buyers (9B CDNR), with a problem when they pass ₹50 lakh (report them in the quarter's
 * GSTR-1 instead).
 */
export function iffReturn(month: { gstin: string; month: string; portal: Readonly<Record<string, unknown>> }): {
	summary: SummaryRow[];
	problems: { table: string; problem: string; document: string }[];
	portal: Record<string, unknown>;
} {
	const b2b = list(month.portal['b2b']);
	const cdnr = list(month.portal['cdnr']);
	const invoices = b2b.flatMap((party) => list(isRecord(party) ? party['inv'] : null));
	const notes = cdnr.flatMap((party) => list(isRecord(party) ? party['nt'] : null));
	const sign = (note: unknown) => (isRecord(note) && note['ntty'] === 'C' ? -1 : 1);
	const invoiceMoney = invoices.map(itemsMoney);
	const noteMoney = notes.map((note) => {
		const m = itemsMoney(note);
		return { taxable: sign(note) * m.taxable, tax: sign(note) * m.tax };
	});
	const sum = (rows: { taxable: number; tax: number }[]) =>
		rows.reduce((s, r) => ({ taxable: s.taxable + r.taxable, tax: s.tax + r.tax }), { taxable: 0, tax: 0 });
	const a = sum(invoiceMoney);
	const n = sum(noteMoney);
	const value = invoices.reduce<number>((s, doc) => s + paise(isRecord(doc) ? doc['val'] : null), 0);
	const problems = value > IFF_LIMIT_PAISE ? [{ table: '4A', problem: 'iff_over_limit', document: month.month }] : [];
	return {
		summary: [
			{ table: '4A', records: invoices.length, taxable: rupees(a.taxable), tax: rupees(a.tax) },
			{ table: '9B', records: notes.length, taxable: rupees(n.taxable), tax: rupees(n.tax) },
		],
		problems,
		portal: { gstin: month.gstin, fp: portalPeriod(month.month), b2b, cdnr },
	};
}

/** The invoice and note numbers an IFF already reported, which the quarter's GSTR-1 leaves out of 4A and 9B. */
export function reportedInIff(portal: Readonly<Record<string, unknown>>): Set<string> {
	const numbers = new Set<string>();
	for (const party of list(portal['b2b']))
		for (const doc of list(isRecord(party) ? party['inv'] : null))
			if (isRecord(doc) && text(doc['inum'])) numbers.add(text(doc['inum']));
	for (const party of list(portal['cdnr']))
		for (const doc of list(isRecord(party) ? party['nt'] : null))
			if (isRecord(doc) && text(doc['nt_num'])) numbers.add(text(doc['nt_num']));
	return numbers;
}

/* ------------------------------------------------------------------ QRMP: the quarter's GSTR-3B and PMT-06 */

/** What GSTR-3B takes from the books and 2B for one month (the API's `collect`). */
export type ThreeBBooks = Omit<Gstr3bInput, 'gstin' | 'month' | 'gstr1Portal' | 'adjustments'>;

const addHeads = (a: TaxHeads, b: TaxHeads): TaxHeads => ({
	igst: a.igst + b.igst,
	cgst: a.cgst + b.cgst,
	sgst: a.sgst + b.sgst,
});

/** The quarter's books for its GSTR-3B: its months' figures added; 2B counts as imported only when every month has one. */
export function quarterBooks(months: readonly ThreeBBooks[]): ThreeBBooks {
	return months.reduce<ThreeBBooks & { isdCredit: TaxHeads }>(
		(sum, m) => ({
			selfInvoices: [...sum.selfInvoices, ...m.selfInvoices],
			twoBImported: sum.twoBImported && m.twoBImported,
			itc2b: addHeads(sum.itc2b, m.itc2b),
			acceptedNotInBooks: sum.acceptedNotInBooks + m.acceptedNotInBooks,
			reversedInBooks: addHeads(sum.reversedInBooks, m.reversedInBooks),
			rule37: addHeads(sum.rule37, m.rule37),
			reclaimed: addHeads(sum.reclaimed, m.reclaimed),
			isdCredit: addHeads(sum.isdCredit, m.isdCredit ?? zero()),
		}),
		{
			selfInvoices: [],
			twoBImported: true,
			itc2b: zero(),
			acceptedNotInBooks: 0,
			reversedInBooks: zero(),
			rule37: zero(),
			reclaimed: zero(),
			isdCredit: zero(),
		},
	);
}

export type Pmt06Method = 'fixed_sum' | 'self_assessment';

/** A rupee up: PMT-06 deposits whole rupees, never short. */
const rupeeUp = (p: number) => Math.ceil(p / 100) * 100;

/**
 * PMT-06 for a QRMP month (rule 61A): by fixed sum, 35% of the cash paid with the last quarter's GSTR-3B (all of the
 * last month's when that quarter was filed monthly), never for a quarter with none; by self-assessment, the month's own
 * tax less the credit it has (its own GSTR-3B worked out, not filed), reverse-charge tax included. Each head apart.
 */
export function pmt06(input: {
	gstin: string;
	month: string;
	method: Pmt06Method;
	/** Fixed sum: the last quarter's cash by head, and whether it was filed monthly (then its last month's cash). */
	lastQuarter: { cash: TaxHeads; monthly: boolean } | null;
	/** Self-assessment: the month's GSTR-3B cash and reverse-charge tax. */
	month3b: { cash: TaxHeads; reverseCharge: TaxHeads } | null;
}): {
	summary: SummaryRow[];
	problems: { table: string; problem: string; document: string }[];
	deposit: TaxHeads;
	portal: Record<string, unknown>;
} {
	const problems: { table: string; problem: string; document: string }[] = [];
	let deposit = zero();
	if (input.method === 'fixed_sum') {
		if (!input.lastQuarter || !total(input.lastQuarter.cash))
			problems.push({ table: 'pmt06', problem: 'pmt06_no_last_quarter', document: input.month });
		else {
			const share = input.lastQuarter.monthly ? 1 : 0.35;
			const cash = input.lastQuarter.cash;
			deposit = {
				igst: rupeeUp(cash.igst * share),
				cgst: rupeeUp(cash.cgst * share),
				sgst: rupeeUp(cash.sgst * share),
			};
		}
	} else if (!input.month3b)
		problems.push({ table: 'pmt06', problem: 'pmt06_month_not_worked', document: input.month });
	else {
		const own = addHeads(input.month3b.cash, input.month3b.reverseCharge);
		deposit = { igst: rupeeUp(own.igst), cgst: rupeeUp(own.cgst), sgst: rupeeUp(own.sgst) };
	}
	return {
		summary: HEADS.map((head) => ({ table: `pmt06_${head}`, records: 0, taxable: 0, tax: rupees(deposit[head]) })),
		problems,
		deposit,
		portal: {
			gstin: input.gstin,
			ret_period: portalPeriod(input.month),
			reason: input.method === 'fixed_sum' ? 'FIXED_SUM' : 'SELF_ASSESSMENT',
			igst: { tax: rupees(deposit.igst) },
			cgst: { tax: rupees(deposit.cgst) },
			sgst: { tax: rupees(deposit.sgst) },
		},
	};
}

/* ------------------------------------------------------------------ Composition: CMP-08 and GSTR-4 */

/**
 * CMP-08 for a quarter: the tax on the quarter's turnover at the composition rate (1% for traders and manufacturers,
 * 5% restaurants, 6% services under s.10(2A)), half CGST and half SGST, plus the reverse-charge tax on what came in, all
 * paid in cash. Turnover is the bills of supply less their credit notes, in paise.
 */
export function cmp08(input: {
	gstin: string;
	quarterEnd: string;
	ratePercent: number;
	turnoverPaise: number;
	bills: number;
	reverseCharge: TaxHeads & { taxable: number; records: number };
}): {
	summary: SummaryRow[];
	problems: { table: string; problem: string; document: string }[];
	tax: TaxHeads;
	portal: Record<string, unknown>;
} {
	const half = Math.round((input.turnoverPaise * input.ratePercent) / 200);
	const outward: TaxHeads = { igst: 0, cgst: half, sgst: half };
	const rcm: TaxHeads = {
		igst: input.reverseCharge.igst,
		cgst: input.reverseCharge.cgst,
		sgst: input.reverseCharge.sgst,
	};
	const tax = addHeads(outward, rcm);
	const problems =
		input.turnoverPaise < 0
			? [{ table: 'cmp_outward', problem: 'cmp08_turnover_below_zero', document: input.quarterEnd }]
			: [];
	const heads = (t: TaxHeads) => ({ iamt: rupees(t.igst), camt: rupees(t.cgst), samt: rupees(t.sgst), csamt: 0 });
	return {
		summary: [
			{
				table: 'cmp_outward',
				records: input.bills,
				taxable: rupees(input.turnoverPaise),
				tax: rupees(total(outward)),
			},
			{
				table: 'cmp_rcm',
				records: input.reverseCharge.records,
				taxable: rupees(input.reverseCharge.taxable),
				tax: rupees(total(rcm)),
			},
			{ table: 'cmp_total', records: 0, taxable: 0, tax: rupees(total(tax)) },
		],
		problems,
		tax,
		portal: {
			gstin: input.gstin,
			ret_period: portalPeriod(input.quarterEnd),
			rate: input.ratePercent,
			outward_supplies: { txval: rupees(input.turnoverPaise), ...heads(outward) },
			inward_rcm: { txval: rupees(input.reverseCharge.taxable), ...heads(rcm) },
			tax_payable: heads(tax),
		},
	};
}

/** A purchase as GSTR-4 lists it: from a registered supplier or not, under reverse charge or not (paise). */
export interface CompositionPurchase extends TaxHeads {
	supplierGstin: string | null;
	taxable: number;
	reverseCharge: boolean;
}

/**
 * GSTR-4 for a composition year: inward supplies (4A registered, 4B registered under reverse charge, 4C unregistered
 * under reverse charge), the year's CMP-08s summed (5), and the turnover by rate (6). From the year's filed CMP-08
 * files and the books' purchases.
 */
export function gstr4(input: {
	gstin: string;
	year: string;
	cmp08s: readonly Readonly<Record<string, unknown>>[];
	purchases: readonly CompositionPurchase[];
}): {
	summary: SummaryRow[];
	problems: { table: string; problem: string; document: string }[];
	portal: Record<string, unknown>;
} {
	const pick = (rows: readonly CompositionPurchase[]) =>
		rows.reduce((s, r) => ({ records: s.records + 1, taxable: s.taxable + r.taxable, tax: s.tax + total(r) }), {
			records: 0,
			taxable: 0,
			tax: 0,
		});
	const a = pick(input.purchases.filter((p) => p.supplierGstin && !p.reverseCharge));
	const b = pick(input.purchases.filter((p) => p.supplierGstin && p.reverseCharge));
	const c = pick(input.purchases.filter((p) => !p.supplierGstin && p.reverseCharge));
	const part = (file: Readonly<Record<string, unknown>>, key: string) => (isRecord(file[key]) ? file[key] : {});
	const filed = input.cmp08s.reduce<{ taxable: number; tax: number; rate: number }>(
		(s, file) => {
			const out = part(file, 'outward_supplies');
			const due = part(file, 'tax_payable');
			return {
				taxable: s.taxable + paise(out['txval']),
				tax: s.tax + paise(due['camt']) + paise(due['samt']) + paise(due['iamt']),
				rate: typeof file['rate'] === 'number' ? file['rate'] : s.rate,
			};
		},
		{ taxable: 0, tax: 0, rate: 0 },
	);
	const outwardTax = input.cmp08s.reduce<number>((s, file) => {
		const out = part(file, 'outward_supplies');
		return s + paise(out['camt']) + paise(out['samt']);
	}, 0);
	const problems =
		input.cmp08s.length < 4
			? [{ table: '5', problem: 'gstr4_quarters_missing', document: String(4 - input.cmp08s.length) }]
			: [];
	return {
		summary: [
			{ table: 'gstr4_4a', records: a.records, taxable: rupees(a.taxable), tax: rupees(a.tax) },
			{ table: 'gstr4_4b', records: b.records, taxable: rupees(b.taxable), tax: rupees(b.tax) },
			{ table: 'gstr4_4c', records: c.records, taxable: rupees(c.taxable), tax: rupees(c.tax) },
			{ table: 'gstr4_5', records: input.cmp08s.length, taxable: rupees(filed.taxable), tax: rupees(filed.tax) },
			{ table: 'gstr4_6', records: 0, taxable: rupees(filed.taxable), tax: rupees(outwardTax) },
		],
		problems,
		portal: {
			gstin: input.gstin,
			fy: input.year,
			inward: {
				registered: { txval: rupees(a.taxable), tax: rupees(a.tax) },
				registered_rcm: { txval: rupees(b.taxable), tax: rupees(b.tax) },
				unregistered_rcm: { txval: rupees(c.taxable), tax: rupees(c.tax) },
			},
			cmp08_summary: { txval: rupees(filed.taxable), tax: rupees(filed.tax) },
			outward_by_rate: [{ rate: filed.rate, txval: rupees(filed.taxable), tax: rupees(outwardTax) }],
		},
	};
}

/* ------------------------------------------------------------------ Input service distributor: GSTR-6A, GSTR-6 */

/** A document in an ISD's GSTR-6A (paise). */
export interface Gstr6aLine extends TaxHeads {
	key: string;
	kind: 'invoice' | 'credit';
	supplierGstin: string;
	number: string;
	date: string;
	taxable: number;
}

/** `dd-mm-yyyy` → `yyyy-mm-dd`. */
const isoDay = (day: string): string => {
	const match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(day);
	return match ? `${match[3]}-${match[2]}-${match[1]}` : day;
};

/**
 * The portal's GSTR-6A file: its GSTIN, month and documents (b2b invoices; cdn credit notes, which lower the credit).
 * Refused with an Error naming what it can't read.
 */
export function parseGstr6a(file: Readonly<Record<string, unknown>>): {
	gstin: string;
	month: string;
	lines: Gstr6aLine[];
} {
	const gstin = text(file['gstin']);
	const fp = text(file['fp']);
	if (!/^[0-9A-Z]{15}$/.test(gstin) || !/^\d{6}$/.test(fp)) throw new Error('gstr6a_file_unreadable');
	const month = `${fp.slice(2)}-${fp.slice(0, 2)}`;
	const lines: Gstr6aLine[] = [];
	const read = (kind: Gstr6aLine['kind'], section: string, docs: string, numberKey: string, dayKey: string) => {
		for (const party of list(file[section])) {
			if (!isRecord(party)) throw new Error('gstr6a_line_unreadable');
			const supplierGstin = text(party['ctin']);
			for (const doc of list(party[docs])) {
				if (!isRecord(doc) || !text(doc[numberKey])) throw new Error('gstr6a_line_unreadable');
				const money = list(doc['itms']).reduce<TaxHeads & { taxable: number }>(
					(s, item) => {
						const d = isRecord(item) && isRecord(item['itm_det']) ? item['itm_det'] : {};
						return {
							taxable: s.taxable + paise(d['txval']),
							igst: s.igst + paise(d['iamt']),
							cgst: s.cgst + paise(d['camt']),
							sgst: s.sgst + paise(d['samt']),
						};
					},
					{ taxable: 0, igst: 0, cgst: 0, sgst: 0 },
				);
				const number = text(doc[numberKey]);
				lines.push({
					key: `${supplierGstin}|${number}`,
					kind,
					supplierGstin,
					number,
					date: isoDay(text(doc[dayKey])),
					...money,
				});
			}
		}
	};
	read('invoice', 'b2b', 'inv', 'inum', 'idt');
	read('credit', 'cdn', 'nt', 'nt_num', 'nt_dt');
	return { gstin, month, lines };
}

/** A GSTIN the ISD's credit can go to, with its turnover in the relevant period (paise). */
export interface IsdRecipient {
	registrationId: string;
	gstin: string;
	stateCode: string;
	turnoverPaise: number;
}

export interface IsdShare {
	registrationId: string;
	gstin: string;
	/** The share of the credit, % to two places. */
	ratioPercent: number;
	/** The ISD invoice's credit as the recipient takes it. */
	credit: TaxHeads;
	/** The ISD's own heads it comes out of. */
	from: TaxHeads;
	invoiceNumber: string;
}

/** Splits an amount in proportion to weights, the paise left over going to the largest share (exact totals). */
function shareOut(amount: number, weights: readonly number[]): number[] {
	const whole = weights.reduce((s, w) => s + w, 0);
	const parts = weights.map((w) => Math.floor((amount * w) / whole));
	const left = amount - parts.reduce((s, p) => s + p, 0);
	const largest = weights.indexOf(Math.max(...weights));
	parts[largest] = (parts[largest] as number) + left;
	return parts;
}

/**
 * Rule 39: the month's eligible credit (invoices less credit notes) shared among the recipients in the ratio of their
 * turnover; IGST stays IGST; CGST and SGST stay so for a recipient in the ISD's State and become IGST for one in
 * another State. One ISD invoice per recipient, numbered `ISD<yymm>-<n>`.
 */
export function isdDistribution(input: {
	isdGstin: string;
	isdState: string;
	month: string;
	lines: readonly Gstr6aLine[];
	recipients: readonly IsdRecipient[];
}): { credit: TaxHeads; shares: IsdShare[]; problems: { table: string; problem: string; document: string }[] } {
	const credit = input.lines.reduce<TaxHeads>((s, l) => {
		const sign = l.kind === 'credit' ? -1 : 1;
		return { igst: s.igst + sign * l.igst, cgst: s.cgst + sign * l.cgst, sgst: s.sgst + sign * l.sgst };
	}, zero());
	const problems: { table: string; problem: string; document: string }[] = [];
	const recipients = input.recipients.filter((r) => r.turnoverPaise > 0);
	if (!input.recipients.length) problems.push({ table: 'isd', problem: 'isd_no_recipients', document: input.month });
	else if (!recipients.length) problems.push({ table: 'isd', problem: 'isd_no_turnover', document: input.month });
	if (HEADS.some((head) => credit[head] < 0))
		problems.push({ table: 'isd', problem: 'isd_credit_below_zero', document: input.month });
	if (problems.length) return { credit, shares: [], problems };
	const weights = recipients.map((r) => r.turnoverPaise);
	const whole = weights.reduce((s, w) => s + w, 0);
	const igst = shareOut(credit.igst, weights);
	const cgst = shareOut(credit.cgst, weights);
	const sgst = shareOut(credit.sgst, weights);
	const yymm = `${input.month.slice(2, 4)}${input.month.slice(5, 7)}`;
	const shares = recipients.map((r, i) => {
		const from = { igst: igst[i] as number, cgst: cgst[i] as number, sgst: sgst[i] as number };
		const same = r.stateCode === input.isdState;
		return {
			registrationId: r.registrationId,
			gstin: r.gstin,
			ratioPercent: Math.round((r.turnoverPaise / whole) * 10_000) / 100,
			credit: same ? from : { igst: from.igst + from.cgst + from.sgst, cgst: 0, sgst: 0 },
			from,
			invoiceNumber: `ISD${yymm}-${i + 1}`,
		};
	});
	return { credit, shares, problems };
}

/** An expense bill billed to the ISD, as GSTR-6 compares it with GSTR-6A (paise). */
export interface IsdBookedBill extends TaxHeads {
	supplierGstin: string;
	billNumber: string;
}

/**
 * Brief 25 EB2: every invoice in GSTR-6A should be an expense bill booked to the ISD's locations, with the same tax
 * (within ₹1 a head), so the credit the ISD distributes is credit its books hold. Found by supplier GSTIN and bill
 * number; credit notes in 6A are not looked for.
 */
export function isdBooksProblems(
	lines: readonly Gstr6aLine[],
	bills: readonly IsdBookedBill[],
): { table: string; problem: string; document: string }[] {
	const key = (gstin: string, number: string) => `${gstin.toUpperCase()}|${normalizeBillNumber(number)}`;
	const booked = new Map(bills.map((bill) => [key(bill.supplierGstin, bill.billNumber), bill]));
	const problems: { table: string; problem: string; document: string }[] = [];
	for (const line of lines) {
		if (line.kind !== 'invoice') continue;
		const bill = booked.get(key(line.supplierGstin, line.number));
		const document = `${line.supplierGstin} ${line.number}`;
		if (!bill) problems.push({ table: 'isd', problem: 'isd_bill_not_in_books', document });
		else if ((['igst', 'cgst', 'sgst'] as const).some((head) => Math.abs(bill[head] - line[head]) > 100))
			problems.push({ table: 'isd', problem: 'isd_bill_tax_differs', document });
	}
	return problems;
}

/** GSTR-6 for the month: the credit received (table 3), its distribution (5) and the ISD invoices (8). */
export function gstr6(input: {
	isdGstin: string;
	month: string;
	day: string;
	lines: readonly Gstr6aLine[];
	distribution: ReturnType<typeof isdDistribution>;
}): {
	summary: SummaryRow[];
	problems: { table: string; problem: string; document: string }[];
	portal: Record<string, unknown>;
} {
	const { credit, shares } = input.distribution;
	const taxable = input.lines.reduce((s, l) => s + (l.kind === 'credit' ? -1 : 1) * l.taxable, 0);
	const heads = (t: TaxHeads) => ({ iamt: rupees(t.igst), camt: rupees(t.cgst), samt: rupees(t.sgst), csamt: 0 });
	const portalDay = (day: string) => `${day.slice(8, 10)}-${day.slice(5, 7)}-${day.slice(0, 4)}`;
	return {
		summary: [
			{ table: 'gstr6_3', records: input.lines.length, taxable: rupees(taxable), tax: rupees(total(credit)) },
			{
				table: 'gstr6_5',
				records: shares.length,
				taxable: 0,
				tax: rupees(shares.reduce((s, r) => s + total(r.credit), 0)),
			},
			{ table: 'gstr6_8', records: shares.length, taxable: 0, tax: 0 },
		],
		problems: input.distribution.problems,
		portal: {
			gstin: input.isdGstin,
			fp: portalPeriod(input.month),
			b2b: input.lines
				.filter((l) => l.kind === 'invoice')
				.map((l) => ({
					ctin: l.supplierGstin,
					inum: l.number,
					idt: portalDay(l.date),
					txval: rupees(l.taxable),
					...heads(l),
				})),
			cdn: input.lines
				.filter((l) => l.kind === 'credit')
				.map((l) => ({
					ctin: l.supplierGstin,
					nt_num: l.number,
					nt_dt: portalDay(l.date),
					txval: rupees(l.taxable),
					...heads(l),
				})),
			isd: shares.map((s) => ({
				rcpgstin: s.gstin,
				docs: [{ docnum: s.invoiceNumber, docdt: portalDay(input.day), ...heads(s.credit) }],
			})),
		},
	};
}

/**
 * The months a filed return covers, for its lock (G8): a quarter's three for a quarterly GSTR-1 or GSTR-3B (QRMP) and
 * for CMP-08; otherwise none beyond its own month (an empty list).
 */
export function coveredMonths(returnType: string, month: string, scheme: 'monthly' | 'qrmp' | null): string[] {
	const quarterly =
		returnType === 'CMP-08' || (scheme === 'qrmp' && (returnType === 'GSTR-1' || returnType === 'GSTR-3B'));
	return quarterly ? [...quarterOf(month).months] : [];
}

/** The monthly-cycle returns a GSTIN of this kind and scheme files (the calendar keeps the ones due each month). */
export function returnsFor(
	kind: 'regular' | 'composition' | 'isd' | 'casual',
	scheme: 'monthly' | 'qrmp',
): ('GSTR-1' | 'GSTR-3B' | 'IFF' | 'PMT-06' | 'CMP-08' | 'GSTR-6')[] {
	if (kind === 'composition') return ['CMP-08'];
	if (kind === 'isd') return ['GSTR-6'];
	return scheme === 'qrmp' ? ['IFF', 'PMT-06', 'GSTR-1', 'GSTR-3B'] : ['GSTR-1', 'GSTR-3B'];
}
