import type { Product } from '@saha-textile/contracts';

import type { PageQuery, Paginated } from './pagination';

export interface SearchQuery extends PageQuery {
	q: string;
	categoryId?: string;
}

/** Full-text search port (Mongo Atlas Search now; swappable later). */
export interface SearchPort {
	indexProduct(product: Product): Promise<void>;
	removeProduct(productId: string): Promise<void>;
	search(query: SearchQuery): Promise<Paginated<Product>>;
}
