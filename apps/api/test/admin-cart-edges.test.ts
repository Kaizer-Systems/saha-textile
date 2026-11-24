import { BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

/** The shop's own line pricing is tested in core-domain; here each product's priced row is set by the test. */
const rows = vi.hoisted(() => new Map<string, Record<string, unknown>>());
vi.mock('@saha-textile/core-domain', async (original) => ({
	...(await original<typeof import('@saha-textile/core-domain')>()),
	priceCartLine: (page: { id?: string }) => {
		const line = rows.get(page.id ?? '');
		return line ? { ok: true, line } : { ok: false, reason: 'unknown_variant' };
	},
}));

import { AdminCartService } from '../src/admin-orders/admin-cart.service';

const row = (over: Record<string, unknown> = {}) => ({
	sku: 'SAR-1',
	variationId: null,
	variantLabel: null,
	galleryIndex: null,
	basePriceINR: 1000,
	unitPriceINR: 1000,
	mrpINR: null,
	available: 5,
	buyable: true,
	soldBy: 'piece',
	shortestCutTenths: null,
	options: [],
	measurements: [],
	children: [],
	...over,
});
const page = (id: string, over: Record<string, unknown> = {}) => ({
	id,
	bundle: null,
	freeWith: null,
	soldBy: 'piece',
	gallery: [],
	optionGroups: [],
	variants: [],
	measurements: null,
	...over,
});
const product = (id: string, over: Record<string, unknown> = {}) => ({
	id,
	type: 'simple',
	title: { en: `${id} title` },
	categoryIds: ['cat_1'],
	soldBy: 'piece',
	...over,
});
const fact = (productId: string, over: Record<string, unknown> = {}) => ({
	facts: { productId, regularSellingINR: 1000, currentSaleINR: null },
	variant: { isBaseVariant: true, stock: { quantity: 5, held: 1, reserved: 1 } },
	...over,
});

interface Setup {
	reads?: Record<string, { title: string; page: unknown } | null>;
	cards?: unknown[];
	facts?: (items: Array<{ productId: string }>) => unknown[];
	products?: unknown[];
}

function setup(options: Setup = {}) {
	const catalog = {
		cartRead: async (id: string) => options.reads?.[id] ?? null,
		cardsForIds: async () => options.cards ?? [],
	};
	const zones = {
		factsFor: vi.fn(async (items: Array<{ productId: string }>) =>
			options.facts ? options.facts(items) : items.map((item) => fact(item.productId)),
		),
		// A zone that prices everything at ₹800 except products whose id starts `p_off`.
		price: (_pricing: unknown, facts: { productId: string }) => ({
			price: facts.productId.startsWith('p_off')
				? { kind: 'noPrice', reason: 'ruleSaysNoPrice' }
				: { kind: 'priced', unitPriceINR: 800, rule: { ruleId: 'all' }, addOns: null },
		}),
	};
	const currency = {
		convert: async (_amount: number, code: string) =>
			code === 'INR'
				? { currency: 'INR', rateFromINR: 1, markupPercent: 0, amount: 0 }
				: Promise.reject(new Error('no such currency')),
	};
	const businesses = {
		findById: async (id: string) =>
			(
				({
					biz_w: { id, roles: { customer: { zoneId: 'zone_w' } } },
					biz_plain: { id, roles: {} },
					biz_system: { id, roles: { customer: { zoneId: 'zone_system' } } },
				}) as Record<string, unknown>
			)[id] ?? null,
	};
	const priceZones = {
		findById: async (id: string) =>
			id === 'zone_w'
				? { id, system: false, status: 'live', rules: [] }
				: id === 'zone_system'
					? { id, system: true, status: 'live', rules: [] }
					: null,
	};
	const items = options.products ?? [];
	const products = { list: vi.fn(async () => ({ items, total: items.length })) };
	const service = new AdminCartService(
		catalog as never,
		zones as never,
		currency as never,
		businesses as never,
		priceZones as never,
		products as never,
	);
	return { service, zones, products };
}

const line = (productId: string, quantity = 1) => ({ productId, variationId: null, quantity, addons: [] });

describe('admin cart pricing: the remaining cases', () => {
	it('refuses an unknown business, and gives shop prices to one with no customer zone or a system zone', async () => {
		rows.set('p_1', row());
		const { service, zones } = setup({ reads: { p_1: { title: 'Saree', page: page('p_1') } } });
		await expect(
			service.price({ buyer: { kind: 'business', businessId: 'biz_none' }, currency: 'INR', lines: [] }),
		).rejects.toBeInstanceOf(NotFoundException);
		for (const businessId of ['biz_plain', 'biz_system']) {
			const view = await service.price({
				buyer: { kind: 'business', businessId },
				currency: 'INR',
				lines: [line('p_1')],
			});
			expect(view.lines[0]).toMatchObject({ zonePrice: null, unitPriceINR: 1000 });
		}
		expect(zones.factsFor).not.toHaveBeenCalled();
	});

	it('shows a line whose product is gone, or cannot be priced, as unavailable with what it knows', async () => {
		const { service } = setup({
			reads: { p_cloth: { title: 'Cloth', page: page('p_cloth', { soldBy: 'metre' }) } },
		});
		const view = await service.price({
			buyer: null,
			currency: 'INR',
			lines: [line('p_gone'), line('p_cloth', 20)],
		});
		expect(view.lines[0]).toMatchObject({
			title: '',
			sku: '',
			soldBy: 'piece',
			imageUrl: null,
			children: [],
			setHeading: null,
			setOnSale: false,
			problem: 'unavailable',
		});
		expect(view.lines[1]).toMatchObject({
			title: 'Cloth',
			soldBy: 'metre',
			imageUrl: null,
			children: [],
			problem: 'unavailable',
		});
		expect(view.subtotalINR).toBe(0);
	});

	it('carries measurements, free items and a set’s sale onto the line, and names what is sold out or off sale', async () => {
		const gift = {
			role: 'free',
			key: 'f1',
			parentKey: null,
			level: null,
			productId: 'p_gift',
			title: 'Gift pouch',
			sku: 'GIFT',
			variantId: null,
			variantLabel: null,
			quantity: 1,
			priceINR: 0,
			mrpINR: null,
		};
		rows.set(
			'p_tailored',
			row({
				measurements: [{ code: 'bust', label: 'Bust', value: 34, unit: 'in' }],
				children: [gift],
				setOnSale: true,
				available: 0,
			}),
		);
		rows.set('p_hidden', row({ buyable: false }));
		const { service } = setup({
			reads: {
				p_tailored: { title: 'Blouse', page: page('p_tailored') },
				p_hidden: { title: 'Hidden', page: page('p_hidden') },
			},
		});
		const view = await service.price({
			buyer: null,
			currency: 'INR',
			lines: [line('p_tailored'), line('p_hidden')],
		});
		expect(view.lines[0]).toMatchObject({
			measurements: [{ code: 'bust', label: 'Bust', value: '34 in' }],
			children: [expect.objectContaining({ role: 'free', productId: 'p_gift', image: null })],
			setOnSale: true,
			problem: 'out_of_stock',
		});
		expect(view.lines[1]).toMatchObject({ problem: 'unavailable', unitPriceINR: 0 });
		expect(view.subtotalINR).toBe(0);
	});

	it('refuses a currency that is not set up', async () => {
		await expect(setup().service.price({ buyer: null, currency: 'XYZ', lines: [] })).rejects.toBeInstanceOf(
			BadRequestException,
		);
	});
});

describe('admin product cards', () => {
	it('prices cards for a shop customer: names and photos from the card or the product, stock net of holds', async () => {
		const { service, products } = setup({
			products: [product('p_a', { shortestCutTenths: 10 }), product('p_b', { soldBy: 'metre' }), product('p_c')],
			cards: [{ id: 'p_a', title: 'Card A', image: { roles: { card: [{ url: 'https://cdn.test/a.webp' }] } } }],
			facts: () => [
				fact('p_a'),
				fact('p_b', { variant: { isBaseVariant: false, stock: { quantity: 1, held: 2, reserved: 0 } } }),
			],
		});
		const { items, total } = await service.cards({ q: '', page: 1, pageSize: 20, currency: 'INR' } as never);
		expect(total).toBe(3);
		expect(items[0]).toMatchObject({
			title: 'Card A',
			imageUrl: 'https://cdn.test/a.webp',
			hasVariants: false,
			shortestCutTenths: 10,
			stock: 3,
			retailINR: 1000,
			price: 1000,
			zonePrice: null,
			isBundle: false,
		});
		expect(items[1]).toMatchObject({
			title: 'p_b title',
			imageUrl: null,
			hasVariants: true,
			shortestCutTenths: null,
			stock: 0,
		});
		expect(items[2]).toMatchObject({ retailINR: 0, stock: null, hasVariants: false, price: 0 });
		expect(products.list).toHaveBeenCalledWith(expect.objectContaining({ categoryIds: undefined }));
	});

	it('prices cards by a business zone within a category, greying what the zone does not price', async () => {
		const { service, products } = setup({
			products: [product('p_a'), product('p_off_1'), product('p_c')],
			facts: (items) => items.slice(0, 2).map((item) => fact(item.productId)),
		});
		const { items } = await service.cards(
			{ q: 'silk', categoryId: 'cat_1', businessId: 'biz_w', page: 1, pageSize: 20, currency: 'INR' } as never,
			new Date('2026-11-24T00:00:00.000Z'),
		);
		expect(items.map((item) => [item.productId, item.price])).toEqual([
			['p_a', 800],
			['p_off_1', null],
			['p_c', 0],
		]);
		expect(items[2]?.zonePrice).toBeNull();
		expect(products.list).toHaveBeenCalledWith(expect.objectContaining({ categoryIds: ['cat_1'] }));
	});

	it('shows a set at its own price and stock, and a set whose page is gone as a plain card', async () => {
		const { service } = setup({
			products: [product('p_set', { type: 'bundle' }), product('p_set_gone', { type: 'bundle' })],
			reads: {
				p_set: {
					title: 'Set',
					page: page('p_set', { bundle: { priceINR: 5000, stock: { setsPossible: 2 } } }),
				},
			},
			cards: [{ id: 'p_set', title: 'Wedding set', image: null }],
		});
		const { items } = await service.cards({ q: '', page: 1, pageSize: 20, currency: 'INR' } as never);
		expect(items[0]).toMatchObject({
			title: 'Wedding set',
			imageUrl: null,
			isBundle: true,
			stock: 2,
			retailINR: 5000,
			price: 5000,
			setsPossible: 2,
		});
		expect(items[1]).toMatchObject({ title: 'p_set_gone title', isBundle: false, setsPossible: null });
		const plain = setup({
			products: [product('p_set', { type: 'bundle' })],
			reads: { p_set: { title: 'Set', page: page('p_set') } },
		});
		expect(
			(await plain.service.cards({ q: '', page: 1, pageSize: 20, currency: 'INR' } as never)).items[0]?.isBundle,
		).toBe(false);
	});
});

describe('admin variant choices: the remaining cases', () => {
	const variant = (id: string, selections: Record<string, string>, over: Record<string, unknown> = {}) => ({
		id,
		sku: `SKU-${id}`,
		selections,
		sellingINR: 900,
		quantity: 3,
		buyable: true,
		galleryIndex: null,
		...over,
	});

	it('lists nothing when no variant is for sale, without asking for zone facts', async () => {
		const { service, zones } = setup({
			reads: {
				p_none: { title: 'None', page: page('p_none', { variants: [variant('v1', {}, { buyable: false })] }) },
			},
		});
		expect((await service.variantChoices('p_none', { currency: 'INR' } as never)).items).toEqual([]);
		expect(zones.factsFor).not.toHaveBeenCalled();
	});

	it('names a variant by its terms, its code for an unknown term, or its SKU; stock and price without facts', async () => {
		const colours = [{ code: 'colour', terms: [{ code: 'red', label: 'Red' }] }];
		const { service } = setup({
			reads: {
				p_v: {
					title: 'Saree',
					page: page('p_v', {
						optionGroups: colours,
						variants: [
							variant('v1', { colour: 'red' }),
							variant('v2', { colour: 'teal' }),
							variant('v3', {}),
							variant('v4', { size: 'L' }),
						],
					}),
				},
			},
			facts: () => [
				{
					facts: { productId: 'p_v', regularSellingINR: 1000, currentSaleINR: 950 },
					variant: { stock: { quantity: 4, held: 1, reserved: 0 } },
				},
				{ facts: { productId: 'p_v', regularSellingINR: 1000, currentSaleINR: null } },
			],
		});
		const choices = await service.variantChoices(
			'p_v',
			{ currency: 'INR' } as never,
			new Date('2026-11-24T00:00:00.000Z'),
		);
		expect(choices.items.map((item) => [item.label, item.stock, item.retailINR, item.price])).toEqual([
			['Red', 3, 950, 950],
			['teal', 3, 1000, 1000],
			['SKU-v3', 3, 900, 900],
			['L', 3, 900, 900],
		]);
	});

	it('gives no price where the business zone does not price a variant', async () => {
		const { service } = setup({
			reads: { p_off_v: { title: 'Off', page: page('p_off_v', { variants: [variant('v1', {})] }) } },
		});
		const choices = await service.variantChoices('p_off_v', { businessId: 'biz_w', currency: 'INR' } as never);
		expect(choices.items[0]).toMatchObject({ price: null, zonePrice: { kind: 'noPrice' } });
	});
});
