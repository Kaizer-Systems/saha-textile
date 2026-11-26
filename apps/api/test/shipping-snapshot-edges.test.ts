import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

/** The shop's own line pricing is tested in core-domain; here each product's priced row is set by the test. */
const priced = vi.hoisted(() => new Map<string, Record<string, unknown> | string>());
vi.mock('@saha-textile/core-domain', async (original) => ({
	...(await original<typeof import('@saha-textile/core-domain')>()),
	priceCartLine: (page: { id?: string }) => {
		const row = priced.get(page.id ?? '');
		if (typeof row === 'string') return { ok: false, reason: row };
		return {
			ok: true,
			line: {
				sku: 'SKU',
				variationId: null,
				variantLabel: null,
				galleryIndex: null,
				available: null,
				buyable: true,
				shortestCutTenths: null,
				options: [],
				measurements: [],
				children: [],
				basePriceINR: 1000,
				unitPriceINR: 1000,
				mrpINR: null,
				soldBy: 'piece',
				...row,
			},
		};
	},
}));

import { ShippingSnapshotService, defaultVariationId } from '../src/shipping/shipping-snapshot.service';

const page = (id: string, over: Record<string, unknown> = {}) => ({
	id,
	variants: [],
	gallery: [],
	saleEndsAt: null,
	madeToOrder: false,
	...over,
});
const product = (id: string, over: Record<string, unknown> = {}) => ({
	id,
	categoryIds: [],
	shippingCharges: null,
	shippingDefaults: null,
	weightPerMetreGrams: null,
	...over,
});
const photo = (roles: Record<string, Array<{ url: string }>>) => ({ roles });

function setup(
	pages: Record<string, unknown>,
	products: Record<string, unknown>,
	categories: Record<string, unknown> = {},
) {
	const variants = { findById: vi.fn(async () => ({ shippingProfile: { weightGrams: 300 } })) };
	return {
		service: new ShippingSnapshotService(
			{
				cartRead: async (id: string) => (id in pages ? { title: `Title ${id}`, page: pages[id] } : null),
			} as never,
			{ findById: async (id: string) => products[id] ?? null } as never,
			variants as never,
			{ findById: async (id: string) => categories[id] ?? null } as never,
		),
		variants,
	};
}

const delivery = { country: 'IN', state: 'West Bengal', pincode: '700045' };
const shopper = { signedIn: false, groups: [], firstOrder: true };
const defaults = { domestic: 50, internationalFirst: 1500, internationalFurther: 700 };
const lines = (...ids: Array<[string, string | null]>) =>
	ids.map(([productId, variationId]) => ({ productId, variationId, quantity: 1 }));

describe('the shipping snapshot: the remaining cases', () => {
	it('refuses a product off the shop or missing, and one the cart cannot price', async () => {
		priced.set('p_needs', 'measurements_required');
		const { service } = setup(
			{ p_page_only: page('p_page_only'), p_needs: page('p_needs') },
			{ p_needs: product('p_needs') },
		);
		await expect(service.build(lines(['p_gone', null]), delivery, shopper, defaults)).rejects.toBeInstanceOf(
			BadRequestException,
		);
		await expect(service.build(lines(['p_page_only', null]), delivery, shopper, defaults)).rejects.toBeInstanceOf(
			BadRequestException,
		);
		await expect(service.build(lines(['p_needs', null]), delivery, shopper, defaults)).rejects.toMatchObject({
			response: { issues: [{ code: 'measurements_required' }] },
		});
	});

	it('uses the shop defaults for a product in no category, and reads a chosen option’s own box', async () => {
		priced.set('p_plain', {});
		const { service, variants } = setup({ p_plain: page('p_plain') }, { p_plain: product('p_plain') });
		const { snapshot, views } = await service.build(lines(['p_plain', 'var_1']), delivery, shopper, defaults);
		expect(variants.findById).toHaveBeenCalledWith('var_1', 'admin');
		expect(snapshot.lines[0]).toMatchObject({
			mainCategoryId: null,
			mainCategoryAncestorIds: [],
			freeShipping: false,
			charges: defaults,
		});
		expect(views[0]?.chargeSources?.domestic).toEqual({ from: 'shopDefault', name: null });
		expect(views[0]?.imageUrl).toBeNull();
	});

	it('weighs a length of fabric by its box when it has no weight a metre', async () => {
		priced.set('p_cloth', { soldBy: 'metre' });
		const { service } = setup(
			{ p_cloth: page('p_cloth') },
			{
				p_cloth: product('p_cloth', {
					shippingDefaults: { weightGrams: 400, lengthCm: null, widthCm: null, heightCm: null },
				}),
			},
		);
		const { snapshot, views } = await service.build(lines(['p_cloth', null]), delivery, shopper, defaults);
		expect(snapshot.lines[0]).toMatchObject({ units: 1, chargeableWeightGrams: 400 });
		expect(views[0]?.box).toBeNull();
	});

	it('names a category by another language or not at all, skips a parent that is gone, and draws a card or gallery photo', async () => {
		priced.set('p_bn', {});
		priced.set('p_blank', {});
		const charging = {
			domesticINR: 90,
			internationalFirstINR: null,
			internationalFurtherINR: null,
			weightGrams: null,
			lengthCm: null,
			widthCm: null,
			heightCm: null,
		};
		const { service } = setup(
			{
				p_bn: page('p_bn', { gallery: [photo({ card: [{ url: 'card.webp' }] })] }),
				p_blank: page('p_blank', { gallery: [photo({ gallery: [{ url: 'gallery.webp' }] })] }),
			},
			{
				p_bn: product('p_bn', { categoryIds: ['cat_bn'] }),
				p_blank: product('p_blank', { categoryIds: ['cat_blank'] }),
			},
			{
				cat_bn: { id: 'cat_bn', name: { bn: 'শাড়ি' }, ancestors: ['cat_gone'], shipping: charging },
				cat_blank: { id: 'cat_blank', name: {}, ancestors: [], shipping: charging },
			},
		);
		const { snapshot, views } = await service.build(
			lines(['p_bn', null], ['p_blank', null]),
			delivery,
			shopper,
			defaults,
		);
		expect(snapshot.lines[0]?.mainCategoryAncestorIds).toEqual([]);
		expect(views[0]?.chargeSources?.domestic).toEqual({ from: 'category', name: 'শাড়ি' });
		expect(views[1]?.chargeSources?.domestic).toEqual({ from: 'category', name: null });
		expect(views.map((view) => view.imageUrl)).toEqual(['card.webp', 'gallery.webp']);
	});

	it('draws no thumbnail from a photo with neither a card nor a gallery size', async () => {
		priced.set('p_odd', {});
		const { service } = setup(
			{ p_odd: page('p_odd', { gallery: [photo({ swatch: [{ url: 's.webp' }] })] }) },
			{ p_odd: product('p_odd') },
		);
		expect(
			(await service.build(lines(['p_odd', null]), delivery, shopper, defaults)).views[0]?.imageUrl,
		).toBeNull();
	});
});

describe('the option a card prices by default', () => {
	it('is none without options, the first buyable one, else the first', () => {
		expect(defaultVariationId({ variants: [] } as never)).toBeUndefined();
		expect(
			defaultVariationId({
				variants: [
					{ id: 'v1', buyable: false },
					{ id: 'v2', buyable: true },
				],
			} as never),
		).toBe('v2');
		expect(defaultVariationId({ variants: [{ id: 'v1', buyable: false }] } as never)).toBe('v1');
	});
});
