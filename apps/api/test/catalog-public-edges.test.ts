import { NotFoundException } from '@nestjs/common';
import { CatalogPlacementQuery, Product, ProductVariant } from '@saha-textile/contracts';
import { describe, expect, it, vi } from 'vitest';
import type { z } from 'zod';

import { CatalogPublicService } from '../src/catalog/catalog-public.service';
import { catalogEtag, CatalogEtagInterceptor } from '../src/catalog/catalog-etag.interceptor';
import { pricedRow, productReadModel, skuView } from '../src/catalog/catalog-read-model';
import { lastValueFrom, of } from 'rxjs';

type Variant = z.output<typeof ProductVariant>;
type ProductRow = z.output<typeof Product>;

const product = (overrides: Record<string, unknown> = {}): ProductRow =>
	Product.parse({
		id: 'prd_1',
		type: 'simple',
		sku: 'SKU-1',
		title: { en: 'Red saree' },
		slug: 'red-saree',
		basePriceINR: 1000,
		status: 'live',
		lifecycle: { liveAt: '2026-10-01T00:00:00.000Z' },
		...overrides,
	});

const variant = (overrides: Record<string, unknown> = {}): Variant =>
	ProductVariant.parse({
		id: 'var_1',
		productId: 'prd_1',
		sku: 'V1',
		status: 'live',
		optionSelections: [{ attributeCode: 'size', termCode: 's' }],
		optionSelectionHash: 'size:s',
		isBaseVariant: true,
		priceINR: 1000,
		stock: { quantity: 2 },
		...overrides,
	});

const asset = (id: string, role: string) => ({
	id,
	visibility: 'public',
	width: 300,
	height: 400,
	dominantColor: null,
	thumbHash: null,
	text: { alt: {}, title: {}, caption: {} },
	derivatives: [
		{ role, storageKey: `k/${id}`, width: 300, height: 400, byteSize: 1, format: 'image/webp', roleVersion: 1 },
	],
});

const query = (overrides: Record<string, unknown> = {}) => CatalogPlacementQuery.parse({ ...overrides });

interface Options {
	rows?: ProductRow[];
	variants?: Variant[];
	withAll?: boolean;
	assets?: unknown[];
	placement?: unknown;
	category?: unknown;
	bundle?: unknown;
	template?: unknown;
	routes?: unknown[];
	route?: unknown;
	relations?: unknown[];
	retired?: string[];
	live?: string[];
	canonical?: unknown;
}

const build = (options: Options = {}) => {
	const rows = options.rows ?? [product()];
	const variantRows = options.variants ?? [variant()];
	const products = {
		findBySlug: vi.fn(async (slug: string) => rows.find((row) => row.slug === slug) ?? null),
		findById: vi.fn(async (id: string) => rows.find((row) => row.id === id) ?? null),
		list: vi.fn(async ({ page = 1 }: { page?: number }) => ({
			items: page === 1 ? rows : [],
			total: rows.length,
			page,
			pageSize: 500,
		})),
		listPublicSlugs: vi.fn(async () => rows.map((row) => row.slug)),
	};
	const variants = {
		listForProduct: vi.fn(async () => variantRows),
		listForProducts: vi.fn(async () => variantRows),
	};
	const placements = {
		findByPath: vi.fn(async () => options.placement ?? null),
		findCanonical: vi.fn(async () => options.canonical ?? null),
		listLivePaths: vi.fn(async () => options.live ?? []),
		listRetiredPaths: vi.fn(async () => options.retired ?? []),
	};
	const media = { findManyByIds: vi.fn(async () => options.assets ?? []) };
	const storage = { getUrl: (key: string) => `https://cdn.test/${key}` };
	const relations = { listForProduct: vi.fn(async () => options.relations ?? []) };
	const templates = { findByCode: vi.fn(async () => options.template ?? null) };
	const bundles = { findByProductId: vi.fn(async () => options.bundle ?? null) };
	const categories = { findBySlug: vi.fn(async () => options.category ?? null) };
	const seo = {
		find: vi.fn(async () => options.route ?? null),
		listIndexable: vi.fn(async () => options.routes ?? []),
	};
	const service =
		options.withAll === false
			? new CatalogPublicService(products as never, variants as never)
			: new CatalogPublicService(
					products as never,
					variants as never,
					placements as never,
					media as never,
					storage as never,
					relations as never,
					templates as never,
					bundles as never,
					categories as never,
					seo as never,
				);
	return { service, products, variants, placements, media, seo };
};

