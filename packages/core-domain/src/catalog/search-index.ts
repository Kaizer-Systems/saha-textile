import type { AttributeDefinition, Product } from '@saha-textile/contracts';

import type { SearchEntry, SearchPort } from '../ports/search.port';
import { isShownOnShop } from './product-visibility';

/**
 * Words that say nothing about a product. Spellings and words that mean the same thing are the
 * admin's search words (`searchDictionary`), not a list in code.
 */
export const SEARCH_STOP_WORDS: readonly string[] = ['a', 'an', 'and', 'for', 'in', 'of', 'the', 'with'];

/** The search words staff wrote for each value a product carries. One list serves every language. */
export function valueSearchWords(
	product: Pick<Product, 'optionGroups'>,
	definitions: readonly Pick<AttributeDefinition, 'code' | 'terms'>[],
): string[] {
	const byCode = new Map(definitions.map((row) => [row.code, row]));
	return product.optionGroups.flatMap((group) => {
		const terms = byCode.get(group.attributeCode)?.terms ?? [];
		return group.terms.flatMap((term) => terms.find((row) => row.code === term.code)?.aliases ?? []);
	});
}

/** Index document: ids and words. The selling price stays in Mongo. */
export function searchDocument(product: Pick<Product, 'id' | 'slug' | 'sku' | 'title' | 'categoryIds'>): {
	id: string;
	words: string;
	categoryIds: string[];
} {
	return {
		id: product.id,
		words: [product.title.en, product.title['bn'], product.slug, product.sku].filter(Boolean).join(' '),
		categoryIds: [...(product.categoryIds ?? [])],
	};
}

/**
 * Rebuilds the derived search index from Mongo, live products only. Running it again writes the
 * same documents, so it is safe to repeat. Typeahead calls `SearchPort`, not a Mongo regex.
 */
export async function rebuildSearchIndex(entries: readonly SearchEntry[], search: SearchPort): Promise<number> {
	// Live and shown on the shop: a product kept off the shop (D5) is never found by search.
	const live = entries.filter((entry) => isShownOnShop(entry.product));
	await search.replaceIndex(live);
	return live.length;
}
