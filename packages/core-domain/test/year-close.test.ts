import { describe, expect, it } from 'vitest';

import {
	YEAR_CLOSE_KEYS,
	type YearCloseFacts,
	closingLines,
	closingStale,
	yearCloseChecks,
	yearCloseDone,
	yearCloseReady,
	yearSpan,
} from '../src/ledger/year-close';

/**
 * Closing a financial year (accounts brief T3): the ten checks, when the closing entries and the close may go ahead,
 * and the closing voucher that takes each income and expense ledger's year back to nothing, the profit or loss to the
 * Profit and loss account, location by location.
 */

/** Every part of the books in use and done. */
const done: YearCloseFacts = {
	cashOpen: 0,
	banks: { total: 2, reconciled: 2 },
	stockCount: { posted: 3, open: 0 },
	transfersOpen: 0,
	depreciationDue: 0,
	payrollMarchDone: true,
	gst: { needed: 12, filed: 12 },
	suspensePaise: 0,
	suspenseCarried: false,
	accrualsConfirmed: true,
	closing: 'posted',
};
const byKey = (facts: YearCloseFacts) => Object.fromEntries(yearCloseChecks(facts).map((c) => [c.key, c]));

describe('the ten checks', () => {
	it('runs the ten checks in the order drawn', () => {
		expect(YEAR_CLOSE_KEYS).toEqual([
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
		expect(yearCloseChecks(done).map((c) => [c.key, c.state])).toEqual(YEAR_CLOSE_KEYS.map((key) => [key, 'ok']));
	});

	it('shows a part of the books not in use as such', () => {
		const unused = byKey({
			...done,
			cashOpen: null,
			banks: null,
			stockCount: null,
			transfersOpen: null,
			depreciationDue: null,
			payrollMarchDone: null,
			gst: null,
		});
		for (const key of ['cash', 'banks', 'stock_count', 'transfers', 'depreciation', 'payroll', 'gst'])
			expect(unused[key]).toEqual({ key, state: 'not_in_use', count: 0, of: null, amountPaise: null });
	});

	it('asks for attention to cash sheets, transfers and depreciation still open, with how many', () => {
		const open = byKey({ ...done, cashOpen: 2, transfersOpen: 1, depreciationDue: 4 });
		expect(open['cash']).toEqual({ key: 'cash', state: 'attention', count: 2, of: null, amountPaise: null });
		expect(open['transfers']).toMatchObject({ state: 'attention', count: 1 });
		expect(open['depreciation']).toMatchObject({ state: 'attention', count: 4 });
		expect(byKey(done)['cash']).toEqual({ key: 'cash', state: 'ok', count: 0, of: null, amountPaise: null });
	});

	it('counts banks and GST returns as so many of so many, done once all are', () => {
		expect(byKey({ ...done, banks: { total: 3, reconciled: 2 } })['banks']).toEqual({
			key: 'banks',
			state: 'attention',
			count: 2,
			of: 3,
			amountPaise: null,
		});
		expect(byKey({ ...done, banks: { total: 0, reconciled: 0 } })['banks']).toMatchObject({ state: 'ok' });
		expect(byKey({ ...done, gst: { needed: 12, filed: 11 } })['gst']).toMatchObject({
			state: 'attention',
			count: 11,
			of: 12,
		});
		expect(byKey(done)['gst']).toMatchObject({ state: 'ok', count: 12, of: 12 });
	});

	it('wants a stock count posted and none left open', () => {
		expect(byKey(done)['stock_count']).toEqual({
			key: 'stock_count',
			state: 'ok',
			count: 0,
			of: 3,
			amountPaise: null,
		});
		expect(byKey({ ...done, stockCount: { posted: 3, open: 1 } })['stock_count']).toMatchObject({
			state: 'attention',
			count: 1,
			of: 3,
		});
		expect(byKey({ ...done, stockCount: { posted: 0, open: 0 } })['stock_count']).toMatchObject({
			state: 'attention',
			count: 0,
			of: 0,
		});
	});

	it('wants March’s payroll posted and the accruals confirmed', () => {
		expect(byKey({ ...done, payrollMarchDone: false })['payroll']).toMatchObject({ state: 'attention', count: 1 });
		expect(byKey(done)['payroll']).toMatchObject({ state: 'ok', count: 0 });
		expect(byKey({ ...done, accrualsConfirmed: false })['accruals']).toMatchObject({
			state: 'attention',
			count: 1,
		});
	});

	it('warns of money left in suspense unless it is carried with a note', () => {
		expect(byKey({ ...done, suspensePaise: 42_000 })['suspense']).toEqual({
			key: 'suspense',
			state: 'warning',
			count: 0,
			of: null,
			amountPaise: 42_000,
		});
		expect(byKey({ ...done, suspensePaise: 42_000, suspenseCarried: true })['suspense']).toMatchObject({
			state: 'ok',
			amountPaise: 42_000,
		});
		expect(byKey(done)['suspense']).toMatchObject({ state: 'ok', amountPaise: 0 });
	});

	it('wants the closing entries posted, and posted again when the year changed after', () => {
		expect(byKey({ ...done, closing: 'none' })['closing']).toEqual({
			key: 'closing',
			state: 'attention',
			count: 0,
			of: null,
			amountPaise: null,
		});
		expect(byKey({ ...done, closing: 'stale' })['closing']).toMatchObject({ state: 'attention', count: 1 });
		expect(byKey(done)['closing']).toMatchObject({ state: 'ok', count: 0 });
	});
});

describe('how far along the year is, and what may go ahead', () => {
	const example = yearCloseChecks({ ...done, transfersOpen: 1, suspensePaise: 42_000, closing: 'none' });

	it('counts seven of ten done: a transfer open, suspense left and no closing entries yet', () => {
		expect(yearCloseDone(example)).toBe(7);
		expect(yearCloseDone(yearCloseChecks(done))).toBe(10);
		expect(yearCloseDone(yearCloseChecks({ ...done, cashOpen: null, gst: null }))).toBe(10);
	});

	it('holds the closing entries while a transfer is open', () => {
		expect(yearCloseReady(example, 'closing_entries')).toBe(false);
	});

	it('lets the closing entries go ahead with only a suspense warning, but not the close until they are posted', () => {
		const settled = yearCloseChecks({ ...done, suspensePaise: 42_000, closing: 'none' });
		expect(yearCloseReady(settled, 'closing_entries')).toBe(true);
		expect(yearCloseReady(settled, 'close')).toBe(false);
		const posted = yearCloseChecks({ ...done, suspensePaise: 42_000 });
		expect(yearCloseReady(posted, 'close')).toBe(true);
		expect(yearCloseReady(yearCloseChecks({ ...done, closing: 'stale' }), 'close')).toBe(false);
	});
});

describe('the closing voucher', () => {
	const chart = {
		groups: [
			{ id: 'g_sales', parentId: null, nature: 'income' },
			{ id: 'g_exp', parentId: null, nature: 'expense' },
			{ id: 'g_cap', parentId: null, nature: 'liability' },
		],
		ledgers: [
			{ id: 'sales', groupId: 'g_sales' },
			{ id: 'rent', groupId: 'g_exp' },
			{ id: 'pl', groupId: 'g_cap' },
			{ id: 'stray', groupId: 'g_gone' },
		],
	};
	const balances = {
		shop: {
			closing: { sales: -1_000_000, rent: 300_000, pl: -50, stray: 9_999 },
			opening: { sales: -200_000, rent: 100_000 },
		},
		bar: { closing: { rent: 50_000 }, opening: {} },
		godown: { closing: { sales: -10_000 }, opening: { sales: -10_000 } },
	};

	it('takes each income and expense ledger’s year back to nothing at each location, the net to profit and loss', () => {
		expect(closingLines(chart, balances, 'pl')).toEqual({
			lines: [
				// The shop: ₹8,000 of sales against ₹2,000 of rent, a ₹6,000 profit.
				{ ledgerId: 'sales', locationId: 'shop', debitPaise: 800_000 },
				{ ledgerId: 'rent', locationId: 'shop', creditPaise: 200_000 },
				{ ledgerId: 'pl', locationId: 'shop', creditPaise: 600_000 },
				// The bar: ₹500 of rent and nothing sold, a loss.
				{ ledgerId: 'rent', locationId: 'bar', creditPaise: 50_000 },
				{ ledgerId: 'pl', locationId: 'bar', debitPaise: 50_000 },
			],
			profitPaise: 550_000,
		});
	});

	it('balances at each location', () => {
		const { lines } = closingLines(chart, balances, 'pl');
		for (const location of ['shop', 'bar']) {
			const at = lines.filter((l) => l.locationId === location);
			expect(at.reduce((s, l) => s + (l.debitPaise ?? 0), 0)).toBe(
				at.reduce((s, l) => s + (l.creditPaise ?? 0), 0),
			);
		}
	});

	it('closes nothing for a year with no income or expense', () => {
		expect(closingLines(chart, {}, 'pl')).toEqual({ lines: [], profitPaise: 0 });
		expect(closingLines(chart, { godown: balances.godown }, 'pl')).toEqual({ lines: [], profitPaise: 0 });
	});

	it('takes posted closing entries as up to date only while every ledger at every location still matches', () => {
		const { lines } = closingLines(chart, balances, 'pl');
		expect(closingStale(lines, lines)).toBe(false);
		expect(closingStale([...lines].reverse(), lines)).toBe(false);
		expect(closingStale(lines.slice(0, 3), lines)).toBe(true);
		const changed = lines.map((l) =>
			l.ledgerId === 'rent' && l.locationId === 'bar' ? { ...l, creditPaise: 60_000 } : l,
		);
		expect(closingStale(changed, lines)).toBe(true);
		const moved = lines.map((l) => (l.locationId === 'bar' ? { ...l, locationId: 'godown' } : l));
		expect(closingStale(moved, lines)).toBe(true);
		// Two lines on one ledger add up as one.
		const split = [
			...lines.filter((l) => !(l.ledgerId === 'rent' && l.locationId === 'shop')),
			{ ledgerId: 'rent', locationId: 'shop', creditPaise: 150_000 },
			{ ledgerId: 'rent', locationId: 'shop', creditPaise: 50_000 },
		];
		expect(closingStale(split, lines)).toBe(false);
	});
});

describe('the financial year', () => {
	it('runs from 1 April to 31 March, month by month', () => {
		expect(yearSpan('2026-27')).toEqual({
			from: '2026-04-01',
			to: '2027-03-31',
			months: [
				'2026-04',
				'2026-05',
				'2026-06',
				'2026-07',
				'2026-08',
				'2026-09',
				'2026-10',
				'2026-11',
				'2026-12',
				'2027-01',
				'2027-02',
				'2027-03',
			],
		});
	});
});
