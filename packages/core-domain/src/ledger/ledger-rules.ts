import type {
	AccountGroup,
	BookPart,
	JournalLine,
	JournalVoucher,
	Ledger,
	AccountStatementRow,
	PeriodLock,
	PeriodState,
	VoucherKind,
	VoucherProblem,
} from '@saha-textile/contracts';
import { rolesOf } from './roles';

/**
 * Voucher rules (accounts brief Q, T; owner-approved 2026-11-23). Pure: the API refuses a post with them and the
 * journal form shows the same problems before Post.
 */

type LineAmounts = Pick<JournalLine, 'debitPaise' | 'creditPaise'>;

export function voucherTotals(lines: readonly LineAmounts[]): { debitPaise: number; creditPaise: number } {
	return lines.reduce(
		(sum, line) => ({
			debitPaise: sum.debitPaise + line.debitPaise,
			creditPaise: sum.creditPaise + line.creditPaise,
		}),
		{ debitPaise: 0, creditPaise: 0 },
	);
}

/** "2026-11-23" → "2026-11". */
export const monthOf = (day: string): string => day.slice(0, 7);

/** Whether a ledger sits under a group playing the cash role, or the bank or overdraft role (contras, receipts): Cash in hand, or under Bank accounts or a bank overdraft (contras, receipts). */
export function ledgerClass(
	ledger: Pick<Ledger, 'groupId'>,
	groups: readonly (Pick<AccountGroup, 'id' | 'parentId' | 'systemKey'> & { roles?: readonly string[] })[],
): 'cash' | 'bank' | 'other' {
	const byId = new Map(groups.map((group) => [group.id, group]));
	for (let group = byId.get(ledger.groupId), hops = 0; group && hops < 20; hops += 1) {
		const roles = rolesOf(group);
		if (roles.includes('cash_in_hand')) return 'cash';
		if (roles.includes('bank_accounts') || roles.includes('bank_od')) return 'bank';
		group = group.parentId ? byId.get(group.parentId) : undefined;
	}
	return 'other';
}

/** The part of the books a voucher belongs to, for period locks (T1). */
export function bookPartOf(
	kind: VoucherKind,
	classes: readonly ('cash' | 'bank' | 'other')[],
	sourceType?: string,
): BookPart {
	if (kind === 'document' && sourceType) {
		if (/invoice|creditNote|debitNote|receipt|refund/i.test(sourceType)) return 'sales';
		if (/purchase|supplier|selfInvoice|paymentVoucher/i.test(sourceType)) return 'purchases';
		if (/stock|transfer|count|opening/i.test(sourceType)) return 'stock';
		if (/payroll|salary/i.test(sourceType)) return 'payroll';
	}
	if (kind === 'journal' || kind === 'opening' || kind === 'document') return 'journal';
	return classes.includes('bank') ? 'bank' : classes.includes('cash') ? 'cash' : 'journal';
}

/** A month's state for one part: the latest lock row wins; no row means open. */
export function periodStateOf(locks: readonly PeriodLock[], month: string, part: BookPart): PeriodState {
	return locks.find((lock) => lock.month === month && lock.part === part)?.state ?? 'open';
}

export interface VoucherCheckContext {
	ledgers: ReadonlyMap<string, Ledger>;
	groups: readonly AccountGroup[];
	locationIds: ReadonlySet<string>;
	locks: readonly PeriodLock[];
	/** A person typing the voucher (control ledgers refused) rather than a document posting it. */
	byHand: boolean;
	/** May post into a month closed for staff (holds accounts.lock); nobody posts into a locked month. */
	mayPostWhenClosed: boolean;
	sourceType?: string;
	/** Returns filed for a GSTIN and month, and the parts of the books each locks (G8). */
	filedGst?: readonly { gstRegistrationId: string; month: string; parts: readonly BookPart[] }[];
}

