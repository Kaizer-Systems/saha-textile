import type { Product } from '@saha-textile/contracts';

import type { SearchPort } from '../ports/search.port';

/**
 * Two-way spellings Meilisearch will not correct on its own, because words
 * shorter than five letters skip typo tolerance. `ikkatsilk` points one way at
 * "ikkat", because a phrase alone misses titles such as "Pure Silk Ikkat Saree".
 */
export const SEARCH_SYNONYMS: Record<string, string[]> = {
	ikat: ['ikkat', 'ekat', 'ekkat'],
	ikkat: ['ikat', 'ekat', 'ekkat'],
	ekat: ['ikat', 'ikkat', 'ekkat'],
	ekkat: ['ikat', 'ikkat', 'ekat'],
	ikkatsilk: ['ikkat silk', 'ikkat'],
};

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
 * Rebuilds the derived search index from Mongo. Live products are upserted.
 * Anything else is removed. Running it again writes the same documents, so it
 * is safe to repeat. Storefront typeahead calls `SearchPort`, not a Mongo regex.
 */
export async function rebuildSearchIndex(products: readonly Product[], search: SearchPort): Promise<number> {
	let indexed = 0;
	for (const product of products) {
		if (product.status !== 'live') {
			await search.removeProduct(product.id);
			continue;
		}
		await search.indexProduct(product);
		indexed += 1;
	}
	return indexed;
}
