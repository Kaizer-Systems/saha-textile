import type { AccountGroup, JournalLine, Ledger, PeriodLock } from '@saha-textile/contracts';
import { describe, expect, it } from 'vitest';

import { defaultChart } from '../src/ledger/chart';
import {
	bookPartOf,
	ledgerClass,
	ledgerStatement,
	monthsBetween,
	periodStateOf,
	reversalLines,
	voucherProblems,
	voucherTotals,
} from '../src/ledger/ledger-rules';

const at = '2026-11-23T00:00:00.000Z';
const group = (id: string, systemKey: string | null, parentId: string | null = null): AccountGroup => ({
	id,
	systemKey,
	name: id,
	parentId,
	nature: 'asset',
	tradingAccount: false,
	order: 0,
	createdAt: at,
	updatedAt: at,
});
const ledger = (id: string, groupId: string, patch: Partial<Ledger> = {}): Ledger => ({
	id,
	systemKey: null,
	name: id,
	groupId,
	nature: 'asset',
	handPosting: true,
	active: true,
	createdAt: at,
	updatedAt: at,
	updatedBy: null,
	...patch,
});
const groups = [
	group('g_ca', 'current_assets'),
	group('g_cash', 'cash_in_hand', 'g_ca'),
	group('g_bank', 'bank_accounts', 'g_ca'),
	group('g_exp', 'indirect_expenses'),
	group('g_tax', 'duties_and_taxes'),
];
const ledgers = new Map(
	[
		ledger('cash', 'g_cash'),
		ledger('hdfc', 'g_bank'),
		ledger('rent', 'g_exp'),
		ledger('output_cgst', 'g_tax', { handPosting: false }),
		ledger('old', 'g_exp', { active: false }),
	].map((l) => [l.id, l]),
);
const line = (ledgerId: string, debit: number, credit: number): JournalLine => ({
	ledgerId,
	locationId: 'loc_bar',
	gstRegistrationId: 'reg_wb',
	debitPaise: debit,
	creditPaise: credit,
	narration: '',
});
const context = (patch: { byHand?: boolean; locks?: PeriodLock[]; mayPostWhenClosed?: boolean } = {}) => ({
	ledgers,
	groups,
	locationIds: new Set(['loc_bar']),
	locks: patch.locks ?? [],
	byHand: patch.byHand ?? true,
	mayPostWhenClosed: patch.mayPostWhenClosed ?? false,
});

