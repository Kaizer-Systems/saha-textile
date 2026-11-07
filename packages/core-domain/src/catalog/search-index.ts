import type { Product } from '@saha-textile/contracts';

import type { SearchEntry, SearchPort } from '../ports/search.port';

/** Spellings and words shoppers use for one thing. Each finds the others. */
const SAME_THING: ReadonlyArray<readonly string[]> = [
	['ikat', 'ikkat', 'ekat', 'ekkat'],
	['saree', 'sari', 'sarees', 'saris'],
	['kanchipuram', 'kanjivaram', 'kanjeevaram', 'kancheepuram', 'kanchi'],
	['banarasi', 'benarasi', 'banaras', 'benaras', 'varanasi'],
	['tussar', 'tussore', 'tasar', 'tasser'],
	['chikankari', 'chikan', 'lucknowi'],
	['jamdani', 'jamdhani', 'dhakai'],
	['kalamkari', 'kalankari'],
	['paithani', 'paithni'],
	['salwar', 'shalwar', 'salwaar'],
	['dupatta', 'chunni', 'odhni'],
	['mulmul', 'muslin'],
	['bridal', 'wedding', 'mariage'],
	['silk', 'soie', 'resham'],
	['cotton', 'coton', 'sooti'],
	['blouse', 'choli'],
	['unstitched', 'dress material'],
];

function synonyms(): Record<string, string[]> {
	const found: Record<string, string[]> = {};
	for (const group of SAME_THING) {
		for (const word of group) found[word] = group.filter((other) => other !== word);
	}
	return found;
}

/**
 * Every word finds the others in its group. `ikkatsilk` points one way at "ikkat", because a phrase
 * alone misses titles such as "Pure Silk Ikkat Saree".
 */
export const SEARCH_SYNONYMS: Record<string, string[]> = {
	...synonyms(),
	ikkatsilk: ['ikkat silk', 'ikkat'],
};

/** Words that say nothing about a product, in the shop's languages. */
export const SEARCH_STOP_WORDS: readonly string[] = [
	'a',
	'an',
	'and',
	'for',
	'in',
	'of',
	'the',
	'with',
	'au',
	'de',
	'des',
	'du',
	'en',
	'et',
	'la',
	'le',
	'les',
	'un',
	'une',
];

/** Index document: ids and words. The selling price stays in Mongo. */
export function searchDocument(product: Pick<Product, 'id' | 'slug' | 'sku' | 'title' | 'categoryIds'>): {
	id: string;
	words: string;
	categoryIds: string[];
} {
	return {
		id: product.id,
		words: [product.title.en, product.title['fr'], product.slug, product.sku].filter(Boolean).join(' '),
		categoryIds: [...(product.categoryIds ?? [])],
	};
}

/**
 * Rebuilds the derived search index from Mongo, live products only. Running it again writes the
 * same documents, so it is safe to repeat. Typeahead calls `SearchPort`, not a Mongo regex.
 */
export async function rebuildSearchIndex(entries: readonly SearchEntry[], search: SearchPort): Promise<number> {
	const live = entries.filter((entry) => entry.product.status === 'live');
	await search.replaceIndex(live);
	return live.length;
}
