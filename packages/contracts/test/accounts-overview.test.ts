import { describe, expect, it } from 'vitest';

import { AccountsOverview, AccountsOverviewQuery, OverviewWaiting } from '../src/accounts-lists';

/** Accounts › Overview (accounts brief Q0): the month asked for, the cards and what is waiting for someone. */

const overview = {
	month: '2026-11',
	cashPaise: 882_400,
	cashLedgers: 2,
	cashBoxes: 1,
	bankPaise: 43_438_800,
	bankNames: ['HDFC Bank · Barasat'],
	customersPaise: 9_950_000,
	suppliersPaise: 41_000_000,
	gstPaise: 300_000,
	gstDueOn: '2026-12-20',
	monthLocked: false,
	lastLocked: '2026-10',
	profitPaise: 7_500_000,
	profitTo: '2026-11-24',
	stockPaise: 572_120_000,
	inTransitPaise: 4_620_000,
	waiting: [{ kind: 'bankLinesToMatch', count: 12 }],
};

describe('the accounts overview', () => {
	it('reads a month as YYYY-MM, or none for this month', () => {
		expect(AccountsOverviewQuery.parse({})).toEqual({});
		expect(AccountsOverviewQuery.parse({ month: '2026-11' })).toEqual({ month: '2026-11' });
		expect(AccountsOverviewQuery.safeParse({ month: '2026-13' }).success).toBe(false);
		expect(AccountsOverviewQuery.safeParse({ month: '2026-1' }).success).toBe(false);
	});

	it('waits on bank lines to match and gateway payments in no payout, beside the vouchers, cash and claims', () => {
		expect(OverviewWaiting.shape.kind.options).toEqual([
			'voucherDrafts',
			'creditNoteDrafts',
			'selfInvoicesDue',
			'adjustmentsWaiting',
			'refundsFailed',
			'cashDifferences',
			'expenseClaims',
			'bankLinesToMatch',
			'paymentsNotInPayout',
		]);
		expect(OverviewWaiting.parse({ kind: 'paymentsNotInPayout', count: 3 })).toEqual({
			kind: 'paymentsNotInPayout',
			count: 3,
		});
		expect(OverviewWaiting.safeParse({ kind: 'bankLines', count: 3 }).success).toBe(false);
	});

	it('lists only what has something waiting: a count of at least one, whole', () => {
		expect(OverviewWaiting.safeParse({ kind: 'bankLinesToMatch', count: 0 }).success).toBe(false);
		expect(OverviewWaiting.safeParse({ kind: 'bankLinesToMatch', count: 1.5 }).success).toBe(false);
	});

	it('shows no cash on delivery held when the answer leaves it out, and what the couriers hold when it says', () => {
		expect(AccountsOverview.parse(overview).codPaise).toBe(0);
		expect(AccountsOverview.parse({ ...overview, codPaise: 1_869_500 }).codPaise).toBe(1_869_500);
		expect(AccountsOverview.parse({ ...overview, codPaise: -200_000 }).codPaise).toBe(-200_000);
		expect(AccountsOverview.safeParse({ ...overview, codPaise: '1869500' }).success).toBe(false);
	});

	it('keeps the rest of the cards as given, and refuses a waiting item it does not know', () => {
		expect(AccountsOverview.parse(overview)).toEqual({ ...overview, codPaise: 0 });
		expect(AccountsOverview.parse({ ...overview, lastLocked: null, waiting: [] })).toMatchObject({
			lastLocked: null,
			waiting: [],
		});
		expect(AccountsOverview.safeParse({ ...overview, waiting: [{ kind: 'bankLines', count: 1 }] }).success).toBe(
			false,
		);
		expect(AccountsOverview.safeParse({ ...overview, cashBoxes: -1 }).success).toBe(false);
		expect(AccountsOverview.safeParse({ ...overview, gstDueOn: '20/12/2026' }).success).toBe(false);
	});
});
