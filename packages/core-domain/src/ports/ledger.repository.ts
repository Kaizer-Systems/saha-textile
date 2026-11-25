import type {
	AccountGroup,
	ChartOfAccounts,
	DocumentLock,
	GstReturnFiling,
	JournalVoucher,
	Ledger,
	PeriodLock,
	VoucherDraft,
	VoucherKind,
	BooksImport,
	ExpenseBill,
	ExpenseBillStatus,
} from '@saha-textile/contracts';

import type { StatementLine } from '../ledger/ledger-rules';
import type { TransactionContext } from './transaction-manager.port';

/**
 * The general ledger's storage (accounts brief Q, T, D10). Vouchers and their lines are written in the caller's
 * transaction with the document that posts them; nothing here edits or deletes a posted line.
 */
export interface GeneralLedgerRepository {
	chart(): Promise<ChartOfAccounts>;
	/** First run only: writes the starting chart when there is none (a second call changes nothing). */
	seedChart(chart: ChartOfAccounts): Promise<boolean>;
	saveGroup(group: AccountGroup): Promise<void>;
	/** Refused with `StaleRevisionError` when `expectedUpdatedAt` no longer matches. */
	saveLedger(ledger: Ledger, expectedUpdatedAt: string | null): Promise<void>;
	findVoucherByKey(idempotencyKey: string, context?: TransactionContext): Promise<JournalVoucher | null>;
	/** Writes the voucher and one line row per line; a repeated idempotency key throws `duplicate_voucher_key`. */
	insertVoucher(voucher: JournalVoucher, context?: TransactionContext): Promise<void>;
	markReversed(voucherId: string, reversedById: string, context?: TransactionContext): Promise<void>;
	getVoucher(id: string): Promise<JournalVoucher | null>;
	listVouchers(query: {
		from: string;
		to: string;
		kinds: readonly VoucherKind[];
		search: string;
		page: number;
		pageSize: number;
	}): Promise<{ items: JournalVoucher[]; total: number }>;
	/** Debit minus credit of a ledger before a day, at some locations (all when empty). */
	balanceBefore(ledgerId: string, day: string, locationIds: readonly string[]): Promise<number>;
	statementLines(
		ledgerId: string,
		from: string,
		to: string,
		locationIds: readonly string[],
	): Promise<StatementLine[]>;
	/** Debit minus credit of every ledger up to and including a day (Q1 balances), at some locations (all when empty). */
	/** Year-closing entries (T3) never count here, so every report reads a closed year as it was. */
	balancesAt(day: string, locationIds: readonly string[]): Promise<Record<string, number>>;
	/** Vouchers set to undo themselves on or before a day and not yet reversed (Q3 reversal date). */
	dueReversals(day: string): Promise<JournalVoucher[]>;
	/** Whether any posted line uses the ledger (a used ledger is switched off, never removed). */
	ledgerInUse(ledgerId: string): Promise<boolean>;
	/** Q3 drafts: not posted, no number. */
	listDrafts(): Promise<VoucherDraft[]>;
	getDraft(id: string): Promise<VoucherDraft | null>;
	/** Refused with `StaleRevisionError` when `expectedUpdatedAt` no longer matches (null = a new draft). */
	saveDraft(draft: VoucherDraft, expectedUpdatedAt: string | null): Promise<void>;
	deleteDraft(id: string, context?: TransactionContext): Promise<void>;
}

export interface PeriodLockRepository {
	list(): Promise<PeriodLock[]>;
	save(locks: readonly PeriodLock[]): Promise<void>;
}

/** Who takes a document: a lock as claimed, before anyone asks its holder to let it go. */
export type DocumentLockClaim = Omit<DocumentLock, 'releaseAskedBy' | 'releaseAskedAt'>;

export interface DocumentLockRepository {
	get(documentType: string, documentId: string): Promise<DocumentLock | null>;
	/**
	 * Takes the lock when it is free, stale (last active before `staleBefore`) or already held by this person;
	 * otherwise returns the holder's lock unchanged. Atomic.
	 */
	acquire(lock: DocumentLockClaim, staleBefore: string): Promise<DocumentLock>;
	/** Moves the lock to another person regardless of the holder (a take-over, logged by the caller). */
	takeOver(lock: DocumentLockClaim): Promise<DocumentLock>;
	touch(documentType: string, documentId: string, holderId: string, at: string): Promise<boolean>;
	release(documentType: string, documentId: string, holderId: string): Promise<void>;
	/** B7: records that someone asked the holder to let it go; false when nobody holds it. */
	askRelease(documentType: string, documentId: string, askedBy: string, at: string): Promise<boolean>;
}

/** Returns marked filed (G8): one per GSTIN, return and month. */
export interface GstReturnRepository {
	list(): Promise<GstReturnFiling[]>;
	/** Refused with `duplicate_gst_filing` when that return is already marked filed. */
	insert(filing: GstReturnFiling): Promise<void>;
}

/** Where money lands (approved 24 Nov, AP-D1): one setting; a save refused with `money_landing_changed` when stale. */
export interface MoneyLandingRepository {
	get(): Promise<import('@saha-textile/contracts').MoneyLanding>;
	save(landing: import('@saha-textile/contracts').MoneyLanding, expectedUpdatedAt: string | null): Promise<void>;
}

/** T3: a financial year's close, one record per year (`2026-27`). */
export interface YearCloseRecord {
	year: string;
	accrualsConfirmedBy: string | null;
	accrualsConfirmedAt: string | null;
	suspenseNote: string | null;
	closingVoucherId: string | null;
	profitPaise: number | null;
	/** YC1: where the profit goes (null: the kind's default), the voucher that moved it, and the choice it posted. */
	profitChoice?: import('@saha-textile/contracts').ProfitChoice | null;
	profitVoucherId?: string | null;
	postedChoice?: string | null;
	closedBy: string | null;
	closedAt: string | null;
	updatedAt: string;
}

/** I1: books brought in from another program, each undoable until a new entry is posted. */
export interface BooksImportRepository {
	list(): Promise<(BooksImport & { vouchersAtImport: number })[]>;
	get(id: string): Promise<(BooksImport & { vouchersAtImport: number }) | null>;
	save(entry: BooksImport & { vouchersAtImport: number }): Promise<void>;
}

export interface YearCloseRepository {
	get(year: string): Promise<YearCloseRecord | null>;
	save(record: YearCloseRecord): Promise<void>;
}

/** Brief 25 EB1: bills for services and expenses; saving checks the version read (a draft edited twice). */
export interface ExpenseBillRepository {
	/** Newest bill first; `from` and `to` bound the bill date (both inclusive). */
	list(query: {
		supplierId?: string;
		status?: ExpenseBillStatus;
		from?: string;
		to?: string;
	}): Promise<ExpenseBill[]>;
	get(id: string): Promise<ExpenseBill | null>;
	/** Refused with `expense_bill_changed` when the stored version isn't `expectedVersion` (null: a new bill). */
	save(bill: ExpenseBill, expectedVersion: number | null, context?: TransactionContext): Promise<ExpenseBill>;
}
