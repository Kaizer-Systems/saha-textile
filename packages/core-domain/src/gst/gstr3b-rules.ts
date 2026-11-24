import type { TaxHeads } from './gstr2b-rules';

/**
 * GSTR-3B (accounts brief G6, Q7). Pure: the month's outward supplies come from the filed GSTR-1 (the portal locks
 * them since July 2025; corrections go through GSTR-1A), reverse-charge tax from our self-invoices, input credit from
 * the lines of GSTR-2B accepted on the portal, credit taken back from the books (goods lost or written off, s.17(5)(h);
 * bills unpaid for 180 days, rule 37), then the set-off of s.49 and rule 88A and the cash to pay. Amounts are paise;
 * the summary and the portal file give rupees.
 */

const HEADS = ['igst', 'cgst', 'sgst'] as const;
const zero = (): TaxHeads => ({ igst: 0, cgst: 0, sgst: 0 });
const rupees = (p: number): number => Math.round(p) / 100;
const paise = (inr: unknown): number => (typeof inr === 'number' && Number.isFinite(inr) ? Math.round(inr * 100) : 0);
const add = (a: TaxHeads, b: TaxHeads, sign = 1): TaxHeads => ({
	igst: a.igst + sign * b.igst,
	cgst: a.cgst + sign * b.cgst,
	sgst: a.sgst + sign * b.sgst,
});
const total = (t: TaxHeads) => t.igst + t.cgst + t.sgst;

/** Each credit's use in the set-off, and what is left to pay in cash and to carry forward. */
export interface SetOff {
	liability: TaxHeads;
	credit: TaxHeads;
	/** IGST credit used against IGST, then CGST and SGST. */
	igstUsed: TaxHeads;
	/** CGST credit used against CGST, then IGST; never against SGST. */
	cgstUsed: { cgst: number; igst: number };
	/** SGST credit used against SGST, then IGST; never against CGST. */
	sgstUsed: { sgst: number; igst: number };
	cash: TaxHeads;
	carried: TaxHeads;
}

/**
 * s.49(5) and rule 88A: IGST credit first against IGST, and then, because CGST and SGST credit may only be used once
 * the IGST credit is used up (s.49A), against CGST and SGST, first where their own credit falls short; CGST credit
 * then pays CGST and then IGST, SGST credit pays SGST and then IGST. CGST credit never pays SGST, nor SGST credit CGST.
 */
export function setOff(liability: TaxHeads, credit: TaxHeads): SetOff {
	const owe = { ...liability };
	const have = { ...credit };
	const use = (from: keyof TaxHeads, against: keyof TaxHeads, cap = Infinity): number => {
		const amount = Math.max(0, Math.min(have[from], owe[against], cap));
		have[from] -= amount;
		owe[against] -= amount;
		return amount;
	};
	const igstUsed = zero();
	igstUsed.igst = use('igst', 'igst');
	igstUsed.cgst = use('igst', 'cgst', Math.max(0, owe.cgst - have.cgst));
	igstUsed.sgst = use('igst', 'sgst', Math.max(0, owe.sgst - have.sgst));
	igstUsed.cgst += use('igst', 'cgst');
	igstUsed.sgst += use('igst', 'sgst');
	const cgstUsed = { cgst: use('cgst', 'cgst'), igst: use('cgst', 'igst') };
	const sgstUsed = { sgst: use('sgst', 'sgst'), igst: use('sgst', 'igst') };
	return { liability, credit, igstUsed, cgstUsed, sgstUsed, cash: owe, carried: have };
}

