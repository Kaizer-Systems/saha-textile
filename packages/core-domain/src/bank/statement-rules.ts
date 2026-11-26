import type { BankLayout } from '@saha-textile/contracts';

/**
 * Reading a bank statement (accounts brief BA4–BA6). Pure: the rows of a statement file, read with the bank's saved
 * layout, become lines with a date, a description, a reference and money out or in; each line has a key so a line
 * imported before is skipped; the statement's opening plus its lines must come to its closing.
 */

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** A statement date in the layout's format as `YYYY-MM-DD`, or null when it isn't one. */
export function statementDate(text: string, format: BankLayout['dateFormat']): string | null {
	const value = text.trim();
	let day: number;
	let month: number;
	let year: number;
	if (format === 'YYYY-MM-DD') {
		const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
		if (!m) return null;
		[year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
	} else if (format === 'DD MMM YYYY') {
		const m = /^(\d{1,2})[\s-]([A-Za-z]{3})[\s-](\d{2,4})$/.exec(value);
		if (!m) return null;
		month = MONTHS.indexOf((m[2] as string).toUpperCase()) + 1;
		[day, year] = [Number(m[1]), Number(m[3])];
	} else {
		const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(value);
		if (!m) return null;
		[day, month, year] = [Number(m[1]), Number(m[2]), Number(m[3])];
	}
	if (year < 100) year += 2000;
	const date = new Date(Date.UTC(year, month - 1, day));
	if (month < 1 || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
	return date.toISOString().slice(0, 10);
}

/** An amount as banks print it ("1,23,456.78", "₹ 500", "(250.00)", "100 Dr") in paise, signed; blank is 0. */
export function statementAmount(text: string): number | null {
	let value = text.replace(/[₹,\s]/g, '').toUpperCase();
	if (!value || value === '-') return 0;
	let sign = 1;
	if (/^\(.*\)$/.test(value)) {
		sign = -1;
		value = value.slice(1, -1);
	}
	if (value.endsWith('DR')) {
		sign = -sign;
		value = value.slice(0, -2);
	} else if (value.endsWith('CR')) value = value.slice(0, -2);
	if (value.startsWith('-')) {
		sign = -sign;
		value = value.slice(1);
	}
	if (!/^\d+(\.\d{1,2})?$/.test(value)) return null;
	return sign * Math.round(Number(value) * 100);
}

export interface ParsedLine {
	row: number;
	date: string;
	description: string;
	reference: string;
	outPaise: number;
	inPaise: number;
	balancePaise: number | null;
}

export type LineProblem = 'date_unreadable' | 'amount_unreadable' | 'no_money';

/** The statement's lines from its rows; rows that aren't lines (headings, totals, blanks) are named, not guessed. */
export function statementLines(
	rows: readonly (readonly string[])[],
	layout: Pick<BankLayout, 'skipRows' | 'dateFormat' | 'money' | 'columns'>,
): { lines: ParsedLine[]; problems: { row: number; problem: LineProblem }[] } {
	const lines: ParsedLine[] = [];
	const problems: { row: number; problem: LineProblem }[] = [];
	const cell = (row: readonly string[], index: number | null) => (index === null ? '' : (row[index] ?? '').trim());
	rows.forEach((row, at) => {
		if (at < layout.skipRows || row.every((c) => !c.trim())) return;
		const n = at + 1;
		const date = statementDate(cell(row, layout.columns.date), layout.dateFormat);
		if (!date) {
			problems.push({ row: n, problem: 'date_unreadable' });
			return;
		}
		let outPaise: number | null;
		let inPaise: number | null;
		if (layout.money === 'split') {
			outPaise = statementAmount(cell(row, layout.columns.withdrawal));
			inPaise = statementAmount(cell(row, layout.columns.deposit));
		} else {
			const amount = statementAmount(cell(row, layout.columns.amount));
			const dr = /^D/i.test(cell(row, layout.columns.drcr));
			outPaise = amount === null ? null : dr ? Math.abs(amount) : 0;
			inPaise = amount === null ? null : dr ? 0 : Math.abs(amount);
		}
		if (outPaise === null || inPaise === null) {
			problems.push({ row: n, problem: 'amount_unreadable' });
			return;
		}
		if (!outPaise && !inPaise) {
			problems.push({ row: n, problem: 'no_money' });
			return;
		}
		const balance = layout.columns.balance === null ? null : statementAmount(cell(row, layout.columns.balance));
		lines.push({
			row: n,
			date,
			description: cell(row, layout.columns.description),
			reference: cell(row, layout.columns.reference),
			outPaise: Math.abs(outPaise),
			inPaise: Math.abs(inPaise),
			balancePaise: balance,
		});
	});
	return { lines, problems };
}

/** What makes a line the same line when a statement is imported again. */
export function lineKey(line: Pick<ParsedLine, 'date' | 'outPaise' | 'inPaise' | 'reference' | 'description'>): string {
	const text = (line.reference || line.description).replace(/\s+/g, ' ').trim().toUpperCase().slice(0, 60);
	return `${line.date}|${line.outPaise}|${line.inPaise}|${text}`;
}

/** BA6: the statement's opening plus its lines, against its closing. */
export function statementTotals(
	openingPaise: number,
	lines: readonly Pick<ParsedLine, 'outPaise' | 'inPaise'>[],
	closingPaise: number,
): { computedPaise: number; matches: boolean } {
	const computedPaise = lines.reduce((sum, l) => sum + l.inPaise - l.outPaise, openingPaise);
	return { computedPaise, matches: computedPaise === closingPaise };
}
