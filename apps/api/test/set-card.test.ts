import { CatalogCard } from '@saha-textile/contracts';
import { describe, expect, it } from 'vitest';

import { setCard } from '../src/catalog/catalog-public.service';

const card = CatalogCard.parse({
	id: 'prd_1',
	slug: 'set',
	title: 'Peacock set',
	path: '/product/set',
	price: { kind: 'single', sellingINR: 0, mrpINR: null, percentOff: null },
	badges: [],
	sku: 'BND-1',
	image: null,
	inStock: false,
	madeToOrder: false,
});
const item = (over: Record<string, unknown> = {}) => ({ variantId: 'v1', variants: [], freeWith: null, ...over });
const set = (over: Record<string, unknown> = {}) =>
	({
		heading: 'components',
		priceINR: 44900,
		separatelyINR: 48400,
		saveINR: 3500,
		fromPrice: false,
		lowINR: 44900,
		highINR: 44900,
		levels: [
			{ take: 1, items: [item()] },
			{ take: 1, items: [item()] },
		],
		buyable: true,
		...over,
	}) as never;

describe('a set’s card (bundle builder brief G02)', () => {
	it('a fixed set shows its price with the pieces’ total struck, and adds from the card', () => {
		expect(setCard(card, set())).toMatchObject({
			price: { kind: 'single', sellingINR: 44900, mrpINR: 48400, percentOff: 7 },
			inStock: true,
			set: { pieces: 2, choose: false },
		});
	});

	it('a set with a choice, a size to pick or a free item to choose says "From" and Choose', () => {
		expect(setCard(card, set({ fromPrice: true, lowINR: 41000 }))).toMatchObject({
			price: { sellingINR: 41000, mrpINR: null },
			set: { choose: true },
		});
		const sized = set({ levels: [{ take: 1, items: [item({ variantId: null, variants: [{ id: 'm' }] })] }] });
		expect(setCard(card, sized).set).toEqual({ pieces: 1, choose: true });
		const free = set({ levels: [{ take: 1, items: [item({ freeWith: { given: false, min: 1 } })] }] });
		expect(setCard(card, free).set?.choose).toBe(true);
		expect(setCard(card, set({ buyable: false })).inStock).toBe(false);
	});
});
