import { NotFoundException } from '@nestjs/common';
import { CatalogPlacementQuery, Product, ProductVariant } from '@saha-textile/contracts';
import { cleanListingParams } from '@saha-textile/core-domain';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import { CatalogPublicService } from '../src/catalog/catalog-public.service';

type Variant = z.output<typeof ProductVariant>;

const product = Product.parse({
	id: 'prd_kurti',
	type: 'variable',
	sku: 'KPS',
	title: { en: 'Kurti Palazzo Set' },
	slug: 'kurti-palazzo-set',
	basePriceINR: 2400,
	status: 'live',
	lifecycle: { liveAt: '2026-10-01T00:00:00.000Z' },
	addonTemplateCode: 'blouse-measurements',
	optionGroups: [
		{
			attributeCode: 'size',
			label: { en: 'Size' },
			semanticRole: 'variation_axis',
			displayStyle: 'circle',
			requiredSelection: true,
			terms: [
				{ code: 's', label: { en: 'S' } },
				{ code: 'm', label: { en: 'M' } },
			],
		},
		{
			attributeCode: 'blouse-design',
			label: { en: 'Blouse Designs' },
			semanticRole: 'named_add_on',
			displayStyle: 'image_tile',
			requiredSelection: true,
			defaultTermCode: 'no-design',
			terms: [
				{ code: 'no-design', label: { en: 'No Design' }, isBase: true, priceDeltaINR: 0 },
				{ code: 'design-1', label: { en: 'Design 1' }, priceDeltaINR: 750, requiresMeasurements: true },
			],
		},
	],
});

function variant(sku: string, size: string, priceINR: number, salePriceINR: number | null = null): Variant {
	return ProductVariant.parse({
		id: `var_${sku}`,
		productId: product.id,
		sku,
		status: 'live',
		optionSelections: [
			{ attributeCode: 'size', termCode: size },
			{ attributeCode: 'row', termCode: sku },
		],
		optionSelectionHash: `size:${size}`,
		isBaseVariant: size === 's',
		priceINR,
		compareAtPriceINR: salePriceINR === null ? null : priceINR,
		salePriceINR,
		stock: { quantity: 3 },
	});
}

function pageService(status: Product['status'] = 'live') {
	const current = { ...product, status };
	const products = {
		findBySlug: async (slug: string, audience?: string) =>
			slug === current.slug && (audience !== 'public' || current.status === 'live') ? current : null,
		findById: async () => null,
	};
	const variants = {
		listForProduct: async () => [variant('KPS-1', 's', 2400), variant('KPS-2', 'm', 2400, 2000)],
		listForProducts: async () => [],
	};
	const addonTemplates = {
		findByCode: async (code: string) =>
			code === 'blouse-measurements'
				? {
						code,
						label: { en: 'Blouse measurements' },
						priceINR: 0,
						fields: [{ code: 'chest', label: 'Chest', unit: 'in', min: 24, max: 50, step: 0.5 }],
					}
				: null,
	};
	return new CatalogPublicService(
		products as never,
		variants as never,
		null,
		null,
		null,
		null,
		addonTemplates as never,
		null,
	);
}

describe('product page read', () => {
	it('returns every option group, axis-only variant selections, and the measurement form', async () => {
		const page = await pageService().page('kurti-palazzo-set');
		expect(page.optionGroups.map((group) => [group.code, group.role, group.displayStyle])).toEqual([
			['size', 'variation_axis', 'circle'],
			['blouse-design', 'named_add_on', 'image_tile'],
		]);
		expect(page.optionGroups[1]?.defaultTermCode).toBe('no-design');
		expect(page.optionGroups[1]?.terms[1]).toMatchObject({ priceDeltaINR: 750, requiresMeasurements: true });
		expect(page.variants.map((row) => row.selections)).toEqual([{ size: 's' }, { size: 'm' }]);
		expect(page.measurements?.fields.map((field) => field.code)).toEqual(['chest']);
		expect(page.selected?.sku).toBe('KPS-1');
		expect(page.badges.primary).toBe('sale');
	});

	it('selects the requested SKU and flags an unknown one while keeping the default', async () => {
		const service = pageService();
		const chosen = await service.page('kurti-palazzo-set', 'KPS-2');
		expect(chosen.unknownVariant).toBe(false);
		expect(chosen.selected).toMatchObject({ sku: 'KPS-2', sellingINR: 2000, mrpINR: 2400 });
		const unknown = await service.page('kurti-palazzo-set', 'NOPE');
		expect(unknown.unknownVariant).toBe(true);
		expect(unknown.selected?.sku).toBe('KPS-1');
	});

	it('falls back to the product’s own measurement fields when it has no template', async () => {
		const service = new CatalogPublicService(
			{
				findBySlug: async () =>
					Product.parse({
						...product,
						addonTemplateCode: null,
						addons: [
							{ code: 'shoulder', label: { en: 'Shoulder' }, type: 'number', unit: 'in' },
							{ code: 'note', label: { en: 'Note' }, type: 'text' },
						],
					}),
				findById: async () => null,
			} as never,
			{ listForProduct: async () => [variant('KPS-1', 's', 2400)] } as never,
		);
		const page = await service.page('kurti-palazzo-set');
		expect(page.measurements).toEqual({
			templateCode: null,
			priceINR: 0,
			fields: [{ code: 'shoulder', label: 'Shoulder', unit: 'in', min: null, max: null, step: null }],
		});
	});

	it('answers a disabled product as not found', async () => {
		await expect(pageService('disabled').page('kurti-palazzo-set')).rejects.toBeInstanceOf(NotFoundException);
	});
});

