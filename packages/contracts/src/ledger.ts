import { z } from 'zod';

import { Id, IsoDateTime } from './common';
import { IsoDate } from './purchasing';

/**
 * The general ledger (accounts brief Q, T, D10; owner-approved 2026-11-23). One set of books per company: every
 * voucher posts balanced debits and credits in the same transaction as its document, and every line carries the
 * location it belongs to and that location's GST registration, stamped when written, never typed.
 *
 * Amounts are whole paise (integers), so sums never drift; screens show rupees.
 */

/** Where a group sits in the statements. */
export const AccountNature = z.enum(['asset', 'liability', 'equity', 'income', 'expense']);
export type AccountNature = z.infer<typeof AccountNature>;

/** A stable name for a group or ledger the system made, used for its translated title and by posting rules. */
export const SystemKey = z.string().regex(/^[a-z][a-z0-9_]{1,59}$/, { message: 'system_key_shape' });

export const AccountGroup = z.object({
	id: Id,
	systemKey: SystemKey.nullable().default(null),
	name: z.string().trim().min(2).max(80),
	parentId: Id.nullable().default(null),
	nature: AccountNature,
	/** Above the gross-profit line: sales, purchases, direct costs and incomes. */
	tradingAccount: z.boolean().default(false),
	order: z.number().int().nonnegative().default(0),
	createdAt: IsoDateTime,
	updatedAt: IsoDateTime,
});
export type AccountGroup = z.infer<typeof AccountGroup>;

export const AccountGroupWrite = AccountGroup.pick({ name: true, parentId: true }).extend({ parentId: Id });
export type AccountGroupWrite = z.infer<typeof AccountGroupWrite>;

export const Ledger = z.object({
	id: Id,
	systemKey: SystemKey.nullable().default(null),
	name: z.string().trim().min(2).max(80),
	groupId: Id,
	nature: AccountNature,
	/**
	 * False for control ledgers that only documents post to (output GST, stock-in-hand, debtors…): a journal
	 * typed by hand can't use them (Q1). Cash and bank stay open to receipts, payments and contras.
	 */
	handPosting: z.boolean().default(true),
	active: z.boolean().default(true),
	createdAt: IsoDateTime,
	updatedAt: IsoDateTime,
	updatedBy: Id.nullable().default(null),
});
export type Ledger = z.infer<typeof Ledger>;

export const LedgerWrite = z.object({
	name: z.string().trim().min(2).max(80),
	groupId: Id,
	active: z.boolean().default(true),
	expectedUpdatedAt: IsoDateTime.nullable().default(null),
});
export type LedgerWrite = z.infer<typeof LedgerWrite>;

export const ChartOfAccounts = z.object({ groups: z.array(AccountGroup), ledgers: z.array(Ledger) });
export type ChartOfAccounts = z.infer<typeof ChartOfAccounts>;

export const Paise = z.number().int().nonnegative().max(1_000_000_000_000);

export const VoucherKind = z.enum(['journal', 'receipt', 'payment', 'contra', 'opening', 'document']);
export type VoucherKind = z.infer<typeof VoucherKind>;
/** The kinds a person types (Q3, Q4); `opening` and `document` are made by the system. */
export const HAND_VOUCHER_KINDS = ['journal', 'receipt', 'payment', 'contra'] as const;

export const JournalLine = z.object({
	ledgerId: Id,
	locationId: Id,
	/** The location's GST registration at posting time; null where the location has none. */
	gstRegistrationId: Id.nullable().default(null),
	debitPaise: Paise.default(0),
	creditPaise: Paise.default(0),
	narration: z.string().trim().max(200).default(''),
});
export type JournalLine = z.infer<typeof JournalLine>;

/** A file kept with a voucher (Q3 Attach): a Media Library file, by id, with the name shown. */
export const VoucherAttachment = z.object({ assetId: Id, name: z.string().trim().min(1).max(200) });
export type VoucherAttachment = z.infer<typeof VoucherAttachment>;

export const JournalVoucher = z.object({
	id: Id,
	number: z.string().min(1),
	kind: VoucherKind,
	/** The day it counts in (India), which decides its period and lock. */
	date: IsoDate,
	narration: z.string().trim().max(500).default(''),
	lines: z.array(JournalLine).min(2).max(500),
	/** The document that posted it (tax invoice, receipt, set-off…), when not typed by hand. */
	source: z
		.object({ type: z.string().min(1), id: Id, number: z.string().nullable().default(null) })
		.nullable()
		.default(null),
	reversalOfId: Id.nullable().default(null),
	reversedById: Id.nullable().default(null),
	/** A journal that undoes itself on this day (accruals, Q3). */
	reverseOn: IsoDate.nullable().default(null),
	/** Posting the same key again returns the first voucher instead of a second one. */
	idempotencyKey: z.string().min(8).max(120).nullable().default(null),
	attachments: z.array(VoucherAttachment).max(20).default([]),
	totalPaise: Paise,
	createdBy: Id.nullable().default(null),
	createdAt: IsoDateTime,
});
export type JournalVoucher = z.infer<typeof JournalVoucher>;