/** Table 3.1 and 3.2 from a filed GSTR-1's portal file. */
export interface Outward {
	/** 3.1(a): taxable supplies, notes netted in. */
	taxable: TaxHeads & { taxable: number; records: number };
	/** 3.1(b): exports (zero rated), notes on them netted in. */
	zeroRated: { taxable: number; igst: number; records: number };
	/** 3.2: inter-State supplies to unregistered buyers, by place of supply. */
	unregisteredInterState: { pos: string; taxable: number; igst: number }[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);
const list = (value: unknown): Record<string, unknown>[] => (Array.isArray(value) ? value.filter(isRecord) : []);
const details = (doc: Record<string, unknown>) =>
	list(doc['itms']).map((item) => (isRecord(item['itm_det']) ? item['itm_det'] : item));

/** What a filed GSTR-1 says was supplied, as 3B's tables 3.1(a), 3.1(b) and 3.2 take it. */
export function outwardFromGstr1(portal: Readonly<Record<string, unknown>>): Outward {
	const taxable = { taxable: 0, ...zero(), records: 0 };
	const zeroRated = { taxable: 0, igst: 0, records: 0 };
	const unreg = new Map<string, { taxable: number; igst: number }>();
	const toUnreg = (pos: unknown, txval: number, igst: number) => {
		const key = typeof pos === 'string' ? pos : '';
		const row = unreg.get(key) ?? { taxable: 0, igst: 0 };
		unreg.set(key, { taxable: row.taxable + txval, igst: row.igst + igst });
	};
	const intoTaxable = (doc: Record<string, unknown>, sign: number, pos?: unknown) => {
		taxable.records += 1;
		for (const item of details(doc)) {
			taxable.taxable += sign * paise(item['txval']);
			taxable.igst += sign * paise(item['iamt']);
			taxable.cgst += sign * paise(item['camt']);
			taxable.sgst += sign * paise(item['samt']);
			if (pos !== undefined) toUnreg(pos, sign * paise(item['txval']), sign * paise(item['iamt']));
		}
	};
	const intoZero = (doc: Record<string, unknown>, sign: number) => {
		zeroRated.records += 1;
		for (const item of details(doc)) {
			zeroRated.taxable += sign * paise(item['txval']);
			zeroRated.igst += sign * paise(item['iamt']);
		}
	};
	for (const party of list(portal['b2b'])) for (const doc of list(party['inv'])) intoTaxable(doc, 1);
	for (const group of list(portal['b2cl'])) for (const doc of list(group['inv'])) intoTaxable(doc, 1, group['pos']);
	for (const row of list(portal['b2cs'])) {
		taxable.records += 1;
		taxable.taxable += paise(row['txval']);
		taxable.igst += paise(row['iamt']);
		taxable.cgst += paise(row['camt']);
		taxable.sgst += paise(row['samt']);
		if (row['sply_ty'] === 'INTER') toUnreg(row['pos'], paise(row['txval']), paise(row['iamt']));
	}
	for (const group of list(portal['exp'])) for (const doc of list(group['inv'])) intoZero(doc, 1);
	for (const party of list(portal['cdnr']))
		for (const note of list(party['nt'])) intoTaxable(note, note['ntty'] === 'D' ? 1 : -1);
	for (const note of list(portal['cdnur'])) {
		const sign = note['ntty'] === 'D' ? 1 : -1;
		if (note['typ'] === 'EXPWOP' || note['typ'] === 'EXPWP') intoZero(note, sign);
		else intoTaxable(note, sign, note['pos']);
	}
	return {
		taxable,
		zeroRated,
		unregisteredInterState: [...unreg.entries()]
			.filter(([, row]) => row.taxable !== 0 || row.igst !== 0)
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([pos, row]) => ({ pos, ...row })),
	};
}

/** A change the accountant makes to a 3B table, with the reason it is kept with. */
export interface Gstr3bAdjustment extends TaxHeads {
	table: '3.1d' | '4A' | '4B';
	reason: string;
}

export interface Gstr3bInput {
	gstin: string;
	month: string;
	/** The month's GSTR-1 as filed. */
	gstr1Portal: Readonly<Record<string, unknown>>;
	/** Self-invoices issued in the month (reverse charge, 3.1(d) and 4A(3)). */
	selfInvoices: readonly (TaxHeads & { taxable: number })[];
	/** Whether a GSTR-2B has been imported for the month. */
	twoBImported: boolean;
	/** Credit from 2B's accepted lines (4A(5)). */
	itc2b: TaxHeads;
	/** How many lines are accepted on the portal but not yet entered in our books. */
	acceptedNotInBooks: number;
	/** Credit taken back in the books this month: goods lost, stolen or written off (s.17(5)(h), 4B(1)). */
	reversedInBooks: TaxHeads;
	/** Bills unpaid 180 days after their date (rule 37, 4B(2)), and credit claimed back on paying them (4D(1)). */
	rule37: TaxHeads;
	reclaimed: TaxHeads;
	adjustments: readonly Gstr3bAdjustment[];
}

export type Gstr3bTable = '3.1a' | '3.1b' | '3.1d' | '4A' | '4B' | '4C' | '6';

export interface Gstr3bResult {
	summary: { table: Gstr3bTable; records: number; taxable: number; tax: number }[];
	problems: { table: Gstr3bTable; problem: string; document: string }[];
	/** In paise: the set-off and the cash to pay, reverse charge apart (always paid in cash). */
	setOff: SetOff;
	reverseChargeCash: TaxHeads;
	portal: Record<string, unknown>;
}

const adjusted = (adjustments: readonly Gstr3bAdjustment[], table: Gstr3bAdjustment['table']) =>
	adjustments.filter((a) => a.table === table).reduce((sum, a) => add(sum, a), zero());
const amt = (t: TaxHeads) => ({ iamt: rupees(t.igst), camt: rupees(t.cgst), samt: rupees(t.sgst), csamt: 0 });

