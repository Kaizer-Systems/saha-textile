import { AsyncLocalStorage } from 'node:async_hooks';

import type { TransactionContext, TransactionManagerPort, TransactionOptions } from '@saha-textile/core-domain';
import mongoose, { type ClientSession } from 'mongoose';

/** The transaction context this adapter puts on the wire: a Mongo session, nothing else. */
interface MongoTransactionContext extends TransactionContext {
	session: ClientSession;
}

/**
 * Tracks the session of the innermost active transaction on the async call stack.
 *
 * This is what makes nesting JOIN rather than open a second transaction: a use case can
 * call another use case that also asks for a transaction without deadlocking against
 * itself or silently splitting one atomic operation into two.
 */
const activeSession = new AsyncLocalStorage<ClientSession>();

/** Extracts the Mongo session from a domain transaction context, if there is one. */
export function sessionFrom(context?: TransactionContext): ClientSession | undefined {
	const candidate = (context as MongoTransactionContext | undefined)?.session;
	return candidate ?? activeSession.getStore();
}

/**
 * MongoDB implementation of `TransactionManagerPort`.
 *
 * The single-node replica set exists for exactly this: multi-document commerce writes
 * (order + stock + ledger + outbox) must commit or roll back together. `withTransaction`
 * relies on the driver's own retry loop for transient/write-conflict errors, which is why
 * the port documents that `work` may run more than once and must be idempotent in memory.
 *
 * A thrown error aborts the transaction and propagates UNCHANGED — the caller sees its own
 * error, not a driver wrapper, so the global error filter can classify it correctly.
 */
export class MongoTransactionManager implements TransactionManagerPort {
	async withTransaction<T>(
		work: (context: TransactionContext) => Promise<T>,
		_options: TransactionOptions = {},
	): Promise<T> {
		// Already inside a transaction → join it instead of nesting a second one.
		const existing = activeSession.getStore();
		if (existing) return work({ session: existing });

		const session = await mongoose.startSession();
		try {
			let result: T;
			let ran = false;

			// `_options.maxRetries` is not forwarded: the driver's own
			// `TransientTransactionError` / `UnknownTransactionCommitResult` retry loop
			// governs here. The port keeps the field for adapters that need to express it;
			// this one deliberately defers to the driver rather than fighting it.
			await session.withTransaction(async () => {
				ran = true;
				result = await activeSession.run(session, () => work({ session }));
			});

			if (!ran) throw new Error('transaction callback did not run');
			return result!;
		} finally {
			await session.endSession();
		}
	}
}
