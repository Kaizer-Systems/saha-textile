/**
 * An opaque handle to an in-flight transaction.
 *
 * It is deliberately structural and empty: a Mongo `ClientSession`, a Postgres client,
 * or a test fake all satisfy it, and core can pass it around without knowing which. If
 * this type ever grows a driver-specific member, the swappability rule is broken.
 */
export interface TransactionContext {
	readonly [key: string]: unknown;
}

/** A unit of work that must commit or roll back as one. */
export type TransactionalWork<T> = (context: TransactionContext) => Promise<T>;

export interface TransactionOptions {
	/**
	 * How many times to retry on a transient/write-conflict error. The adapter decides
	 * which driver errors qualify; core only expresses the intent.
	 */
	maxRetries?: number;
}

/**
 * Unit-of-work boundary (`TransactionManagerPort`).
 *
 * MongoDB runs as a single-node replica set precisely so multi-document commerce writes
 * (place order → decrement stock → write ledger → emit outbox) are atomic. Use cases
 * express that requirement through this port and never touch a driver session.
 *
 * Contract for implementations:
 *   - the work runs inside a transaction; a thrown error aborts it and the error
 *     propagates unchanged;
 *   - the return value of `work` is the return value of `withTransaction`;
 *   - retries re-run the ENTIRE `work` callback, so it must be idempotent in memory;
 *   - nesting joins the existing transaction rather than opening a second one.
 */
export interface TransactionManagerPort {
	withTransaction<T>(work: TransactionalWork<T>, options?: TransactionOptions): Promise<T>;
}
