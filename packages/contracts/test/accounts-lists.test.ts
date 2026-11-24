import { describe, expect, it } from 'vitest';

import {
	ACCOUNTS_LIST_CHIPS,
	AccountsListPage,
	AccountsListQuery,
	AccountsListTab,
	AccountsPrintWrite,
	DayBookChip,
} from '../src/accounts-lists';

/** Accounts › Vouchers and the Day book (accounts brief A1–A9, A3). */
describe('accounts lists contracts', () => {
	it('reads a period, a chip and a page, and refuses a period that runs backwards', () => {
		expect(AccountsListQuery.parse({ from: '2026-11-01', to: '2026-11-30', page: '2' })).toEqual({
			from: '2026-11-01',
			to: '2026-11-30',
			chip: 'all',
			reason: null,
			search: '',
			page: 2,
			pageSize: 25,
		});
		expect(AccountsListQuery.safeParse({ from: '2026-12-01', to: '2026-11-30' }).success).toBe(false);
	});

	it('names a chip list for every tab, the Day book’s chips, and a page of rows', () => {
		expect(Object.keys(ACCOUNTS_LIST_CHIPS)).toEqual(AccountsListTab.options);
		expect(Object.values(ACCOUNTS_LIST_CHIPS).every((chips) => chips[0] === 'all')).toBe(true);
		expect(DayBookChip.parse('journals')).toBe('journals');
		expect(AccountsListPage.parse({ items: [], total: 0, counts: { all: 0 } }).totals).toEqual({});
		expect(AccountsPrintWrite.safeParse({ ids: [] }).success).toBe(false);
	});
});
