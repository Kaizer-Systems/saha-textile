import { Logger } from '@nestjs/common';
import type { ProductBundleRepository, ProductRepository } from '@saha-textile/core-domain';

import type { BundleReader } from './bundle-reader';

/**
 * Keeps each bundle's worked-out stock current (V3, approved 22 Nov 2026): whenever a piece's stock moves (purchase
 * entry, order, return, count, adjustment, the product form), every bundle holding that piece is worked out again
 * and saved, so the Bundles list and its filters stay fast on a large catalogue. The shop page works it out live
 * from the same pieces, so a refresh that fails only leaves the admin list a moment behind.
 */
export class BundleStockService {
	private readonly logger = new Logger('BundleStock');

	constructor(
		private readonly bundles: ProductBundleRepository,
		private readonly products: ProductRepository,
		private readonly reader: BundleReader,
	) {}

	/** Refreshes every bundle holding any of these products. Never throws: a stock move must not fail on it. */
	async refreshContaining(productIds: readonly string[]): Promise<number> {
		let refreshed = 0;
		try {
			const seen = new Set<string>();
			for (const productId of new Set(productIds)) {
				for (const bundle of await this.bundles.listContaining(productId)) {
					if (seen.has(bundle.productId)) continue;
					seen.add(bundle.productId);
					await this.refreshBundle(bundle.productId);
					refreshed += 1;
				}
			}
		} catch (error) {
			this.logger.warn(`Bundle stock not refreshed: ${error instanceof Error ? error.message : String(error)}`);
		}
		return refreshed;
	}

	/** Works out one bundle's stock now and saves it. */
	async refreshBundle(bundleProductId: string): Promise<void> {
		const bundle = await this.bundles.findByProductId(bundleProductId, 'admin');
		if (!bundle) return;
		const product = await this.products.findById(bundleProductId, 'admin');
		const stock = this.reader.stock(await this.reader.resolve(bundle), product?.lowStockThreshold ?? null);
		await this.bundles.saveStock(bundleProductId, stock);
	}
}
