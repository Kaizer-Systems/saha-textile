import type { BankLayout, StatementDateFormat, StatementPreview } from '@saha-textile/contracts';

/**
 * Matching a statement file's columns (accounts brief BA5) and the figures the check before saving starts from (BA6).
 * Pure: the import page keeps the state, these work it out.
 */

/** What a column of the file is, as BA5's "Is" list offers it; "skip" leaves it out. */
export const COLUMN_ROLES = [
	'skip',
	'date',
	'valueDate',
	'description',
	'reference',
	'withdrawal',
	'deposit',
	'amount',
	'drcr',
	'balance',
] as const;
export type ColumnRole = (typeof COLUMN_ROLES)[number];

/** The contract's date formats, repeated because the admin takes only types from that package (a spec holds them equal). */
export const DATE_FORMATS: readonly StatementDateFormat[] = [
	'DD/MM/YY',
	'DD/MM/YYYY',
	'DD-MM-YYYY',
	'YYYY-MM-DD',
	'DD MMM YYYY',
];

type Columns = BankLayout['columns'];
type Mapped = Exclude<ColumnRole, 'skip'>;
const MAPPED: readonly Mapped[] = COLUMN_ROLES.filter((role): role is Mapped => role !== 'skip');

/** Banks' headings for each column, tried in this order; the value date is told apart from the date first. */
const GUESSES: ReadonlyArray<[Mapped, RegExp]> = [
	['valueDate', /value\s*d/i],
	['date', /date|^dt\.?$/i],
	['description', /narration|description|particulars|details|remarks/i],
	['reference', /ref|chq|cheque|utr/i],
	['withdrawal', /withdraw|debit|paid\s*out/i],
	['deposit', /deposit|credit|paid\s*in/i],
	['drcr', /dr\s*\/?\s*cr|^type$/i],
	['balance', /balance/i],
	['amount', /amount|amt/i],
];

/** Each heading's role, each role taken once, from the bank's own words. */
export function guessRoles(heading: readonly string[]): ColumnRole[] {
	const taken = new Set<Mapped>();
	return heading.map((cell) => {
		const found = GUESSES.find(([role, words]) => !taken.has(role) && words.test(cell.trim()));
		if (!found) return 'skip';
		taken.add(found[0]);
		return found[0];
	});
}

/** The layout's columns from the roles picked; a role picked twice keeps its first column. */
export function columnsFrom(roles: readonly ColumnRole[]): Columns {
	const at = (role: Mapped) => {
		const index = roles.indexOf(role);
		return index < 0 ? null : index;
	};
	return Object.fromEntries(MAPPED.map((role) => [role, at(role)])) as Columns;
}

/** The roles of a file `width` columns wide, from a saved layout. */
export function rolesFrom(columns: Columns, width: number): ColumnRole[] {
	return Array.from({ length: width }, (_, index) => MAPPED.find((role) => columns[role] === index) ?? 'skip');
}

/** The date format a sample date is written in. */
export function guessDateFormat(sample: string): StatementDateFormat {
	const text = sample.trim();
	if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(text)) return 'YYYY-MM-DD';
	if (/[A-Za-z]{3}/.test(text)) return 'DD MMM YYYY';
	if (/^\d{1,2}-\d{1,2}-\d{4}$/.test(text)) return 'DD-MM-YYYY';
	if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(text)) return 'DD/MM/YYYY';
	return 'DD/MM/YY';
}

/** A first guess at a file never matched before: the heading row (the first naming a date), its roles and formats. */
export function guessLayout(
	rows: readonly (readonly string[])[],
): Pick<BankLayout, 'skipRows' | 'dateFormat' | 'money' | 'columns'> {
	const headingAt = rows.findIndex((row) => row.length > 2 && row.some((cell) => /date/i.test(cell)));
	const columns = columnsFrom(guessRoles(rows[headingAt] ?? []));
	const sample = rows[headingAt + 1] ?? [];
	return {
		skipRows: headingAt + 1,
		dateFormat: guessDateFormat(columns.date === null ? '' : (sample[columns.date] ?? '')),
		money:
			columns.amount !== null && columns.withdrawal === null && columns.deposit === null
				? 'signed_drcr'
				: 'split',
		columns,
	};
}

type Line = Pick<StatementPreview['lines'][number], 'date' | 'outPaise' | 'inPaise' | 'balancePaise'>;

/**
 * The statement's opening and closing as its balance column shows them (BA6), oldest line first whichever way the
 * bank sorts; zero where the file has no balances, for the person to type.
 */
export function statementEnds(lines: readonly Line[]): { openingPaise: number; closingPaise: number } {
	if (!lines.length) return { openingPaise: 0, closingPaise: 0 };
	const ordered = (lines[0] as Line).date <= (lines.at(-1) as Line).date ? lines : [...lines].reverse();
	const first = ordered[0] as Line;
	const last = ordered.at(-1) as Line;
	const openingPaise = first.balancePaise === null ? 0 : first.balancePaise - first.inPaise + first.outPaise;
	const closingPaise = last.balancePaise ?? openingPaise + linesNet(lines);
	return { openingPaise, closingPaise };
}

/** Money in less money out over the lines, in paise. */
export function linesNet(lines: readonly Pick<Line, 'outPaise' | 'inPaise'>[]): number {
	return lines.reduce((sum, line) => sum + line.inPaise - line.outPaise, 0);
}
