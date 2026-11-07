import 'dotenv/config';

import {
	MongoCategoryRepository,
	MongoProductRepository,
	MongoProductVariantRepository,
	connectMongo,
	disconnectMongo,
} from '@saha-textile/adapters-db-mongo';
import type { Product } from '@saha-textile/contracts';
import { rebuildSearchIndex } from '@saha-textile/core-domain';

import { loadConfig } from './config/app-config';
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
		const variants = new MongoProductVariantRepository();
		const rows = await variants.listForProducts(
			products.map((product) => product.id),
			'public',
		);
		const names = new Map(
			(await new MongoCategoryRepository().tree()).map((row) => [row.id, Object.values(row.name)]),
		);
		const entries = products.map((product) => ({
			product,
			variants: rows.filter((row) => row.productId === product.id),
			categoryNames: product.categoryIds.flatMap((id) => names.get(id) ?? []),
		}));
		const config = loadConfig();
		const { host, apiKey, index } = config.search;
		const search = new MeilisearchSearch(host, apiKey, async () => [], index, config.locales);
		const indexed = await rebuildSearchIndex(entries, search);
		process.stdout.write(`Indexed ${indexed} live products of ${products.length}.\n`);
	} finally {
		await disconnectMongo();
	}
}

main().catch((error: unknown) => {
	process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
	process.exitCode = 1;
});
