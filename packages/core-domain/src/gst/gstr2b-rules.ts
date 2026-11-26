import { normalizeBillNumber } from '../purchasing/purchase-rules';

/**
 * GSTR-2B against our purchases (accounts brief G5). Pure: the 2B file downloaded from the GST portal is read into
 * lines, each supplier invoice is matched to our posted purchase bill by the supplier's GSTIN and the bill number,
 * and the input credit GSTR-3B may claim is the credit of the lines accepted on the portal (IMS) that our books agree
 * with (rule 36(4): only what 2B shows, and never more than our bill). Amounts are paise.
 *
 * - Matched: same GSTIN and bill number, taxable value and each tax within ₹1.
 * - Different: same GSTIN and bill number, amounts apart; credit is the lower of the two per tax.
 * - Only in 2B: the supplier reported a bill we have not entered; enter it, then accept.
 * - Only in our books: posted with credit, not yet in any 2B; the credit is held until the supplier files.
 * - A credit or debit note from a supplier changes credit by its own amount.
 */

/** Taxes in paise. */
export interface TaxHeads {
	igst: number;
	cgst: number;
	sgst: number;
}

export type Gstr2bKind = 'invoice' | 'credit' | 'debit';

/** A supplier's document as GSTR-2B shows it. */
export interface Gstr2bLine {
	/** `<supplier GSTIN>|<kind>|<normalized number>`: one per document. */
	key: string;
	kind: Gstr2bKind;
	supplierGstin: string;
	supplierName: string;
	number: string;
	/** `YYYY-MM-DD`. */
	date: string;
	/** The supplier's GSTR-1 period, `YYYY-MM`, and the day they filed it. */
	supplierPeriod: string | null;
	filedOn: string | null;
	taxable: number;
	igst: number;
	cgst: number;
	sgst: number;
	reverseCharge: boolean;
	/** 2B's own "ITC available" flag; a line marked not available is never claimed. */
	itcAvailable: boolean;
	reason: string | null;
}

export interface Gstr2bFile {
	gstin: string;
	/** `YYYY-MM`. */
	month: string;
	generatedOn: string | null;
	lines: Gstr2bLine[];
	/** Sections read but not matched here (amendments, ISD, imports), with how many documents each held. */
	notRead: { section: string; count: number }[];
}

/** One of our posted purchase bills that claims credit. */
export interface BooksBill {
	entryId: string;
	entryNumber: string;
	supplierGstin: string;
	supplierName: string;
	billNumber: string;
	billDate: string;
	taxable: number;
	igst: number;
	cgst: number;
	sgst: number;
}

export type Gstr2bResult = 'matched' | 'different' | 'only_2b' | 'only_books' | 'note';
/** What was done on the portal's Invoice Management System, or `held` for a bill the supplier has not reported. */
export type ImsAction = 'accept' | 'reject' | 'pending' | 'held';

export interface Gstr2bRow {
	key: string;
	result: Gstr2bResult;
	kind: Gstr2bKind;
	supplierGstin: string;
	supplierName: string;
	number: string;
	date: string;
	reverseCharge: boolean;
	itcAvailable: boolean;
	books: (TaxHeads & { taxable: number }) | null;
	twoB: (TaxHeads & { taxable: number }) | null;
	entryId: string | null;
	entryNumber: string | null;
	action: ImsAction;
}

const SECTIONS_NOT_READ = ['b2ba', 'cdnra', 'isd', 'isda', 'impg', 'impgsez', 'ecom', 'ecoma'] as const;
const TOLERANCE_PAISE = 100;

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);
const list = (value: unknown): Record<string, unknown>[] => (Array.isArray(value) ? value.filter(isRecord) : []);
const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const money = (value: unknown): number =>
	typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 100) : 0;
/** `dd-mm-yyyy` → `yyyy-mm-dd`; anything else is unreadable. */
const isoDay = (value: unknown): string | null => {
	const match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(text(value));
	return match ? `${match[3]}-${match[2]}-${match[1]}` : null;
};
/** `MMYYYY` → `YYYY-MM`. */
const isoMonth = (value: unknown): string | null => {
	const match = /^(0[1-9]|1[0-2])(\d{4})$/.exec(text(value));
	return match ? `${match[2]}-${match[1]}` : null;
};

