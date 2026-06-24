import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Category, Product } from '@saha/contracts';
import type { CategoryRepository, Paginated, ProductFilter, ProductRepository } from '@saha/core-domain';

import { CATEGORY_REPOSITORY, PRODUCT_REPOSITORY } from '../infra/tokens';

@Injectable()
export class CatalogService {
	constructor(
		@Inject(PRODUCT_REPOSITORY) private readonly products: ProductRepository,
		@Inject(CATEGORY_REPOSITORY) private readonly categories: CategoryRepository,
	) {}

	listProducts(filter: ProductFilter): Promise<Paginated<Product>> {
		return this.products.list(filter);
	}

	async getProduct(idOrSlug: string): Promise<Product> {
		const byId = await this.products.findById(idOrSlug);
		const product = byId ?? (await this.products.findBySlug(idOrSlug));
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
