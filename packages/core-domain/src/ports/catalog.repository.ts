import type { Category, Product, ProductStatus } from '@saha-textile/contracts';

import type { PageQuery, Paginated } from './pagination';

export interface ProductFilter extends PageQuery {
	categoryId?: string;
	tag?: string;
	status?: ProductStatus;
	search?: string;
}

/** Persistence port for products. Implemented by infra adapters (e.g. Mongo). */
export interface ProductRepository {
	findById(id: string): Promise<Product | null>;
	findBySlug(slug: string): Promise<Product | null>;
	list(filter: ProductFilter): Promise<Paginated<Product>>;
	save(product: Product): Promise<Product>;
	deleteById(id: string): Promise<void>;
}

/** Persistence port for the category taxonomy. */
export interface CategoryRepository {
	findById(id: string): Promise<Category | null>;
	findBySlug(slug: string): Promise<Category | null>;
	listChildren(parentId: string | null): Promise<Category[]>;
	tree(): Promise<Category[]>;
	save(category: Category): Promise<Category>;
	deleteById(id: string): Promise<void>;
}
