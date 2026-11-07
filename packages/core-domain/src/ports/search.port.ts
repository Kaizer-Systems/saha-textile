import type { Product, ProductVariant } from '@saha-textile/contracts';

import type { PageQuery, Paginated } from './pagination';

export interface SearchQuery extends PageQuery {
	q: string;
	categoryId?: string;
}

export class SearchUnavailableError extends Error {
	override readonly name = 'SearchUnavailableError';
}

/**
 * Full-text search port. Locked target is self-hosted Meilisearch behind this
 * port, with MongoDB as the source of truth and a rebuildable derived index.
 */
export interface SearchEntry {
	product: Product;
	/** The product's live variants, which decide its price range. */
	variants: readonly ProductVariant[];
	/** Names of its categories, so "budget range" finds what its titles do not say. */
	categoryNames?: readonly string[];
}

export interface SearchPort {
	indexProduct(entry: SearchEntry): Promise<void>;
	/** Replaces the whole index and waits until it can answer. */
	replaceIndex(entries: readonly SearchEntry[]): Promise<void>;
	removeProduct(productId: string): Promise<void>;
	search(query: SearchQuery): Promise<Paginated<Product>>;
}
