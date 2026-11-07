import { BadRequestException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Product, ProductVariant } from '@saha-textile/contracts';
import { SearchUnavailableError } from '@saha-textile/core-domain';
import { describe, expect, it, vi } from 'vitest';
import type { z } from 'zod';

import { AdminAddonTemplatesController } from '../src/catalog/admin-addon-templates.controller';
import { AdminProductsController } from '../src/catalog/admin-products.controller';
import { AdminRedirectsController } from '../src/catalog/admin-redirects.controller';
import { CatalogSearchController } from '../src/catalog/catalog-search.controller';
import { CatalogService } from '../src/catalog/catalog.service';
import { CategoriesController } from '../src/catalog/categories.controller';
import { ProductsController } from '../src/catalog/products.controller';
import { StockAlertsController } from '../src/catalog/stock-alerts.controller';
import { StorefrontCatalogController } from '../src/catalog/storefront-catalog.controller';

type Row = z.output<typeof Product>;
type VariantRow = z.output<typeof ProductVariant>;

const product = (overrides: Record<string, unknown> = {}): Row =>
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

const variant = (overrides: Record<string, unknown> = {}): VariantRow =>
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

const write = (overrides: Record<string, unknown> = {}) =>
	({
		id: 'var_1',
		sku: 'V1',
		mrpINR: 1200,
		sellingINR: 1000,
		quantity: 2,
		available: true,
		weightGrams: 100,
		lengthCm: 1,
		widthCm: 2,
		heightCm: 3,
		barcode: 'b',
		hsnCode: 'h',
		...overrides,
	}) as never;

const form = (overrides: Record<string, unknown> = {}) =>
	({
		sku: 'SKU-1',
		status: 'live',
		featured: true,
		madeToOrder: false,
		estimatedDeliveryText: null,
		lowStockThreshold: 1,
		pinnedBadges: [],
		hiddenBadges: [],
		addonPriceINR: null,
		shipping: { weightGrams: null, lengthCm: null, widthCm: null, heightCm: null },
		hsnCode: null,
		variants: [write()],
		...overrides,
	}) as never;

interface Options {
	row?: Row | null;
	rows?: VariantRow[];
	bare?: boolean;
	taken?: Row | null;
	placement?: unknown;
	relations?: unknown[];
	redirects?: unknown[];
	assets?: unknown[];
}

const build = (options: Options = {}) => {
	const row = options.row === undefined ? product() : options.row;
	const rows = options.rows ?? [variant()];
	const stored = [...(options.redirects ?? [])] as Array<{
		id: string;
		sourcePath: string;
		targetPath?: string;
		statusCode: number;
	}>;
	const products = {
		findById: vi.fn(async (id: string) => (row && id === row.id ? row : null)),
		findBySlug: vi.fn(async (slug: string) => (row && slug === row.slug ? row : (options.taken ?? null))),
		list: vi.fn(async () => ({ items: row ? [row] : [], total: row ? 1 : 0, page: 1, pageSize: 20 })),
		save: vi.fn(async (saved: unknown) => saved),
	};
	const categories = {
		tree: vi.fn(async () => ['tree']),
		findBySlug: vi.fn(async (slug: string) => (slug === 'silk' ? { id: 'c1' } : null)),
		findById: vi.fn(async (id: string) => (id === 'c1' ? { name: { en: 'Silk', fr: 'Soie' } } : null)),
	};
	const variants = { listForProduct: vi.fn(async () => rows), save: vi.fn(async (saved: unknown) => saved) };
	const redirects = {
		list: vi.fn(async () => stored),
		findBySource: vi.fn(
			async (sourcePath: string) => stored.find((entry) => entry.sourcePath === sourcePath) ?? null,
		),
		save: vi.fn(async (saved: (typeof stored)[number]) => {
			const index = stored.findIndex((entry) => entry.sourcePath === saved.sourcePath);
			if (index >= 0) stored[index] = saved;
			else stored.push(saved);
			return saved;
		}),
		remove: vi.fn(async () => {}),
	};
	const addons = {
		list: vi.fn(async () => ['template']),
		save: vi.fn(async (saved: unknown) => saved),
		remove: vi.fn(async () => {}),
	};
	const audit = { append: vi.fn(async () => {}) };
	const transactions = { withTransaction: vi.fn(async (work: () => Promise<void>) => work()) };
	const relations = {
		listForProduct: vi.fn(async () => options.relations ?? []),
		deleteById: vi.fn(async () => {}),
		save: vi.fn(async (saved: unknown) => saved),
	};
	const placements = {
		findByPath: vi.fn(async () => options.placement ?? null),
		listLivePaths: vi.fn(async () => ['sarees']),
	};
	const media = { findManyByIds: vi.fn(async () => options.assets ?? []) };
	const storage = { getUrl: (key: string) => `https://cdn.test/${key}` };
	const search = { indexProduct: vi.fn(async () => {}), removeProduct: vi.fn(async () => {}) };
	const stockAlerts = { save: vi.fn(async () => {}) };
	const service = options.bare
		? new CatalogService(products as never, categories as never, variants as never, redirects as never)
		: new CatalogService(
				products as never,
				categories as never,
				variants as never,
				redirects as never,
				addons as never,
				audit as never,
				transactions as never,
				relations as never,
				placements as never,
				media as never,
				storage as never,
				search as never,
				stockAlerts as never,
			);
	return {
		service,
		products,
		variants,
		redirects,
		addons,
		audit,
		relations,
		search,
		stockAlerts,
		transactions,
		stored,
	};
};