/** A voucher typed by hand (Q3 journal; Q4 receipt, payment, contra). */
export const JournalVoucherWrite = z.object({
	kind: z.enum(HAND_VOUCHER_KINDS),
	date: IsoDate,
	narration: z.string().trim().max(500).default(''),
	lines: z
		.array(
			JournalLine.pick({
				ledgerId: true,
				locationId: true,
				debitPaise: true,
				creditPaise: true,
				narration: true,
			}),
		)
		.min(2)
		.max(100),
	reverseOn: IsoDate.nullable().default(null),
	attachments: z.array(VoucherAttachment).max(20).default([]),
	/** Made by the form once, so a double click or a retry never posts twice. */
	idempotencyKey: z.string().min(8).max(120),
	/** Posted from a saved draft: the draft goes in the same transaction. */
	draftId: Id.nullable().default(null),
});
export type JournalVoucherWrite = z.infer<typeof JournalVoucherWrite>;

export const VoucherReverse = z.object({
	date: IsoDate,
	reason: z.string().trim().min(5).max(300),
	idempotencyKey: z.string().min(8).max(120),
});
export type VoucherReverse = z.infer<typeof VoucherReverse>;

/** Why a voucher can't be posted (shared by the API and the form). */
export const VoucherProblem = z.enum([
	'unbalanced',
	'empty',
	'line_both_sides',
	'line_zero',
	'ledger_unknown',
	'ledger_inactive',
	'ledger_not_by_hand',
	'location_unknown',
	'period_locked',
	'period_closed_for_staff',
	'reverse_on_before_date',
	'contra_needs_cash_or_bank',
	'receipt_needs_cash_or_bank_debit',
	'payment_needs_cash_or_bank_credit',
	'already_reversed',
]);
export type VoucherProblem = z.infer<typeof VoucherProblem>;

export const AccountStatementQuery = z.object({
	from: IsoDate,
	to: IsoDate,
	locationIds: z.array(Id).max(200).default([]),
});
export type AccountStatementQuery = z.infer<typeof AccountStatementQuery>;

export const AccountStatementRow = z.object({
	voucherId: Id,
	number: z.string(),
	kind: VoucherKind,
	date: IsoDate,
	narration: z.string(),
	locationId: Id,
	debitPaise: Paise,
	creditPaise: Paise,
	/** Debit positive, credit negative. */
	balancePaise: z.number().int(),
});
export type AccountStatementRow = z.infer<typeof AccountStatementRow>;

export const AccountStatement = z.object({
	ledger: Ledger,
	from: IsoDate,
	to: IsoDate,
	openingPaise: z.number().int(),
	rows: z.array(AccountStatementRow),
	debitPaise: Paise,
	creditPaise: Paise,
	closingPaise: z.number().int(),
});
export type AccountStatement = z.infer<typeof AccountStatement>;

/** The parts of the books a month can be closed or locked for, one by one (T1, T2). */
export const BookPart = z.enum(['sales', 'purchases', 'stock', 'cash', 'bank', 'journal', 'payroll']);
export type BookPart = z.infer<typeof BookPart>;
export const BOOK_PARTS = BookPart.options;

/** Open; closed for staff (an accounts manager may still post, with a reason); locked for everyone. */
export const PeriodState = z.enum(['open', 'closed_for_staff', 'locked']);
export type PeriodState = z.infer<typeof PeriodState>;

export const YearMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'month_shape' });

export const PeriodLock = z.object({
	month: YearMonth,
	part: BookPart,
	state: PeriodState,
	reason: z.string().default(''),
	by: Id.nullable().default(null),
	at: IsoDateTime.nullable().default(null),
});
export type PeriodLock = z.infer<typeof PeriodLock>;

export const PeriodLockWrite = z.object({
	months: z.array(YearMonth).min(1).max(24),
	parts: z.array(BookPart).min(1),
	state: PeriodState,
	reason: z.string().trim().min(5).max(300),
});
export type PeriodLockWrite = z.infer<typeof PeriodLockWrite>;

