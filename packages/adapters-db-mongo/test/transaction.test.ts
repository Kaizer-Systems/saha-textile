import { describe, expect, it } from 'vitest';

import { buildMongoConfig } from '../src/config';
import { connectMongo, disconnectMongo } from '../src/connection';
import { ProductModel } from '../src/models/index';
import { MongoTransactionManager, sessionFrom } from '../src/transaction-manager';

/**
 * Transaction proof against a REAL single-node replica set (Chunk C definition of done).
 *
 * A rollback test that runs without a replica set would pass for the wrong reason —
 * standalone MongoDB rejects transactions outright — so these are gated on `RUN_DB_IT=1`
 * exactly like the other integration tests:
 *   RUN_DB_IT=1 pnpm --filter @saha-textile/adapters-db-mongo test
 */
function hasMongoEnv(): boolean {
	if (process.env.RUN_DB_IT !== '1') return false;
	try {
		buildMongoConfig();
		return true;
	} catch {
		return false;
	}
}

const fixture = (id: string) => ({
	_id: id,
	type: 'simple' as const,
	sku: `TX-${id}`,
	title: { en: `Transaction fixture ${id}` },
	slug: `transaction-fixture-${id}`,
	categoryIds: ['cat_tx_fixture'],
	basePriceINR: 100,
	status: 'draft' as const,
});

describe.skipIf(!hasMongoEnv())('MongoTransactionManager (integration, rs0)', () => {
	const transactions = new MongoTransactionManager();

	const cleanup = async () => {
		await ProductModel.deleteMany({ categoryIds: 'cat_tx_fixture' }).exec();
	};

	it('commits every write in the unit of work', async () => {
		await connectMongo();
		await cleanup();

		await transactions.withTransaction(async (context) => {
			const session = sessionFrom(context);
			await ProductModel.create([fixture('prod_tx_commit_a')], { session });
			await ProductModel.create([fixture('prod_tx_commit_b')], { session });
		});

		expect(await ProductModel.countDocuments({ categoryIds: 'cat_tx_fixture' }).exec()).toBe(2);
		await cleanup();
	});

	it('rolls back EVERY write when the work throws, not just the failing one', async () => {
		await cleanup();

		await expect(
			transactions.withTransaction(async (context) => {
				const session = sessionFrom(context);
				await ProductModel.create([fixture('prod_tx_rollback_a')], { session });
				// The first write already succeeded inside the transaction — the point of the
				// test is that it disappears too.
				throw new Error('deliberate failure after a successful write');
			}),
		).rejects.toThrow('deliberate failure after a successful write');

		expect(await ProductModel.countDocuments({ categoryIds: 'cat_tx_fixture' }).exec()).toBe(0);
	});

	it('propagates the original error unchanged', async () => {
		class DomainError extends Error {}
		await expect(
			transactions.withTransaction(async () => {
				throw new DomainError('domain rule violated');
			}),
		).rejects.toBeInstanceOf(DomainError);
	});

	it('returns the value the work produced', async () => {
		await expect(transactions.withTransaction(async () => 'result-value')).resolves.toBe('result-value');
	});

	it('joins an outer transaction instead of nesting a second one', async () => {
		await cleanup();

		await transactions.withTransaction(async (outer) => {
			const outerSession = sessionFrom(outer);
			await ProductModel.create([fixture('prod_tx_nested_a')], { session: outerSession });

			await transactions.withTransaction(async (inner) => {
				// Same session object → one transaction, not two.
				expect(sessionFrom(inner)).toBe(outerSession);
				await ProductModel.create([fixture('prod_tx_nested_b')], { session: sessionFrom(inner) });
			});
		});

		expect(await ProductModel.countDocuments({ categoryIds: 'cat_tx_fixture' }).exec()).toBe(2);
		await cleanup();
	});

	it('rolls back the outer AND inner writes when a joined inner transaction fails', async () => {
		await cleanup();

		await expect(
			transactions.withTransaction(async (outer) => {
				await ProductModel.create([fixture('prod_tx_join_a')], { session: sessionFrom(outer) });
				await transactions.withTransaction(async (inner) => {
					await ProductModel.create([fixture('prod_tx_join_b')], { session: sessionFrom(inner) });
					throw new Error('inner failure');
				});
			}),
		).rejects.toThrow('inner failure');

		expect(await ProductModel.countDocuments({ categoryIds: 'cat_tx_fixture' }).exec()).toBe(0);
		await disconnectMongo();
	});
});
