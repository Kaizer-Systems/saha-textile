import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Product, ProductVariant } from '@saha-textile/contracts';
import { describe, expect, it, vi } from 'vitest';
import type { z } from 'zod';

import { CatalogService } from '../src/catalog/catalog.service';

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
	outbox?: unknown;
	others?: Row[];
	faqs?: unknown;
	stockRead?: unknown;
	orders?: unknown;
	bundleReader?: unknown;
	bundleRepo?: unknown;
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
		findById: vi.fn(async (id: string) =>
			row && id === row.id ? row : ((options.others ?? []).find((other) => other.id === id) ?? null),
		),
		findBySlug: vi.fn(async (slug: string) => (row && slug === row.slug ? row : (options.taken ?? null))),
		list: vi.fn(async () => {
			const items = [...(row ? [row] : []), ...(options.others ?? [])];
			return { items, total: items.length, page: 1, pageSize: 20 };
		}),
		save: vi.fn(async (saved: unknown) => saved),
		deleteById: vi.fn(async () => undefined),
	};
	const categories = {
		tree: vi.fn(async () => TREE as unknown[]),
		findBySlug: vi.fn(async (slug: string) => (slug === 'silk' ? { id: 'c1' } : null)),
		findById: vi.fn(async (id: string) => (id === 'c1' ? { name: { en: 'Silk', bn: 'সিল্ক' } } : null)),
	};
	const variants = {
		listForProduct: vi.fn(async () => rows),
		listForProducts: vi.fn(async () => rows),
		save: vi.fn(async (saved: unknown) => saved),
		deleteById: vi.fn(async () => undefined),
	};
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
		disableForTarget: vi.fn(async () => 0),
	};
	const placements = {
		findByPath: vi.fn(async () => options.placement ?? null),
		listLivePaths: vi.fn(async () => ['sarees']),
	};
	const media = { findManyByIds: vi.fn(async () => options.assets ?? []) };
	const storage = { getUrl: (key: string) => `https://cdn.test/${key}` };
	const search = { indexProducts: vi.fn(async () => {}), removeProduct: vi.fn(async () => {}) };
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
				undefined,
				undefined,
				options.faqs as never,
				undefined,
				options.outbox as never,
				undefined,
				options.stockRead as never,
				options.orders as never,
				undefined,
				options.bundleReader as never,
				options.bundleRepo as never,
			);
	return {
		service,
		products,
		categories,
		variants,
		redirects,
		addons,
		audit,
		relations,
		search,
		stockAlerts,
		transactions,
		stored,
		media,
	};
};

const TREE = [{ id: 'c1', name: { en: 'Silk', bn: 'সিল্ক' }, ancestors: [] }];

describe('catalog service: deletion facts and removal', () => {
	it('counts held stock, stock history and orders as reasons a product stays', async () => {
		const { service } = build({
			rows: [variant({ stock: { quantity: 0, held: 1 } })],
			stockRead: { withMovements: async () => new Set(['var_1']) },
			orders: { hasLinesFor: async () => true },
		});
		expect(await service.deletionFacts(product())).toEqual({ hasStock: true, hasMovements: true, hasOrders: true });
		const bare = build({ bare: true, rows: [variant({ stock: { quantity: 0 } })] });
		expect(await bare.service.deletionFacts(product())).toEqual({
			hasStock: false,
			hasMovements: false,
			hasOrders: false,
		});
	});

	it('removes a product with no question store or links, and keeps a question shared with another product', async () => {
		const bare = build({ bare: true });
		await bare.service.removeNeverLive(product(), null);
		const faqs = {
			listForProduct: vi.fn(async () => [{ id: 'faq_shared', productIds: ['prd_1', 'prd_2'] }]),
			deleteById: vi.fn(async () => undefined),
		};
		const { service } = build({ faqs });
		await service.removeNeverLive(product(), 'adm_1');
		expect(faqs.deleteById).not.toHaveBeenCalled();
	});

	it('copies no questions when there is no question store', async () => {
		const { service, relations } = build();
		await service.copyExtras('prd_1', 'prd_2');
		expect(relations.listForProduct).toHaveBeenCalled();
	});
});

describe('catalog service: the form read', () => {
	it('names the main category by English, another language or its address, with no HSN or box when unset', async () => {
		const row = product({ categoryIds: ['c1'] });
		const { service, categories } = build({ row });
		categories.findById
			.mockResolvedValueOnce({ id: 'c1', slug: 'silk', name: { bn: 'সিল্ক' }, returnable: true } as never)
			.mockResolvedValueOnce({
				id: 'c1',
				slug: 'silk',
				name: {},
				returnable: true,
				hsnCode: '5007',
				shipping: { weightGrams: 600 },
			} as never);
		expect((await service.adminDetail('red-saree')).mainCategory).toMatchObject({
			name: 'সিল্ক',
			hsnCode: null,
			shipping: null,
		});
		expect((await service.adminDetail('red-saree')).mainCategory).toMatchObject({
			name: 'silk',
			hsnCode: '5007',
			shipping: { weightGrams: 600 },
		});
	});

	it('shows a variant’s own picture with its version', async () => {
		const { service } = build({
			rows: [variant({ media: { primaryAssetId: 'ast_v', primaryVersionId: 'ver_1' } })],
		});
		const detail = await service.adminDetail('red-saree');
		expect(detail.variants[0]?.image).toEqual({ assetId: 'ast_v', versionId: 'ver_1' });
	});

	it('asks for the share picture’s tile with the gallery’s', async () => {
		const base = product();
		const { service, media } = build({
			row: { ...base, media: { ...base.media, shareImage: { assetId: 'ast_share', versionId: null } } } as Row,
		});
		await service.adminDetail('red-saree');
		expect(media.findManyByIds.mock.calls.flat(2)).toContain('ast_share');
	});

	it('saves a bundle’s questions the way the product form does, and nothing without a question store', async () => {
		const faqs = {
			listForProduct: vi.fn(async () => []),
			save: vi.fn(async (row: unknown) => row),
			deleteById: vi.fn(async () => {}),
		};
		await build({ faqs }).service.saveProductFaq('prd_1', []);
		expect(faqs.listForProduct).toHaveBeenCalledWith('prd_1');
		await expect(build().service.saveProductFaq('prd_1', [])).resolves.toBeUndefined();
	});
});

