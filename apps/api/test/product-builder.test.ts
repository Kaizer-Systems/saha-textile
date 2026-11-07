import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Product } from '@saha-textile/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminProductsController } from '../src/catalog/admin-products.controller';
import { AdminTaxonomyController } from '../src/catalog/admin-taxonomy.controller';
import { applyProductContent, syncVariantRows } from '../src/catalog/product-content';
import { ProductBuilderService } from '../src/catalog/product-builder.service';
import { TaxonomyService } from '../src/catalog/taxonomy.service';

const both = { en: 'Text', fr: 'Texte' };
const product = (over: Record<string, unknown> = {}) =>
	Product.parse({
		id: 'prd_1',
		type: 'simple',
		sku: 'S',
		title: both,
		slug: 'saree',
		shortDescription: both,
		description: both,
		seo: { title: both, description: both },
		categoryIds: ['c'],
		basePriceINR: 100,
		media: { gallery: ['a'], compound: [], altOverrides: {} },
		status: 'disabled',
		...over,
	});

const content = (over: Record<string, unknown> = {}) =>
	({
		title: { en: ' Name ', fr: 'Nom' },
		shortDescription: both,
		description: { fr: 'Texte' },
		metaTitle: both,
		metaDescription: both,
		estimatedDeliveryText: {},
		categoryIds: ['c'],
		optionGroups: [],
		addonTemplateCode: null,
		imageMode: 'compound',
		gallery: ['a'],
		compound: [{ selectionHash: 'h', gallery: ['a'] }],
		altOverrides: { a: { fr: 'Alt' } },
		...over,
	}) as never;

describe('applyProductContent', () => {
	it('keeps lead-time text only once it has English', () => {
		const text = { en: ' Soon ', fr: 'Bientôt' };
		expect(applyProductContent(product(), content({ estimatedDeliveryText: text })).estimatedDeliveryText).toEqual({
			en: 'Soon',
			fr: 'Bientôt',
		});
		const french = content({ estimatedDeliveryText: { fr: 'Bientôt' } });
		expect(applyProductContent(product(), french).estimatedDeliveryText).toBeNull();
	});

	it('takes every language-bound field and the images', () => {
		const next = applyProductContent(product(), content());
		expect(next.title).toEqual({ en: 'Name', fr: 'Nom' });
		expect(next.description).toEqual({ en: '', fr: 'Texte' });
		expect(next.seo).toEqual({ title: both, description: both });
		expect(next.imageMode).toBe('compound');
		expect(next.media?.altOverrides).toEqual({ a: { fr: 'Alt' } });
	});

	it('refuses a product with no English name', () => {
		expect(() => applyProductContent(product(), content({ title: { fr: 'Nom' } }))).toThrow('English name');
		expect(() => applyProductContent(product(), content({ title: { en: ' ' } }))).toThrow('English name');
	});
});

describe('syncVariantRows', () => {
	const axis = (...codes: string[]) => ({
		attributeCode: 'color',
		label: both,
		semanticRole: 'variation_axis',
		displayStyle: 'rectangle',
		requiredSelection: false,
		terms: codes.map((code) => ({ code, label: both })),
	});
	const row = (hash: string, over: Record<string, unknown> = {}) =>
		({
			id: `var_${hash}`,
			sku: hash,
			optionSelectionHash: hash,
			status: 'live',
			isBaseVariant: false,
			stock: { tracked: true, quantity: 4, lowStockThreshold: null, allowBackorder: false },
			...over,
		}) as never;

	it('does nothing without an axis', () => {
		expect(syncVariantRows(product(), [row('base:base')])).toEqual([]);
	});

	it('adds new combinations from the base row with no stock, and disables dropped ones', () => {
		const changed = syncVariantRows(product({ optionGroups: [axis('red', 'pure silk')] }), [
			row('base:base', { isBaseVariant: true }),
			row('color:red'),
		]);
		const added = changed.find((entry) => entry.optionSelectionHash === 'color:pure silk');
		expect(added).toMatchObject({ sku: 'S-PURE-SILK', status: 'live', stock: { quantity: 0 } });
		expect(changed.find((entry) => entry.optionSelectionHash === 'base:base')).toMatchObject({
			status: 'disabled',
			isBaseVariant: false,
		});
		expect(changed.some((entry) => entry.optionSelectionHash === 'color:red')).toBe(false);
	});

	it('uses the first row when none is the base, and leaves disabled rows alone', () => {
		const changed = syncVariantRows(product({ optionGroups: [axis('red')] }), [
			row('old:one', { status: 'disabled', sku: 'X' }),
		]);
		expect(changed).toHaveLength(1);
		expect(changed[0]?.isBaseVariant).toBe(true);
	});
});

