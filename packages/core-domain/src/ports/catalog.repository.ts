import type { Category, Product, ProductStatus } from '@saha-textile/contracts';

import type { CatalogAudience } from '../catalog/product-visibility';
import type { PageQuery, Paginated } from './pagination';

export interface ProductFilter extends PageQuery {
	/**
	 * Defaults to `public` in every implementation — an omitted audience must hide
	 * non-live products, never reveal them.
	 */
	audience?: CatalogAudience;
	categoryId?: string;
	tag?: string;
	/** Narrowing only: a public caller can never widen beyond the storefront-visible set. */
	status?: ProductStatus;
	search?: string;
}

/**
 * Persistence port for products. Implemented by infra adapters (e.g. Mongo).
 *
 * Every read takes the audience so status visibility is enforced in ONE place
 * (the repository query) rather than trusted to each caller.
 */
export interface ProductRepository {
	findById(id: string, audience?: CatalogAudience): Promise<Product | null>;
	findBySlug(slug: string, audience?: CatalogAudience): Promise<Product | null>;
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