const actions = (audit: { append: ReturnType<typeof vi.fn> }) =>
	audit.append.mock.calls.map((call: unknown[]) => (call[0] as { action: string }).action);

describe('reads', () => {
	it('defaults the audience to public', async () => {
		const { service, products } = build();
		await service.listProducts({} as never);
		expect(products.list).toHaveBeenCalledWith({ audience: 'public' });
		await service.listProducts({ audience: 'admin' } as never);
		expect(products.list).toHaveBeenLastCalledWith({ audience: 'admin' });
	});

	it('finds a product by id or slug, and refuses a stranger', async () => {
		const { service } = build();
		expect((await service.getProduct('prd_1')).id).toBe('prd_1');
		expect((await service.getProduct('red-saree')).id).toBe('prd_1');
		await expect(service.getProduct('none')).rejects.toBeInstanceOf(NotFoundException);
	});

	it('reads the category tree and one category', async () => {
		const { service } = build();
		expect(await service.getCategoryTree()).toEqual(['tree']);
		expect(await service.getCategory('silk')).toEqual({ id: 'c1' });
		await expect(service.getCategory('none')).rejects.toBeInstanceOf(NotFoundException);
	});

	it('shows no selection for a product with no rows', async () => {
		expect((await build({ rows: [] }).service.productRead('red-saree')).selected).toBeNull();
	});
});

describe('redirects', () => {
	const row = { sourcePath: '/Old/', statusCode: 301, targetPath: '/en/new', reason: 'legacy_woo' } as never;

	it('saves by normalised source, audits, and keeps an edit on the same row', async () => {
		const { service, audit, redirects } = build({
			redirects: [{ id: 'redir_1', sourcePath: '/old', statusCode: 410 }],
		});
		const saved = await service.saveRedirect(row, 'a1');
		expect(saved).toMatchObject({ id: 'redir_1', sourcePath: '/old' });
		expect(redirects.save).toHaveBeenCalledTimes(1);
		expect(actions(audit)).toEqual(['catalog.redirect.save']);
	});

	it('records a row with no target', async () => {
		const { service, audit } = build();
		await service.saveRedirect({ sourcePath: '/gone', statusCode: 410, reason: 'legacy_woo' } as never);
		const entry = audit.append.mock.calls[0]?.[0 as never] as unknown as {
			metadata: { targetPath: unknown };
			actorUserId: unknown;
		};
		expect(entry.metadata.targetPath).toBeNull();
		expect(entry.actorUserId).toBeNull();
	});

	it('repoints rows that went through this one', async () => {
		const { service, stored } = build({
			redirects: [{ id: 'r1', sourcePath: '/older', statusCode: 301, targetPath: '/old', reason: 'legacy_woo' }],
		});
		await service.saveRedirect(row);
		expect(stored.find((entry) => entry.sourcePath === '/older')?.targetPath).toBe('/en/new');
	});

	it('turns a loop into a clear refusal, and passes on anything else', async () => {
		const looping = build();
		looping.redirects.save.mockRejectedValue(new Error('redirect loop'));
		await expect(looping.service.saveRedirect(row)).rejects.toBeInstanceOf(BadRequestException);
		const broken = build();
		broken.redirects.save.mockRejectedValue(new Error('disk full'));
		await expect(broken.service.saveRedirect(row)).rejects.toThrow('disk full');
		const odd = build();
		odd.redirects.save.mockRejectedValue('not an error');
		await expect(odd.service.saveRedirect(row)).rejects.toBe('not an error');
	});

	it('works without a transaction manager or audit log', async () => {
		const { service } = build({ bare: true });
		await expect(service.saveRedirect(row)).resolves.toMatchObject({ sourcePath: '/old' });
		await expect(service.removeRedirect('/old')).resolves.toBeUndefined();
	});

	it('lists the rows', async () => {
		const { service } = build({ redirects: [{ id: 'r', sourcePath: '/a', statusCode: 410 }] });
		expect(await service.listRedirects()).toHaveLength(1);
	});

	it('removes a row', async () => {
		const { service, redirects, audit } = build();
		await service.removeRedirect('/old', 'a1');
		expect(redirects.remove).toHaveBeenCalledWith('/old');
		expect(actions(audit)).toEqual(['catalog.redirect.remove']);
	});
});

