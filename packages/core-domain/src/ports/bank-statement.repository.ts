import type { BankImport, BankLayout, BankLine, BankLineQuery } from '@saha-textile/contracts';

import type { TransactionContext } from './transaction-manager.port';

/** Bank statements (accounts brief BA4–BA7): saved layouts, imported lines, and each import. */
export interface BankStatementRepository {
	layouts(): Promise<BankLayout[]>;
	saveLayout(layout: BankLayout): Promise<void>;
	/** Which of these keys the account already holds. */
	keysIn(bankAccountId: string, keys: readonly string[]): Promise<Set<string>>;
	insertLines(lines: readonly BankLine[], context?: TransactionContext): Promise<void>;
	insertImport(entry: BankImport, context?: TransactionContext): Promise<void>;
	lines(
		bankAccountId: string,
		query: BankLineQuery,
	): Promise<{ items: BankLine[]; total: number; counts: Record<string, number> }>;
	/** Per account: the last statement day and the lines still to match (BA1). */
	summary(): Promise<Record<string, { lastDate: string | null; toMatch: number }>>;
}