describe('ProductBuilderService', () => {
	const build = (rows: Product[] = [], options: { media?: boolean; bundles?: boolean } = {}) => {
		const catalog = {
			getProduct: vi.fn(async (id: string) => {
				const found = rows.find((row) => row.id === id || row.slug === id);
				if (!found) throw new NotFoundException('no');
				return found;
			}),
			record: vi.fn(async () => undefined),
			syncSearch: vi.fn(async () => undefined),
		};
		const products = {
			findBySlug: vi.fn(async (slug: string) => rows.find((row) => row.slug === slug) ?? null),
			findById: vi.fn(async (id: string) => rows.find((row) => row.id === id) ?? null),
			save: vi.fn(async (row: unknown) => row),
		};
		const variants = {
			save: vi.fn(async (row: unknown) => row),
			listForProduct: vi.fn(async () => [{ priceINR: 100 }]),
		};
		const media = { findById: vi.fn(async () => ({ derivatives: [{ role: 'thumb' }, { role: 'card' }, { role: 'gallery' }], text: { alt: both } })) };
		const bundles = {
			findByProductId: vi.fn(async (): Promise<unknown> => null),
			isBundleProduct: vi.fn(async () => false),
			save: vi.fn(async (row: unknown) => row),
		};
		const service = new ProductBuilderService(
			catalog as never,
			products as never,
			variants as never,
			{ locales: ['en', 'fr'] } as never,
			options.media === false ? null : (media as never),
			options.bundles === false ? null : (bundles as never),
		);
		return { service, catalog, products, variants, media, bundles };
	};

	it('creates a disabled product with one base row and a free address', async () => {
		const { service, products, variants, catalog } = build([product({ slug: 'silk-saree' })]);
		const made = await service.create(
			{ type: 'simple', sku: 'NEW', title: { en: 'Silk Saree!' }, basePriceINR: 900 },
			'adm_1',
		);
		expect(made.slug).toBe('silk-saree-2');
		expect(products.save.mock.calls[0]?.[0]).toMatchObject({ status: 'disabled', sku: 'NEW' });
		expect(variants.save.mock.calls[0]?.[0]).toMatchObject({ isBaseVariant: true, priceINR: 900 });
		expect(catalog.record).toHaveBeenCalledOnce();
	});

	it('refuses a name with nothing to make an address from', async () => {
		const { service } = build();
		await expect(
			service.create({ type: 'simple', sku: 'N', title: { en: '!!!' }, basePriceINR: 0 }, null),
		).rejects.toBeInstanceOf(BadRequestException);
	});

	it('goes live when ready, once', async () => {
		const { service, products, catalog } = build([product()]);
		await expect(service.goLive('prd_1', 'adm_1')).resolves.toEqual({ live: true, gaps: [] });
		expect(products.save.mock.calls[0]?.[0]).toMatchObject({ status: 'live' });
		expect(catalog.syncSearch).toHaveBeenCalledOnce();
		const already = build([product({ status: 'live', lifecycle: { liveAt: '2026-01-01T00:00:00.000Z' } })]);
		await expect(already.service.goLive('prd_1', null)).resolves.toMatchObject({ live: true });
		expect(already.products.save).not.toHaveBeenCalled();
	});

	it('keeps an earlier first-live date', async () => {
		const { service, products } = build([product({ lifecycle: { liveAt: '2026-01-01T00:00:00.000Z' } })]);
		await service.goLive('prd_1', null);
		expect(products.save.mock.calls[0]?.[0]).toMatchObject({ lifecycle: { liveAt: '2026-01-01T00:00:00.000Z' } });
	});

	it('lists the gaps and changes nothing when not ready', async () => {
		const { service, products } = build([product({ title: { en: 'Only English' } })]);
		const result = await service.goLive('prd_1', null);
		expect(result.live).toBe(false);
		expect(result.gaps).toContainEqual({ field: 'title', locale: 'fr' });
		expect(products.save).not.toHaveBeenCalled();
	});

	it('copes with no image and no media library, and refuses a discontinued product', async () => {
		const noImage = build([product({ media: { gallery: [], compound: [], altOverrides: {} } })]);
		expect((await noImage.service.goLive('prd_1', null)).gaps).toContainEqual({
			field: 'primary_image',
			locale: null,
		});
		const noLibrary = build([product()], { media: false });
		expect((await noLibrary.service.goLive('prd_1', null)).gaps).toContainEqual({
			field: 'image_alt',
			locale: 'fr',
		});
		const gone = build([product({ status: 'discontinued' })]);
		await expect(gone.service.goLive('prd_1', null)).rejects.toThrow('discontinued');
	});

	const group = {
		code: 'g',
		label: both,
		minSelections: 1,
		maxSelections: 1,
		components: [{ productId: 'prd_1', variantId: null, quantity: 1, required: true, priceAdjustmentINR: null }],
	};
	const write = {
		bundleType: 'fixed_kit',
		pricePolicy: 'sum_components',
		fixedPriceINR: null,
		groups: [group],
	} as never;

	it('reads and saves a bundle', async () => {
		const parent = product({ id: 'prd_b', slug: 'kit', type: 'bundle' });
		const { service, bundles, catalog } = build([parent, product()]);
		await expect(service.bundle('kit')).resolves.toBeNull();
		await service.saveBundle('kit', write, 'adm_1');
		expect(bundles.save.mock.calls[0]?.[0]).toMatchObject({ productId: 'prd_b', status: 'draft' });
		expect(catalog.record).toHaveBeenCalledOnce();
		bundles.findByProductId.mockResolvedValueOnce({ id: 'bnd_1', status: 'live' });
		await service.saveBundle('kit', write, null);
		expect(bundles.save.mock.calls[1]?.[0]).toMatchObject({ id: 'bnd_1', status: 'live' });
		bundles.findByProductId.mockResolvedValueOnce({ id: 'bnd_1' });
		await expect(service.bundle('kit')).resolves.toEqual({ id: 'bnd_1' });
	});

	it('refuses bad bundles', async () => {
		const parent = product({ id: 'prd_b', slug: 'kit', type: 'bundle' });
		const notBundle = build([product()]);
		await expect(notBundle.service.saveBundle('prd_1', write, null)).rejects.toThrow('Only a bundle');
		const nested = build([parent, product()]);
		nested.bundles.isBundleProduct.mockResolvedValueOnce(true);
		await expect(nested.service.saveBundle('kit', write, null)).rejects.toThrow('may not contain a bundle');
		const missing = build([parent]);
		await expect(missing.service.saveBundle('kit', write, null)).rejects.toBeInstanceOf(NotFoundException);
		const off = build([parent], { bundles: false });
		await expect(off.service.bundle('kit')).rejects.toThrow('unavailable');
	});
});