export function voucherProblems(
	voucher: {
		kind: VoucherKind;
		date: string;
		reverseOn?: string | null;
		lines: readonly JournalLine[];
		/** Undoes another voucher: its sides are swapped on purpose, so the cash-side rules don't apply. */
		reversal?: boolean;
	},
	context: VoucherCheckContext,
): VoucherProblem[] {
	const problems = new Set<VoucherProblem>();
	if (voucher.lines.length < 2) problems.add('empty');
	const classes: ('cash' | 'bank' | 'other')[] = [];
	for (const line of voucher.lines) {
		if (line.debitPaise > 0 && line.creditPaise > 0) problems.add('line_both_sides');
		if (line.debitPaise === 0 && line.creditPaise === 0) problems.add('line_zero');
		const ledger = context.ledgers.get(line.ledgerId);
		if (!ledger) {
			problems.add('ledger_unknown');
			continue;
		}
		if (!ledger.active) problems.add('ledger_inactive');
		if (context.byHand && !ledger.handPosting) problems.add('ledger_not_by_hand');
		if (!context.locationIds.has(line.locationId)) problems.add('location_unknown');
		classes.push(ledgerClass(ledger, context.groups));
	}
	const totals = voucherTotals(voucher.lines);
	if (totals.debitPaise !== totals.creditPaise || totals.debitPaise === 0) problems.add('unbalanced');
	const classOf = (line: JournalLine) => {
		const ledger = context.ledgers.get(line.ledgerId);
		return ledger ? ledgerClass(ledger, context.groups) : 'other';
	};
	if (!voucher.reversal && voucher.kind === 'contra' && voucher.lines.some((line) => classOf(line) === 'other'))
		problems.add('contra_needs_cash_or_bank');
	if (
		!voucher.reversal &&
		voucher.kind === 'receipt' &&
		!voucher.lines.some((line) => line.debitPaise > 0 && classOf(line) !== 'other')
	)
		problems.add('receipt_needs_cash_or_bank_debit');
	if (
		!voucher.reversal &&
		voucher.kind === 'payment' &&
		!voucher.lines.some((line) => line.creditPaise > 0 && classOf(line) !== 'other')
	)
		problems.add('payment_needs_cash_or_bank_credit');
	if (voucher.reverseOn && voucher.reverseOn <= voucher.date) problems.add('reverse_on_before_date');
	const state = periodStateOf(
		context.locks,
		monthOf(voucher.date),
		bookPartOf(voucher.kind, classes, context.sourceType),
	);
	if (state === 'locked') problems.add('period_locked');
	const part = bookPartOf(voucher.kind, classes, context.sourceType);
	const month = monthOf(voucher.date);
	if (
		voucher.lines.some((line) =>
			(context.filedGst ?? []).some(
				(filed) =>
					filed.gstRegistrationId === line.gstRegistrationId &&
					filed.month === month &&
					filed.parts.includes(part),
			),
		)
	)
		problems.add('gst_filed');
	if (state === 'closed_for_staff' && !context.mayPostWhenClosed) problems.add('period_closed_for_staff');
	return [...problems];
}

/** The lines that undo a voucher: every debit becomes a credit and back (a reversal is its own voucher). */
export function reversalLines(voucher: Pick<JournalVoucher, 'lines'>): JournalLine[] {
	return voucher.lines.map((line) => ({ ...line, debitPaise: line.creditPaise, creditPaise: line.debitPaise }));
}

export interface StatementLine {
	voucherId: string;
	number: string;
	kind: VoucherKind;
	date: string;
	narration: string;
	locationId: string;
	debitPaise: number;
	creditPaise: number;
}

/** Q2: the opening balance, each entry with its running balance (debit positive), and the closing. */
export function ledgerStatement(
	openingPaise: number,
	lines: readonly StatementLine[],
): { rows: AccountStatementRow[]; debitPaise: number; creditPaise: number; closingPaise: number } {
	const sorted = [...lines].sort((a, b) => a.date.localeCompare(b.date) || a.number.localeCompare(b.number));
	let balance = openingPaise;
	const rows = sorted.map((line) => {
		balance += line.debitPaise - line.creditPaise;
		return { ...line, balancePaise: balance };
	});
	const totals = voucherTotals(sorted);
	return { rows, ...totals, closingPaise: balance };
}

/** Months from one to another inclusive ("2026-04" … "2027-03"). */
export function monthsBetween(from: string, to: string): string[] {
	const months: string[] = [];
	let [year, month] = from.split('-').map(Number) as [number, number];
	const [endYear, endMonth] = to.split('-').map(Number) as [number, number];
	while (year < endYear || (year === endYear && month <= endMonth)) {
		months.push(`${year}-${String(month).padStart(2, '0')}`);
		month += 1;
		if (month > 12) {
			month = 1;
			year += 1;
		}
		if (months.length > 240) break;
	}
	return months;
}