describe('product page', () => {
	it('refuses an unknown product, and finds one by id', async () => {
		await expect(build().service.page('none')).rejects.toBeInstanceOf(NotFoundException);
		expect((await build().service.page('prd_1')).slug).toBe('red-saree');
	});

	it('works with nothing but the product and its variants', async () => {
		const page = await build({ withAll: false, rows: [product({ media: { gallery: ['m1'] } })] }).service.page(
			'red-saree',
		);
		expect(page).toMatchObject({
			description: '',
			estimatedDeliveryText: null,
			gallery: [],
			measurements: null,
			bundle: null,
			breadcrumb: [],
			variants: [],
		});
	});

	it('builds groups from old attributes, with colours and swatches', async () => {
		const row = product({
			attributes: [
				{
					code: 'colour',
					label: { en: 'Colour' },
					usedForVariations: true,
					terms: [
						{ code: 'red', label: { en: 'Red' }, hex: '#ff0000', swatch: 'sw1' },
						{ code: 'blue', label: { en: 'Blue' } },
					],
				},
				{
					code: 'fabric',
					label: { en: 'Fabric' },
					usedForVariations: false,
					terms: [{ code: 'silk', label: { en: 'Silk' } }],
				},
			],
		});
		const page = await build({
			rows: [row],
			variants: [
				variant({
					optionSelections: [
						{ attributeCode: 'colour', termCode: 'red' },
						{ attributeCode: 'row', termCode: 'x' },
					],
					optionSelectionHash: 'colour:red',
				}),
			],
			assets: [asset('sw1', 'swatch_image')],
		}).service.page('red-saree');
		expect(page.optionGroups[0]).toMatchObject({
			role: 'variation_axis',
			displayStyle: 'color_swatch',
			required: true,
		});
		expect(page.optionGroups[0]?.terms[0]).toMatchObject({ hex: '#ff0000' });
		expect(page.optionGroups[0]?.terms[0]?.image?.assetId).toBe('sw1');
		expect(page.optionGroups[0]?.terms[1]).toMatchObject({ hex: null, image: null, priceDeltaINR: null });
		expect(page.optionGroups[1]).toMatchObject({ role: 'filter_only', displayStyle: 'rectangle' });
		expect(page.variants[0]?.selections).toEqual({ colour: 'red' });
	});

	it('finds a variant photo in the gallery, and copes when it is not there', async () => {
		const row = product({
			media: { gallery: ['m1', 'gone'] },
			description: { en: 'Soft' },
			estimatedDeliveryText: { en: 'Soon' },
			optionGroups: [
				{
					attributeCode: 'size',
					label: { en: 'Size' },
					semanticRole: 'variation_axis',
					displayStyle: 'circle',
					requiredSelection: true,
					terms: [{ code: 's', label: { en: 'S' } }],
				},
			],
		});
		const page = await build({
			rows: [row],
			variants: [
				variant({ media: { primaryAssetId: 'm1' } }),
				variant({
					id: 'var_2',
					sku: 'V2',
					isBaseVariant: false,
					optionSelectionHash: 'b',
					media: { primaryAssetId: 'other' },
				}),
				variant({ id: 'var_3', sku: 'V3', isBaseVariant: false, optionSelectionHash: 'c' }),
			],
			assets: [asset('m1', 'gallery')],
		}).service.page('red-saree');
		expect(page).toMatchObject({ description: 'Soft', estimatedDeliveryText: 'Soon' });
		expect(page.gallery).toHaveLength(1);
		expect(page.variants.map((row2) => row2.galleryIndex)).toEqual([0, null, null]);
	});

	it('answers no selection when a product has no variants', async () => {
		expect((await build({ variants: [] }).service.page('red-saree')).selected).toBeNull();
	});

	it('skips an image that resolves to no matching role', async () => {
		const row = product({ media: { gallery: ['m1'] } });
		const page = await build({ rows: [row], assets: [asset('m1', 'card')] }).service.page('red-saree');
		expect(page.gallery).toEqual([]);
		const hidden = await build({
			rows: [row],
			assets: [{ ...asset('m1', 'gallery'), visibility: 'private' }],
		}).service.page('red-saree');
		expect(hidden.gallery).toEqual([]);
	});
});