describe('general ledger rules (accounts brief Q, T)', () => {
	it('starts every kind of business with the posting ledgers and its own owners’ accounts', () => {
		const sole = defaultChart('proprietorship');
		const company = defaultChart('private_limited');
		for (const chart of [sole, company]) {
			const groupKeys = new Set(chart.groups.map((g) => g.systemKey));
			for (const l of chart.ledgers) expect(groupKeys.has(l.groupKey)).toBe(true);
			for (const g of chart.groups) if (g.parentKey) expect(groupKeys.has(g.parentKey)).toBe(true);
			expect(new Set(chart.ledgers.map((l) => l.systemKey)).size).toBe(chart.ledgers.length);
		}
		expect(sole.ledgers.map((l) => l.systemKey)).toEqual(expect.arrayContaining(['capital', 'drawings']));
		expect(company.ledgers.map((l) => l.systemKey)).toContain('share_capital');
		expect(company.groups.find((g) => g.systemKey === 'capital_account')?.name).toBe('Share capital');
		expect(sole.ledgers.find((l) => l.systemKey === 'output_cgst')?.handPosting).toBe(false);
	});

	it('accepts a balanced journal and adds up both sides', () => {
		const lines = [line('rent', 1_500_000, 0), line('cash', 0, 1_500_000)];
		expect(voucherProblems({ kind: 'journal', date: '2026-11-23', lines }, context())).toEqual([]);
		expect(voucherTotals(lines)).toEqual({ debitPaise: 1_500_000, creditPaise: 1_500_000 });
	});

	it('refuses an unbalanced voucher, two-sided or empty lines, and ledgers it may not use', () => {
		const problems = voucherProblems(
			{
				kind: 'journal',
				date: '2026-11-23',
				lines: [line('rent', 100, 0), line('output_cgst', 0, 50), line('old', 5, 5), line('nope', 0, 0)],
			},
			context(),
		);
		expect(problems).toEqual(
			expect.arrayContaining([
				'unbalanced',
				'line_both_sides',
				'line_zero',
				'ledger_unknown',
				'ledger_inactive',
				'ledger_not_by_hand',
			]),
		);
		// A document may post to a control ledger.
		expect(
			voucherProblems(
				{ kind: 'document', date: '2026-11-23', lines: [line('cash', 105, 0), line('output_cgst', 0, 105)] },
				context({ byHand: false }),
			),
		).toEqual([]);
	});

	it('needs cash or bank on the right side of receipts, payments and contras', () => {
		const rentFromCash = [line('rent', 100, 0), line('cash', 0, 100)];
		expect(voucherProblems({ kind: 'payment', date: '2026-11-23', lines: rentFromCash }, context())).toEqual([]);
		expect(voucherProblems({ kind: 'receipt', date: '2026-11-23', lines: rentFromCash }, context())).toContain(
			'receipt_needs_cash_or_bank_debit',
		);
		expect(voucherProblems({ kind: 'contra', date: '2026-11-23', lines: rentFromCash }, context())).toContain(
			'contra_needs_cash_or_bank',
		);
		const deposit = [line('hdfc', 100, 0), line('cash', 0, 100)];
		expect(voucherProblems({ kind: 'contra', date: '2026-11-23', lines: deposit }, context())).toEqual([]);
	});

	it('follows the month’s lock: closed for staff lets an accounts manager post, locked lets nobody', () => {
		const lines = [line('rent', 100, 0), line('cash', 0, 100)];
		const closed: PeriodLock[] = [
			{ month: '2026-10', part: 'journal', state: 'closed_for_staff', reason: 'Oct done', by: null, at: null },
			{ month: '2026-09', part: 'journal', state: 'locked', reason: 'Filed', by: null, at: null },
		];
		expect(voucherProblems({ kind: 'journal', date: '2026-10-31', lines }, context({ locks: closed }))).toContain(
			'period_closed_for_staff',
		);
		expect(
			voucherProblems(
				{ kind: 'journal', date: '2026-10-31', lines },
				context({ locks: closed, mayPostWhenClosed: true }),
			),
		).toEqual([]);
		expect(
			voucherProblems(
				{ kind: 'journal', date: '2026-09-30', lines },
				context({ locks: closed, mayPostWhenClosed: true }),
			),
		).toContain('period_locked');
		expect(periodStateOf(closed, '2026-11', 'journal')).toBe('open');
	});

	it('names the part of the books a voucher belongs to', () => {
		expect(bookPartOf('journal', ['other'])).toBe('journal');
		expect(bookPartOf('payment', ['other', 'cash'])).toBe('cash');
		expect(bookPartOf('contra', ['cash', 'bank'])).toBe('bank');
		expect(bookPartOf('document', ['other'], 'taxInvoice')).toBe('sales');
		expect(bookPartOf('document', ['other'], 'purchaseEntry')).toBe('purchases');
		expect(ledgerClass(ledger('x', 'g_cash'), groups)).toBe('cash');
	});

	it('refuses a reversal date on or before the voucher date and reverses by swapping sides', () => {
		const lines = [line('rent', 100, 0), line('cash', 0, 100)];
		expect(
			voucherProblems({ kind: 'journal', date: '2026-11-23', reverseOn: '2026-11-23', lines }, context()),
		).toContain('reverse_on_before_date');
		expect(reversalLines({ lines })).toEqual([line('rent', 0, 100), line('cash', 100, 0)]);
	});

	it('runs a ledger statement from its opening balance', () => {
		const statement = ledgerStatement(10_000, [
			{
				voucherId: 'v2',
				number: 'JV/2',
				kind: 'payment',
				date: '2026-11-20',
				narration: '',
				locationId: 'l',
				debitPaise: 0,
				creditPaise: 4_000,
			},
			{
				voucherId: 'v1',
				number: 'RC/1',
				kind: 'receipt',
				date: '2026-11-05',
				narration: '',
				locationId: 'l',
				debitPaise: 2_500,
				creditPaise: 0,
			},
		]);
		expect(statement.rows.map((row) => [row.number, row.balancePaise])).toEqual([
			['RC/1', 12_500],
			['JV/2', 8_500],
		]);
		expect(statement).toMatchObject({ debitPaise: 2_500, creditPaise: 4_000, closingPaise: 8_500 });
		expect(monthsBetween('2026-11', '2027-02')).toEqual(['2026-11', '2026-12', '2027-01', '2027-02']);
	});
});
