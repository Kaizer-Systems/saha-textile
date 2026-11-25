import { describe, expect, it } from 'vitest';

import {
	ProfitChoice,
	ProfitChoiceOption,
	ProfitPlan,
	ProfitShareRow,
	YearCloseCheck,
	YearCloseCheckKey,
	YearCloseConfirm,
	YearCloseView,
} from '../src/ledger';

/** Closing a financial year (accounts brief T3): the checks, the page and its two confirmations. */

const accepted = (input: unknown) => expect(input).toBe(true);
const refused = (input: unknown) => expect(input).toBe(false);

describe('the year-end checks', () => {
	it('names the ten checks', () => {
		expect(YearCloseCheckKey.options).toEqual([
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
		]);
	});

	it('keeps a check’s state, its count, out of how many, and an amount where one applies', () => {
		const banks = { key: 'banks', state: 'attention', count: 2, of: 3, amountPaise: null };
		expect(YearCloseCheck.parse(banks)).toEqual(banks);
		accepted(
			YearCloseCheck.safeParse({ key: 'suspense', state: 'warning', count: 0, of: null, amountPaise: 42_000 })
				.success,
		);
		accepted(YearCloseCheck.safeParse({ ...banks, state: 'not_in_use' }).success);
		refused(YearCloseCheck.safeParse({ ...banks, state: 'skipped' }).success);
		refused(YearCloseCheck.safeParse({ ...banks, key: 'payslips' }).success);
		refused(YearCloseCheck.safeParse({ ...banks, count: 1.5 }).success);
		refused(YearCloseCheck.safeParse({ ...banks, amountPaise: 0.5 }).success);
	});
});

const view = {
	year: '2026-27',
	from: '2026-04-01',
	to: '2027-03-31',
	kind: 'proprietorship',
	profitChoice: { option: 'to_capital', reserveBasis: 'percent', reserveValue: 0 },
	profitChoices: ['keep', 'to_capital', 'to_capital_keep_drawings'],
	profitPlan: null,
	profitVoucherId: null,
	checks: [{ key: 'closing', state: 'attention', count: 0, of: null, amountPaise: null }],
	done: 7,
	canPostClosing: false,
	canClose: false,
	closingVoucherId: null,
	profitPaise: null,
	suspenseNote: null,
	accrualsConfirmedAt: null,
	closedAt: null,
	closedBy: null,
};

describe('the year-close page', () => {
	it('shows the year, its checks, what may go ahead, and the close once made', () => {
		expect(YearCloseView.parse(view)).toEqual(view);
		const closed = {
			...view,
			done: 10,
			canPostClosing: true,
			canClose: true,
			closingVoucherId: 'vch_close_2627',
			profitPaise: 550_000,
			suspenseNote: 'Carried: unexplained deposit, HDFC, 12 March',
			accrualsConfirmedAt: '2027-04-10T05:00:00.000Z',
			closedAt: '2027-04-12T05:00:00.000Z',
			closedBy: 'adm_owner',
			profitVoucherId: 'vch_profit_2627',
		};
		expect(YearCloseView.parse(closed)).toEqual(closed);
		refused(YearCloseView.safeParse({ ...view, from: '1 Apr 2026' }).success);
		refused(YearCloseView.safeParse({ ...view, profitPaise: 0.5 }).success);
		refused(YearCloseView.safeParse({ ...view, canClose: undefined }).success);
		refused(YearCloseView.safeParse({ ...view, kind: 'public_limited' }).success);
		refused(YearCloseView.safeParse({ ...view, profitChoices: ['to_reserve'] }).success);
		refused(YearCloseView.safeParse({ ...view, profitPlan: undefined }).success);
	});

	it('confirms the accruals, carries suspense with a note trimmed to 300 letters, neither unless asked', () => {
		expect(YearCloseConfirm.parse({})).toEqual({ accruals: false, suspenseNote: null, profitChoice: null });
		expect(YearCloseConfirm.parse({ accruals: true, suspenseNote: '  Carried to 2027-28 ' })).toEqual({
			accruals: true,
			suspenseNote: 'Carried to 2027-28',
			profitChoice: null,
		});
		expect(YearCloseConfirm.parse({ suspenseNote: null }).suspenseNote).toBeNull();
		accepted(YearCloseConfirm.safeParse({ suspenseNote: 'x'.repeat(300) }).success);
		refused(YearCloseConfirm.safeParse({ suspenseNote: 'x'.repeat(301) }).success);
		refused(YearCloseConfirm.safeParse({ accruals: 'yes' }).success);
	});
});

