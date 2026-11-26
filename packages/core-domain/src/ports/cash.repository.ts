import type {
	CashBox,
	CashSettings,
	CashSheet,
	CashSheetLine,
	ExpenseClaim,
	ExpenseClaimStatus,
	PettyExpense,
} from '@saha-textile/contracts';

import type { TransactionContext } from './transaction-manager.port';

/** O11 and the claims list: one page and the count behind every chip, over the same period and search. */
export interface CashPage<T, C extends string> {
	items: T[];
	total: number;
	counts: Record<C, number>;
}

/** A search already turned into ids by the caller (boxes and locations by name, people by name): any may match. */
export interface CashMatch {
	boxIds: readonly string[] | null;
	people: readonly string[] | null;
}

/**
 * Cash (accounts brief O1–O14): the settings, boxes, each box's sheets and their lines, petty expenses and staff
 * claims. Sheets and claims are saved by version; a sheet's lines are written once, in the voucher's transaction.
 */
export interface CashRepository {
	settings(): Promise<CashSettings | null>;
	saveSettings(settings: CashSettings, context?: TransactionContext): Promise<void>;

	boxes(): Promise<CashBox[]>;
	box(id: string, context?: TransactionContext): Promise<CashBox | null>;
	/** Inserts or replaces; refused with `duplicate_cash_box_ledger` when another box already uses the ledger. */
	saveBox(box: CashBox, context?: TransactionContext): Promise<void>;

	sheet(id: string, context?: TransactionContext): Promise<CashSheet | null>;
	/** The box's sheet still open, if any (a box has at most one). */
	openSheet(boxId: string, context?: TransactionContext): Promise<CashSheet | null>;
	/** The box's sheet of a day, if any. */
	sheetOn(boxId: string, date: string, context?: TransactionContext): Promise<CashSheet | null>;
	/** The box's sheets closed with a difference nobody has settled, oldest first. */
	unsettled(boxId: string, context?: TransactionContext): Promise<CashSheet[]>;
	/** Refused with `cash_sheet_exists` for a second sheet of the box that day, or a second open one. */
	insertSheet(sheet: CashSheet, context?: TransactionContext): Promise<void>;
	/** Refused with `cash_sheet_changed` when someone saved it since `expectedVersion`; the version goes up by one. */
	saveSheet(sheet: CashSheet, expectedVersion: number, context?: TransactionContext): Promise<CashSheet>;
	listSheets(
		query: {
			from: string;
			to: string;
			chip: 'all' | 'difference' | 'open';
			locationIds: readonly string[] | null;
			match: CashMatch | null;
			page: number;
			pageSize: number;
		},
	): Promise<CashPage<CashSheet, 'all' | 'difference' | 'open'>>;
	/** Excess held in suspense whose days are up and not yet released. */
	suspenseDue(today: string): Promise<CashSheet[]>;
	/** Sheets of a month still open or waiting for a manager (T2's checks before a lock). */
	unfinishedIn(month: string): Promise<CashSheet[]>;

	/** Refused with `duplicate_cash_line` for the same voucher on the same box twice. */
	insertLine(line: CashSheetLine, context?: TransactionContext): Promise<void>;
	linesOf(sheetId: string, context?: TransactionContext): Promise<CashSheetLine[]>;
	/** Lines written while no sheet of the box was open join this one. */
	adoptLines(boxId: string, sheetId: string, context?: TransactionContext): Promise<number>;
	/** Money in and out on each sheet. */
	sheetTotals(sheetIds: readonly string[]): Promise<Record<string, { inPaise: number; outPaise: number }>>;

	/** Refused with `duplicate_petty_expense` for a number used twice. */
	insertPetty(expense: PettyExpense, context?: TransactionContext): Promise<void>;
	/** Cash paid to one payee (matched loosely by name) on a day, across every box. */
	pettyPaidOn(date: string, paidTo: string): Promise<number>;
	/** A box's petty expenses not yet put back by a refill. */
	pettySinceRefill(boxId: string, context?: TransactionContext): Promise<PettyExpense[]>;
	markRefilled(ids: readonly string[], refillId: string, context?: TransactionContext): Promise<void>;
	listPetty(query: {
		from: string;
		to: string;
		boxIds: readonly string[] | null;
		search: string;
		page: number;
		pageSize: number;
	}): Promise<{ items: PettyExpense[]; total: number; totalPaise: number }>;

	/** Refused with `duplicate_expense_claim` for a number used twice. */
	insertClaim(claim: ExpenseClaim, context?: TransactionContext): Promise<void>;
	claim(id: string, context?: TransactionContext): Promise<ExpenseClaim | null>;
	/** Refused with `expense_claim_changed` when someone saved it since `expectedVersion`. */
	saveClaim(claim: ExpenseClaim, expectedVersion: number, context?: TransactionContext): Promise<ExpenseClaim>;
	listClaims(query: {
		from: string;
		to: string;
		chip: 'all' | ExpenseClaimStatus;
		search: string;
		locationIds: readonly string[] | null;
		page: number;
		pageSize: number;
	}): Promise<CashPage<ExpenseClaim, 'all' | ExpenseClaimStatus>>;
	/** Approved claims to be paid with a month's salary (payroll picks them up). */
	claimsForPayroll(month: string): Promise<ExpenseClaim[]>;
}
