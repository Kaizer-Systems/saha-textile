import { Inject, Injectable } from '@nestjs/common';
import { RecentPurchases } from '@saha-textile/contracts';
import type { OrderRepository } from '@saha-textile/core-domain';

import { ORDER_REPOSITORY } from '../infra/tokens';
import { CatalogPublicService } from './catalog-public.service';

const WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_ORDERS = 12;

/**
 * Real sales for the storefront's "someone recently purchased" popup. An empty list hides the
 * popup, so it starts by itself once paid orders exist and goes quiet when sales stop. A product
 * nobody can buy right now is left out: there is nothing for the shopper to act on.
 */
@Injectable()
export class RecentPurchasesService {
	constructor(
		@Inject(ORDER_REPOSITORY) private readonly orders: OrderRepository,
		private readonly catalog: CatalogPublicService,
	) {}

	async list(now = new Date()): Promise<RecentPurchases> {
		const since = new Date(now.getTime() - WINDOW_MS).toISOString();
		const purchases = await this.orders.listRecentlyPurchased(since, MAX_ORDERS);
		const cards = await this.catalog.cardsForIds(purchases.map((purchase) => purchase.productId));
		const onSale = new Map(cards.filter((card) => card.inStock).map((card) => [card.id, card]));
		return RecentPurchases.parse({
			items: purchases.flatMap(({ productId, purchasedAt }) => {
				const card = onSale.get(productId);
				return card ? [{ card, purchasedAt }] : [];
			}),
		});
	}
}
