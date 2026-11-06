import { CatalogCard } from '@saha-textile/contracts';
import type { OrderRepository } from '@saha-textile/core-domain';
import { describe, expect, it, vi } from 'vitest';

import type { CatalogPublicService } from '../src/catalog/catalog-public.service';
import { RecentPurchasesService } from '../src/catalog/recent-purchases.service';

const now = new Date('2026-11-06T12:00:00.000Z');

const card = (id: string, inStock = true) =>
	CatalogCard.parse({
		id,
		slug: id,
		title: id,
		path: `/product/${id}`,
		price: { kind: 'single', sellingINR: 1000, mrpINR: null, percentOff: null },
		badges: [],
		sku: null,
		image: null,
		inStock,
		madeToOrder: false,
	});

function service(purchases: { productId: string; purchasedAt: string }[], cards: CatalogCard[]) {
	const listRecentlyPurchased = vi.fn().mockResolvedValue(purchases);
	const orders = { listRecentlyPurchased } as unknown as OrderRepository;
	const catalog = { cardsForIds: vi.fn().mockResolvedValue(cards) } as unknown as CatalogPublicService;
	return { recent: new RecentPurchasesService(orders, catalog), listRecentlyPurchased };
}

describe('recent purchases', () => {
	it('is empty when nothing was sold, which keeps the popup hidden', async () => {
		const { recent } = service([], []);

		await expect(recent.list(now)).resolves.toEqual({ items: [] });
	});

	it('looks back one day from now', async () => {
		const { recent, listRecentlyPurchased } = service([], []);

		await recent.list(now);

		expect(listRecentlyPurchased).toHaveBeenCalledWith('2026-11-05T12:00:00.000Z', 12);
	});

	it('keeps the real sale time and leaves out what cannot be bought', async () => {
		const purchasedAt = '2026-11-06T11:40:00.000Z';
		const { recent } = service(
			[
				{ productId: 'on-sale', purchasedAt },
				{ productId: 'sold-out', purchasedAt },
				{ productId: 'withdrawn', purchasedAt },
			],
			[card('on-sale'), card('sold-out', false)],
		);

		const { items } = await recent.list(now);

		expect(items.map((item) => [item.card.id, item.purchasedAt])).toEqual([['on-sale', purchasedAt]]);
	});

	it('carries only the product and the time', async () => {
		const { recent } = service(
			[{ productId: 'on-sale', purchasedAt: '2026-11-06T11:40:00.000Z' }],
			[card('on-sale')],
		);

		const { items } = await recent.list(now);

		expect(Object.keys(items[0] ?? {}).sort()).toEqual(['card', 'purchasedAt']);
	});
});