describe('category listing read', () => {
	const silk = Product.parse({
		...product,
		id: 'prd_silk',
		sku: 'SILK',
		slug: 'silk-saree',
		title: { en: 'Silk Saree' },
		categoryIds: ['cat_silk'],
		ratingsSummary: { avg: 4.5, count: 2 },
		optionGroups: [
			{
				attributeCode: 'fabric',
				label: { en: 'Fabric' },
				semanticRole: 'filter_only',
				displayStyle: 'rectangle',
				requiredSelection: false,
				terms: [{ code: 'silk', label: { en: 'Silk' } }],
			},
		],
	});
	const cotton = Product.parse({
		...silk,
		id: 'prd_cotton',
		sku: 'COTTON',
		slug: 'cotton-saree',
		title: { en: 'Cotton Saree' },
		categoryIds: ['cat_cotton'],
		ratingsSummary: { avg: 0, count: 0 },
		optionGroups: [
			{
				attributeCode: 'fabric',
				label: { en: 'Fabric' },
				semanticRole: 'filter_only',
				displayStyle: 'rectangle',
				requiredSelection: false,
				terms: [{ code: 'cotton', label: { en: 'Cotton' } }],
			},
			{
				attributeCode: 'blouse-design',
				label: { en: 'Blouse' },
				semanticRole: 'named_add_on',
				displayStyle: 'rectangle',
				requiredSelection: false,
				defaultTermCode: 'plain',
				terms: [{ code: 'plain', label: { en: 'Plain' }, isBase: true }],
			},
		],
	});
	const priced = (productId: string, priceINR: number, salePriceINR: number | null = null) => ({
		...variant(`${productId}-1`, 's', priceINR, salePriceINR),
		productId,
	});

	function listingService(pageSize = 500) {
		const queries: { categoryId?: string; page?: number }[] = [];
		const all = [silk, cotton];
		const products = {
			list: async (query: { categoryId?: string; page?: number }) => {
				queries.push(query);
				const start = ((query.page ?? 1) - 1) * pageSize;
				return { items: all.slice(start, start + pageSize), total: all.length, page: query.page, pageSize };
			},
			findById: async (id: string) => all.find((row) => row.id === id) ?? null,
		};
		const variants = {
			listForProducts: async () => [priced('prd_silk', 5000, 4000), priced('prd_cotton', 1500)],
		};
		const placements = {
			findByPath: async (slugs: string[]) =>
				slugs.join('/') === 'sarees'
					? { categoryId: 'cat_sarees', pathLabel: 'Sarees', pathSlugs: ['sarees'] }
					: null,
		};
		const categories = {
			findBySlug: async (slug: string) => (slug === 'pure-silk' ? { id: 'cat_silk' } : null),
		};
		const service = new CatalogPublicService(
			products as never,
			variants as never,
			placements as never,
			null,
			null,
			null,
			null,
			null,
			categories as never,
		);
		return { service, queries };
	}

	const list = (input: Record<string, unknown> = {}, pageSize?: number) =>
		listingService(pageSize).service.placement(CatalogPlacementQuery.parse(input));
	const slugs = async (input: Record<string, unknown>) => (await list(input)).products.map((card) => card.slug);

	it('answers an empty path with the all-products listing', async () => {
		const { service, queries } = listingService();

		const page = await service.placement(CatalogPlacementQuery.parse({}));

		expect(page).toMatchObject({ path: '', title: 'All products', breadcrumb: [], indexable: true, total: 2 });
		expect(queries[0]?.categoryId).toBeUndefined();
	});

	it('names a real placement and reads only its category', async () => {
		const { service, queries } = listingService();

		const page = await service.placement(CatalogPlacementQuery.parse({ path: 'sarees' }));

		expect(page).toMatchObject({ path: 'sarees', title: 'Sarees' });
		expect(page.breadcrumb).toEqual([{ name: 'Sarees', path: '/collections/sarees' }]);
		expect(queries[0]?.categoryId).toBe('cat_sarees');
	});

	it('still answers an unknown path as not found', async () => {
		const { service } = listingService();

		await expect(service.placement(CatalogPlacementQuery.parse({ path: 'no/such/path' }))).rejects.toBeInstanceOf(
			NotFoundException,
		);
	});

	it('reads the whole catalogue across pages', async () => {
		const page = await list({}, 1);

		expect(page.total).toBe(2);
	});

	it('sorts and filters by the price the shopper sees', async () => {
		expect(await slugs({ sortBy: 'low-high' })).toEqual(['cotton-saree', 'silk-saree']);
		expect(await slugs({ sortBy: 'high-low' })).toEqual(['silk-saree', 'cotton-saree']);
		expect(await slugs({ sortBy: 'discount-high-low' })).toEqual(['silk-saree', 'cotton-saree']);
		expect(await slugs({ price_min: 3000, price_max: 4500 })).toEqual(['silk-saree']);
		expect(await slugs({ price: '0-2000,10000-' })).toEqual(['cotton-saree']);
		expect(await slugs({ price_min: 99999 })).toEqual([]);
	});

	it('filters by rating floor, ticked category and attributes', async () => {
		expect(await slugs({ rating: '4,5' })).toEqual(['silk-saree']);
		expect(await slugs({ category: 'pure-silk' })).toEqual(['silk-saree']);
		expect(await slugs({ category: 'no-such-slug' })).toEqual([]);
		expect(await slugs({ attribute: 'fabric:cotton' })).toEqual(['cotton-saree']);
		expect(await slugs({ attribute: ['fabric:cotton', 'fabric:silk'] })).toEqual(['silk-saree', 'cotton-saree']);
	});

	it('pages the result without losing the total', async () => {
		const page = await list({ page: 2, pageSize: 1, sortBy: 'a-z' });

		expect(page.products.map((card) => card.slug)).toEqual(['silk-saree']);
		expect(page).toMatchObject({ total: 2, page: 2, pageSize: 1, indexable: false });
	});

	it('counts filter values disjunctively and leaves out add-ons', async () => {
		const page = await list({ attribute: 'fabric:silk' });

		expect(page.facets).toEqual([
			{
				code: 'fabric',
				label: 'Fabric',
				terms: [
					{ code: 'cotton', label: 'Cotton', count: 1 },
					{ code: 'silk', label: 'Silk', count: 1 },
				],
			},
		]);
	});

	it('marks anything but the plain first page as not indexable', async () => {
		for (const input of [
			{ sortBy: 'a-z' },
			{ rating: '4' },
			{ price: '0-' },
			{ price_min: 1 },
			{ price_max: 1 },
			{ category: 'pure-silk' },
			{ attribute: 'fabric:silk' },
			{ page: 2 },
		]) {
			expect((await list(input)).indexable).toBe(false);
		}
	});

	it('accepts everything the storefront keeps after cleaning an address', () => {
		const dirty = { page: '3', sortBy: 'z-a', rating: '1', price: '5-', attribute: 'a:b', category: 'c-d', x: 'y' };

		expect(CatalogPlacementQuery.safeParse(cleanListingParams(dirty)).success).toBe(true);
	});

	it.each([
		{ page: 'abc' },
		{ pageSize: 'abc' },
		{ pageSize: -1 },
		{ pageSize: 100000 },
		{ sortBy: 'nope' },
		{ rating: '9' },
		{ price: 'abc' },
		{ price_min: -1 },
		{ attribute: 'bad' },
	])('refuses malformed input %j', (input) => {
		expect(CatalogPlacementQuery.safeParse(input).success).toBe(false);
	});
});
