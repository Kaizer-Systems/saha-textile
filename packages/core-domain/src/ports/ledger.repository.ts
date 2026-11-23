import type {
	AccountGroup,
	ChartOfAccounts,
	DocumentLock,
	JournalVoucher,
	Ledger,
	PeriodLock,
	VoucherKind,
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
	/** Vouchers set to undo themselves on or before a day and not yet reversed (Q3 reversal date). */
	dueReversals(day: string): Promise<JournalVoucher[]>;
	/** Whether any posted line uses the ledger (a used ledger is switched off, never removed). */
	ledgerInUse(ledgerId: string): Promise<boolean>;
}

export interface PeriodLockRepository {
	list(): Promise<PeriodLock[]>;
	save(locks: readonly PeriodLock[]): Promise<void>;
}

export interface DocumentLockRepository {
	get(documentType: string, documentId: string): Promise<DocumentLock | null>;
	/**
	 * Takes the lock when it is free, stale (last active before `staleBefore`) or already held by this person;
	 * otherwise returns the holder's lock unchanged. Atomic.
	 */
	acquire(lock: DocumentLock, staleBefore: string): Promise<DocumentLock>;
	/** Moves the lock to another person regardless of the holder (a take-over, logged by the caller). */
	takeOver(lock: DocumentLock): Promise<DocumentLock>;
	touch(documentType: string, documentId: string, holderId: string, at: string): Promise<boolean>;
	release(documentType: string, documentId: string, holderId: string): Promise<void>;
}
