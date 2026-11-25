/**
 * Closing a financial year (accounts brief T3). Pure: the ten checks from facts gathered across the books, whether the
 * closing entries or the close itself may go ahead, and the closing voucher's lines: each income and expense ledger's
 * movement for the year taken back to nothing at each location, the difference (the year's profit or loss) to the
 * Profit and loss account. Year-closing lines never count in balances, so every report reads the year as it was.
 */

import { appropriationLedgerIds } from './profit-share';
import { rolesOf } from './roles';

export const YEAR_CLOSE_KEYS = [
	'cash',
	'banks',
	'stock_count',
	'transfers',
	'depreciation',
	'payroll',
	'gst',
	'suspense',
	'accruals',
	'closing',
] as const;
export type YearCloseKey = (typeof YEAR_CLOSE_KEYS)[number];
export type YearCloseState = 'ok' | 'attention' | 'warning' | 'not_in_use';

export interface YearCloseCheck {
	key: YearCloseKey;
	state: YearCloseState;
	/** What is still open (or done, for "n of m" checks). */
	count: number;
	of: number | null;
	amountPaise: number | null;
}

/** What the books say at the year's end; null where that part of the software isn't in use. */
export interface YearCloseFacts {
	cashOpen: number | null;
	banks: { total: number; reconciled: number } | null;
	stockCount: { posted: number; open: number } | null;
	transfersOpen: number | null;
	depreciationDue: number | null;
	/** Null when payroll isn't in use; otherwise whether March is posted. */
	payrollMarchDone: boolean | null;
	gst: { needed: number; filed: number } | null;
	suspensePaise: number;
	suspenseCarried: boolean;
	accrualsConfirmed: boolean;
	closing: 'none' | 'posted' | 'stale';
}

const open = (key: YearCloseKey, count: number | null): YearCloseCheck =>
	count === null
		? { key, state: 'not_in_use', count: 0, of: null, amountPaise: null }
		: { key, state: count ? 'attention' : 'ok', count, of: null, amountPaise: null };

const outOf = (key: YearCloseKey, part: { done: number; of: number } | null): YearCloseCheck =>
	part === null
		? { key, state: 'not_in_use', count: 0, of: null, amountPaise: null }
		: { key, state: part.done >= part.of ? 'ok' : 'attention', count: part.done, of: part.of, amountPaise: null };

/** T3: the ten checks, as drawn. Suspense left over is a warning to settle or carry with a note, never a block. */
export function yearCloseChecks(f: YearCloseFacts): YearCloseCheck[] {
	const stock = f.stockCount;
	return [
		open('cash', f.cashOpen),
		outOf('banks', f.banks && { done: f.banks.reconciled, of: f.banks.total }),
		stock === null
			? open('stock_count', null)
			: {
					// Counts still open, out of the year-end counts posted.
					key: 'stock_count',
					state: stock.posted > 0 && stock.open === 0 ? 'ok' : 'attention',
					count: stock.open,
					of: stock.posted,
					amountPaise: null,
				},
		open('transfers', f.transfersOpen),
		open('depreciation', f.depreciationDue),
		open('payroll', f.payrollMarchDone === null ? null : f.payrollMarchDone ? 0 : 1),
		outOf('gst', f.gst && { done: f.gst.filed, of: f.gst.needed }),
		{
			key: 'suspense',
			state: f.suspensePaise === 0 || f.suspenseCarried ? 'ok' : 'warning',
			count: 0,
			of: null,
			amountPaise: f.suspensePaise,
		},
		open('accruals', f.accrualsConfirmed ? 0 : 1),
		{
			key: 'closing',
			state: f.closing === 'posted' ? 'ok' : 'attention',
			count: f.closing === 'stale' ? 1 : 0,
			of: null,
			amountPaise: null,
		},
	];
}

/** How many of the ten are done: ok, or not in use. */
export function yearCloseDone(checks: readonly YearCloseCheck[]): number {
	return checks.filter((c) => c.state === 'ok' || c.state === 'not_in_use').length;
}

/**
 * The closing entries may be posted once every other check is done (a suspense warning may stand); the year may be
 * closed and locked once the closing entries are posted and up to date too.
 */
export function yearCloseReady(checks: readonly YearCloseCheck[], step: 'closing_entries' | 'close'): boolean {
	return checks.filter((c) => step === 'close' || c.key !== 'closing').every((c) => c.state !== 'attention');
}

interface ChartLike {
	groups: readonly {
		id: string;
		parentId: string | null;
		nature: string;
		systemKey?: string | null;
		roles?: readonly string[];
	}[];
	ledgers: readonly { id: string; groupId: string }[];
}

export interface ClosingLine {
	ledgerId: string;
	locationId: string;
	debitPaise?: number;
	creditPaise?: number;
}

/**
 * The closing voucher's lines from each location's balances at the year's end and the year before (debit positive):
 * every income and expense ledger's movement for the year reversed, the net to the Profit and loss account.
 * Returns the lines and the year's profit (positive) or loss (negative).
 */