describe('where the year’s profit goes (brief 25 YC1–YC3)', () => {
	it('offers keeping it, to capital with or without drawings, the deed, the ratio only, or general reserve', () => {
		expect(ProfitChoiceOption.options).toEqual([
			'keep',
			'to_capital',
			'to_capital_keep_drawings',
			'deed',
			'ratio_only',
			'to_general_reserve',
		]);
		refused(ProfitChoiceOption.safeParse('to_reserve').success);
	});

	it('keeps a reserve as a % of the profit unless an amount is chosen, never below nothing', () => {
		expect(ProfitChoice.parse({ option: 'keep' })).toEqual({
			option: 'keep',
			reserveBasis: 'percent',
			reserveValue: 0,
		});
		const amount = { option: 'to_general_reserve', reserveBasis: 'amount', reserveValue: 50_000.5 };
		expect(ProfitChoice.parse(amount)).toEqual(amount);
		accepted(ProfitChoice.safeParse({ ...amount, reserveValue: 1e12 }).success);
		refused(ProfitChoice.safeParse({ ...amount, reserveValue: 1e12 + 1 }).success);
		refused(ProfitChoice.safeParse({ ...amount, reserveValue: -1 }).success);
		refused(ProfitChoice.safeParse({ ...amount, reserveBasis: 'share' }).success);
		expect(YearCloseConfirm.parse({ profitChoice: { option: 'deed' } }).profitChoice).toEqual({
			option: 'deed',
			reserveBasis: 'percent',
			reserveValue: 0,
		});
		refused(YearCloseConfirm.safeParse({ profitChoice: { option: 'share' } }).success);
	});

	// The brief's YC3 firm: ₹18,00,000 shared, Arindam's line.
	const arindam = {
		partnerId: 'p_a',
		name: 'Arindam',
		sharePercent: 60,
		interestPaise: 12_000_000,
		interestAllowedPaise: 12_000_000,
		remunerationPaise: 72_000_000,
		sharePaise: 25_200_000,
		totalPaise: 109_200_000,
		tdsPaise: 8_400_000,
	};
	const plan = {
		option: 'deed',
		profitPaise: 180_000_000,
		rows: [arindam],
		bookProfitPaise: 162_000_000,
		remunerationLimitPaise: 115_200_000,
		remunerationDisallowedPaise: 4_800_000,
		interestDisallowedPaise: 0,
		chargesApplied: true,
		drawingsPaise: 0,
		capitalAfterPaise: null,
		reservePaise: 0,
		lines: [
			{
				ledgerName: "Partners' remuneration",
				debitPaise: 72_000_000,
				creditPaise: 0,
				narration: 'Remuneration: Arindam',
			},
		],
		problems: [],
	};

	it('shows a firm’s sharing line by line, a loss signed, with the s.40(b) figures', () => {
		expect(ProfitShareRow.parse(arindam)).toEqual(arindam);
		const loss = { ...arindam, sharePaise: -17_520_000, totalPaise: -5_520_000 };
		expect(ProfitShareRow.parse(loss)).toEqual(loss);
		refused(ProfitShareRow.safeParse({ ...arindam, interestPaise: 0.5 }).success);
		expect(YearCloseView.parse({ ...view, kind: 'partnership', profitPlan: plan }).profitPlan).toEqual(plan);
	});

	it('leaves the firm’s figures empty for a proprietor or a company, and names the plan’s problems', () => {
		const proprietor = {
			...plan,
			option: 'to_capital',
			rows: [],
			bookProfitPaise: null,
			remunerationLimitPaise: null,
			remunerationDisallowedPaise: 0,
			chargesApplied: false,
			drawingsPaise: 31_000_000,
			capitalAfterPaise: 89_500_000,
			problems: ['partners_missing'],
		};
		expect(ProfitPlan.parse(proprietor)).toEqual(proprietor);
		refused(ProfitPlan.safeParse({ ...plan, option: 'share' }).success);
		refused(ProfitPlan.safeParse({ ...plan, reservePaise: 0.5 }).success);
		refused(ProfitPlan.safeParse({ ...plan, lines: [{ ledgerName: 'x', debitPaise: 1 }] }).success);
	});
});