describe('discontinue', () => {
	it('writes a 410 with no replacement, and takes the product out of search', async () => {
		const { service, products, search, stored } = build();
		expect(await service.discontinue('red-saree', null, 'a1')).toEqual({
			slug: 'red-saree',
			statusCode: 410,
			targetPath: null,
		});
		expect((products.save.mock.calls[0] as unknown as [Row])[0]).toMatchObject({
			status: 'discontinued',
			replacementTarget: null,
		});
		expect(stored[0]).toMatchObject({ sourcePath: '/product/red-saree', statusCode: 410 });
		expect(search.removeProduct).toHaveBeenCalledWith('prd_1');
	});

	it('writes a 301 to a live product', async () => {
		const { service } = build({ taken: product({ id: 'prd_2', slug: 'blue' }) });
		expect(await service.discontinue('red-saree', '/product/blue')).toMatchObject({
			statusCode: 301,
			targetPath: '/product/blue',
		});
	});

	it('writes a 301 to a live collection', async () => {
		const { service, products } = build({ placement: { id: 'plc' } });
		await service.discontinue('red-saree', '/collections/sarees/silk');
		expect((products.save.mock.calls[0] as unknown as [Row])[0].replacementTarget).toEqual({
			kind: 'collection',
			path: '/collections/sarees/silk',
		});
	});

	it.each([
		['itself', '/product/red-saree'],
		['a missing product', '/product/none'],
		['a bare product path', '/product'],
		['a missing collection', '/collections/none'],
		['anything else', '/about'],
	])('refuses %s as a replacement', async (_label, path) => {
		await expect(build().service.discontinue('red-saree', path)).rejects.toThrow('live product or collection');
	});

	it('refuses a collection when placements are not wired in', async () => {
		await expect(build({ bare: true }).service.discontinue('red-saree', '/collections/x')).rejects.toBeInstanceOf(
			BadRequestException,
		);
	});
});

