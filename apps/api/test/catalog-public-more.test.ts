import { CatalogCard, Product, ProductVariant } from '@saha-textile/contracts';
import { describe, expect, it, vi } from 'vitest';
import type { z } from 'zod';

import { CatalogPublicService, setCard } from '../src/catalog/catalog-public.service';
import { LanguageStore } from '../src/languages/language-store';
import { BundleReader } from '../src/catalog/bundles/bundle-reader';
import { SEEDED_PRICE_METHODS } from '@saha-textile/core-domain';

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

interface Options {
	rows?: ProductRow[];
	variants?: Variant[];
	withAll?: boolean;
	languages?: string[];
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
	faqs?: unknown;
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
		findPublicSlugBySku: vi.fn(async (sku: string) => rows.find((row) => row.sku === sku)?.slug ?? null),
	};
	const variants = {
		listForProduct: vi.fn(async () => variantRows),
		listForProducts: vi.fn(async () => variantRows),
	};
	const placements = {
		findByPath: vi.fn(async () => options.placement ?? null),
		findCanonical: vi.fn(async (_id: string): Promise<unknown> => options.canonical ?? null),
		listLivePaths: vi.fn(async () => options.live ?? []),
		listRetiredPaths: vi.fn(async () => options.retired ?? []),
	};
	const media = { findManyByIds: vi.fn(async () => options.assets ?? []) };
	const storage = { getUrl: (key: string) => `https://cdn.test/${key}` };
	const relations = { listForProduct: vi.fn(async () => options.relations ?? []) };
	const templates = { findByCode: vi.fn(async () => options.template ?? null) };
	const bundles = { findByProductId: vi.fn(async () => options.bundle ?? null) };
	const methods = {
		findById: vi.fn(
			async (id: string) =>
				SEEDED_PRICE_METHODS.map((seed) => ({
					...seed,
					id: `bpm_${seed.code}`,
					seeded: true,
					version: 1,
				})).find((method) => method.id === id) ?? null,
		),
	};
	const categories = {
		findBySlug: vi.fn(async () => options.category ?? null),
		findById: vi.fn(async () => options.category ?? null),
	};
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
					undefined,
					options.languages ? LanguageStore.fixed(options.languages) : undefined,
					options.faqs as never,
					undefined,
					new BundleReader(products as never, variants as never, methods as never, null),
				);
	return { service, products, variants, placements, media, seo };
};

const placement = (overrides: Record<string, unknown> = {}) => ({
	pathSlugs: ['sarees', 'silk'],
	pathCategoryIds: ['cat_1', 'cat_2'],
	pathLabel: 'Sarees',
	status: 'live',
	...overrides,
});
const set = product({ id: 'prd_set', type: 'bundle', slug: 'wedding-set', sku: 'BND-0001', basePriceINR: 0 });
const bundle = (overrides: Record<string, unknown> = {}) => ({
	id: 'bnd_1',
	productId: 'prd_set',
	levels: [
		{
			code: 'piece-1',
			label: { en: 'Saree' },
			take: 1,
			source: { kind: 'items' },
			items: [{ productId: 'prd_1', variantId: null, quantity: 2, priceInSetINR: null }],
			priceMode: 'difference',
		},
	],
	extras: [],
	pricing: {
		methodId: 'bpm_pieces_added_up',
		params: {},
		rules: [],
		combine: 'all',
		capAtSeparately: false,
		roundTo: 'one',
	},
	saleWindow: null,
	styledPhoto: null,
	dearerReason: null,
	stock: null,
	status: 'live',
	...overrides,
});

