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

/** GSTR-1's tables of supplies: B2B, B2C large, exports, B2C others, and notes. */
export const GSTR1_SUPPLY_TABLES = ['4A', '5', '7', '9B'] as const;
export const GSTR1_EXPORT_TABLES = ['6A'] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

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
 * - 4 taxable outward supplies (filed GSTR-1's B2B, B2C and notes);
 * - 5 exports without tax, exempt and non-GST (filed GSTR-1's exports);
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
	return [
		{
			table: '4',
			returns: sum(input.gstr1, GSTR1_SUPPLY_TABLES, 'taxable'),
			books: tablesTotal(input.books.summary, GSTR1_SUPPLY_TABLES).taxable,
			unit: 'paise',
		},
		{
			table: '5',
			returns: sum(input.gstr1, GSTR1_EXPORT_TABLES, 'taxable'),
			books: tablesTotal(input.books.summary, GSTR1_EXPORT_TABLES).taxable,
			unit: 'paise',
		},
		{ table: '6', returns: sum(input.gstr3b, ['4A'], 'tax'), books: input.books.inputCredit, unit: 'paise' },
		{ table: '7', returns: sum(input.gstr3b, ['4B'], 'tax'), books: input.books.reversed, unit: 'paise' },
		{ table: '17', returns: filedCodes.size, books: hsnCodes(input.books.portal).size, unit: 'count' },
	];
}
