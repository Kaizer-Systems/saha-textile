import {
	MongoAttributeDefinitionRepository,
	MongoCategoryRepository,
	MongoProductRepository,
	MongoProductVariantRepository,
	MongoSearchOutboxRepository,
	MongoSearchTermRepository,
	MongoSiteSettingsRepository,
	lastBuiltSearchVersion,
	recordSearchVersionBuilt,
} from '@saha-textile/adapters-db-mongo';
import { StorefrontSearchSettings, type Product } from '@saha-textile/contracts';
import {
	SearchUnavailableError,
	checkSearchIndex,
	drainSearchOutbox,
	rebuildSearchIndex,
	replaySearchChanges,
	searchVocabulary,
	valueSearchWords,
	type ReleaseStep,
	type SearchCheckResult,
	type SearchEntry,
	type SearchFlushResult,
	type SearchSyncDeps,
} from '@saha-textile/core-domain';

import { loadConfig } from '../config/app-config';
import { MeilisearchSearch, noProductsLoaded } from './meilisearch-search';
import { SEARCH_INDEX_VERSION } from './search-index-version';

const PAGE_SIZE = 200;
/** Replays start this much before the recorded moment, so a save on the boundary is not missed. */
const REPLAY_MARGIN_MS = 60_000;

/** The search index this code reads, from the API's own settings. */
export function releaseSearch(): MeilisearchSearch {
	const config = loadConfig();
	const { host, apiKey, index } = config.search;
	return new MeilisearchSearch(host, apiKey, noProductsLoaded, index, config.locales);
}

/** The admin's search words and "show first" categories, as every product save writes them. */
async function vocabularyNow() {
	const tree = await new MongoCategoryRepository().tree();
	const settings = StorefrontSearchSettings.parse(
		(await new MongoSiteSettingsRepository().get('storefront.search')) ?? {},
	);
	const vocabulary = searchVocabulary(
		await new MongoSearchTermRepository().listLive(),
		tree,
		settings.showFirstCategoryIds,
	);
	return { tree, vocabulary };
}

/** Everything search needs about these products: variants, category names and search words. */
export async function searchEntriesFor(products: readonly Product[]): Promise<SearchEntry[]> {
	if (!products.length) return [];
	const { tree, vocabulary } = await vocabularyNow();
	const rows = await new MongoProductVariantRepository().listForProducts(
		products.map((product) => product.id),
		'public',
	);
	const names = new Map(tree.map((row) => [row.id, Object.values(row.name)]));
	const definitions = await new MongoAttributeDefinitionRepository().listAll();
	return products.map((product) => ({
		product,
		variants: rows.filter((row) => row.productId === product.id),
		categoryNames: product.categoryIds.flatMap((id) => names.get(id) ?? []),
		searchWords: valueSearchWords(product, definitions),
		searchTerms: vocabulary.wordsFor(product),
		showFirst: vocabulary.showsFirst(product),
	}));
}

/** Every product as staff see them. */
async function allProducts(): Promise<Product[]> {
	const repository = new MongoProductRepository();
	const products: Product[] = [];
	for (let page = 1; ; page += 1) {
		const { items, total } = await repository.list({ audience: 'admin', page, pageSize: PAGE_SIZE });
		products.push(...items);
		if (!items.length || products.length >= total) return products;
	}
}

/** The search change queue, wired to this index. */
export function searchSyncDeps(search: MeilisearchSearch): SearchSyncDeps {
	const products = new MongoProductRepository();
	return {
		outbox: new MongoSearchOutboxRepository(),
		loadProduct: (id) => products.findById(id, 'admin'),
		apply: async (live, removed) => search.applyChanges(await searchEntriesFor(live), removed),
		now: () => new Date(),
	};
}

/** Replays queued changes since the index's last catch-up (or its build) and notes the new point. */
export async function catchUpSearch(search: MeilisearchSearch): Promise<number> {
	const record = await search.buildRecord();
	if (!record) return 0;
	const at = new Date();
	const since = new Date(Date.parse(record.caughtUpAt ?? record.startedAt) - REPLAY_MARGIN_MS);
	const replayed = await replaySearchChanges(searchSyncDeps(search), since);
	await search.recordCatchUp(at);
	return replayed;
}

/**
 * Fills or refreshes the search index from Mongo, the source of truth, and says what it did.
 * With `release`, a search version that is already built gets only its settings and search
 * words; otherwise the index is rebuilt, then every change saved during the build is replayed
 * into it.
 */
export async function prepareSearchIndex(search: MeilisearchSearch, options: { release: boolean }): Promise<string> {
	const { vocabulary } = await vocabularyNow();
	if (options.release && (await search.buildState()) === 'ready') {
		await search.applyCurrentSettings();
		await search.updateSynonyms(vocabulary.synonyms);
		await recordSearchVersionBuilt(SEARCH_INDEX_VERSION, new Date());
		return `Search index ${search.index} is already built; settings and search words applied.`;
	}
	const products = await allProducts();
	await search.updateSynonyms(vocabulary.synonyms);
	const indexed = await rebuildSearchIndex(await searchEntriesFor(products), search);
	const replayed = await catchUpSearch(search);
	await recordSearchVersionBuilt(SEARCH_INDEX_VERSION, new Date());
	return `Indexed ${indexed} live products of ${products.length} into ${search.index}; replayed ${replayed} changes saved meanwhile.`;
}

/** One pass of the worker over the search change queue. */
export function drainSearchQueue(search: MeilisearchSearch): Promise<SearchFlushResult> {
	return drainSearchOutbox(searchSyncDeps(search));
}

/** The nightly comparison of the database with the search index. */
export function nightlySearchCheck(search: MeilisearchSearch): Promise<SearchCheckResult> {
	return checkSearchIndex({
		outbox: new MongoSearchOutboxRepository(),
		products: allProducts,
		indexedIds: () => search.indexedIds(),
		now: () => new Date(),
	});
}

/**
 * The search row of the release steps. Every release applies settings and search words; only a
 * new search version builds the index, and it must finish before the apps switch. When search
 * is down and the version is unchanged, the release goes ahead: shoppers see the "search is
 * unavailable" message and every change waits in the queue until search returns.
 */
export function searchIndexStep(search: MeilisearchSearch): ReleaseStep {
	let down = false;
	return {
		key: 'search-index',
		label: 'Search index',
		cadence: 'every-release',
		needed: async () => {
			let state: Awaited<ReturnType<MeilisearchSearch['buildState']>>;
			try {
				state = await search.buildState();
			} catch (error) {
				if (!(error instanceof SearchUnavailableError)) throw error;
				if ((await lastBuiltSearchVersion()) !== SEARCH_INDEX_VERSION) {
					throw new Error(
						`search is unavailable, and this release needs search version ${SEARCH_INDEX_VERSION} built first`,
						{ cause: error },
					);
				}
				down = true;
				return {
					needed: false,
					reason: `search is unavailable; search version ${SEARCH_INDEX_VERSION} is unchanged, so the release goes ahead and changes wait in the queue`,
				};
			}
			return {
				needed: true,
				reason:
					state === 'ready'
						? `search version ${SEARCH_INDEX_VERSION} unchanged: settings and search words only`
						: `search version ${SEARCH_INDEX_VERSION} is new: full build of ${search.index}`,
			};
		},
		run: () => prepareSearchIndex(search, { release: true }),
		check: async () => {
			if (down) return { ok: true, detail: 'skipped while search is down' };
			return (await search.buildState()) === 'ready'
				? { ok: true, detail: `${search.index} is built and answering` }
				: { ok: false, detail: `${search.index} was not recorded as built` };
		},
	};
}
