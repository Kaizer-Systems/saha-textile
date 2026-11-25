/**
 * GSTR-9 against the books (accounts brief G9) and the monthly books-to-returns check (G7). Pure: the year's filed
 * returns, as their drafts keep them, beside the same figures worked out from the books. Amounts are paise; a return's
 * summary keeps rupees and is converted here.
 */

/** A return's summary row as its draft keeps it (rupees). */
export interface SummaryRow {
	table: string;
	taxable: number;
	tax: number;
}

const paise = (inr: number): number => Math.round(inr * 100);

/** The twelve months of a financial year, `2025-26` → `2025-04` … `2026-03`. */
export function fyMonths(year: string): string[] {
	const start = Number(year.slice(0, 4));
	return Array.from({ length: 12 }, (_, i) => {
		const month = ((3 + i) % 12) + 1;
		return `${month >= 4 ? start : start + 1}-${String(month).padStart(2, '0')}`;
	});
}

/** A financial year's label is `YYYY-YY` with the second year following the first. */
export function isFinancialYear(year: string): boolean {
	const match = /^(\d{4})-(\d{2})$/.exec(year);
	return !!match && (Number(match[1]) + 1) % 100 === Number(match[2]);
}

/** Taxable value and tax of some of a summary's tables, in paise. */
export function tablesTotal(
	summary: readonly SummaryRow[],
	tables: readonly string[],
): { taxable: number; tax: number } {
	return summary
		.filter((row) => tables.includes(row.table))
		.reduce((sum, row) => ({ taxable: sum.taxable + paise(row.taxable), tax: sum.tax + paise(row.tax) }), {
			taxable: 0,
			tax: 0,
		});
}

/** GSTR-1's tables of supplies: B2B, B2C large, B2C others, and notes (export notes among them). */
export const GSTR1_SUPPLY_TABLES = ['4A', '5', '7', '9B'] as const;
export const GSTR1_EXPORT_TABLES = ['6A'] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** An item's taxable value in paise: an export keeps it on the item, a note under `itm_det`. */
const itemTaxable = (item: unknown): number => {
	const detail = isRecord(item) && isRecord(item['itm_det']) ? item['itm_det'] : item;
	return isRecord(detail) && typeof detail['txval'] === 'number' ? paise(detail['txval']) : 0;
};
const docTaxable = (doc: unknown): number =>
	list(isRecord(doc) ? doc['itms'] : null).reduce<number>((sum, item) => sum + itemTaxable(item), 0);

/**
 * A GSTR-1 file's exports of one kind (with IGST paid, WPAY, or under a LUT, WOPAY): the invoices' taxable value and
 * their notes' (a credit note lowers it, a debit note raises it), in paise.
 */
export function exportTaxable(
	portal: Readonly<Record<string, unknown>>,
	kind: 'WPAY' | 'WOPAY',
): { invoices: number; notes: number } {
	const noteType = kind === 'WPAY' ? 'EXPWP' : 'EXPWOP';
	const invoices = list(portal['exp'])
		.filter((group) => isRecord(group) && group['exp_typ'] === kind)
		.flatMap((group) => list((group as Record<string, unknown>)['inv']));
	const notes = list(portal['cdnur']).filter((note) => isRecord(note) && note['typ'] === noteType);
	return {
		invoices: invoices.reduce<number>((sum, doc) => sum + docTaxable(doc), 0),
		notes: notes.reduce<number>(
			(sum, note) => sum + ((note as Record<string, unknown>)['ntty'] === 'D' ? 1 : -1) * docTaxable(note),
			0,
		),
	};
}

/**
 * GSTR-9 table 4 and 5's taxable value from a GSTR-1: table 4 holds the taxed supplies, exports with IGST paid among
 * them (4C), and their notes; table 5 the exports under a LUT (5A) with their notes, which the summary's 9B also holds
 * and so are taken out of table 4.
 */
export function annualSupplies(gstr1: { summary: readonly SummaryRow[]; portal: Readonly<Record<string, unknown>> }): {
	taxed: number;
	zeroRatedWithoutTax: number;
} {
	const withTax = exportTaxable(gstr1.portal, 'WPAY');
	const withoutTax = exportTaxable(gstr1.portal, 'WOPAY');
	return {
		taxed: tablesTotal(gstr1.summary, GSTR1_SUPPLY_TABLES).taxable + withTax.invoices - withoutTax.notes,
		zeroRatedWithoutTax: withoutTax.invoices + withoutTax.notes,
	};
}

/** The HSN codes a GSTR-1 file's table 12 lists, to registered and to unregistered buyers alike. */
export function hsnCodes(portal: Readonly<Record<string, unknown>>): Set<string> {
	const hsn = isRecord(portal['hsn']) ? portal['hsn'] : {};
	const codes = new Set<string>();
	for (const part of ['hsn_b2b', 'hsn_b2c'])
		for (const row of Array.isArray(hsn[part]) ? (hsn[part] as unknown[]) : [])
			if (isRecord(row) && typeof row['hsn_sc'] === 'string') codes.add(row['hsn_sc']);
	return codes;
}

export type AnnualTable = '4' | '5' | '6' | '7' | '17';

export interface AnnualRow {
	table: AnnualTable;
	/** Paise, or a count for table 17. */
	returns: number;
	books: number;
	unit: 'paise' | 'count';
}

export interface AnnualInput {
	/** The year's filed GSTR-1 summaries and files. */
	gstr1: readonly { summary: readonly SummaryRow[]; portal: Readonly<Record<string, unknown>> }[];
	/** The year's filed GSTR-3B summaries. */
	gstr3b: readonly { summary: readonly SummaryRow[] }[];
	/** The books for the year: GSTR-1 worked out over the whole year, input credit taken, credit reversed. */
	books: {
		summary: readonly SummaryRow[];
		portal: Readonly<Record<string, unknown>>;
		inputCredit: number;
		reversed: number;
	};
}

/**
 * GSTR-9's tables against the books:
 * - 4 taxable outward supplies (filed GSTR-1's B2B, B2C, exports with IGST paid, and notes);
 * - 5 exports under a LUT without tax, exempt and non-GST;
 * - 6 input credit claimed (filed GSTR-3B's 4A) against the credit the books took;
 * - 7 credit reversed (GSTR-3B's 4B) against the books' reversals;
 * - 17 the HSN codes sold.
 */
export function annualRows(input: AnnualInput): AnnualRow[] {
	const sum = (
		rows: readonly { summary: readonly SummaryRow[] }[],
		tables: readonly string[],
		field: 'taxable' | 'tax',
	) => rows.reduce((total, r) => total + tablesTotal(r.summary, tables)[field], 0);
	const filedCodes = new Set(input.gstr1.flatMap((r) => [...hsnCodes(r.portal)]));
	const filed = input.gstr1.map(annualSupplies);
	const books = annualSupplies(input.books);
	return [
		{ table: '4', returns: filed.reduce((s, r) => s + r.taxed, 0), books: books.taxed, unit: 'paise' },
		{
			table: '5',
			returns: filed.reduce((s, r) => s + r.zeroRatedWithoutTax, 0),
			books: books.zeroRatedWithoutTax,
			unit: 'paise',
		},
		{ table: '6', returns: sum(input.gstr3b, ['4A'], 'tax'), books: input.books.inputCredit, unit: 'paise' },
		{ table: '7', returns: sum(input.gstr3b, ['4B'], 'tax'), books: input.books.reversed, unit: 'paise' },
		{ table: '17', returns: filedCodes.size, books: hsnCodes(input.books.portal).size, unit: 'count' },
	];
}