/** GSTR-3B for a GSTIN and month: its tables, what stops approval, the set-off and the file for the portal. */
export function gstr3b(input: Gstr3bInput): Gstr3bResult {
	const outward = outwardFromGstr1(input.gstr1Portal);
	const rcmTaxable = input.selfInvoices.reduce((sum, s) => sum + s.taxable, 0);
	const rcm = add(
		input.selfInvoices.reduce((sum, s) => add(sum, s), zero()),
		adjusted(input.adjustments, '3.1d'),
	);
	const adjusted4A = adjusted(input.adjustments, '4A');
	const itcOther = add(add(input.itc2b, input.reclaimed), adjusted4A);
	const available = add(itcOther, rcm);
	const reversedRules = add(input.reversedInBooks, adjusted(input.adjustments, '4B'));
	const reversed = add(reversedRules, input.rule37);
	const net = add(available, reversed, -1);

	const outputTax: TaxHeads = {
		igst: outward.taxable.igst + outward.zeroRated.igst,
		cgst: outward.taxable.cgst,
		sgst: outward.taxable.sgst,
	};
	// Credit that went below nothing (more taken back than claimed) is paid like tax.
	const liability = add(outputTax, {
		igst: Math.max(0, -net.igst),
		cgst: Math.max(0, -net.cgst),
		sgst: Math.max(0, -net.sgst),
	});
	const credit = { igst: Math.max(0, net.igst), cgst: Math.max(0, net.cgst), sgst: Math.max(0, net.sgst) };
	const result = setOff(liability, credit);

	const problems: Gstr3bResult['problems'] = [];
	if (!input.twoBImported) problems.push({ table: '4A', problem: 'gstr2b_missing', document: input.month });
	if (input.acceptedNotInBooks > 0)
		problems.push({ table: '4A', problem: 'accepted_not_in_books', document: String(input.acceptedNotInBooks) });
	if (HEADS.some((head) => adjusted4A[head] > 0))
		problems.push({ table: '4A', problem: 'credit_over_2b', document: '' });
	for (const a of input.adjustments)
		if (!a.reason.trim()) problems.push({ table: a.table, problem: 'adjustment_reason', document: '' });

	const summary: Gstr3bResult['summary'] = [
		{
			table: '3.1a',
			records: outward.taxable.records,
			taxable: rupees(outward.taxable.taxable),
			tax: rupees(total(outward.taxable)),
		},
		{
			table: '3.1b',
			records: outward.zeroRated.records,
			taxable: rupees(outward.zeroRated.taxable),
			tax: rupees(outward.zeroRated.igst),
		},
		{ table: '3.1d', records: input.selfInvoices.length, taxable: rupees(rcmTaxable), tax: rupees(total(rcm)) },
		{ table: '4A', records: 0, taxable: 0, tax: rupees(total(available)) },
		{ table: '4B', records: 0, taxable: 0, tax: rupees(total(reversed)) },
		{ table: '4C', records: 0, taxable: 0, tax: rupees(total(net)) },
		{ table: '6', records: 0, taxable: 0, tax: rupees(total(result.cash) + total(rcm)) },
	];

	const [year, month] = input.month.split('-');
	const portal = {
		gstin: input.gstin,
		ret_period: `${month}${year}`,
		sup_details: {
			osup_det: { txval: rupees(outward.taxable.taxable), ...amt(outward.taxable) },
			osup_zero: { txval: rupees(outward.zeroRated.taxable), iamt: rupees(outward.zeroRated.igst), csamt: 0 },
			osup_nil_exmp: { txval: 0 },
			isup_rev: { txval: rupees(rcmTaxable), ...amt(rcm) },
			osup_nongst: { txval: 0 },
		},
		inter_sup: {
			unreg_details: outward.unregisteredInterState.map((row) => ({
				pos: row.pos,
				txval: rupees(row.taxable),
				iamt: rupees(row.igst),
			})),
			comp_details: [],
			uin_details: [],
		},
		itc_elg: {
			itc_avl: [
				{ ty: 'IMPG', ...amt(zero()) },
				{ ty: 'IMPS', ...amt(zero()) },
				{ ty: 'ISRC', ...amt(rcm) },
				{ ty: 'ISD', ...amt(zero()) },
				{ ty: 'OTH', ...amt(itcOther) },
			],
			itc_rev: [
				{ ty: 'RUL', ...amt(reversedRules) },
				{ ty: 'OTH', ...amt(input.rule37) },
			],
			itc_net: amt(net),
			itc_inelg: [
				{ ty: 'RUL', ...amt(zero()) },
				{ ty: 'OTH', ...amt(zero()) },
			],
		},
		inward_sup: {
			isup_details: [
				{ ty: 'GST', inter: 0, intra: 0 },
				{ ty: 'NONGST', inter: 0, intra: 0 },
			],
		},
		intr_ltfee: { intr_details: amt(zero()) },
	};
	return { summary, problems, setOff: result, reverseChargeCash: rcm, portal };
}

