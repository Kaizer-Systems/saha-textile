import type { Product } from '@saha-textile/contracts';

import type { PageQuery, Paginated } from './pagination';

export interface SearchQuery extends PageQuery {
	q: string;
	categoryId?: string;
}

/**
 * Full-text search port. Locked target is self-hosted Meilisearch behind this
 * port, with MongoDB as the source of truth and a rebuildable derived index.
 * The current implementation is an interim Mongo regex query in the adapter;
 * no Meilisearch adapter is bound yet.
 */
export interface SearchPort {
	indexProduct(product: Product): Promise<void>;
	removeProduct(productId: string): Promise<void>;
	search(query: SearchQuery): Promise<Paginated<Product>>;
}
