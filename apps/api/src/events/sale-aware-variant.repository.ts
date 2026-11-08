import type { ProductVariant } from '@saha-textile/contracts';
import type {
	CatalogAudience,
	Paginated,
	ProductVariantRepository,
	TransactionContext,
	VariantFilter,
} from '@saha-textile/core-domain';

import type { SalePriceBook } from './sale-price-book';

/**
 * Product variants with running sale prices laid over them, for shop reads only.
 *
 * Reads with the `public` audience see the sale price; admin reads and every write go
 * straight through, so a sale price can never be saved onto a product.
 */
export class SaleAwareVariantRepository implements ProductVariantRepository {
	constructor(
		private readonly inner: ProductVariantRepository,
		private readonly book: SalePriceBook,
	) {}

	private shop(row: ProductVariant, audience?: CatalogAudience): ProductVariant {
		return audience === 'public' ? this.book.overlay(row) : row;
	}

	async findById(variantId: string, audience?: CatalogAudience) {
		const row = await this.inner.findById(variantId, audience);
		return row ? this.shop(row, audience) : null;
	}

	async findBySku(sku: string, audience?: CatalogAudience) {
		const row = await this.inner.findBySku(sku, audience);
		return row ? this.shop(row, audience) : null;
	}

	findByOptionSelectionHash(productId: string, hash: string) {
		return this.inner.findByOptionSelectionHash(productId, hash);
	}

	async listForProduct(productId: string, audience?: CatalogAudience) {
		return (await this.inner.listForProduct(productId, audience)).map((row) => this.shop(row, audience));
	}

	async listForProducts(productIds: readonly string[], audience?: CatalogAudience) {
		return (await this.inner.listForProducts(productIds, audience)).map((row) => this.shop(row, audience));
	}

	async list(filter: VariantFilter): Promise<Paginated<ProductVariant>> {
		const page = await this.inner.list(filter);
		return { ...page, items: page.items.map((row) => this.shop(row, filter.audience)) };
	}

	save(variant: ProductVariant, context?: TransactionContext) {
		return this.inner.save(variant, context);
	}

	saveMany(variants: readonly ProductVariant[], context?: TransactionContext) {
		return this.inner.saveMany(variants, context);
	}

	deleteById(variantId: string, context?: TransactionContext) {
		return this.inner.deleteById(variantId, context);
	}
}
