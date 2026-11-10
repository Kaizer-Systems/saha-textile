import {
	MongoAttributeDefinitionRepository,
	MongoCategoryRepository,
	MongoProductRepository,
	MongoProductVariantRepository,
	MongoSearchTermRepository,
	MongoSiteSettingsRepository,
} from '@saha-textile/adapters-db-mongo';
import { StorefrontSearchSettings, type Product } from '@saha-textile/contracts';
import { rebuildSearchIndex, searchVocabulary, valueSearchWords, type ReleaseStep } from '@saha-textile/core-domain';

import { loadConfig } from '../config/app-config';
import { MeilisearchSearch } from './meilisearch-search';
import { SEARCH_INDEX_VERSION } from './search-index-version';

const PAGE_SIZE = 200;

/** The search index this code reads, from the API's own settings. */
export function releaseSearch(): MeilisearchSearch {
	const config = loadConfig();
	const { host, apiKey, index } = config.search;
	return new MeilisearchSearch(host, apiKey, async () => [], index, config.locales);
}

/**
 * Fills or refreshes the search index from Mongo, the source of truth, and says what it did.
 * With `release`, a search version that is already built gets only its settings and search
 * words; without it, the index is always rebuilt.
 */
export async function prepareSearchIndex(search: MeilisearchSearch, options: { release: boolean }): Promise<string> {
	const tree = await new MongoCategoryRepository().tree();
	const settings = StorefrontSearchSettings.parse(
		(await new MongoSiteSettingsRepository().get('storefront.search')) ?? {},
	);
	// The admin's search words and "show first" categories, as every product save writes them.
	const vocabulary = searchVocabulary(
		await new MongoSearchTermRepository().listLive(),
		tree,
		settings.showFirstCategoryIds,
	);
	if (options.release && (await search.buildState()) === 'ready') {
		await search.applyCurrentSettings();
		await search.updateSynonyms(vocabulary.synonyms);
		return `Search index ${search.index} is already built; settings and search words applied.`;
	}

	const repository = new MongoProductRepository();
	const products: Product[] = [];
	for (let page = 1; ; page += 1) {
		const { items, total } = await repository.list({ audience: 'admin', page, pageSize: PAGE_SIZE });
		products.push(...items);
		if (!items.length || products.length >= total) break;
	}
	const rows = await new MongoProductVariantRepository().listForProducts(
		products.map((product) => product.id),
		'public',
	);
	const names = new Map(tree.map((row) => [row.id, Object.values(row.name)]));
	const definitions = await new MongoAttributeDefinitionRepository().listAll();
	const entries = products.map((product) => ({
		product,
		variants: rows.filter((row) => row.productId === product.id),
		categoryNames: product.categoryIds.flatMap((id) => names.get(id) ?? []),
		searchWords: valueSearchWords(product, definitions),
		searchTerms: vocabulary.wordsFor(product),
		showFirst: vocabulary.showsFirst(product),
	}));
	await search.updateSynonyms(vocabulary.synonyms);
	const indexed = await rebuildSearchIndex(entries, search);
	return `Indexed ${indexed} live products of ${products.length} into ${search.index}.`;
}

/**
 * The search row of the release steps. Every release applies settings and search words; only a
 * new search version builds the index, and it must finish before the apps switch.
 */
export function searchIndexStep(search: MeilisearchSearch): ReleaseStep {
	return {
		key: 'search-index',
		label: 'Search index',
		cadence: 'every-release',
		needed: async () => ({
			needed: true,
			reason:
				(await search.buildState()) === 'ready'
					? `search version ${SEARCH_INDEX_VERSION} unchanged: settings and search words only`
					: `search version ${SEARCH_INDEX_VERSION} is new: full build of ${search.index}`,
		}),
		run: () => prepareSearchIndex(search, { release: true }),
		check: async () =>
			(await search.buildState()) === 'ready'
				? { ok: true, detail: `${search.index} is built and answering` }
				: { ok: false, detail: `${search.index} was not recorded as built` },
	};
}
