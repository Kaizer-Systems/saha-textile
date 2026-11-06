import type { Product } from '@saha-textile/contracts';

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
export interface SearchPort {
	indexProduct(product: Product): Promise<void>;
	removeProduct(productId: string): Promise<void>;
	search(query: SearchQuery): Promise<Paginated<Product>>;
}
