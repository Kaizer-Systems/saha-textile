import { z } from 'zod';

import { Id } from './common';
import { IsoDate } from './purchasing';

/**
 * Accounts › Vouchers, Day book (accounts brief A1–A9, A3): every document of the books in one shape, so each tab and
 * the Day book are the same table. Cells a tab shows beyond the shared ones travel in `extra`.
 */

/** The tabs of Accounts › Vouchers, in the order A1 draws them. */
export const AccountsListTab = z.enum([
	'receipts',
	'paymentVouchers',
	'contra',
	'journal',
	'creditNotes',
	'debitNotes',
	'refundVouchers',
	'selfInvoices',
	'stockAdjustments',
]);
export type AccountsListTab = z.infer<typeof AccountsListTab>;

/** The chips each tab offers (the first is "All"). */
export const ACCOUNTS_LIST_CHIPS: Readonly<Record<AccountsListTab, readonly string[]>> = {
	receipts: ['all', 'against_orders', 'on_account', 'refunded'],
	paymentVouchers: ['all', 'reverse_charge', 'supplier_bills', 'cancelled'],
	contra: ['all'],
	journal: ['all', 'set_offs', 'reversals', 'itc_reversed'],
	creditNotes: ['all', 'drafts', 'waiting_for_buyer', 'issued', 'cancelled'],
	debitNotes: ['all'],
	refundVouchers: ['all', 'refunded', 'waiting_for_gateway', 'failed'],
	selfInvoices: ['all', 'drafts', 'due_soon', 'unpaid', 'paid'],
	stockAdjustments: ['all', 'waiting', 'posted', 'reversed'],
};

/** The Day book's chips (A3): every voucher, or one kind of them. */
export const DAY_BOOK_CHIPS = [
	'all',
	'receipts',
	'refunds',
	'creditNotes',
	'payments',
	'selfInvoices',
	'journals',
	'stockAdjustments',
] as const;
export const DayBookChip = z.enum(DAY_BOOK_CHIPS);
export type DayBookChip = z.infer<typeof DayBookChip>;

export const AccountsListQuery = z
	.object({
		from: IsoDate,
		to: IsoDate,
		chip: z.string().trim().max(40).default('all'),
		/** Stock adjustments: one reason (A9 "Every reason"). */
		reason: z.string().trim().max(40).nullable().default(null),
		search: z.string().trim().max(80).default(''),
		page: z.coerce.number().int().min(1).default(1),
		pageSize: z.coerce.number().int().min(1).max(100).default(25),
	})
	.refine((query) => query.from <= query.to, { message: 'period_backwards', path: ['from'] });
export type AccountsListQuery = z.infer<typeof AccountsListQuery>;

/** One document as a list row; amounts in rupees, `by` and `approvedBy` as names. */
export const AccountsListRow = z.object({
	id: Id,
	tab: AccountsListTab,
	/** Null while a draft or a request waits for its number. */
	number: z.string().nullable(),
	date: IsoDate,
	party: z.string().nullable(),
	/** The invoice, order, receipt or item it is against or about. */
	against: z.string().nullable(),
	/** What kind of it this is: a method, a reason or a journal kind, as a code the admin words. */
	detail: z.string().nullable(),
	reference: z.string().nullable(),
	amountINR: z.number().nullable(),
	/** Day book: money in and out, and the stock change in stock units (pieces, or tenths of a metre). */
	moneyInINR: z.number().nullable(),
	moneyOutINR: z.number().nullable(),
	stock: z.number().int().nullable(),
	soldBy: z.enum(['piece', 'metre']).nullable(),
	by: z.string().nullable(),
	approvedBy: z.string().nullable(),
	/** A code the admin words: issued, draft, posted, paid, refunded… */
	status: z.string(),
	extra: z.record(z.string(), z.union([z.string(), z.number(), z.null()])).default({}),
});
export type AccountsListRow = z.infer<typeof AccountsListRow>;

export const AccountsListPage = z.object({
	items: z.array(AccountsListRow),
	total: z.number().int().nonnegative(),
	/** How many rows each chip holds over the same period and search. */
	counts: z.record(z.string(), z.number().int().nonnegative()),
	/** Figures for the period above the table (A1: taxable issued, tax reversed, count). */
	totals: z.record(z.string(), z.number()).default({}),
});
export type AccountsListPage = z.infer<typeof AccountsListPage>;

/** Print the picked documents of one tab as one file (A1 picks bar). */
export const AccountsPrintWrite = z.object({ ids: z.array(Id).min(1).max(50) });
export type AccountsPrintWrite = z.infer<typeof AccountsPrintWrite>;
