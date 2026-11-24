import { describe, expect, it } from 'vitest';

import { YearCloseCheck, YearCloseCheckKey, YearCloseConfirm, YearCloseView } from '../src/ledger';

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

describe('the year-close page', () => {
	const view = {
		year: '2026-27',
		from: '2026-04-01',
		to: '2027-03-31',
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
		};
		expect(YearCloseView.parse(closed)).toEqual(closed);
		refused(YearCloseView.safeParse({ ...view, from: '1 Apr 2026' }).success);
		refused(YearCloseView.safeParse({ ...view, profitPaise: 0.5 }).success);
		refused(YearCloseView.safeParse({ ...view, canClose: undefined }).success);
	});

	it('confirms the accruals, carries suspense with a note trimmed to 300 letters, neither unless asked', () => {
		expect(YearCloseConfirm.parse({})).toEqual({ accruals: false, suspenseNote: null });
		expect(YearCloseConfirm.parse({ accruals: true, suspenseNote: '  Carried to 2027-28 ' })).toEqual({
			accruals: true,
			suspenseNote: 'Carried to 2027-28',
		});
		expect(YearCloseConfirm.parse({ suspenseNote: null }).suspenseNote).toBeNull();
		accepted(YearCloseConfirm.safeParse({ suspenseNote: 'x'.repeat(300) }).success);
		refused(YearCloseConfirm.safeParse({ suspenseNote: 'x'.repeat(301) }).success);
		refused(YearCloseConfirm.safeParse({ accruals: 'yes' }).success);
	});
});
