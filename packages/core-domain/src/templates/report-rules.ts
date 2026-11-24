import type {
	AccountGroup,
	AccountsTemplate,
	Ledger,
	ReportLine,
	ReportPreviewRow,
	ReportSource,
	ReportTemplateContent,
} from '@saha-textile/contracts';

import { rolesOf } from '../ledger/roles';
import { chartFor, kindsOf } from './rules';

/** The lines in tree order with their depth: a line whose parent is missing sits at the top; a loop is left out. */
export function reportOrder(lines: readonly ReportLine[]): { line: ReportLine; depth: number }[] {
	const keys = new Set(lines.map((line) => line.key));
	const order: { line: ReportLine; depth: number }[] = [];
	const seen = new Set<string>();
	const walk = (parent: string | null, depth: number): void => {
		const under = lines.filter((line) =>
			parent === null ? line.parentKey === null || !keys.has(line.parentKey) : line.parentKey === parent,
		);
		for (const line of under) {
			if (seen.has(line.key)) continue;
			seen.add(line.key);
			order.push({ line, depth });
			walk(line.key, depth + 1);
		}
	};
	walk(null, 0);
	return order;
}

/**
 * AT6's publishing checks: line keys are unique, every parent exists and no line sits under itself; for each kind the
 * report applies to, every source is in the chart that kind opens (a role someone plays, a group or a ledger by key).
 */
export function reportProblems(
	template: Pick<AccountsTemplate, 'code' | 'appliesTo'>,
	content: ReportTemplateContent,
	library: readonly AccountsTemplate[],
): string[] {
	const problems = new Set<string>();
	const keys = new Set<string>();
	for (const line of content.lines) {
		if (keys.has(line.key)) problems.add(`template_duplicate_key:${line.key}`);
		keys.add(line.key);
	}
	for (const line of content.lines)
		if (line.parentKey !== null && !keys.has(line.parentKey)) problems.add(`template_unknown_parent:${line.key}`);
	const placed = new Set(reportOrder(content.lines).map((row) => row.line.key));
	for (const line of content.lines) if (!placed.has(line.key)) problems.add(`template_report_cycle:${line.key}`);
	const sources = content.lines.flatMap((line) => line.sources);
	if (!sources.length) return [...problems];
	for (const kind of kindsOf(template)) {
		let chart: ReturnType<typeof chartFor>;
		try {
			chart = chartFor(kind, [...library], template.code, []);
		} catch (error) {
			problems.add((error as Error).message);
			continue;
		}
		const groups = new Set(chart.groups.map((group) => group.id));
		const ledgers = new Set(chart.ledgers.map((ledger) => ledger.id));
		const roles = new Set([...chart.groups, ...chart.ledgers].flatMap((holder) => rolesOf(holder)));
		const known = { role: roles, group: groups, ledger: ledgers };
		for (const source of sources)
			if (!known[source.kind].has(source.key)) problems.add(`template_report_source:${source.key}:${kind}`);
	}
	return [...problems];
}

/** The company's books as a report reads them. */
export interface ReportBooks {
	groups: readonly AccountGroup[];
	ledgers: readonly Ledger[];
}

/** One column's balances (paise, debit positive): on its last day, and on the day before its year began. */
export interface ReportColumn {
	closing: Readonly<Record<string, number>>;
	opening: Readonly<Record<string, number>>;
}

const PERIOD = new Set(['income', 'expense']);
const CREDIT = new Set(['liability', 'equity', 'income']);

/** The ledgers a source adds up in this company's books, or null when the books have nothing by that key. */
function ledgersOf(source: ReportSource, books: ReportBooks): Ledger[] | null {
	const under = (roots: readonly AccountGroup[]): Ledger[] => {
		const ids = new Set(roots.map((group) => group.id));
		for (let grown = true; grown;) {
			grown = false;
			for (const group of books.groups)
				if (group.parentId !== null && ids.has(group.parentId) && !ids.has(group.id)) {
					ids.add(group.id);
					grown = true;
				}
		}
		return books.ledgers.filter((ledger) => ids.has(ledger.groupId));
	};
	if (source.kind === 'ledger') {
		const found = books.ledgers.filter((ledger) => ledger.systemKey === source.key);
		return found.length ? found : null;
	}
	if (source.kind === 'group') {
		const found = books.groups.filter((group) => group.systemKey === source.key);
		return found.length ? under(found) : null;
	}
	const direct = books.ledgers.filter((ledger) => rolesOf(ledger).includes(source.key));
	const groups = books.groups.filter((group) => rolesOf(group).includes(source.key));
	return direct.length || groups.length ? [...direct, ...under(groups)] : null;
}

/** A ledger's figure in a column: the year's movement for income and expense, the closing balance for the rest. */
function figure(ledger: Ledger, column: ReportColumn): number {
	const closing = column.closing[ledger.id] ?? 0;
	return PERIOD.has(ledger.nature) ? closing - (column.opening[ledger.id] ?? 0) : closing;
}

/**
 * AT6 "Preview with this company": every line in tree order with its figure for this year and, when the report shows
 * it, the year before. A line adds up its own sources and the lines under it (each ledger once) and reads credit
 * balances as positive when it holds any liability, equity or income. With a note per line, each line lists its own
 * ledgers. Sources the books don't have are named, never guessed.
 */
export function reportRows(
	content: ReportTemplateContent,
	books: ReportBooks,
	thisYear: ReportColumn,
	lastYear: ReportColumn | null,
): { rows: ReportPreviewRow[]; problems: string[] } {
	const problems = new Set<string>();
	const own = new Map<string, Map<string, Ledger>>();
	for (const line of content.lines) {
		const found = own.get(line.key) ?? new Map<string, Ledger>();
		for (const source of line.sources) {
			const ledgers = ledgersOf(source, books);
			if (!ledgers) problems.add(`report_source_unknown:${source.kind}:${source.key}`);
			for (const ledger of ledgers ?? []) found.set(ledger.id, ledger);
		}
		own.set(line.key, found);
	}
	const order = reportOrder(content.lines);
	const all = (key: string): Map<string, Ledger> => {
		const ledgers = new Map(own.get(key));
		for (const row of order)
			if (row.line.parentKey === key) for (const [id, l] of all(row.line.key)) ledgers.set(id, l);
		return ledgers;
	};
	const rows = order.map(({ line, depth }) => {
		const ledgers = [...all(line.key).values()];
		const side: 'debit' | 'credit' = ledgers.some((ledger) => CREDIT.has(ledger.nature)) ? 'credit' : 'debit';
		const shown = (paise: number): number => (side === 'credit' ? 0 - paise : paise);
		const sum = (column: ReportColumn) => ledgers.reduce((total, ledger) => total + figure(ledger, column), 0);
		return {
			key: line.key,
			label: line.label,
			depth,
			side,
			thisYearPaise: shown(sum(thisYear)),
			lastYearPaise: lastYear ? shown(sum(lastYear)) : null,
			ledgers: content.notes
				? [...(own.get(line.key) as Map<string, Ledger>).values()].map((ledger) => ({
						name: ledger.name,
						thisYearPaise: shown(figure(ledger, thisYear)),
						lastYearPaise: lastYear ? shown(figure(ledger, lastYear)) : null,
					}))
				: [],
		};
	});
	return { rows, problems: [...problems] };
}