describe('product page: the remaining cases', () => {
	it('sells fabric from 1.0 m when no shortest cut was set, with its quick lengths', async () => {
		const cloth = product({
			soldBy: 'metre',
			shortestCutTenths: null,
			quickLengths: [{ tenths: 25, label: { en: '2.5 m' } }],
			widthInches: 44,
			weightPerMetreGrams: 120,
		});
		const page = await build({ rows: [cloth] }).service.page('red-saree');
		expect(page.metre).toMatchObject({
			shortestCutTenths: 10,
			quickLengths: [{ tenths: 25, label: '2.5 m' }],
			widthInches: 44,
		});
	});

	it('leaves out a second line with no words in the page language, and a measurements title with none', async () => {
		const row = product({
			addonTemplateCode: 'blouse',
			optionGroups: [
				{
					attributeCode: 'size',
					label: { en: 'Size' },
					semanticRole: 'variation_axis',
					displayStyle: 'rectangle',
					requiredSelection: false,
					terms: [{ code: 's', label: { en: 'S' }, subLabel: { bn: 'ছোট' } }],
				},
			],
		});
		const template = {
			code: 'blouse',
			label: { bn: 'মাপ' },
			priceINR: 500,
			sizeGuide: [],
			fields: [{ code: 'bust', label: { en: 'Bust' }, unit: 'in', min: null, max: null, step: null }],
		};
		const page = await build({ rows: [row], template }).service.page('red-saree');
		expect(page.optionGroups[0]?.terms[0]?.subLabel).toBeNull();
		expect(page.measurements?.title).toBeNull();
	});

	it('draws no set when none is stored, and a set piece with its own photo', async () => {
		expect((await build({ rows: [set, product()], bundle: null }).service.page('wedding-set')).bundle).toBeNull();
		const piece = product({ media: { gallery: ['ast_1'], compound: [], altOverrides: {} } });
		const page = await build({
			rows: [set, piece],
			bundle: bundle(),
			assets: [asset('ast_1', 'card')],
		}).service.page('wedding-set');
		expect(page.bundle?.levels[0]?.items[0]?.image).not.toBeNull();
	});

	it('reads the FAQ of a category with no canonical placement from the product’s own categories', async () => {
		const faqs = { resolveForSurface: vi.fn(async () => []) };
		await build({ rows: [product({ faqEnabled: true, categoryIds: ['cat_1'] })], faqs }).service.page('red-saree');
		expect(faqs.resolveForSurface).toHaveBeenCalledWith(expect.objectContaining({ categoryIds: ['cat_1'] }));
	});

	it('keeps the deepest live category when a shallower one comes later', async () => {
		const deep = product({ categoryIds: ['cat_deep', 'cat_top'] });
		const { service, placements } = build({ rows: [deep] });
		placements.findCanonical.mockImplementation(async (id: string) =>
			id === 'cat_deep'
				? placement({ pathSlugs: ['sarees', 'silk', 'banarasi'], pathCategoryIds: ['a', 'b', 'c'] })
				: placement({ pathSlugs: ['sarees'], pathCategoryIds: ['cat_top'] }),
		);
		const page = await service.page('red-saree');
		expect(page.breadcrumb).toHaveLength(3);
	});

	it('shows no chosen share picture when the version chosen has no files', async () => {
		const row = product({
			media: {
				gallery: [],
				compound: [],
				altOverrides: {},
				shareImage: { assetId: 'ast_s', versionId: 'ver_2' },
			},
		});
		const shared = {
			...asset('ast_s', 'share'),
			derivatives: [{ ...asset('ast_s', 'share').derivatives[0], versionId: 'ver_1' }],
		};
		const page = await build({ rows: [row], assets: [shared] }).service.page('red-saree');
		expect(page.shareImageUrl ?? null).toBeNull();
	});
});

describe('product cards and related products: the remaining cases', () => {
	it('prices a set card at its own price, showing what the pieces cost apart when the set is cheaper', async () => {
		const rows = [set, product()];
		const plain = await build({ rows, bundle: bundle() }).service.cardsForIds(['prd_set']);
		expect(plain[0]?.price).toMatchObject({ mrpINR: null, percentOff: null });
		// A fixed set cheaper than its pieces bought apart strikes their total.
		const cheaper = setCard(
			plain[0] as CatalogCard,
			{
				levels: [],
				fromPrice: false,
				heading: 'fixed',
				lowINR: 1800,
				priceINR: 1800,
				separatelyINR: 2000,
				buyable: true,
			} as never,
		);
		expect(cheaper.price).toMatchObject({ mrpINR: 2000, percentOff: 10 });
	});

	it('tops up “You may also like” from the product’s categories and stops once it has enough', async () => {
		const main = product({ categoryIds: ['cat_parent', 'cat_child'] });
		const others = Array.from({ length: 10 }, (_, index) =>
			product({ id: `prd_${index + 10}`, slug: `other-${index}`, sku: `SKU-${index + 10}` }),
		);
		const { service, products } = build({ rows: [main, ...others] });
		const cards = await service.relationCards('red-saree');
		expect(cards.related.length).toBeGreaterThanOrEqual(6);
		expect(products.list).toHaveBeenCalledTimes(1);
	});
});

describe('sitemap paths: the remaining cases', () => {
	it('keeps a page address with no language in front as it is', async () => {
		const routes = [{ entityType: 'page', path: '/about', canonicalPath: '/about', locale: 'en' }];
		expect(await build({ routes, languages: ['en', 'bn'] }).service.sitemapPaths()).toContain('/about');
	});
});