describe('admin list and detail', () => {
	const asset = {
		id: 'm1',
		visibility: 'public',
		width: 10,
		height: 10,
		dominantColor: null,
		thumbHash: null,
		text: { alt: {}, title: {}, caption: {} },
		derivatives: [
			{ role: 'card', storageKey: 'k', width: 10, height: 10, byteSize: 1, format: 'image/webp', roleVersion: 1 },
		],
	};

	it('prices from the cheapest variant and shows a thumbnail', async () => {
		const row = product({ media: { gallery: ['m1'] } });
		const list = await build({
			row,
			rows: [
				variant({ priceINR: 900 }),
				variant({ id: 'v2', sku: 'V2', isBaseVariant: false, optionSelectionHash: 'x', priceINR: 800 }),
			],
			assets: [asset],
		}).service.adminList({ page: 1, pageSize: 20 } as never);
		expect(list.items[0]).toMatchObject({
			sellingFromINR: 800,
			stock: 4,
			variantCount: 2,
			thumbnailUrl: 'https://cdn.test/k',
		});
	});

	it('gives the form a picture for each image it can show', async () => {
		const row = product({ media: { gallery: ['m1', 'gone'], compound: [], altOverrides: {} } });
		const detail = await build({ row, rows: [variant()], assets: [asset] }).service.adminDetail('red-saree');
		expect(detail.images).toMatchObject([{ assetId: 'm1', url: 'https://cdn.test/k' }]);
	});

	it('falls back to the base price, and to no thumbnail', async () => {
		const list = await build({ rows: [] }).service.adminList({ page: 1, pageSize: 20 } as never);
		expect(list.items[0]).toMatchObject({ sellingFromINR: 1000, thumbnailUrl: null });
		const hidden = await build({
			row: product({ media: { gallery: ['m1'] } }),
			assets: [{ ...asset, visibility: 'private' }],
		}).service.adminList({ page: 1, pageSize: 20 } as never);
		expect(hidden.items[0]?.thumbnailUrl).toBeNull();
		const noRole = await build({
			row: product({ media: { gallery: ['m1'] } }),
			assets: [{ ...asset, derivatives: [{ ...asset.derivatives[0], role: 'zoom' }] }],
		}).service.adminList({ page: 1, pageSize: 20 } as never);
		expect(noRole.items[0]?.thumbnailUrl).toBeNull();
		const bare = await build({ bare: true, row: product({ media: { gallery: ['m1'] } }) }).service.adminList({
			page: 1,
			pageSize: 20,
		} as never);
		expect(bare.items[0]?.thumbnailUrl).toBeNull();
	});

	it('reads a full form', async () => {
		const row = product({
			estimatedDeliveryText: { en: 'Soon' },
			pinnedBadges: ['sale', 'not-a-badge'],
			hiddenBadges: ['featured', 'nope'],
			replacementTarget: { kind: 'product', path: '/product/blue' },
			optionGroups: [
				{
					attributeCode: 'size',
					label: { en: 'Size' },
					semanticRole: 'variation_axis',
					displayStyle: 'circle',
					requiredSelection: true,
					terms: [{ code: 's', label: { en: 'Small' } }],
				},
			],
		});
		const detail = await build({
			row,
			rows: [
				variant({
					shippingProfile: { weightGrams: 1, lengthCm: 2, widthCm: 3, heightCm: 4 },
					taxProfile: { hsnCode: '5007', taxClassId: null },
					barcode: 'b',
					compareAtPriceINR: 1200,
				}),
				variant({
					id: 'v2',
					sku: 'V2',
					isBaseVariant: false,
					status: 'disabled',
					optionSelections: [{ attributeCode: 'gone', termCode: 'x' }],
					optionSelectionHash: 'x',
				}),
			],
			relations: [
				{ source: 'manual', targetId: 'prd_2' },
				{ source: 'insight_set', targetId: 'prd_3' },
			],
		}).service.adminDetail('red-saree');
		expect(detail).toMatchObject({
			estimatedDeliveryText: 'Soon',
			pinnedBadges: ['sale'],
			hiddenBadges: ['featured'],
			replacementPath: '/product/blue',
			relatedProductIds: ['prd_2'],
			published: true,
		});
		expect(detail.variants[0]).toMatchObject({
			label: 'Small',
			weightGrams: 1,
			hsnCode: '5007',
			barcode: 'b',
			mrpINR: 1200,
		});
		expect(detail.variants[1]).toMatchObject({
			label: 'Red saree',
			available: false,
			weightGrams: null,
			lengthCm: null,
			widthCm: null,
			heightCm: null,
			barcode: null,
			hsnCode: null,
		});
	});

	it('reads a draft with nothing filled in', async () => {
		const detail = await build({
			bare: true,
			row: product({ status: 'draft', lifecycle: { liveAt: null } }),
			rows: [],
		}).service.adminDetail('red-saree');
		expect(detail).toMatchObject({
			published: false,
			estimatedDeliveryText: null,
			replacementPath: null,
			relatedProductIds: [],
		});
	});

	it('lists replacement targets, with or without placements', async () => {
		const targets = await build().service.replacementTargets();
		expect(targets.map((target) => target.kind)).toEqual(['product', 'collection']);
		expect((await build({ bare: true }).service.replacementTargets()).map((target) => target.kind)).toEqual([
			'product',
		]);
	});
});