describe('measurements', () => {
	const field = { code: 'chest', label: 'Chest', unit: 'in', min: 1, max: 2, step: 1 };

	it('uses the template, with the product price first', async () => {
		const template = { code: 'blouse', priceINR: 500, fields: [field] };
		const own = product({ addonTemplateCode: 'blouse', addonPriceINR: 300 });
		expect((await build({ rows: [own], template }).service.page('red-saree')).measurements).toMatchObject({
			templateCode: 'blouse',
			priceINR: 300,
		});
		const fallback = product({ addonTemplateCode: 'blouse' });
		expect((await build({ rows: [fallback], template }).service.page('red-saree')).measurements?.priceINR).toBe(
			500,
		);
	});

	it('falls back to the product number fields when a template is empty or missing', async () => {
		const row = product({
			addonTemplateCode: 'blouse',
			addons: [
				{ code: 'waist', label: { en: 'Waist' }, type: 'number', unit: 'cm', required: false },
				{ code: 'hip', label: { en: 'Hip' }, type: 'number', required: false },
				{ code: 'note', label: { en: 'Note' }, type: 'text', required: false },
			],
		});
		const page = await build({ rows: [row], template: { code: 'x', priceINR: 1, fields: [] } }).service.page(
			'red-saree',
		);
		expect(page.measurements).toMatchObject({ templateCode: null, priceINR: 0 });
		expect(page.measurements?.fields.map((entry) => entry.unit)).toEqual(['cm', 'in']);
		const priced = product({ addonPriceINR: 50, addons: row.addons });
		expect((await build({ rows: [priced] }).service.page('red-saree')).measurements?.priceINR).toBe(50);
	});
});

describe('bundles', () => {
	const component = (productId: string, extra: Record<string, unknown> = {}) => ({
		productId,
		quantity: 2,
		required: true,
		...extra,
	});
	const bundle = (overrides: Record<string, unknown> = {}) => ({
		bundleType: 'fixed_kit',
		pricePolicy: 'sum_components',
		fixedPriceINR: null,
		groups: [
			{ code: 'set', label: { en: 'Set' }, minSelections: 1, maxSelections: 3, components: [component('prd_1')] },
		],
		...overrides,
	});

	it('sums the live components', async () => {
		const page = await build({ bundle: bundle() }).service.page('red-saree');
		expect(page.bundle).toMatchObject({ priceINR: 2000 });
		expect(page.bundle?.groups[0]).toMatchObject({ maxSelections: 1 });
		expect(page.bundle?.groups[0]?.components[0]).toMatchObject({ sku: 'V1', sellingINR: 1000, inStock: true });
	});

	it('uses the fixed price, or the sum when none is set', async () => {
		const fixed = await build({
			bundle: bundle({ pricePolicy: 'fixed_bundle_price', fixedPriceINR: 900 }),
		}).service.page('red-saree');
		expect(fixed.bundle?.priceINR).toBe(900);
		const missing = await build({ bundle: bundle({ pricePolicy: 'fixed_bundle_price' }) }).service.page(
			'red-saree',
		);
		expect(missing.bundle?.priceINR).toBe(2000);
	});

	it('leaves out components that are gone, and a bundle with none left', async () => {
		const page = await build({
			bundle: bundle({
				groups: [
					{
						code: 'a',
						label: { en: 'A' },
						minSelections: 1,
						maxSelections: 1,
						components: [component('gone')],
					},
					{
						code: 'b',
						label: { en: 'B' },
						minSelections: 1,
						maxSelections: 1,
						components: [component('prd_1')],
					},
				],
			}),
		}).service.page('red-saree');
		expect(page.bundle?.groups.map((group) => group.code)).toEqual(['b']);
		const empty = await build({
			bundle: bundle({
				groups: [
					{
						code: 'a',
						label: { en: 'A' },
						minSelections: 1,
						maxSelections: 1,
						components: [component('gone')],
					},
				],
			}),
		}).service.page('red-saree');
		expect(empty.bundle).toBeNull();
	});

	it('falls back to the product when a component has no variants', async () => {
		const page = await build({ bundle: bundle(), variants: [] }).service.page('red-saree');
		expect(page.bundle?.groups[0]?.components[0]).toMatchObject({ sku: 'SKU-1', sellingINR: 1000, inStock: false });
	});

	it('marks a made-to-order component in stock', async () => {
		const page = await build({
			bundle: bundle(),
			rows: [product({ madeToOrder: true })],
			variants: [variant({ stock: { quantity: 0 } })],
		}).service.page('red-saree');
		expect(page.bundle?.groups[0]?.components[0]?.inStock).toBe(true);
	});
});