/**
 * The postings that take input credit back in the books, and their undoing: goods lost, stolen, destroyed or written
 * off (s.17(5)(h)), from stock adjustments and written-off returned pieces.
 */
export const ITC_REVERSAL_SOURCES: readonly string[] = [
	'stockAdjustment',
	'creditNoteInputTax',
	'creditNoteInputTaxCancel',
	'debitNoteInputTax',
];

interface VoucherLike {
	source?: { type: string } | null;
	lines: readonly { ledgerId: string; locationId: string; debitPaise: number; creditPaise: number }[];
}

/** 4B(1) from the books: input tax credited (less restored) by reversal postings at a GSTIN's locations. */
export function reversedInBooks(
	vouchers: readonly VoucherLike[],
	inputLedgers: Readonly<Record<keyof TaxHeads, string>>,
	locationIds: ReadonlySet<string>,
): TaxHeads {
	const reversed = zero();
	for (const voucher of vouchers) {
		if (!voucher.source || !ITC_REVERSAL_SOURCES.includes(voucher.source.type)) continue;
		for (const line of voucher.lines) {
			if (!locationIds.has(line.locationId)) continue;
			for (const head of HEADS)
				if (line.ledgerId === inputLedgers[head]) reversed[head] += line.creditPaise - line.debitPaise;
		}
	}
	return reversed;
}

/** A posted purchase bill as rule 37 looks at it (paise). */
export interface Rule37Bill {
	entryId: string;
	billDate: string;
	totalPaise: number;
	/** Debit notes against it, which lower what is owed. */
	creditedPaise: number;
	tax: TaxHeads;
	payments: readonly { paidOn: string; paise: number }[];
}

/** The day 180 days after the bill's date: credit on what is still unpaid then is taken back in that month's return. */
export function day180(billDate: string): string {
	const at = new Date(`${billDate}T00:00:00Z`);
	at.setUTCDate(at.getUTCDate() + 180);
	return at.toISOString().slice(0, 10);
}

const share = (tax: TaxHeads, part: number, whole: number): TaxHeads =>
	whole > 0
		? {
				igst: Math.round((tax.igst * part) / whole),
				cgst: Math.round((tax.cgst * part) / whole),
				sgst: Math.round((tax.sgst * part) / whole),
			}
		: zero();

/**
 * Rule 37: a bill not paid in full within 180 days of its date has the credit on the unpaid part taken back in the
 * return for the month the 180 days end (4B(2)); paying it later brings that credit back in the month paid (4A(5),
 * shown in 4D(1)).
 */
export function rule37(
	bills: readonly Rule37Bill[],
	month: string,
): { reversed: TaxHeads; reclaimed: TaxHeads; entries: { entryId: string; reversed: number; reclaimed: number }[] } {
	const first = `${month}-01`;
	const [y, m] = month.split('-').map(Number) as [number, number];
	const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
	let reversed = zero();
	let reclaimed = zero();
	const entries: { entryId: string; reversed: number; reclaimed: number }[] = [];
	for (const bill of bills) {
		const due = day180(bill.billDate);
		if (due > last) continue;
		const paidBy = (day: string, after = '') =>
			bill.payments.filter((p) => p.paidOn <= day && p.paidOn > after).reduce((sum, p) => sum + p.paise, 0);
		const owedAtDue = Math.max(0, bill.totalPaise - bill.creditedPaise - paidBy(due));
		if (!owedAtDue) continue;
		if (due >= first) {
			const taken = share(bill.tax, owedAtDue, bill.totalPaise);
			reversed = add(reversed, taken);
			entries.push({ entryId: bill.entryId, reversed: total(taken), reclaimed: 0 });
			continue;
		}
		const before = new Date(`${first}T00:00:00Z`);
		before.setUTCDate(before.getUTCDate() - 1);
		const paidSinceDue = paidBy(before.toISOString().slice(0, 10), due);
		const paidNow = paidBy(last, before.toISOString().slice(0, 10));
		const back = Math.max(0, Math.min(paidNow, owedAtDue - paidSinceDue));
		if (!back) continue;
		const returned = share(bill.tax, back, bill.totalPaise);
		reclaimed = add(reclaimed, returned);
		entries.push({ entryId: bill.entryId, reversed: 0, reclaimed: total(returned) });
	}
	return { reversed, reclaimed, entries };
}