describe('saving the product form', () => {
	it('refuses a discontinued product', async () => {
		await expect(
			build({ row: product({ status: 'discontinued' }) }).service.updateMerchandising('red-saree', form()),
		).rejects.toThrow('discontinued');
	});

	it('keeps a published SKU, on the product and on a variant', async () => {
		await expect(build().service.updateMerchandising('red-saree', form({ sku: 'NEW' }))).rejects.toThrow(
			'keeps its SKU',
		);
		await expect(
			build().service.updateMerchandising('red-saree', form({ variants: [write({ sku: 'NEW' })] })),
		).rejects.toThrow('A published variant keeps its SKU');
	});

	it('lets a draft change its SKUs', async () => {
		const row = product({ status: 'draft', lifecycle: { liveAt: null } });
		const { service, products } = build({ row });
		await service.updateMerchandising(
			'red-saree',
			form({ sku: 'NEW', status: 'disabled', variants: [write({ sku: 'NEW-V' })] }),
		);
		const saved = (products.save.mock.calls[0] as unknown as [Row])[0];
		expect(saved.sku).toBe('NEW');
		expect(saved.lifecycle).toMatchObject({ liveAt: null, disabledAt: expect.any(String) });
	});

	it('refuses an unknown variant', async () => {
		await expect(
			build().service.updateMerchandising('red-saree', form({ variants: [write({ id: 'nope' })] })),
		).rejects.toThrow('Unknown variant');
	});

	it('writes prices, stock, shipping and tax', async () => {
		const { service, variants, products, search, audit } = build();
		expect(await service.updateMerchandising('red-saree', form(), 'a1')).toEqual({
			id: 'prd_1',
			slug: 'red-saree',
		});
		const saved = (variants.save.mock.calls[0] as unknown as [VariantRow])[0];
		expect(saved).toMatchObject({
			priceINR: 1200,
			compareAtPriceINR: 1200,
			salePriceINR: 1000,
			status: 'live',
			barcode: 'b',
			shippingProfile: { weightGrams: 100 },
			taxProfile: { hsnCode: 'h', taxClassId: null },
		});
		expect((products.save.mock.calls[0] as unknown as [Row])[0]).toMatchObject({
			basePriceINR: 1000,
			onSale: true,
			featured: true,
		});
		expect(search.indexProduct).toHaveBeenCalledTimes(1);
		expect(actions(audit)).toEqual(['catalog.product.save']);
	});

	it('uses the selling price when there is no MRP, and no discount at MRP', async () => {
		const { service, variants } = build();
		await service.updateMerchandising(
			'red-saree',
			form({ variants: [write({ mrpINR: null, sellingINR: 900, available: false })] }),
		);
		expect((variants.save.mock.calls[0] as unknown as [VariantRow])[0]).toMatchObject({
			priceINR: 900,
			compareAtPriceINR: null,
			salePriceINR: null,
			status: 'disabled',
		});
		const same = build();
		await same.service.updateMerchandising(
			'red-saree',
			form({ variants: [write({ mrpINR: 1000, sellingINR: 1000 })] }),
		);
		expect((same.variants.save.mock.calls[0] as unknown as [VariantRow])[0].salePriceINR).toBeNull();
	});

	it('keeps a tax class and a delivery text in other languages', async () => {
		const row = product({ estimatedDeliveryText: { en: 'Old', fr: 'Bientôt' } });
		const { service, variants, products } = build({
			row,
			rows: [variant({ taxProfile: { hsnCode: 'x', taxClassId: 'gst' } })],
		});
		await service.updateMerchandising('red-saree', form({ estimatedDeliveryText: 'New' }));
		expect((variants.save.mock.calls[0] as unknown as [VariantRow])[0].taxProfile?.taxClassId).toBe('gst');
		expect((products.save.mock.calls[0] as unknown as [Row])[0].estimatedDeliveryText).toEqual({
			en: 'New',
			fr: 'Bientôt',
		});
	});

	it('starts a delivery text from nothing', async () => {
		const { service, products } = build();
		await service.updateMerchandising('red-saree', form({ estimatedDeliveryText: 'New' }));
		expect((products.save.mock.calls[0] as unknown as [Row])[0].estimatedDeliveryText).toEqual({ en: 'New' });
	});

	it('marks the first time a product goes live', async () => {
		const row = product({ status: 'live', lifecycle: { liveAt: null } });
		const { service, products } = build({ row });
		await service.updateMerchandising('red-saree', form());
		expect((products.save.mock.calls[0] as unknown as [Row])[0].lifecycle.liveAt).toEqual(expect.any(String));
	});

	it('keeps the disabled date on a product already disabled', async () => {
		const row = product({
			status: 'disabled',
			lifecycle: { liveAt: '2026-01-01T00:00:00.000Z', disabledAt: '2026-02-01T00:00:00.000Z' },
		});
		const { service, products, search } = build({ row });
		await service.updateMerchandising('red-saree', form({ status: 'disabled' }));
		expect((products.save.mock.calls[0] as unknown as [Row])[0].lifecycle.disabledAt).toBe(
			'2026-02-01T00:00:00.000Z',
		);
		expect(search.removeProduct).toHaveBeenCalledWith('prd_1');
	});

	it('counts stock received, and notes a return to stock', async () => {
		const { service, products } = build({ rows: [variant({ stock: { quantity: 0 } })] });
		await service.updateMerchandising('red-saree', form({ variants: [write({ quantity: 5 })] }));
		const saved = (products.save.mock.calls[0] as unknown as [Row])[0];
		expect(saved.lifetimeUnitsReceived).toBe(5);
		expect(saved.backInStockAt).toEqual(expect.any(String));
	});

	it('counts a row with no earlier stock as all new', async () => {
		const { service, products } = build();
		const realGet = Map.prototype.get;
		const spy = vi.spyOn(Map.prototype, 'get').mockImplementation(function (
			this: Map<unknown, unknown>,
			key: unknown,
		) {
			const stack = new Error().stack ?? '';
			return stack.includes('catalog.service') && stack.includes('reduce') ? undefined : realGet.call(this, key);
		});
		await service.updateMerchandising('red-saree', form({ variants: [write({ quantity: 3 })] }));
		spy.mockRestore();
		expect((products.save.mock.calls[0] as unknown as [Row])[0].lifetimeUnitsReceived).toBe(3);
	});

	it('counts nothing for stock going down', async () => {
		const { service, products } = build();
		await service.updateMerchandising('red-saree', form({ variants: [write({ quantity: 0 })] }));
		const saved = (products.save.mock.calls[0] as unknown as [Row])[0];
		expect(saved.lifetimeUnitsReceived).toBe(0);
		expect(saved.backInStockAt).toBeNull();
	});

	it('prices from all rows when none is live, and keeps the price with no rows', async () => {
		const { service, products } = build();
		await service.updateMerchandising(
			'red-saree',
			form({ variants: [write({ available: false, mrpINR: null, sellingINR: 700 })] }),
		);
		expect((products.save.mock.calls[0] as unknown as [Row])[0].basePriceINR).toBe(700);
		const empty = build({ rows: [] });
		await empty.service.updateMerchandising('red-saree', form({ variants: [] }));
		expect((empty.products.save.mock.calls[0] as unknown as [Row])[0].basePriceINR).toBe(1000);
	});

	it('leaves a variant the form did not send, and prices from it too', async () => {
		const rows = [
			variant(),
			variant({ id: 'v2', sku: 'V2', isBaseVariant: false, optionSelectionHash: 'x', priceINR: 400 }),
		];
		const { service, products } = build({ rows });
		await service.updateMerchandising('red-saree', form());
		expect((products.save.mock.calls[0] as unknown as [Row])[0].basePriceINR).toBe(400);
	});

	it('forwards a renamed address, and refuses one already in use', async () => {
		const { service, stored } = build();
		expect((await service.updateMerchandising('red-saree', form({ slug: 'crimson' }))).slug).toBe('crimson');
		expect(stored[0]).toMatchObject({
			sourcePath: '/product/red-saree',
			targetPath: '/product/crimson',
			reason: 'slug_change',
		});
		await expect(
			build({ taken: product({ id: 'prd_2', slug: 'crimson' }) }).service.updateMerchandising(
				'red-saree',
				form({ slug: 'crimson' }),
			),
		).rejects.toThrow('already taken');
	});

	it('gives search the names of its categories', async () => {
		const { service, search } = build();
		await service.syncSearch(product({ status: 'live', categoryIds: ['c1', 'gone'] }));
		expect(search.indexProduct).toHaveBeenLastCalledWith(
			expect.objectContaining({ categoryNames: ['Silk', 'Soie'] }),
		);
	});

	it('saves even when the search index is down', async () => {
		const { service, search } = build();
		search.indexProduct.mockRejectedValue(new Error('search down'));
		await expect(service.updateMerchandising('red-saree', form())).resolves.toMatchObject({ id: 'prd_1' });
	});

	it('saves with no search wired in', async () => {
		await expect(build({ bare: true }).service.updateMerchandising('red-saree', form())).resolves.toMatchObject({
			id: 'prd_1',
		});
		await expect(
			build({ bare: true }).service.updateMerchandising('red-saree', form({ status: 'disabled' })),
		).resolves.toMatchObject({ id: 'prd_1' });
	});

	it('replaces manual relations, keeps automatic ones, and skips itself', async () => {
		const { service, relations } = build({
			relations: [
				{ id: 'keep', source: 'insight_set' },
				{ id: 'drop', source: 'manual' },
			],
		});
		await service.updateMerchandising('red-saree', form({ relatedProductIds: ['prd_2', 'prd_1', ''] }));
		expect(relations.deleteById).toHaveBeenCalledTimes(1);
		expect(relations.deleteById).toHaveBeenCalledWith('drop');
		expect(relations.save).toHaveBeenCalledTimes(1);
		expect((relations.save.mock.calls[0] as unknown as [{ targetId: string }])[0].targetId).toBe('prd_2');
	});
});