describe('TaxonomyService', () => {
	const category = (over: Record<string, unknown> = {}) => ({
		id: 'cat_1',
		name: { en: 'Sarees' },
		slug: 'sarees',
		parentId: null,
		path: ['cat_1'],
		ancestors: [],
		depth: 0,
		isBannerCollection: false,
		displayOrder: 0,
		description: {},
		...over,
	});
	const placement = (over: Record<string, unknown> = {}) => ({
		id: 'plc_1',
		categoryId: 'cat_1',
		parentCategoryId: null,
		pathCategoryIds: ['cat_1'],
		pathSlugs: ['sarees'],
		pathLabel: 'Sarees',
		depth: 0,
		isCanonical: true,
		displayOrder: 0,
		status: 'live',
		...over,
	});
	const body = (over: Record<string, unknown> = {}) =>
		({
			name: { en: 'Sarees', fr: 'Sarees' },
			description: {},
			seoTitle: {},
			seoDescription: {},
			slug: 'sarees',
			parentId: null,
			alsoUnder: [],
			displayOrder: 0,
			...over,
		}) as never;

	let rows: Array<ReturnType<typeof category>>;
	let spots: Array<ReturnType<typeof placement>>;
	const repositories = () => {
		const catalog = {
			inTransaction: vi.fn(async (write: () => Promise<void>) => write()),
			record: vi.fn(async () => undefined),
			upsertRedirect: vi.fn(async () => undefined),
			syncSearch: vi.fn(async () => undefined),
		};
		const categories = {
			tree: vi.fn(async () => rows),
			findById: vi.fn(async (id: string) => rows.find((row) => row.id === id) ?? null),
			findBySlug: vi.fn(async (slug: string) => rows.find((row) => row.slug === slug) ?? null),
			listChildren: vi.fn(async (id: string) => rows.filter((row) => row.parentId === id)),
			save: vi.fn(async (row: unknown) => row),
			deleteById: vi.fn(async () => undefined),
		};
		const placements = {
			listForCategory: vi.fn(async (id: string) => spots.filter((row) => row.categoryId === id)),
			findCanonical: vi.fn(
				async (id: string) => spots.find((row) => row.categoryId === id && row.isCanonical) ?? null,
			),
			findById: vi.fn(async (id: string) => spots.find((row) => row.id === id) ?? null),
			listSubtree: vi.fn(async () => spots),
			moveSubtree: vi.fn(async () => []),
			save: vi.fn(async (row: ReturnType<typeof placement>) => {
				spots = [...spots.filter((spot) => spot.id !== row.id), row];
				return row;
			}),
			deleteById: vi.fn(async (id: string) => {
				spots = spots.filter((row) => row.id !== id);
			}),
		};
		const attributes = {
			listAll: vi.fn(async () => ['attr']),
			findByCode: vi.fn(async (): Promise<unknown> => null),
			save: vi.fn(async (row: unknown) => row),
			deleteByCode: vi.fn(async () => undefined),
		};
		const products = {
			list: vi.fn(async (): Promise<unknown> => ({ items: [], total: 0 })),
			save: vi.fn(async (row: unknown) => row),
		};
		const service = new TaxonomyService(
			catalog as never,
			categories as never,
			placements as never,
			attributes as never,
			products as never,
			{ categoryImages: async () => new Map([['a1', 'https://cdn.test/a1']]) } as never,
		);
		return { service, catalog, categories, placements, attributes, products };
	};

	beforeEach(() => {
		rows = [category()];
		spots = [placement()];
	});

	it('lists categories with their address and product count', async () => {
		const { service, products } = repositories();
		products.list.mockResolvedValue({ items: [], total: 3 });
		rows = [category({ seo: { title: both, description: both } }), category({ id: 'cat_2', slug: 'two' })];
		spots = [placement(), placement({ id: 'x', isCanonical: false, parentCategoryId: 'cat_9' })];
		const [first, second] = await service.listCategories();
		expect(first).toMatchObject({ path: 'sarees', productCount: 3, alsoUnder: ['cat_9'], seoTitle: both });
		expect(second).toMatchObject({ path: null, alsoUnder: [], seoTitle: {} });
	});

	it('shows a saved image, and hides one the library no longer has', async () => {
		const { service } = repositories();
		rows = [category({ media: { bannerImage: 'a1', iconImage: 'gone' } })];
		const [row] = await service.listCategories();
		expect(row?.image).toEqual({ id: 'a1', url: 'https://cdn.test/a1' });
		expect(row?.icon).toBeNull();
	});

	it('keeps images and order unless a save changes them', async () => {
		const { service, categories } = repositories();
		rows = [category({ displayOrder: 7, media: { bannerImage: 'a1', iconImage: 'a2' } })];
		await service.saveCategory('cat_1', body({ displayOrder: undefined }), null);
		expect(categories.save.mock.lastCall?.[0]).toMatchObject({
			displayOrder: 7,
			media: { bannerImage: 'a1', iconImage: 'a2' },
		});
		await service.saveCategory(null, body({ slug: 'fresh', displayOrder: undefined }), null);
		expect(categories.save.mock.lastCall?.[0]).toMatchObject({ displayOrder: 0 });
		await service.saveCategory('cat_1', body({ imageId: null, iconId: 'a3', displayOrder: 2 }), null);
		const saved = categories.save.mock.lastCall?.[0] as { media: object; displayOrder: number };
		expect(saved.displayOrder).toBe(2);
		expect(saved.media).toEqual({ iconImage: 'a3' });
	});

	it('adds a top-level and a child category with their placements', async () => {
		const { service, placements } = repositories();
		await service.saveCategory(null, body({ slug: 'dress' }), 'adm_1');
		expect(placements.save.mock.calls[0]?.[0]).toMatchObject({ pathSlugs: ['dress'], isCanonical: true, depth: 0 });
		await service.saveCategory(null, body({ slug: 'silk', parentId: 'cat_1' }), null);
		expect(placements.save.mock.calls[1]?.[0]).toMatchObject({
			pathSlugs: ['sarees', 'silk'],
			parentCategoryId: 'cat_1',
			depth: 1,
		});
	});

	it('refuses bad categories', async () => {
		const { service } = repositories();
		await expect(service.saveCategory(null, body({ name: { en: ' ' } }), null)).rejects.toThrow('English name');
		await expect(service.saveCategory('nope', body({ slug: 'x' }), null)).rejects.toBeInstanceOf(NotFoundException);
		await expect(service.saveCategory(null, body(), null)).rejects.toThrow('already taken');
		await expect(service.saveCategory(null, body({ slug: 'x', parentId: 'nope' }), null)).rejects.toThrow(
			'does not exist',
		);
		await expect(service.saveCategory('cat_1', body({ parentId: 'cat_1' }), null)).rejects.toThrow('under itself');
		rows = [category(), category({ id: 'cat_2', slug: 'two', ancestors: ['cat_1'], parentId: 'cat_1' })];
		await expect(service.saveCategory('cat_1', body({ parentId: 'cat_2' }), null)).rejects.toThrow('under itself');
		spots = [];
		await expect(service.saveCategory(null, body({ slug: 'y', parentId: 'cat_1' }), null)).rejects.toThrow(
			'no address',
		);
	});

	it('renames in the paths and writes the forward', async () => {
		const { service, catalog, placements } = repositories();
		spots = [
			placement(),
			placement({
				id: 'plc_child',
				categoryId: 'cat_9',
				pathCategoryIds: ['cat_1', 'cat_9'],
				pathSlugs: ['sarees', 'silk'],
				isCanonical: true,
			}),
		];
		await service.saveCategory('cat_1', body({ slug: 'sarees-new' }), null);
		expect(placements.save.mock.calls[0]?.[0]).toMatchObject({ pathSlugs: ['sarees-new'] });
		expect(placements.save.mock.calls[1]?.[0]).toMatchObject({ pathSlugs: ['sarees-new', 'silk'] });
		expect(catalog.upsertRedirect).toHaveBeenCalledWith(
			expect.objectContaining({
				sourcePath: '/collections/sarees',
				targetPath: '/collections/sarees-new',
				reason: 'category_move',
			}),
		);
	});

	it('moves under a new parent, and writes nothing when the path stands', async () => {
		rows = [category(), category({ id: 'cat_2', slug: 'two' })];
		const { service, placements, catalog } = repositories();
		await service.saveCategory('cat_1', body({ parentId: 'cat_2' }), null);
		expect(placements.moveSubtree).toHaveBeenCalledWith({ placementId: 'plc_1', newParentCategoryId: 'cat_2' });
		expect(catalog.upsertRedirect).not.toHaveBeenCalled();
		placements.findById.mockResolvedValueOnce(null);
		await service.saveCategory('cat_1', body(), null);
		expect(catalog.upsertRedirect).not.toHaveBeenCalled();
	});

	it('adds and removes extra placements', async () => {
		rows = [category(), category({ id: 'cat_2', slug: 'two' })];
		spots = [
			placement(),
			placement({
				id: 'plc_2',
				categoryId: 'cat_2',
				pathCategoryIds: ['cat_2'],
				pathSlugs: ['two'],
				pathLabel: 'Two',
			}),
		];
		const { service, placements } = repositories();
		await service.saveCategory('cat_1', body({ alsoUnder: ['cat_2'] }), null);
		expect(placements.save.mock.calls[0]?.[0]).toMatchObject({ isCanonical: false, pathSlugs: ['two', 'sarees'] });
		const count = placements.save.mock.calls.length;
		await service.saveCategory('cat_1', body({ alsoUnder: ['cat_2'] }), null);
		expect(placements.save.mock.calls.length).toBe(count);
		await service.saveCategory('cat_1', body(), null);
		expect(placements.deleteById).toHaveBeenCalledOnce();
	});

	it('deletes only an empty category', async () => {
		const { service, categories, placements, products } = repositories();
		await expect(service.deleteCategory('nope', null)).rejects.toBeInstanceOf(NotFoundException);
		rows = [category(), category({ id: 'cat_2', slug: 'two', parentId: 'cat_1' })];
		await expect(service.deleteCategory('cat_1', null)).rejects.toThrow('child categories');
		rows = [category()];
		products.list.mockResolvedValueOnce({ items: [], total: 1 });
		await expect(service.deleteCategory('cat_1', null)).rejects.toThrow('its products');
		await service.deleteCategory('cat_1', 'adm_1');
		expect(placements.deleteById).toHaveBeenCalledWith('plc_1');
		expect(categories.deleteById).toHaveBeenCalledWith('cat_1');
	});

	const attribute = (over: Record<string, unknown> = {}) =>
		({
			code: 'color',
			label: { en: 'Colour' },
			defaultRole: 'filter_only',
			defaultDisplayStyle: 'rectangle',
			valueType: 'term',
			terms: [{ code: 'red', label: { en: 'Red' }, slug: 'red', aliases: [], isBase: false, hidden: false }],
			...over,
		}) as never;
	const using = {
		items: [
			{
				optionGroups: [
					{ attributeCode: 'color', terms: [{ code: 'red' }] },
					{ attributeCode: 'size', terms: [{ code: 's' }] },
				],
			},
		],
		total: 1,
	};

	it('lists and saves attributes', async () => {
		const { service, attributes, catalog } = repositories();
		await expect(service.listAttributes()).resolves.toEqual(['attr']);
		await service.saveAttribute(attribute(), 'adm_1');
		expect(attributes.save.mock.calls[0]?.[0]).toMatchObject({ id: 'attr_color' });
		attributes.findByCode.mockResolvedValueOnce({ id: 'attr_old' });
		await service.saveAttribute(attribute(), null);
		expect(attributes.save.mock.calls[1]?.[0]).toMatchObject({ id: 'attr_old' });
		expect(catalog.record).toHaveBeenCalledTimes(2);
		await expect(service.saveAttribute(attribute({ label: { en: ' ' } }), null)).rejects.toThrow('English name');
	});

	it('refuses to drop a value a product uses, and pages through every product', async () => {
		const { service, products } = repositories();
		products.list.mockResolvedValueOnce({ items: [using.items[0], {}], total: 400 } as never);
		products.list.mockResolvedValueOnce({ items: [], total: 400 });
		const emptied = (products.list.mock.results, attribute({ terms: [] }));
		const first = using.items[0] as { optionGroups: unknown[] };
		products.list.mockReset();
		products.list.mockResolvedValueOnce({ items: [first], total: 400 });
		products.list.mockResolvedValueOnce({ items: [], total: 400 });
		await expect(service.saveAttribute(emptied, null)).rejects.toThrow('hide them instead: red');
		expect(products.list).toHaveBeenCalledTimes(2);
	});

	it('writes a new name to every product using the value, then to search', async () => {
		const { service, products, catalog } = repositories();
		const used = {
			id: 'p1',
			optionGroups: [
				{
					attributeCode: 'color',
					label: { en: 'Old' },
					terms: [
						{ code: 'red', label: { en: 'Old red' } },
						{ code: 'gone', label: { en: 'Kept' } },
					],
				},
				{ attributeCode: 'size', label: { en: 'Size' }, terms: [] },
			],
		};
		const other = { id: 'p2', optionGroups: [{ attributeCode: 'size', terms: [] }] };
		products.list.mockResolvedValue({ items: [used, other], total: 2 });
		const body = attribute({
			code: 'color',
			label: { en: 'Colour', fr: 'Couleur' },
			terms: [
				{ code: 'red', slug: 'red', label: { en: 'Red', fr: 'Rouge' }, aliases: [] },
				{ code: 'gone', slug: 'gone', label: { en: 'Kept' }, aliases: [] },
			],
		});
		await service.saveAttribute(body, null);
		expect(products.save).toHaveBeenCalledTimes(1);
		const saved = products.save.mock.lastCall?.[0] as typeof used;
		expect(saved.optionGroups[0]).toMatchObject({
			label: { en: 'Colour', fr: 'Couleur' },
			terms: [{ label: { en: 'Red', fr: 'Rouge' } }, { label: { en: 'Kept' } }],
		});
		expect(saved.optionGroups[1]).toEqual(used.optionGroups[1]);
		expect(catalog.syncSearch).toHaveBeenCalledWith(saved);
	});

	it('keeps the name of a value that left the attribute while saving', async () => {
		const { service, products } = repositories();
		const late = {
			id: 'p1',
			optionGroups: [{ attributeCode: 'color', label: {}, terms: [{ code: 'late', label: { en: 'Late' } }] }],
		};
		products.list.mockResolvedValueOnce({ items: [], total: 0 });
		products.list.mockResolvedValueOnce({ items: [late], total: 1 });
		await service.saveAttribute(attribute({ code: 'color' }), null);
		const saved = products.save.mock.lastCall?.[0] as typeof late;
		expect(saved.optionGroups[0]?.terms[0]?.label).toEqual({ en: 'Late' });
	});

	it('deletes only an unused attribute', async () => {
		const { service, attributes, products } = repositories();
		await expect(service.deleteAttribute('color', null)).rejects.toBeInstanceOf(NotFoundException);
		attributes.findByCode.mockResolvedValue({ id: 'attr_color' });
		products.list.mockResolvedValueOnce(using);
		await expect(service.deleteAttribute('color', null)).rejects.toThrow('cannot be deleted');
		await service.deleteAttribute('color', 'adm_1');
		expect(attributes.deleteByCode).toHaveBeenCalledWith('color');
	});
});

