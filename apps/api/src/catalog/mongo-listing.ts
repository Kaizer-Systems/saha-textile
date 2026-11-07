import type { Product, ProductVariant } from '@saha-textile/contracts';
import {
	listingFacets,
	matchesListing,
	sortListing,
	type ListingPage,
	type ListingPort,
	type ListingQuery,
	type ProductRepository,
	type ProductVariantRepository,
} from '@saha-textile/core-domain';

import { filterableCodes, listingRow } from './listing-row';

const READ_PAGE = 200;

/**
 * Listings straight from Mongo: always exact, and the fallback when search cannot answer. It
 * reads the whole category, which is fine for a boutique catalogue and slow for a huge one.
 */
export class MongoListing implements ListingPort {
	constructor(
		private readonly products: ProductRepository,
		private readonly variants: ProductVariantRepository,
	) {}

	async page(query: ListingQuery): Promise<ListingPage> {
		const products = await this.publicProducts(query.categoryId);
		const variants = await this.variantsByProduct(products);
		const filterable = filterableCodes(products);
		const rows = products.map((product) => listingRow(product, variants.get(product.id) ?? [], filterable));
		const sorted = sortListing(
			rows.filter((row) => matchesListing(row, query.filters)),
			query.sort,
		);
		const start = (query.page - 1) * query.pageSize;
		return {
			productIds: sorted.slice(start, start + query.pageSize).map((row) => row.id),
			total: sorted.length,
			facets: listingFacets(rows, query.filters),
		};
	}

	private async publicProducts(categoryId: string | undefined): Promise<Product[]> {
		const found: Product[] = [];
		for (let page = 1; ; page += 1) {
			const { items, total } = await this.products.list({
				audience: 'public',
				...(categoryId ? { categoryId } : {}),
				page,
				pageSize: READ_PAGE,
			});
			found.push(...items);
			if (!items.length || found.length >= total) return found;
		}
	}

	private async variantsByProduct(products: readonly Product[]): Promise<Map<string, ProductVariant[]>> {
		const rows = await this.variants.listForProducts(
			products.map((product) => product.id),
			'public',
		);
		const grouped = new Map<string, ProductVariant[]>();
		for (const row of rows) grouped.set(row.productId, [...(grouped.get(row.productId) ?? []), row]);
		return grouped;
	}
}