describe('stock alerts', () => {
	it('needs a signed-in customer and a real variant', async () => {
		await expect(build().service.requestStockAlert('red-saree', 'V1', null)).rejects.toThrow('Sign in');
		await expect(build().service.requestStockAlert('red-saree', 'NOPE', 'c1')).rejects.toThrow('Variant not found');
	});

	it('saves the request, and still answers with no store', async () => {
		const { service, stockAlerts } = build();
		expect(await service.requestStockAlert('red-saree', 'V1', 'c1')).toEqual({ ok: true });
		expect(stockAlerts.save).toHaveBeenCalledWith(
			expect.objectContaining({ customerId: 'c1', variantId: 'var_1' }),
		);
		expect(await build({ bare: true }).service.requestStockAlert('red-saree', 'V1', 'c1')).toEqual({ ok: true });
	});
});

describe('add-on templates', () => {
	it('lists, saves and removes with an audit row', async () => {
		const { service, audit, addons } = build();
		expect(await service.listAddonTemplates()).toEqual(['template']);
		await service.saveAddonTemplate({ code: 'fall', label: { en: 'Fall' }, priceINR: 1, fields: [], sizeGuide: [] }, 'a1');
		await service.removeAddonTemplate('fall');
		expect(addons.remove).toHaveBeenCalledWith('fall');
		expect(actions(audit)).toEqual(['catalog.addon-template.save', 'catalog.addon-template.remove']);
	});

	it('answers nothing, or refuses, with no store', async () => {
		const { service } = build({ bare: true });
		expect(await service.listAddonTemplates()).toEqual([]);
		await expect(service.saveAddonTemplate({ code: 'x', label: { en: 'X' }, priceINR: 1, fields: [], sizeGuide: [] })).rejects.toBeInstanceOf(
			NotFoundException,
		);
		await expect(service.removeAddonTemplate('x')).rejects.toBeInstanceOf(NotFoundException);
	});
});

