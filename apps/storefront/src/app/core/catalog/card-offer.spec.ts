import { afterEach, describe, expect, it } from 'vitest';

import { IProduct, IVariation } from '@data-access/interfaces/product.interface';

import { cardOffer } from './card-offer';

function product(overrides: Partial<IProduct> = {}, variations: Partial<IVariation>[] = []): IProduct {
	return {
		id: 1,
		name: 'Banarasi',
		slug: 'banarasi',
		price: 3950,
		sale_price: 2950,
		discount: 25,
		stock_status: 'in_stock',
		quantity: 4,
		is_featured: false,
		published_at: '',
		variations: variations.map(
			(row, index) =>
				({
					id: index + 1,
					name: `v${index}`,
					price: 3950,
					sale_price: 2950,
					stock_status: 'in_stock',
					sku: `sku-${index}`,
					discount: 25,
					quantity: 2,
					status: true,
					...row,
				}) as IVariation,
		),
		...overrides,
	} as IProduct;
}

describe('cardOffer', () => {
	it('shows one price when every variant shares the selling price and the MRP', () => {
		const offer = cardOffer(product({}, [{}, {}]));
		expect(offer.kind).toBe('single');
		expect(offer.selling).toBe(2950);
		expect(offer.mrp).toBe(3950);
		expect(offer.percentOff).toBe(25);
	});

	it('shows a range and no percent when the prices differ', () => {
		const offer = cardOffer(product({}, [{ sale_price: 2450 }, { sale_price: 3950, price: 3950 }]));
		expect(offer).toMatchObject({ kind: 'range', min: 2450, max: 3950, percentOff: null, mrp: null });
	});

	it('shows the two badge slots the API chose and invents none of its own', () => {
		const chosen = cardOffer(product({ card_badges: { primary: 'bestseller', secondary: 'low_stock' } }));
		expect(chosen.primary).toBe('badge_bestseller');
		expect(chosen.secondary).toBe('badge_low_stock');
		const featuredOnly = cardOffer(product({ is_featured: true, card_badges: { primary: null, secondary: null } }));
		expect(featuredOnly.primary).toBeNull();
		expect(cardOffer(product()).secondary).toBeNull();
		expect(cardOffer(product({ is_featured: true })).primary).toBe('badge_featured');
	});
});

describe('cardBadges', () => {
	it('puts a promotion in the first slot and a stock fact in the second', async () => {
		const { cardBadges } = await import('./from-api');
		expect(cardBadges(['back_in_stock'])).toEqual({ primary: null, secondary: 'back_in_stock' });
		expect(cardBadges(['sale', 'low_stock'])).toEqual({ primary: 'sale', secondary: 'low_stock' });
	});
});
