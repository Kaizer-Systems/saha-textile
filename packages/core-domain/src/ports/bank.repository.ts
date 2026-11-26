import type { BankAccount } from '@saha-textile/contracts';

import type { TransactionContext } from './transaction-manager.port';

/** Bank accounts (accounts brief BA1–BA3): the bank's details beside each bank ledger. */
export interface BankRepository {
	list(): Promise<BankAccount[]>;
	get(id: string, context?: TransactionContext): Promise<BankAccount | null>;
	/** A second account with the same IFSC and number throws `bank_account_exists`. */
	insert(account: BankAccount, context?: TransactionContext): Promise<void>;
	/** Saves over the version the screen read; a change made meanwhile throws `bank_account_changed`. */
	save(account: BankAccount, expectedVersion: number, context?: TransactionContext): Promise<BankAccount>;
}
