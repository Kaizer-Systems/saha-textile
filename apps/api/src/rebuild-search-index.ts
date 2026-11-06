import 'dotenv/config';

import { MongoProductRepository, connectMongo, disconnectMongo } from '@saha-textile/adapters-db-mongo';
import type { Product } from '@saha-textile/contracts';
import { rebuildSearchIndex } from '@saha-textile/core-domain';

import { MeilisearchSearch } from './search/meilisearch-search';

const PAGE_SIZE = 200;

/**
 * Fills the Meilisearch index from Mongo, the source of truth. Safe to repeat. Run it once on a
 * fresh index, and again after any bulk catalogue change: `pnpm --filter @saha-textile/api search:rebuild`.
 */
async function main(): Promise<void> {
	await connectMongo();
	try {
		const repository = new MongoProductRepository();
		const products: Product[] = [];
		for (let page = 1; ; page += 1) {
			const { items, total } = await repository.list({ audience: 'admin', page, pageSize: PAGE_SIZE });
			products.push(...items);
			if (!items.length || products.length >= total) break;
		}
		const search = new MeilisearchSearch(
			process.env['MEILISEARCH_HOST'],
			process.env['MEILISEARCH_API_KEY'],
			async () => [],
		);
		const indexed = await rebuildSearchIndex(products, search);
		process.stdout.write(`Indexed ${indexed} live products of ${products.length}.\n`);
	} finally {
		await disconnectMongo();
	}
}

main().catch((error: unknown) => {
	process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
	process.exitCode = 1;
});