describe('breadcrumbs', () => {
	const placement = (overrides: Record<string, unknown> = {}) => ({
		pathSlugs: ['sarees', 'silk'],
		pathLabel: 'Sarees',
		status: 'live',
		...overrides,
	});
	const row = product({ categoryIds: ['cat_1'] });

	it('walks the canonical placement, naming a missing label by its slug', async () => {
		const page = await build({ rows: [row], canonical: placement() }).service.page('red-saree');
		expect(page.breadcrumb).toEqual([
			{ name: 'Sarees', path: '/collections/sarees' },
			{ name: 'silk', path: '/collections/sarees/silk' },
		]);
	});

	it('shows none for a retired or missing placement', async () => {
		expect(
			(await build({ rows: [row], canonical: placement({ status: 'draft' }) }).service.page('red-saree'))
				.breadcrumb,
		).toEqual([]);
		expect((await build({ rows: [row] }).service.page('red-saree')).breadcrumb).toEqual([]);
	});
});

describe('home', () => {
	it('builds every rail', async () => {
		const home = await build().service.home();
		expect(home.newArrivals).toHaveLength(1);
		expect(home.bestsellers).toHaveLength(1);
		expect(home.featured).toHaveLength(1);
		expect(home.sale).toHaveLength(1);
	});
});

