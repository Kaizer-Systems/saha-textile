/**
 * Recomputes every product's rating from its approved reviews, and writes both the rating
 * aggregate and the product's own star summary (cards, listings and search read that one).
 *
 * Safe to re-run anywhere: it only ever writes what the approved reviews say. On the local
 * showcase catalogue it clears the builder's invented ratings (owner decision 2026-11-08).
 * Rebuild the search index afterwards so listing stars follow.
 *
 * Usage: pnpm --filter @saha-textile/adapters-db-mongo ratings:recompute
 */
import { connectMongo, disconnectMongo } from '../src/connection';
import { ProductModel } from '../src/models/index';
import { MongoReviewRepository } from '../src/repositories/content.repository';

async function main(): Promise<void> {
	await connectMongo();
	const reviews = new MongoReviewRepository();
	const ids = await ProductModel.find({}).select('_id').lean<Array<{ _id: string }>>().exec();
	let rated = 0;
	for (const { _id } of ids) {
		const aggregate = await reviews.recomputeAggregate(String(_id));
		if (aggregate.count > 0) rated += 1;
	}
	console.log(`[ratings:recompute] ${ids.length} products recomputed, ${rated} with approved reviews`);
	await disconnectMongo();
}

main().catch((error: unknown) => {
	console.error('[ratings:recompute] failed:', error);
	process.exitCode = 1;
});