/** A document's money: its own totals, or the sum of its items when the totals are left out. */
function amounts(doc: Record<string, unknown>): { taxable: number } & TaxHeads {
	const items = list(doc['items']);
	const sum = (field: string) => items.reduce((total, item) => total + money(item[field]), 0);
	const pick = (field: string) => (field in doc ? money(doc[field]) : sum(field));
	return { taxable: pick('txval'), igst: pick('igst'), cgst: pick('cgst'), sgst: pick('sgst') };
}

/** The document's line, or null when its number or day can't be read. */
function lineOf(
	supplier: Record<string, unknown>,
	doc: Record<string, unknown>,
	kind: Gstr2bKind,
	number: string,
): Gstr2bLine | null {
	const date = isoDay(doc['dt']);
	const supplierGstin = text(supplier['ctin']).toUpperCase();
	if (!number || !date || !supplierGstin) return null;
	return {
		key: `${supplierGstin}|${kind}|${normalizeBillNumber(number)}`,
		kind,
		supplierGstin,
		supplierName: text(supplier['trdnm']),
		number,
		date,
		supplierPeriod: isoMonth(supplier['supprd']),
		filedOn: isoDay(supplier['supfildt']),
		...amounts(doc),
		reverseCharge: text(doc['rev']).toUpperCase() === 'Y',
		itcAvailable: text(doc['itcavl']).toUpperCase() !== 'N',
		reason: text(doc['rsn']) || null,
	};
}

/**
 * The 2B file as the portal gives it (with or without its `data` wrapper) for one GSTIN and month. Refused with
 * `gstr2b_file_unreadable` when it isn't a 2B file, and with `gstr2b_line_unreadable` when a document has no number
 * or day.
 */
export function parseGstr2b(file: unknown): Gstr2bFile {
	const root = isRecord(file) && isRecord(file['data']) ? file['data'] : file;
	if (!isRecord(root)) throw new Error('gstr2b_file_unreadable');
	const gstin = text(root['gstin']).toUpperCase();
	const month = isoMonth(root['rtnprd']);
	const docs = root['docdata'];
	if (!gstin || !month || !isRecord(docs)) throw new Error('gstr2b_file_unreadable');
	const lines: Gstr2bLine[] = [];
	const add = (line: Gstr2bLine | null) => {
		if (!line) throw new Error('gstr2b_line_unreadable');
		lines.push(line);
	};
	for (const supplier of list(docs['b2b']))
		for (const invoice of list(supplier['inv'])) add(lineOf(supplier, invoice, 'invoice', text(invoice['inum'])));
	for (const supplier of list(docs['cdnr']))
		for (const note of list(supplier['nt']))
			add(
				lineOf(
					supplier,
					note,
					text(note['typ']).toUpperCase() === 'D' ? 'debit' : 'credit',
					text(note['ntnum']),
				),
			);
	const notRead = SECTIONS_NOT_READ.map((section) => ({
		section,
		count: list(docs[section]).reduce(
			(total, supplier) =>
				total +
				Math.max(1, list(supplier['inv']).length + list(supplier['nt']).length + list(supplier['boe']).length),
			0,
		),
	})).filter((s) => s.count > 0);
	return { gstin, month, generatedOn: isoDay(root['gendt']), lines, notRead };
}

const within = (a: TaxHeads & { taxable: number }, b: TaxHeads & { taxable: number }) =>
	(['taxable', 'igst', 'cgst', 'sgst'] as const).every((field) => Math.abs(a[field] - b[field]) <= TOLERANCE_PAISE);

/** The action a row starts with before anyone records what was done on the portal. */
export function defaultAction(result: Gstr2bResult, itcAvailable: boolean): ImsAction {
	if (result === 'only_books') return 'held';
	if (!itcAvailable) return 'reject';
	return result === 'matched' || result === 'note' ? 'accept' : 'pending';
}

/**
 * 2B's lines against our bills. Each 2B invoice finds the bill with the same supplier GSTIN and normalized number;
 * bills left over are only in our books. Recorded actions (`decisions`, by row key) replace the defaults; a bill only in
 * our books stays held whatever was recorded.
 */