describe('placement listings', () => {
	const placement = { categoryId: 'cat_1', pathSlugs: ['sarees'], pathLabel: 'Sarees' };

	it('lists everything when no path is given, and needs placements for a path', async () => {
		const all = await build({ withAll: false }).service.placement(query());
		expect(all).toMatchObject({ path: '', title: 'All products', breadcrumb: [], total: 1, indexable: true });
		await expect(build({ withAll: false }).service.placement(query({ path: 'sarees' }))).rejects.toThrow(
			'Catalogue placements are unavailable',
		);
		await expect(build().service.placement(query({ path: 'none' }))).rejects.toThrow('Category not found');
	});

	it('names the page from its placement', async () => {
		const page = await build({ placement }).service.placement(query({ path: 'sarees' }));
		expect(page).toMatchObject({ path: 'sarees', title: 'Sarees' });
		expect(page.breadcrumb).toEqual([{ name: 'Sarees', path: '/collections/sarees' }]);
	});

	it('names a crumb by its slug when the label runs out', async () => {
		const page = await build({
			placement: { categoryId: 'cat_1', pathSlugs: ['sarees', 'silk'], pathLabel: 'Sarees' },
		}).service.placement(query({ path: 'sarees/silk' }));
		expect(page.breadcrumb[1]?.name).toBe('silk');
	});

	it('reads every page of products', async () => {
		const { service, products } = build();
		products.list.mockImplementation(async ({ page = 1 }: { page?: number }) => ({
			items: page < 3 ? [product({ id: `prd_${page}`, slug: `p-${page}` })] : [],
			total: 5,
			page,
			pageSize: 500,
		}));
		expect((await service.placement(query())).total).toBe(2);
	});

	it('filters by rating, category, price and attribute, and calls such a page unindexable', async () => {
		const rows = [
			product({
				ratingsSummary: { avg: 4.5, count: 2 },
				categoryIds: ['cat_1'],
				optionGroups: [
					{
						attributeCode: 'fabric',
						label: { en: 'Fabric' },
						semanticRole: 'filter_only',
						displayStyle: 'rectangle',
						requiredSelection: false,
						terms: [{ code: 'silk', label: { en: 'Silk' } }],
					},
					{
						attributeCode: 'blouse',
						label: { en: 'Blouse' },
						semanticRole: 'named_add_on',
						displayStyle: 'rectangle',
						requiredSelection: false,
						defaultTermCode: 'none',
						terms: [{ code: 'none', label: { en: 'None' }, isBase: true }],
					},
				],
			}),
		];
		const page = await build({ rows, category: { id: 'cat_1' } }).service.placement(
			query({ rating: '4,5', category: 'silk', price: '0-2000', attribute: 'fabric:silk' }),
		);
		expect(page).toMatchObject({ total: 1, indexable: false });
		expect(page.facets.map((facet) => facet.code)).toEqual(['fabric']);
		const repeated = await build({ rows }).service.placement(
			query({ attribute: ['fabric:silk', 'fabric:cotton'] }),
		);
		expect(repeated.total).toBe(1);
	});

	it('empties the list for a category slug that matches nothing', async () => {
		expect((await build().service.placement(query({ category: 'none' }))).total).toBe(0);
	});

	it('ignores the category filter when categories are not wired in', async () => {
		expect((await build({ withAll: false }).service.placement(query({ category: 'none' }))).total).toBe(1);
	});

	it('is not indexable past the first page', async () => {
		expect((await build().service.placement(query({ page: 2 }))).indexable).toBe(false);
	});

	it('prices rows by range, single and no price at all', async () => {
		const rows = [
			product({ id: 'prd_a', slug: 'a', title: { en: 'A' } }),
			product({ id: 'prd_b', slug: 'b', title: { en: 'B' } }),
			product({ id: 'prd_c', slug: 'c', title: { en: 'C' }, basePriceINR: 7 }),
		];
		const variants = [
			variant({ productId: 'prd_a', priceINR: 100 }),
			variant({ id: 'v2', sku: 'V2', productId: 'prd_a', priceINR: 300, optionSelectionHash: 'x' }),
			variant({
				id: 'v3',
				sku: 'V3',
				productId: 'prd_b',
				priceINR: 200,
				compareAtPriceINR: 400,
				salePriceINR: 200,
				optionSelectionHash: 'y',
			}),
			variant({ id: 'v4', sku: 'V4', productId: 'prd_c', status: 'draft', optionSelectionHash: 'z' }),
		];
		const low = await build({ rows, variants }).service.placement(query({ sortBy: 'low-high' }));
		expect(low.products.map((row) => row.id)).toEqual(['prd_c', 'prd_a', 'prd_b']);
		const discount = await build({ rows, variants }).service.placement(query({ sortBy: 'discount-high-low' }));
		expect(discount.products[0]?.id).toBe('prd_b');
	});

	it('gives a product with no variants its base price', async () => {
		const page = await build({ variants: [] }).service.placement(query());
		expect(page.products[0]?.price).toMatchObject({ kind: 'single', sellingINR: 1000 });
	});
});

describe('gallery and swatches', () => {
	it('keeps only frames that resolve', async () => {
		const row = product({ media: { gallery: ['m1', 'gone'] } });
		const gallery = await build({ rows: [row], assets: [asset('m1', 'gallery')] }).service.gallery('red-saree');
		expect(gallery.frames).toHaveLength(1);
	});

	it('lists swatches with and without a picture', async () => {
		const row = product({
			attributes: [
				{
					code: 'colour',
					label: { en: 'Colour' },
					terms: [
						{ code: 'red', label: { en: 'Red' }, hex: '#ff0000', swatch: 's1' },
						{ code: 'blue', label: { en: 'Blue' } },
					],
				},
			],
		});
		const swatches = await build({ rows: [row], assets: [asset('s1', 'swatch_image')] }).service.swatches(
			'red-saree',
		);
		expect(swatches[0]).toMatchObject({ attributeCode: 'colour', hex: '#ff0000' });
		expect(swatches[0]?.image?.assetId).toBe('s1');
		expect(swatches[1]).toMatchObject({ hex: null, image: null });
	});
});

