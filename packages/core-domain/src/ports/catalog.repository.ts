import type { Category, Product, ProductStatus } from '@saha-textile/contracts';

import type { CatalogAudience } from '../catalog/product-visibility';
import type { PageQuery, Paginated } from './pagination';

export interface ProductFilter extends PageQuery {
	/** Only these items (Settings › Languages: a list filtered to what is missing in a language). */
	ids?: readonly string[];
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
	featured?: boolean;
	onSale?: boolean;
	insight?: 'bestseller' | 'trending';
	/** Placement path such as `sarees/pure-cotton`. Matches a category id resolved by the caller. */
	categoryIds?: string[];
}

/**
 * Persistence port for products. Implemented by infra adapters (e.g. Mongo).
 *
 * Every read takes the audience so status visibility is enforced in ONE place
 * (the repository query) rather than trusted to each caller.
 */
export interface CategorySummary {
	categoryId: string;
	productCount: number;
	coverAssetId: string | null;
}

export interface ProductRepository {
	findById(id: string, audience?: CatalogAudience): Promise<Product | null>;
	findBySlug(slug: string, audience?: CatalogAudience): Promise<Product | null>;
	list(filter: ProductFilter): Promise<Paginated<Product>>;
	save(product: Product): Promise<Product>;
	deleteById(id: string): Promise<void>;
	/** Live product slugs for the storefront redirect allow-list. */
	listPublicSlugs(): Promise<string[]>;
	/** The live product with this product code, for the short `/p/<code>` address. */
	findPublicSlugBySku(sku: string): Promise<string | null>;
	/** Live products per category, with the first product's lead photo. */
	categorySummaries(): Promise<CategorySummary[]>;
	/** Every product with at least one YouTube video, whatever its status, for the weekly check. */
	listWithVideos(): Promise<Product[]>;
	/** Every product, any status, whose main (first) category is this one (F03 HSN refill, PD3). */
	listByMainCategory(categoryId: string): Promise<Product[]>;
	/** Replaces the weekly badges: every other product loses them. */
	setInsightBadges(input: { bestseller: readonly string[]; trending: readonly string[] }): Promise<void>;
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