export function reconcile2b(
	lines: readonly Gstr2bLine[],
	bills: readonly BooksBill[],
	decisions: Readonly<Record<string, ImsAction>> = {},
): Gstr2bRow[] {
	const byKey = new Map(
		bills.map((bill) => [
			`${bill.supplierGstin.toUpperCase()}|invoice|${normalizeBillNumber(bill.billNumber)}`,
			bill,
		]),
	);
	const used = new Set<string>();
	const rows: Gstr2bRow[] = lines.map((line) => {
		const bill = line.kind === 'invoice' ? byKey.get(line.key) : undefined;
		if (bill) used.add(bill.entryId);
		const twoB = { taxable: line.taxable, igst: line.igst, cgst: line.cgst, sgst: line.sgst };
		const books = bill ? { taxable: bill.taxable, igst: bill.igst, cgst: bill.cgst, sgst: bill.sgst } : null;
		const result: Gstr2bResult =
			line.kind !== 'invoice' ? 'note' : !books ? 'only_2b' : within(books, twoB) ? 'matched' : 'different';
		const recorded = decisions[line.key];
		return {
			key: line.key,
			result,
			kind: line.kind,
			supplierGstin: line.supplierGstin,
			supplierName: line.supplierName || bill?.supplierName || '',
			number: line.number,
			date: line.date,
			reverseCharge: line.reverseCharge,
			itcAvailable: line.itcAvailable,
			books,
			twoB,
			entryId: bill?.entryId ?? null,
			entryNumber: bill?.entryNumber ?? null,
			action: recorded && recorded !== 'held' ? recorded : defaultAction(result, line.itcAvailable),
		};
	});
	for (const bill of bills.filter((b) => !used.has(b.entryId)))
		rows.push({
			key: `books|${bill.entryId}`,
			result: 'only_books',
			kind: 'invoice',
			supplierGstin: bill.supplierGstin,
			supplierName: bill.supplierName,
			number: bill.billNumber,
			date: bill.billDate,
			reverseCharge: false,
			itcAvailable: true,
			books: { taxable: bill.taxable, igst: bill.igst, cgst: bill.cgst, sgst: bill.sgst },
			twoB: null,
			entryId: bill.entryId,
			entryNumber: bill.entryNumber,
			action: 'held',
		});
	return rows;
}

/**
 * The credit GSTR-3B table 4A(5) may claim from 2B: accepted rows only, never on reverse charge (claimed through the
 * self-invoice) or a line 2B marks not available. A matched or different bill claims the lower of 2B and our bill per
 * tax; a supplier's credit note takes its credit back, a debit note adds to it. A bill only in 2B claims nothing until it
 * is entered.
 */
export function claimFrom2b(rows: readonly Gstr2bRow[]): TaxHeads {
	const claim: TaxHeads = { igst: 0, cgst: 0, sgst: 0 };
	for (const row of rows) {
		if (row.action !== 'accept' || row.reverseCharge || !row.itcAvailable || !row.twoB) continue;
		for (const head of ['igst', 'cgst', 'sgst'] as const) {
			if (row.result === 'note') claim[head] += row.kind === 'credit' ? -row.twoB[head] : row.twoB[head];
			else if (row.books) claim[head] += Math.min(row.books[head], row.twoB[head]);
		}
	}
	return claim;
}

/**
 * s.16(4): credit on a bill of a financial year can be claimed up to 30 November after that year ends. The last
 * month whose return may still claim a bill dated `billDate` (`YYYY-MM`); bills past it are no longer looked for in 2B.
 */
export function lastClaimMonth(billDate: string): string {
	const year = Number(billDate.slice(0, 4));
	const month = Number(billDate.slice(5, 7));
	const fyEnds = month >= 4 ? year + 1 : year;
	return `${fyEnds}-11`;
}

/** Each result's count, for the page's chips. */
export function countResults(rows: readonly Gstr2bRow[]): Record<Gstr2bResult | 'all', number> {
	const counts = { all: rows.length, matched: 0, different: 0, only_2b: 0, only_books: 0, note: 0 };
	for (const row of rows) counts[row.result] += 1;
	return counts;
}