describe('catalog service: the admin list with bundles', () => {
	const stockSummary = { setsPossible: 1, state: 'in_stock', soldOutPieces: [], soldOutChoices: [] };
	const quote = (method: unknown) => ({
		levels: [],
		extras: [],
		method,
		params: {},
		rules: [],
		combine: 'all',
		capAtSeparately: false,
		roundTo: 'one',
	});
	const pieces = { base: { kind: 'pieces' }, inputs: [], rules: [], combine: 'all' };
	const fixed = {
		base: { kind: 'fixed', input: 'price' },
		inputs: [{ code: 'price', label: { en: 'Price' }, kind: 'money', min: null, max: null, default: null }],
		rules: [],
		combine: 'all',
	};

	it('passes the type and shop filters, and reads each bundle’s levels, price and stock', async () => {
		const set = product({ id: 'prd_set', slug: 'set', type: 'bundle', sku: 'BND-0001' });
		const fixedSet = product({ id: 'prd_fixed', slug: 'fixed', type: 'bundle', sku: 'BND-0002' });
		const bundleRepo = {
			listByProductIds: vi.fn(async () => [
				{ productId: 'prd_set', levels: [{}], stock: stockSummary },
				{ productId: 'prd_fixed', levels: [], stock: null },
				{ productId: 'prd_elsewhere', levels: [], stock: null },
			]),
		};
		const bundleReader = {
			resolve: vi.fn(async (row: { productId: string }) => ({
				productId: row.productId,
				levels: row.productId === 'prd_set' ? [{ items: [{}, {}], take: 1 }] : [],
			})),
			toQuote: (resolved: { productId: string }) => quote(resolved.productId === 'prd_fixed' ? fixed : pieces),
			stock: vi.fn(() => stockSummary),
		};
		const { service, products } = build({ row: product(), others: [set, fixedSet], bundleReader, bundleRepo });
		const list = await service.adminList({
			search: '',
			page: 1,
			pageSize: 20,
			type: 'bundle',
			shop: 'shown',
		} as never);
		expect(products.list).toHaveBeenCalledWith(expect.objectContaining({ type: 'bundle', shop: 'shown' }));
		const bundleOf = (id: string) => list.items.find((item) => item.id === id)?.bundle;
		expect(bundleOf('prd_1')).toBeNull();
		expect(bundleOf('prd_set')).toMatchObject({
			levels: 1,
			choices: true,
			fromPrice: true,
			stock: { setsPossible: 1 },
		});
		expect(bundleOf('prd_fixed')).toMatchObject({ levels: 0, choices: false, setPriceINR: null });
		expect(bundleReader.stock).toHaveBeenCalledWith(expect.objectContaining({ productId: 'prd_elsewhere' }), null);
	});

	it('reads no bundles without the bundle stores, or when the page has none', async () => {
		const { service } = build();
		expect((await service.adminList({ search: '', page: 1, pageSize: 20 } as never)).items[0]?.bundle).toBeNull();
		const bundleRepo = { listByProductIds: vi.fn(async () => []) };
		const withStores = build({ bundleReader: {}, bundleRepo });
		await withStores.service.adminList({ search: '', page: 1, pageSize: 20 } as never);
		expect(bundleRepo.listByProductIds).not.toHaveBeenCalled();
	});
});

describe('catalog service: free items on the form', () => {
	const freeWith = (productId: string) => ({
		items: [{ productId, variantId: null, quantity: 1 }],
		take: 'all',
		count: null,
		from: null,
		required: true,
	});

	it('refuses the product itself, a missing product and a bundle as a free item', async () => {
		const others = [product({ id: 'prd_set', slug: 'set', type: 'bundle' })];
		const { service } = build({ others });
		await expect(
			service.updateMerchandising('red-saree', form({ freeWith: freeWith('prd_1') })),
		).rejects.toBeInstanceOf(BadRequestException);
		await expect(
			service.updateMerchandising('red-saree', form({ freeWith: freeWith('prd_gone') })),
		).rejects.toBeInstanceOf(NotFoundException);
		await expect(
			service.updateMerchandising('red-saree', form({ freeWith: freeWith('prd_set') })),
		).rejects.toBeInstanceOf(BadRequestException);
	});

	it('saves a real product as a free item, and the Show on shop switch when sent', async () => {
		const others = [product({ id: 'prd_gift', slug: 'gift' })];
		const { service, products } = build({ others });
		await service.updateMerchandising('red-saree', form({ freeWith: freeWith('prd_gift'), showOnShop: false }));
		expect((products.save.mock.calls[0] as unknown as [Row])[0]).toMatchObject({
			freeWith: { items: [{ productId: 'prd_gift' }] },
			showOnShop: false,
		});
	});
});