describe('catalogue controllers', () => {
	const signedIn = { userId: 'u1' } as never;

	it('hands admin product work to the service', async () => {
		const catalog = {
			adminList: vi.fn(async () => 'list'),
			replacementTargets: vi.fn(async () => 'targets'),
			adminDetail: vi.fn(async () => 'detail'),
			discontinue: vi.fn(async () => 'gone'),
			updateMerchandising: vi.fn(async () => 'saved'),
		};
		const controller = new AdminProductsController(catalog as never, {} as never);
		expect(await controller.list({ page: 1 } as never)).toBe('list');
		expect(await controller.replacementTargets()).toBe('targets');
		expect(await controller.detail('p')).toBe('detail');
		await controller.discontinue('p', { replacementPath: '/x' } as never, signedIn);
		expect(catalog.discontinue).toHaveBeenLastCalledWith('p', '/x', 'u1');
		await controller.discontinue('p', {} as never, undefined);
		expect(catalog.discontinue).toHaveBeenLastCalledWith('p', null, null);
		await controller.update('p', { sku: 's' } as never, signedIn);
		await controller.update('p', { sku: 's' } as never, undefined);
		expect(catalog.updateMerchandising).toHaveBeenNthCalledWith(1, 'p', { sku: 's' }, 'u1');
		expect(catalog.updateMerchandising).toHaveBeenNthCalledWith(2, 'p', { sku: 's' }, null);
	});

	it('hands add-on and redirect work to the service', async () => {
		const catalog = {
			listAddonTemplates: vi.fn(async () => 'templates'),
			saveAddonTemplate: vi.fn(async () => 'saved'),
			removeAddonTemplate: vi.fn(async () => undefined),
			listRedirects: vi.fn(async () => 'redirects'),
			saveRedirect: vi.fn(async () => 'saved'),
			removeRedirect: vi.fn(async () => undefined),
		};
		const addons = new AdminAddonTemplatesController(catalog as never);
		expect(await addons.list()).toBe('templates');
		await addons.save({ code: 'x' } as never, signedIn);
		await addons.save({ code: 'x' } as never, undefined);
		expect(catalog.saveAddonTemplate).toHaveBeenLastCalledWith({ code: 'x' }, null);
		await addons.remove('x', signedIn);
		await addons.remove('x', undefined);
		expect(catalog.removeAddonTemplate).toHaveBeenNthCalledWith(1, 'x', 'u1');
		expect(catalog.removeAddonTemplate).toHaveBeenNthCalledWith(2, 'x', null);
		const redirects = new AdminRedirectsController(catalog as never);
		expect(await redirects.list()).toBe('redirects');
		await redirects.save({ sourcePath: '/a' } as never, signedIn);
		await redirects.save({ sourcePath: '/a' } as never, undefined);
		expect(catalog.saveRedirect).toHaveBeenLastCalledWith({ sourcePath: '/a' }, null);
		await redirects.remove('/a', signedIn);
		await redirects.remove('/a', undefined);
		expect(catalog.removeRedirect).toHaveBeenNthCalledWith(1, '/a', 'u1');
		expect(catalog.removeRedirect).toHaveBeenNthCalledWith(2, '/a', null);
	});

	it('serves categories', async () => {
		const catalog = { getCategoryTree: vi.fn(async () => 'tree'), getCategory: vi.fn(async () => 'one') };
		const publicCatalog = { menu: vi.fn(async () => []) };
		const controller = new CategoriesController(catalog as never, publicCatalog as never);
		expect(await controller.menu()).toEqual([]);
		expect(await controller.tree()).toBe('tree');
		expect(await controller.get('silk')).toBe('one');
	});

	it('serves public product reads', async () => {
		const catalog = {
			listProducts: vi.fn(async () => 'list'),
			getProduct: vi.fn(async () => 'product'),
			listRedirects: vi.fn(async () => [
				{ sourcePath: '/saved', statusCode: 301, targetPath: '/x', id: 'hidden' },
			]),
		};
		const publicCatalog = {
			retiredCollectionRows: vi.fn(async () => [
				{ sourcePath: '/saved', statusCode: 410 },
				{ sourcePath: '/auto', statusCode: 410 },
			]),
			relationCards: vi.fn(async () => 'relations'),
			gallery: vi.fn(async () => 'gallery'),
			page: vi.fn(async () => 'page'),
		};
		const controller = new ProductsController(catalog as never, publicCatalog as never);
		await controller.list('2', '10', 'c', 't', 's');
		expect(catalog.listProducts).toHaveBeenLastCalledWith({
			audience: 'public',
			page: 2,
			pageSize: 10,
			categoryId: 'c',
			tag: 't',
			search: 's',
		});
		await controller.list();
		expect(catalog.listProducts).toHaveBeenLastCalledWith(
			expect.objectContaining({ page: undefined, pageSize: undefined }),
		);
		expect(await controller.legacyRedirects()).toEqual([
			{ sourcePath: '/saved', statusCode: 301, targetPath: '/x' },
			{ sourcePath: '/auto', statusCode: 410 },
		]);
		expect(await controller.relations('p')).toBe('relations');
		expect(await controller.gallery('p')).toBe('gallery');
		expect(await controller.view('p', 'V1')).toBe('page');
		expect(publicCatalog.page).toHaveBeenCalledWith('p', 'V1');
		expect(await controller.get('p')).toBe('product');
	});

	it('serves storefront reads', async () => {
		const catalog = {
			home: vi.fn(async () => 'home'),
			placement: vi.fn(async () => 'placement'),
			cardsForSlugs: vi.fn(async () => 'cards'),
			seoRoute: vi.fn(async () => 'route'),
			sitemapPaths: vi.fn(async () => ['/en/']),
			livePaths: vi.fn(async () => 'paths'),
		};
		const recent = { list: vi.fn(async () => 'recent') };
		const controller = new StorefrontCatalogController(catalog as never, recent as never);
		expect(await controller.home()).toBe('home');
		expect(await controller.placement({ path: 'x' } as never)).toBe('placement');
		await controller.cards({ slug: 'a' } as never);
		expect(catalog.cardsForSlugs).toHaveBeenLastCalledWith(['a']);
		await controller.cards({ slug: ['a', 'b'] } as never);
		expect(catalog.cardsForSlugs).toHaveBeenLastCalledWith(['a', 'b']);
		await controller.cards({} as never);
		expect(catalog.cardsForSlugs).toHaveBeenLastCalledWith([]);
		expect(await controller.recent()).toBe('recent');
		expect(await controller.seoRoute({ path: '/x', locale: 'en' } as never)).toEqual({ route: 'route' });
		expect(await controller.sitemap()).toEqual({ paths: ['/en/'] });
		expect(await controller.livePaths()).toBe('paths');
	});

	it('rate limits a stock alert by person', async () => {
		const catalog = { requestStockAlert: vi.fn(async () => ({ ok: true })) };
		const limits = { enforce: vi.fn(async () => {}) };
		const controller = new StockAlertsController(catalog as never, limits as never);
		const request = { ip: '1.2.3.4' } as never;
		await controller.stockAlert('p', { variantSku: 'V1' } as never, signedIn, request);
		expect(limits.enforce).toHaveBeenLastCalledWith('stock_alert', { identifier: 'u1', ip: '1.2.3.4' });
		expect(catalog.requestStockAlert).toHaveBeenLastCalledWith('p', 'V1', 'u1');
		await controller.stockAlert('p', { variantSku: 'V1' } as never, undefined, request);
		expect(limits.enforce).toHaveBeenLastCalledWith('stock_alert', { identifier: '', ip: '1.2.3.4' });
		expect(catalog.requestStockAlert).toHaveBeenLastCalledWith('p', 'V1', null);
	});

	it('searches, and turns a search outage into a 503', async () => {
		const search = { search: vi.fn(async () => ({ items: [{ id: 'p1' }], total: 1 })) };
		const catalog = { cardsForIds: vi.fn(async () => ['card']) };
		const limits = { enforce: vi.fn(async () => {}) };
		const controller = new CatalogSearchController(search as never, catalog as never, limits as never);
		const request = { ip: '1.2.3.4' } as never;
		expect(await controller.searchProducts({ q: 'silk', categoryId: 'c' } as never, request)).toEqual({
			items: ['card'],
			total: 1,
		});
		expect(search.search).toHaveBeenLastCalledWith({ q: 'silk', categoryId: 'c', page: 1, pageSize: 24 });
		await controller.searchProducts({ q: 'silk' } as never, request);
		expect(search.search).toHaveBeenLastCalledWith({ q: 'silk', page: 1, pageSize: 24 });
		search.search.mockRejectedValueOnce(new SearchUnavailableError('down'));
		await expect(controller.searchProducts({ q: 'x' } as never, request)).rejects.toBeInstanceOf(
			ServiceUnavailableException,
		);
		search.search.mockRejectedValueOnce(new Error('bug'));
		await expect(controller.searchProducts({ q: 'x' } as never, request)).rejects.toThrow('bug');
	});
});