/** Someone is editing a document; others are told who (D10). */
export const DocumentLock = z.object({
	documentType: z.string().min(1).max(60),
	documentId: Id,
	holderId: Id,
	holderName: z.string(),
	since: IsoDateTime,
	lastActiveAt: IsoDateTime,
});
export type DocumentLock = z.infer<typeof DocumentLock>;

/** Accounts › Vouchers list (A: period presets, kinds, search). */
export const VoucherListQuery = z.object({
	from: IsoDate,
	to: IsoDate,
	kinds: z
		.union([VoucherKind, z.array(VoucherKind)])
		.transform((value) => (Array.isArray(value) ? value : [value]))
		.default([]),
	search: z.string().trim().max(80).default(''),
	page: z.coerce.number().int().min(1).default(1),
	pageSize: z.coerce.number().int().min(1).max(200).default(25),
});
export type VoucherListQuery = z.infer<typeof VoucherListQuery>;

export const VoucherPage = z.object({
	items: z.array(JournalVoucher),
	total: z.number().int().nonnegative(),
	page: z.number().int(),
	pageSize: z.number().int(),
});
export type VoucherPage = z.infer<typeof VoucherPage>;

/** Q2's query string: one or several locations, or none for all the person may see. */
export const AccountStatementSearch = z.object({
	from: IsoDate,
	to: IsoDate,
	locationIds: z
		.union([Id, z.array(Id)])
		.transform((value) => (Array.isArray(value) ? value : [value]))
		.default([]),
});

export const PeriodGrid = z.object({ months: z.array(YearMonth), locks: z.array(PeriodLock) });
export type PeriodGrid = z.infer<typeof PeriodGrid>;

/** The document a lock is about (D10). */
export const DocumentLockTarget = z.object({
	documentType: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{1,59}$/),
	documentId: Id,
});
export type DocumentLockTarget = z.infer<typeof DocumentLockTarget>;

/** Q1's balances on a day. */
export const BalancesQuery = z.object({ on: IsoDate });
export type BalancesQuery = z.infer<typeof BalancesQuery>;

/** A draft line may be half filled: Save draft keeps whatever is typed; Post checks it all (Q3). */
export const VoucherDraftLine = z.object({
	ledgerId: z.string().max(80).default(''),
	locationId: z.string().max(80).default(''),
	debitPaise: Paise.default(0),
	creditPaise: Paise.default(0),
	narration: z.string().trim().max(200).default(''),
});
export type VoucherDraftLine = z.infer<typeof VoucherDraftLine>;

/** Q3 Save draft: a voucher not yet posted, with no number; anyone who may post can open and finish it. */
export const VoucherDraft = z.object({
	id: Id,
	kind: z.enum(HAND_VOUCHER_KINDS),
	date: IsoDate,
	narration: z.string().trim().max(500).default(''),
	lines: z.array(VoucherDraftLine).max(100).default([]),
	reverseOn: IsoDate.nullable().default(null),
	attachments: z.array(VoucherAttachment).max(20).default([]),
	createdBy: Id.nullable().default(null),
	createdByName: z.string().default(''),
	createdAt: IsoDateTime,
	updatedAt: IsoDateTime,
	updatedBy: Id.nullable().default(null),
});
export type VoucherDraft = z.infer<typeof VoucherDraft>;

export const VoucherDraftWrite = VoucherDraft.pick({
	kind: true,
	date: true,
	narration: true,
	lines: true,
	reverseOn: true,
	attachments: true,
}).extend({ expectedUpdatedAt: IsoDateTime.nullable().default(null) });
export type VoucherDraftWrite = z.infer<typeof VoucherDraftWrite>;

/** A voucher as its page reads it: with each attachment's link. */
export const VoucherDetail = JournalVoucher.extend({
	attachmentLinks: z.array(VoucherAttachment.extend({ url: z.string().nullable() })).default([]),
});
export type VoucherDetail = z.infer<typeof VoucherDetail>;

/**
 * T2's checks before a month is locked. Each says whether something in that month still needs doing; a lock may
 * go ahead anyway, as drawn. A check whose feature is not built yet says so (`not_in_use`) instead of passing.
 */
export const PeriodCheckKey = z.enum([
	'cash_sheets',
	'transfers',
	'depreciation',
	'payroll',
	'drafts',
	'reversals',
	'stock_counts',
	'stock_approvals',
]);
export type PeriodCheckKey = z.infer<typeof PeriodCheckKey>;

export const PeriodCheck = z.object({
	key: PeriodCheckKey,
	state: z.enum(['ok', 'attention', 'not_in_use']),
	count: z.number().int().nonnegative().default(0),
});
export type PeriodCheck = z.infer<typeof PeriodCheck>;

export const PeriodChecksQuery = z.object({ month: YearMonth });