describe('cards', () => {
	it('skips unknown slugs and ids, and takes at most twelve slugs', async () => {
		const { service, products } = build();
		expect(await service.cardsForSlugs(['red-saree', 'gone'])).toHaveLength(1);
		products.findBySlug.mockClear();
		await service.cardsForSlugs(Array.from({ length: 20 }, (_, index) => `s-${index}`));
		expect(products.findBySlug).toHaveBeenCalledTimes(12);
		expect(await service.cardsForIds(['prd_1', 'gone'])).toHaveLength(1);
	});

	it('shows a primary photo and the badges', async () => {
		const row = product({ media: { gallery: ['m1'] }, featured: true });
		const cards = await build({ rows: [row], assets: [asset('m1', 'card')] }).service.cardsForIds(['prd_1']);
		expect(cards[0]?.image?.assetId).toBe('m1');
		expect(cards[0]?.badges).toContain('featured');
	});

	it('names the pieces left only while the low-stock fact shows', async () => {
		const low = product({ lowStockThreshold: 3 });
		const stock = { tracked: true, quantity: 2, lowStockThreshold: null, allowBackorder: false };
		const cards = await build({ rows: [low], variants: [variant({ stock })] }).service.cardsForIds(['prd_1']);
		expect(cards[0]).toMatchObject({ lowStockLeft: 2, badges: ['low_stock'] });
	});

	it('falls back to the product SKU and shows made to order in stock', async () => {
		const cards = await build({ rows: [product({ madeToOrder: true })], variants: [] }).service.cardsForIds([
			'prd_1',
		]);
		expect(cards[0]).toMatchObject({ sku: 'SKU-1', inStock: true, image: null });
	});

	it('needs no media lookup when there is nothing to look up', async () => {
		const { service, media } = build();
		await service.cardsForIds(['prd_1']);
		expect(media.findManyByIds).not.toHaveBeenCalled();
	});
});

describe('relations', () => {
	const relation = (relationType: string, targetId: string) => ({
		relationType,
		targetType: 'product',
		targetId,
		status: 'live',
		rank: 0,
		startsAt: null,
		endsAt: null,
	});

	it('answers empty lists when relations are not wired in', async () => {
		expect(await build({ withAll: false }).service.relationCards('red-saree')).toEqual({
			related: [],
			upsell: [],
			crossSell: [],
			boughtTogether: [],
		});
	});

	it('groups by type and drops a target that vanished', async () => {
		const rows = [product(), product({ id: 'prd_2', slug: 'b' }), product({ id: 'prd_3', slug: 'c' })];
		const built = build({
			rows,
			relations: [
				relation('related', 'prd_2'),
				relation('upsell', 'prd_3'),
				relation('cross_sell', 'prd_2'),
				relation('bought_together', 'prd_3'),
			],
		});
		const cards = await built.service.relationCards('red-saree');
		expect(cards.related.map((card) => card.id)).toEqual(['prd_2']);
		expect(cards.upsell.map((card) => card.id)).toEqual(['prd_3']);
		expect(cards.crossSell.map((card) => card.id)).toEqual(['prd_2']);
		expect(cards.boughtTogether.map((card) => card.id)).toEqual(['prd_3']);
		built.products.findById.mockResolvedValue(null);
		expect((await built.service.relationCards('red-saree')).related).toEqual([]);
	});
});

