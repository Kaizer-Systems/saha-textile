import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Category, Product } from '@saha-textile/contracts';
import type {
	CatalogAudience,
	CategoryRepository,
	Paginated,
	ProductFilter,
	ProductRepository,
} from '@saha-textile/core-domain';

import { CATEGORY_REPOSITORY, PRODUCT_REPOSITORY } from '../infra/tokens';

@Injectable()
export class CatalogService {
	constructor(
		@Inject(PRODUCT_REPOSITORY) private readonly products: ProductRepository,
		@Inject(CATEGORY_REPOSITORY) private readonly categories: CategoryRepository,
	) {}

	listProducts(filter: ProductFilter): Promise<Paginated<Product>> {
		return this.products.list({ ...filter, audience: filter.audience ?? 'public' });
	}

	/**
	 * Resolves a product for the given audience. A non-live product is indistinguishable
	 * from a missing one to a public caller — same 404, no "exists but hidden" signal.
	 */
	async getProduct(idOrSlug: string, audience: CatalogAudience = 'public'): Promise<Product> {
		const byId = await this.products.findById(idOrSlug, audience);
		const product = byId ?? (await this.products.findBySlug(idOrSlug, audience));
		if (!product) throw new NotFoundException(`Product not found: ${idOrSlug}`);
		return product;
	}

	getCategoryTree(): Promise<Category[]> {
		return this.categories.tree();
	}

	async getCategory(slug: string): Promise<Category> {
		const category = await this.categories.findBySlug(slug);
		if (!category) throw new NotFoundException(`Category not found: ${slug}`);
		return category;
	}
}
