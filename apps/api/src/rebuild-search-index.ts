import 'dotenv/config';

import {
	MongoAttributeDefinitionRepository,
	MongoCategoryRepository,
	MongoProductRepository,
	MongoProductVariantRepository,
	MongoSearchTermRepository,
	MongoSiteSettingsRepository,
	connectMongo,
	disconnectMongo,
} from '@saha-textile/adapters-db-mongo';
import { StorefrontSearchSettings, type Product } from '@saha-textile/contracts';
import { rebuildSearchIndex, searchVocabulary, valueSearchWords } from '@saha-textile/core-domain';

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
		const tree = await new MongoCategoryRepository().tree();
		const names = new Map(tree.map((row) => [row.id, Object.values(row.name)]));
		const definitions = await new MongoAttributeDefinitionRepository().listAll();
		const settings = StorefrontSearchSettings.parse(
			(await new MongoSiteSettingsRepository().get('storefront.search')) ?? {},
		);
		// The admin's search words and "show first" categories, as every product save writes them.
		const vocabulary = searchVocabulary(
			await new MongoSearchTermRepository().listLive(),
			tree,
			settings.showFirstCategoryIds,
		);
		const entries = products.map((product) => ({
			product,
			variants: rows.filter((row) => row.productId === product.id),
			categoryNames: product.categoryIds.flatMap((id) => names.get(id) ?? []),
			searchWords: valueSearchWords(product, definitions),
			searchTerms: vocabulary.wordsFor(product),
			showFirst: vocabulary.showsFirst(product),
		}));
		const config = loadConfig();
		const { host, apiKey, index } = config.search;
		const search = new MeilisearchSearch(host, apiKey, async () => [], index, config.locales);
		await search.updateSynonyms(vocabulary.synonyms);
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