describe('addresses', () => {
	it('lists live paths with or without placements', async () => {
		expect(await build({ live: ['sarees'] }).service.livePaths()).toEqual({
			products: ['red-saree'],
			collections: ['sarees'],
		});
		expect(await build({ withAll: false }).service.livePaths()).toEqual({
			products: ['red-saree'],
			collections: [],
		});
	});

	it('turns a retired collection into a row, unless it is live again', async () => {
		const rows = await build({
			retired: ['sarees/old', 'sarees'],
			live: ['sarees'],
		}).service.retiredCollectionRows();
		expect(rows.map((row) => row.sourcePath)).toEqual(['/collections/sarees/old']);
		expect(await build({ withAll: false }).service.retiredCollectionRows()).toEqual([]);
	});

	it('returns a route with a plain description', async () => {
		const route = { path: '/x', description: `<p>Soft   <b>silk</b></p>${'x'.repeat(200)}` };
		const found = await build({ route }).service.seoRoute('/x', 'en');
		expect(found?.description.startsWith('Soft silk')).toBe(true);
		expect(found?.description).toHaveLength(160);
		expect(await build().service.seoRoute('/x', 'en')).toBeNull();
		expect(await build({ withAll: false }).service.seoRoute('/x', 'en')).toBeNull();
	});

	it('lists only addresses that are still live, with a slash on language homes', async () => {
		const routes = [
			{ path: '/', entityType: 'page', canonicalPath: '/en' },
			{ path: '/about', entityType: 'page', canonicalPath: '/en/about' },
			{ path: '/product/red-saree', entityType: 'product', canonicalPath: '/fr/product/red-saree' },
			{ path: '/collections/sarees', entityType: 'category', canonicalPath: '/en/collections/sarees' },
			{ path: '/product/gone', entityType: 'product', canonicalPath: '/en/product/gone' },
		];
		expect(await build({ routes, live: ['sarees'] }).service.sitemapPaths()).toEqual([
			'/en/',
			'/en/about',
			'/en/collections/sarees',
			'/fr/product/red-saree',
		]);
		expect(await build({ withAll: false }).service.sitemapPaths()).toEqual([]);
	});
});

describe('read model', () => {
	it('prices a row and says when it can be bought', () => {
		expect(pricedRow(variant({ stock: { quantity: 0 } }), true).buyable).toBe(true);
		expect(pricedRow(variant({ stock: { quantity: 0 } }), false).buyable).toBe(false);
		expect(pricedRow(variant({ status: 'draft' }), true)).toMatchObject({ buyable: false, live: false });
	});

	it('shows a row photo when it has one', () => {
		expect(skuView(variant({ media: { primaryAssetId: 'm1' } }), false).imageAssetId).toBe('m1');
		expect(skuView(variant(), false).imageAssetId).toBeNull();
	});

	it('honours a chosen variant and flags one it cannot find', () => {
		const rows = [variant(), variant({ id: 'v2', sku: 'V2', isBaseVariant: false, optionSelectionHash: 'b' })];
		expect(productReadModel(product(), rows, 'V2').selected?.sku).toBe('V2');
		expect(productReadModel(product(), rows, 'NOPE')).toMatchObject({
			unknownVariant: true,
			selected: { sku: 'V1' },
		});
		expect(productReadModel(product(), rows, null).unknownVariant).toBe(false);
	});

	it('reads the dates that decide a badge, and treats made to order only when live', () => {
		const row = product({
			madeToOrder: true,
			status: 'disabled',
			backInStockAt: '2026-11-01T00:00:00.000Z',
			lifecycle: { liveAt: null },
		});
		expect(productReadModel(row, []).madeToOrder).toBe(false);
	});

	it('sees a sale on any row', () => {
		const sale = variant({ compareAtPriceINR: 2000, salePriceINR: 1000 });
		expect(productReadModel(product(), [sale]).badges.primary).toBe('sale');
	});
});

describe('CatalogEtagInterceptor', () => {
	const run = (ifNoneMatch?: string) => {
		const reply = { header: vi.fn(), status: vi.fn() };
		const context = {
			switchToHttp: () => ({
				getResponse: () => reply,
				getRequest: () => ({ headers: { 'if-none-match': ifNoneMatch } }),
			}),
		};
		const result = lastValueFrom(
			new CatalogEtagInterceptor().intercept(context as never, { handle: () => of({ a: 1 }) } as never),
		);
		return { reply, result };
	};

	it('tags the body', async () => {
		const { reply, result } = run();
		expect(await result).toEqual({ a: 1 });
		expect(reply.header).toHaveBeenCalledWith('etag', catalogEtag({ a: 1 }));
		expect(reply.status).not.toHaveBeenCalled();
	});

	it('answers 304 to a matching tag', async () => {
		const { reply, result } = run(catalogEtag({ a: 1 }));
		await result;
		expect(reply.status).toHaveBeenCalledWith(304);
	});
});