describe('admin builder routes', () => {
	const signedIn = { userId: 'adm_1' } as never;

	it('passes product builder calls through, with or without a signed-in actor', async () => {
		const builder = {
			create: vi.fn(async () => 'made'),
			goLive: vi.fn(async () => 'live'),
			bundle: vi.fn(async () => 'bundle'),
			saveBundle: vi.fn(async () => 'saved'),
		};
		const controller = new AdminProductsController({} as never, builder as never);
		expect(await controller.create({} as never, signedIn)).toBe('made');
		expect(await controller.create({} as never, undefined)).toBe('made');
		expect(await controller.goLive('p', signedIn)).toBe('live');
		expect(await controller.goLive('p', undefined)).toBe('live');
		expect(await controller.bundle('p')).toBe('bundle');
		expect(await controller.saveBundle('p', {} as never, signedIn)).toBe('saved');
		expect(await controller.saveBundle('p', {} as never, undefined)).toBe('saved');
	});

	it('passes category and attribute calls through', async () => {
		const taxonomy = {
			listCategories: vi.fn(async () => 'cats'),
			saveCategory: vi.fn(async () => 'cat'),
			deleteCategory: vi.fn(async () => undefined),
			listAttributes: vi.fn(async () => 'attrs'),
			saveAttribute: vi.fn(async () => 'attr'),
			deleteAttribute: vi.fn(async () => undefined),
		};
		const controller = new AdminTaxonomyController(taxonomy as never);
		expect(await controller.categories()).toBe('cats');
		for (const who of [signedIn, undefined]) {
			expect(await controller.createCategory({} as never, who)).toBe('cat');
			expect(await controller.updateCategory('c', {} as never, who)).toBe('cat');
			await controller.deleteCategory('c', who);
			expect(await controller.saveAttribute({} as never, who)).toBe('attr');
			await controller.deleteAttribute('a', who);
		}
		expect(await controller.attributes()).toBe('attrs');
	});
});
