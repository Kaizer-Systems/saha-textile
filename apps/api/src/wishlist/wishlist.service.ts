import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { WISHLIST_ACCOUNT_LIMIT, type WishlistIds, type WishlistView } from '@saha-textile/contracts';
import type { ProductRepository, WishlistRepository } from '@saha-textile/core-domain';

import { domainRefusal } from '../auth/domain-refusal';
import { CatalogPublicService } from '../catalog/catalog-public.service';
import { PRODUCT_REPOSITORY, WISHLIST_REPOSITORY } from '../infra/tokens';

/**
 * A signed-in customer's wishlist (owner decision 2026-11-08). Only products on sale can be
 * saved; a saved product that later leaves the shop stays in the list (its heart stays red)
 * until the customer removes it, and the page simply has no card for it.
 */
@Injectable()
export class WishlistService {
	constructor(
		@Inject(WISHLIST_REPOSITORY) private readonly wishlist: WishlistRepository,
		@Inject(PRODUCT_REPOSITORY) private readonly products: ProductRepository,
		private readonly catalog: CatalogPublicService,
	) {}

	async view(customerId: string): Promise<WishlistView> {
		const productIds = await this.wishlist.listProductIds(customerId);
		return { productIds, items: await this.catalog.cardsForIds(productIds) };
	}

	async add(customerId: string, productId: string, now = new Date()): Promise<WishlistIds> {
		const current = await this.wishlist.listProductIds(customerId);
		if (current.includes(productId)) return { productIds: current };
		if (current.length >= WISHLIST_ACCOUNT_LIMIT) {
			throw domainRefusal('wishlist_full', 'Your wishlist is full. Remove something to save this.');
		}
		if (!(await this.products.findById(productId, 'public'))) throw new NotFoundException('Product not found');
		await this.wishlist.add({ customerId, productId, at: now.toISOString() });
		return { productIds: [productId, ...current] };
	}

	async remove(customerId: string, productId: string): Promise<WishlistIds> {
		await this.wishlist.remove({ customerId, productId });
		return { productIds: await this.wishlist.listProductIds(customerId) };
	}

	/** The guest list on sign-in: products on sale, not saved yet, within the account ceiling. */
	async merge(customerId: string, productIds: readonly string[], now = new Date()): Promise<WishlistIds> {
		const current = new Set(await this.wishlist.listProductIds(customerId));
		const room = Math.max(0, WISHLIST_ACCOUNT_LIMIT - current.size);
		const fresh = [...new Set(productIds)].filter((id) => !current.has(id));
		const live = (await Promise.all(fresh.map((id) => this.products.findById(id, 'public'))))
			.filter((product) => product !== null)
			.map((product) => product.id)
			.slice(0, room);
		await this.wishlist.addMany({ customerId, productIds: live, at: now.toISOString() });
		return { productIds: await this.wishlist.listProductIds(customerId) };
	}
}
