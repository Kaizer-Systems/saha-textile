import type { AccountsListPage, AccountsListQuery, AccountsListTab } from '@saha-textile/contracts';

/**
 * Accounts › Vouchers and the Day book (accounts brief A1–A9, A3): every document of the books read as list rows, one
 * tab at a time or every kind together by date. A read model over the documents' own collections; `by` and
 * `approvedBy` come back as user ids for the caller to name.
 */
export interface AccountsListsReader {
	list(tab: AccountsListTab, query: AccountsListQuery, today: string): Promise<AccountsListPage>;
	/** Every issued or posted voucher by date; `query.chip` is a Day book chip. */
	dayBook(query: AccountsListQuery): Promise<AccountsListPage>;
}