export function closingLines(
	chart: ChartLike,
	byLocation: Readonly<
		Record<string, { closing: Readonly<Record<string, number>>; opening: Readonly<Record<string, number>> }>
	>,
	profitAndLossLedgerId: string,
): { lines: ClosingLine[]; profitPaise: number } {
	const groups = new Map(chart.groups.map((g) => [g.id, g]));
	const nominal = chart.ledgers.filter((l) => {
		const nature = groups.get(l.groupId)?.nature;
		return nature === 'income' || nature === 'expense';
	});
	const lines: ClosingLine[] = [];
	let profitPaise = 0;
	for (const [locationId, at] of Object.entries(byLocation)) {
		let net = 0;
		for (const ledger of nominal) {
			const moved = (at.closing[ledger.id] ?? 0) - (at.opening[ledger.id] ?? 0);
			if (!moved) continue;
			net += moved;
			lines.push(
				moved > 0
					? { ledgerId: ledger.id, locationId, creditPaise: moved }
					: { ledgerId: ledger.id, locationId, debitPaise: -moved },
			);
		}
		if (!net) continue;
		// Expenses above income (net debit) is a loss: the Profit and loss account takes the debit.
		lines.push(
			net > 0
				? { ledgerId: profitAndLossLedgerId, locationId, debitPaise: net }
				: { ledgerId: profitAndLossLedgerId, locationId, creditPaise: -net },
		);
		profitPaise -= net;
	}
	return { lines, profitPaise };
}

/** Whether a posted closing voucher still matches the year: the same amount on every ledger at every location. */
export function closingStale(posted: readonly ClosingLine[], wanted: readonly ClosingLine[]): boolean {
	const key = (l: ClosingLine) => `${l.ledgerId}@${l.locationId}`;
	const sum = (lines: readonly ClosingLine[]) => {
		const out = new Map<string, number>();
		for (const l of lines) out.set(key(l), (out.get(key(l)) ?? 0) + (l.debitPaise ?? 0) - (l.creditPaise ?? 0));
		return out;
	};
	const a = sum(posted);
	const b = sum(wanted);
	if (a.size !== b.size) return true;
	for (const [k, v] of a) if (b.get(k) !== v) return true;
	return false;
}

/** The financial year a label names: its first and last day and its twelve months (`2026-27`). */
export function yearSpan(label: string): { from: string; to: string; months: string[] } {
	const start = Number(label.slice(0, 4));
	const months = Array.from({ length: 12 }, (_, i) => {
		const month = ((3 + i) % 12) + 1;
		return `${month >= 4 ? start : start + 1}-${String(month).padStart(2, '0')}`;
	});
	return { from: `${start}-04-01`, to: `${start + 1}-03-31`, months };
}

/**
 * Each location's profit for the year before any sharing (YC1): what the closing entries would take to the profit and
 * loss account with the appropriation ledgers left out, so a posted sharing never changes the profit it shared.
 */
export function profitByLocation(
	chart: ChartLike,
	byLocation: Readonly<
		Record<string, { closing: Readonly<Record<string, number>>; opening: Readonly<Record<string, number>> }>
	>,
	profitAndLossLedgerId: string,
): Record<string, number> {
	const shared = appropriationLedgerIds(chart);
	const { lines } = closingLines(
		{ groups: chart.groups, ledgers: chart.ledgers.filter((l) => !shared.has(l.id)) },
		byLocation,
		profitAndLossLedgerId,
	);
	const out: Record<string, number> = {};
	for (const line of lines)
		if (line.ledgerId === profitAndLossLedgerId)
			out[line.locationId] = (line.creditPaise ?? 0) - (line.debitPaise ?? 0);
	return out;
}

interface FigureLedger {
	id: string;
	nature: string;
	systemKey: string | null;
	roles?: readonly string[];
}

const nominal = (ledger: FigureLedger): boolean => ledger.nature === 'income' || ledger.nature === 'expense';

/**
 * Balances as a year's reports read them (debit positive): every earlier year's profit, which the closing entries never
 * move in balances, carried into the profit and loss account. `opening` is the balances on the year's eve.
 */
export function withProfitCarried(
	ledgers: readonly FigureLedger[],
	closing: Readonly<Record<string, number>>,
	opening: Readonly<Record<string, number>>,
): Record<string, number> {
	const pl = ledgers.find((l) => rolesOf(l).includes('profit_and_loss'));
	const carried = ledgers.filter(nominal).reduce((sum, l) => sum + (opening[l.id] ?? 0), 0);
	if (!pl || !carried) return { ...closing };
	return { ...closing, [pl.id]: (closing[pl.id] ?? 0) + carried };
}

/** A trial balance's figures for a day in a year: income and expense for the year so far, earlier profit carried. */
export function yearFigures(
	ledgers: readonly FigureLedger[],
	closing: Readonly<Record<string, number>>,
	opening: Readonly<Record<string, number>>,
): Record<string, number> {
	const out = withProfitCarried(ledgers, closing, opening);
	for (const ledger of ledgers.filter(nominal))
		out[ledger.id] = (closing[ledger.id] ?? 0) - (opening[ledger.id] ?? 0);
	return out;
}
