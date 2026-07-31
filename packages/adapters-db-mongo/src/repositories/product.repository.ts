import type { Product } from '@saha-textile/contracts';
import {
	type CatalogAudience,
	type Paginated,
	type ProductFilter,
	type ProductRepository,
	resolveProductStatusFilter,
} from '@saha-textile/core-domain';

import { toProduct } from '../mappers';
import { type ProductDoc, ProductModel } from '../models/index';

function escapeRegex(input: string): string {
	return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Builds the status clause for a query. The audience defaults to `public`, so a
 * caller that forgets to pass one gets the storefront-visible set — hiding data, never
 * leaking it. An empty allow-list (a public caller asking for `draft`) is expressed as
 * `$in: []`, which matches nothing.
 */
function statusClause(audience: CatalogAudience | undefined, requested?: Product['status']) {
	const statuses = resolveProductStatusFilter(audience ?? 'public', requested);
	return statuses === undefined ? {} : { status: { $in: statuses } };
}

export class MongoProductRepository implements ProductRepository {
	async findById(id: string, audience: CatalogAudience = 'public'): Promise<Product | null> {
		const doc = await ProductModel.findOne({ _id: id, ...statusClause(audience) })
			.lean<ProductDoc>()
			.exec();
		return doc ? toProduct(doc) : null;
	}

	async findBySlug(slug: string, audience: CatalogAudience = 'public'): Promise<Product | null> {
		const doc = await ProductModel.findOne({ slug, ...statusClause(audience) })
			.lean<ProductDoc>()
			.exec();
		return doc ? toProduct(doc) : null;
	}

	async list(filter: ProductFilter): Promise<Paginated<Product>> {
		const query: Record<string, unknown> = { ...statusClause(filter.audience, filter.status) };
		if (filter.categoryId) query.categoryIds = filter.categoryId;
		if (filter.tag) query.tags = filter.tag;
		if (filter.search) {
			const rx = new RegExp(escapeRegex(filter.search), 'i');
			query.$or = [{ slug: rx }, { sku: rx }, { tags: rx }];
		}

		const page = filter.page && filter.page > 0 ? filter.page : 1;
		const pageSize = filter.pageSize && filter.pageSize > 0 ? filter.pageSize : 20;

		const [docs, total] = await Promise.all([
			ProductModel.find(query)
				.sort({ createdAt: -1 })
				.skip((page - 1) * pageSize)
				.limit(pageSize)
				.lean<ProductDoc[]>()
				.exec(),
			ProductModel.countDocuments(query).exec(),
		]);

		return { items: docs.map(toProduct), total, page, pageSize };
	}

	async save(product: Product): Promise<Product> {
		const { id, ...rest } = product;
		const doc = await ProductModel.findByIdAndUpdate(
			id,
			{ $set: rest },
			{ upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
		)
			.lean<ProductDoc>()
			.exec();
		return toProduct(doc as ProductDoc);
	}

	async deleteById(id: string): Promise<void> {
		await ProductModel.deleteOne({ _id: id }).exec();
	}
}
