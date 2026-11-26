import { describe, expect, it, vi } from 'vitest';

import type { Cart, CartLine } from '@saha-textile/contracts';

import { CartLinesService, imageOf } from '../src/cart/cart-lines.service';
import { CartService } from '../src/cart/cart.service';
import { loadConfig } from '../src/config/app-config';

const config = loadConfig({
	JWT_ACCESS_SECRET: 'a'.repeat(32),
	JWT_REFRESH_SECRET: 'b'.repeat(32),
	CSRF_SECRET: 'c'.repeat(32),
});

const shopper = {
	userId: 'cus_1',
	sessionId: 's',
	audience: 'storefront',
	role: null,
	permissions: [],
} as never;

const image = {
	assetId: 'a1',
	width: 300,
	height: 400,
	alt: 'Silk',
	dominantColor: null,
	thumbHash: null,
	roles: { gallery: [{ url: 'https://cdn.example.test/a.webp', width: 300, height: 400, format: 'image/webp' }] },
};

const page = (over: Record<string, unknown> = {}) => ({
	slug: 'silk',
	title: 'Silk',
	madeToOrder: false,
	selected: { sku: 'S1', sellingINR: 1000, mrpINR: 1200, quantity: 3, buyable: true },
	gallery: [image],
	optionGroups: [],
	variants: [],
	measurements: null,
	bundle: null,
	...over,
});

const stored = (over: Partial<CartLine> = {}): CartLine => ({
	id: 'line_1',
	productId: 'p1',
	variationId: null,
	quantity: 1,
	addons: [],
	bundle: null,
	free: [],
	...over,
});

const harness = () => {
	const carts = {
		findById: vi.fn(),
		findByUserId: vi.fn(async () => null as Cart | null),
		findByGuestToken: vi.fn(async () => null as Cart | null),
		save: vi.fn(async (cart: Cart) => cart),
		deleteById: vi.fn(),
	};
	const ownership = new CartService(carts as never, config);
	const catalog = {
		cartRead: vi.fn(async (): Promise<unknown> => ({ slug: 'silk', title: 'Silk', page: page() })),
	};
	return { carts, catalog, ownership, service: new CartLinesService(carts as never, ownership, catalog as never) };
};

const owned = (lines: CartLine[] = [stored()]): Cart => ({
	id: 'cart_1',
	userId: 'cus_1',
	guestToken: null,
	currency: 'INR',
	lines,
});

const gift = (productId: string, assetId: string | null) => ({
	productId,
	title: productId,
	image: assetId ? { ...image, assetId } : null,
	mrpINR: 500,
	sellingINR: 400,
	quantity: 1,
	inStock: true,
	variantId: null,
	variantLabel: null,
	variants: [],
});
const freeWith = (items: unknown[]) => ({
	take: 'all',
	count: null,
	from: null,
	required: true,
	given: true,
	min: items.length,
	max: items.length,
	noneOrExactly: false,
	items,
});
const piece = (productId: string, assetId: string, over: Record<string, unknown> = {}) => ({
	key: productId,
	productId,
	image: { ...image, assetId },
	freeWith: null,
	...over,
});

describe('a child row’s picture', () => {
	it('is a set piece’s or extra’s own photo, else a free item’s, else none', () => {
		const set = page({
			bundle: {
				levels: [
					{ items: [piece('p_saree', 'a_saree', { freeWith: freeWith([gift('p_pouch', 'a_pouch')]) })] },
				],
				extras: [piece('p_blouse', 'a_blouse')],
			},
			freeWith: freeWith([gift('p_card', null)]),
		}) as never;
		expect(imageOf(set, 'p_saree')?.assetId).toBe('a_saree');
		expect(imageOf(set, 'p_blouse')?.assetId).toBe('a_blouse');
		expect(imageOf(set, 'p_pouch')?.assetId).toBe('a_pouch');
		expect(imageOf(set, 'p_card')).toBeNull();
		expect(imageOf(set, 'p_stranger')).toBeNull();
		expect(imageOf(page() as never, 'p_stranger')).toBeNull();
	});
});

describe('cart lines: older rows and free items', () => {
	it('reads and edits a line saved before free items existed as having none', async () => {
		const h = harness();
		const older = { ...stored(), free: undefined } as unknown as CartLine;
		h.carts.findByUserId.mockResolvedValue(owned([older]));
		expect((await h.service.current({ principal: shopper })).lines[0]).toMatchObject({ free: [] });
		const edited = await h.service.update('line_1', { quantity: 2 } as never, { principal: shopper });
		expect(edited.lines[0]).toMatchObject({ quantity: 2, free: [] });
	});

	it('lists a product’s own free items under its line', async () => {
		const h = harness();
		h.catalog.cartRead.mockResolvedValue({
			slug: 'silk',
			title: 'Silk',
			page: page({ freeWith: freeWith([gift('p_pouch', 'a_pouch')]) }),
		});
		h.carts.findByUserId.mockResolvedValue(owned());
		const view = await h.service.current({ principal: shopper });
		expect(view.lines[0]?.children).toEqual([expect.objectContaining({ productId: 'p_pouch', role: 'free' })]);
	});
});
