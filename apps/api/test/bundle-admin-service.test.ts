import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { BundlePriceMethod, Product, ProductBundle } from '@saha-textile/contracts';
import { describe, expect, it, vi } from 'vitest';

import { BundleAdminService } from '../src/catalog/bundles/bundle-admin.service';
import { BundleReader, type ResolvedItem } from '../src/catalog/bundles/bundle-reader';

const both = { en: 'Text', bn: 'Texte' };
const product = (over: Record<string, unknown> = {}) =>
	Product.parse({
		id: 'prd_b',
		type: 'bundle',
		sku: 'BND-0001',
		title: both,
		slug: 'kit',
		basePriceINR: 0,
		media: { gallery: [], compound: [], altOverrides: {} },
		status: 'disabled',
		...over,
	});
const piece = (over: Record<string, unknown> = {}) =>
	Product.parse({
		id: 'prd_1',
		type: 'simple',
		sku: 'S',
		title: both,
		slug: 'saree',
		basePriceINR: 1000,
		media: { gallery: ['ast_1'], compound: [], altOverrides: {} },
		...over,
	});
const method = (over: Record<string, unknown> = {}) =>
	BundlePriceMethod.parse({
		id: 'bpm_fixed',
		code: 'fixed_price',
		name: { en: 'Fixed price' },
		help: { en: 'A price you type' },
		inputs: [
			{ code: 'price', label: { en: 'Price' }, kind: 'money', default: 5000 },
			{ code: 'pct', label: { en: '% off' }, kind: 'percent' },
		],
		base: { kind: 'fixed', input: 'price' },
		...over,
	});
const item = (over: Partial<ResolvedItem> = {}): ResolvedItem => ({
	key: 'i1',
	productId: 'prd_1',
	product: piece(),
	isBundle: false,
	live: true,
	shown: true,
	title: 'Saree',
	slug: 'saree',
	sku: 'S',
	variantId: null,
	variantLabel: null,
	variants: [{ id: 'var_1', label: 'Red', inStock: true, available: 2 }],
	mrpINR: null,
	sellingINR: 1000,
	saleINR: null,
	saleEventId: null,
	saleEndsAt: null,
	priceInSetINR: 1000,
	overridden: false,
	todayINR: 1000,
	quantity: 1,
	soldBy: 'piece',
	madeToOrder: false,
	available: 3,
	capacity: 3,
	imageAssetId: null,
	imageVersionId: null,
	freeWith: null,
	...over,
});
const level = (code: string, items: ResolvedItem[], take = 1) => ({
	code,
	label: { en: code },
	take,
	priceMode: 'difference' as const,
	source: { kind: 'items' as const },
	items,
});
const bundleRow = (over: Record<string, unknown> = {}) =>
	ProductBundle.parse({
		id: 'bnd_1',
		productId: 'prd_b',
		levels: [],
		pricing: { methodId: 'bpm_fixed', params: { price: 5000 } },
		...over,
	});
const write = (over: Record<string, unknown> = {}) =>
	({
		levels: [],
		extras: [],
		pricing: {
			methodId: 'bpm_fixed',
			params: { price: 5000 },
			rules: [],
			combine: 'all',
			capAtSeparately: false,
			roundTo: 'one',
		},
		saleWindow: null,
		styledPhoto: null,
		dearerReason: null,
		...over,
	}) as never;

interface Setup {
	rows?: Product[];
	bundle?: ProductBundle | null;
	methods?: BundlePriceMethod[];
	resolved?: (bundle: ProductBundle) => Record<string, unknown>;
	events?: boolean;
	thumbnails?: Record<string, string | null>;
}

function setup(options: Setup = {}) {
	const rows = options.rows ?? [product()];
	const quoteOf = new BundleReader(null as never, null as never, null, null);
	const catalog = {
		getProduct: vi.fn(async (id: string) => {
			const found = rows.find((row) => row.id === id || row.slug === id);
			if (!found) throw new NotFoundException('no');
			return found;
		}),
		productFaq: vi.fn(async () => [{ id: 'faq_1', question: { en: 'Silk?' }, answer: { en: 'Yes' } }]),
		thumbnailsFor: vi.fn(async () => new Map(Object.entries(options.thumbnails ?? {}))),
		saveProductFaq: vi.fn(async () => undefined),
		syncSearch: vi.fn(async () => undefined),
		record: vi.fn(async () => undefined),
	};
	const products = {
		findById: vi.fn(async (id: string) => rows.find((row) => row.id === id) ?? null),
		save: vi.fn(async (row: unknown) => row),
	};
	const bundles = {
		findByProductId: vi.fn(async () => options.bundle ?? null),
		countUsingMethod: vi.fn(async () => 0),
	};
	const methodList = options.methods ?? [method()];
	const methods = {
		list: vi.fn(async () => methodList),
		findById: vi.fn(async (id: string) => methodList.find((row) => row.id === id) ?? null),
		findByCode: vi.fn(async (code: string) => methodList.find((row) => row.code === code) ?? null),
		save: vi.fn(async (row: BundlePriceMethod) => row),
		deleteById: vi.fn(async () => undefined),
	};
	const cards: unknown[] = [];
	const reader = {
		resolve: vi.fn(async (bundle: ProductBundle) => ({
			bundle,
			method: null,
			levels: [],
			extras: [],
			...options.resolved?.(bundle),
		})),
		toQuote: (resolved: never) => quoteOf.toQuote(resolved),
		stock: vi.fn(() => null),
		page: vi.fn(async (_resolved: unknown, _product: unknown, cardOf: (target: Product) => Promise<unknown>) => {
			cards.push(await cardOf(piece()));
			cards.push(await cardOf(piece({ media: { gallery: ['ast_none'], compound: [], altOverrides: {} } })));
			cards.push(await cardOf(piece({ media: { gallery: [], compound: [], altOverrides: {} } })));
			return null;
		}),
	};
	const events =
		options.events === false
			? null
			: { findById: vi.fn(async (id: string) => (id === 'evt_diwali' ? { name: 'Diwali sale' } : null)) };
	const service = new BundleAdminService(
		catalog as never,
		products as never,
		bundles as never,
		methods as never,
		reader as never,
		events as never,
	);
	return { service, catalog, products, bundles, methods, reader, cards };
}

describe('bundle builder page', () => {
	it('opens only a bundle', async () => {
		const { service } = setup({ rows: [piece()] });
		await expect(service.view('prd_1')).rejects.toBeInstanceOf(BadRequestException);
	});

	it('opens a new bundle on the first active method with its default numbers', async () => {
		const { service, reader } = setup({
			methods: [method({ id: 'bpm_off', code: 'off_method', active: false }), method()],
		});
		const view = await service.view('kit');
		expect(view.bundle).toBeNull();
		expect(reader.resolve.mock.calls[0]?.[0]).toMatchObject({
			levels: [],
			pricing: { methodId: 'bpm_fixed', params: { price: 5000 } },
		});
		expect(view.product).toMatchObject({
			published: false,
			showOnShop: true,
			description: {},
			seo: { title: {}, description: {} },
		});
		expect(view.product.faq).toEqual([{ id: 'faq_1', question: { en: 'Silk?' }, answer: { en: 'Yes' } }]);
		// Every method is listed, the switched-off one too; the new bundle starts on the first active one.
		expect(view.methods).toEqual([
			expect.objectContaining({ id: 'bpm_off', usedBy: 0 }),
			expect.objectContaining({ id: 'bpm_fixed', usedBy: 0 }),
		]);
		expect(view.checks.map((check) => check.code)).toEqual(['no_levels', 'method_inactive']);
	});

	it('falls back to the pieces-added-up method when none is active', async () => {
		const { service, reader } = setup({ methods: [method({ active: false })] });
		await service.view('kit');
		expect(reader.resolve.mock.calls[0]?.[0]).toMatchObject({
			pricing: { methodId: 'bpm_pieces_added_up', params: {} },
		});
	});

	it('shows a saved bundle, published once live or once it has been live', async () => {
		const live = setup({
			rows: [
				product({
					status: 'live',
					showOnShop: false,
					description: both,
					seo: { title: both, description: both },
				}),
			],
			bundle: bundleRow(),
		});
		const view = await live.service.view('kit');
		expect(view.bundle?.id).toBe('bnd_1');
		expect(view.product).toMatchObject({ published: true, showOnShop: false, description: both });
		const before = setup({
			rows: [product({ lifecycle: { liveAt: '2026-01-01T00:00:00.000Z' } })],
			bundle: bundleRow(),
		});
		expect((await before.service.view('kit')).product.published).toBe(true);
	});

	it('lists each piece once, with its photo, sale and free items', async () => {
		const onSale = item({
			key: 'i1',
			imageAssetId: 'ast_1',
			saleINR: 800,
			saleEventId: 'evt_diwali',
			saleEndsAt: '2026-11-30T00:00:00.000Z',
			freeWith: { items: [{ productId: 'prd_9', variantId: null, quantity: 1 }] } as never,
			product: piece({ hsnCode: '6204' }),
		});
		const unnamedSale = item({ key: 'i2', imageAssetId: 'ast_gone', saleINR: 900, saleEventId: 'evt_old' });
		const { service, cards } = setup({
			bundle: bundleRow(),
			thumbnails: { ast_1: 'https://cdn.test/ast_1.webp', ast_gone: null },
			resolved: () => ({
				method: method(),
				levels: [level('g', [onSale, unnamedSale]), level('h', [item({ key: 'i3' })])],
				extras: [onSale, item({ key: 'x1' })],
			}),
		});
		const view = await service.view('kit');
		expect(view.items.map((row) => row.key)).toEqual(['i1', 'i2', 'i3', 'x1']);
		expect(view.items[0]).toMatchObject({
			imageUrl: 'https://cdn.test/ast_1.webp',
			saleName: 'Diwali sale',
			freeItems: 1,
		});
		expect(view.items[1]).toMatchObject({ imageUrl: null, saleName: null, freeItems: 0 });
		expect(view.items[2]).toMatchObject({ imageUrl: null, saleName: null });
		expect(cards[0]).toMatchObject({ assetId: 'ast_1', roles: { card: [{ url: 'https://cdn.test/ast_1.webp' }] } });
		expect(cards.slice(1)).toEqual([null, null]);
	});

	it('names no sales when there is no event store', async () => {
		const { service } = setup({
			events: false,
			resolved: () => ({ levels: [level('g', [item({ saleEventId: 'evt_diwali', saleINR: 800 })])] }),
		});
		expect((await service.view('kit')).items[0]?.saleName).toBeNull();
	});

	it('reports every check with its level, piece and number, and a set dearer than its pieces', async () => {
		const failing = setup({
			bundle: bundleRow({ pricing: { methodId: 'bpm_fixed', params: {} } }),
			resolved: () => ({
				method: method({ active: false }),
				levels: [level('g', []), level('h', [item({ key: 'i2', live: false, capacity: 0 })])],
			}),
		});
		const checks = (await failing.service.view('kit')).checks;
		expect(checks).toEqual(
			expect.arrayContaining([
				{
					severity: 'error',
					code: 'method_inactive',
					level: null,
					key: null,
					input: null,
					totalINR: null,
					separatelyINR: null,
				},
				expect.objectContaining({ code: 'level_empty', level: 'g', key: null }),
				expect.objectContaining({ code: 'item_not_live', level: 'h', key: 'i2' }),
				expect.objectContaining({ code: 'input_missing', input: 'price' }),
			]),
		);
		const dearer = setup({
			bundle: bundleRow({ pricing: { methodId: 'bpm_fixed', params: { price: 5000, pct: 0 } } }),
			resolved: (bundle) => ({ bundle, method: method(), levels: [level('g', [item()])] }),
		});
		expect((await dearer.service.view('kit')).checks).toEqual([
			expect.objectContaining({
				severity: 'error',
				code: 'set_dearer',
				totalINR: 5000,
				separatelyINR: 1000,
				level: null,
			}),
		]);
	});

	it('puts the styled photo first, then each level’s included pieces, each photo once', async () => {
		const { service } = setup({
			bundle: bundleRow(),
			thumbnails: { ast_styled: 'https://cdn.test/styled.webp', ast_1: 'https://cdn.test/1.webp' },
			resolved: (bundle) => ({
				bundle: { ...bundle, styledPhoto: { assetId: 'ast_styled', versionId: null } },
				levels: [
					level('g', [item({ key: 'a', imageAssetId: 'ast_1' }), item({ key: 'b', imageAssetId: 'ast_2' })]),
					level('h', [item({ key: 'c', imageAssetId: 'ast_1' }), item({ key: 'd' })], 2),
					level('k', [item({ key: 'e', imageAssetId: 'ast_3' })]),
				],
			}),
		});
		expect((await service.view('kit')).photos).toEqual([
			{ assetId: 'ast_styled', url: 'https://cdn.test/styled.webp', fromKey: null },
			{ assetId: 'ast_1', url: 'https://cdn.test/1.webp', fromKey: 'a' },
			{ assetId: 'ast_3', url: '', fromKey: 'e' },
		]);
		const unthumbed = setup({
			resolved: (bundle) => ({ bundle: { ...bundle, styledPhoto: { assetId: 'ast_styled', versionId: null } } }),
		});
		expect((await unthumbed.service.view('kit')).photos).toEqual([
			{ assetId: 'ast_styled', url: '', fromKey: null },
		]);
	});
});

describe('bundle draft preview', () => {
	it('works out a new draft without saving, as a draft or live set', async () => {
		const fresh = setup();
		await fresh.service.draft('kit', write());
		expect(fresh.reader.resolve.mock.calls[0]?.[0]).toMatchObject({ id: 'draft', status: 'draft', stock: null });
		const saved = setup({ rows: [product({ status: 'live' })], bundle: bundleRow() });
		const response = await saved.service.draft('kit', write({ dearerReason: 'Kept for the launch' }));
		expect(saved.reader.resolve.mock.calls[0]?.[0]).toMatchObject({ id: 'bnd_1', status: 'live' });
		expect(Object.keys(response).sort()).toEqual(['checks', 'items', 'page', 'photos', 'stock']);
	});
});

describe('bundle photos on its product', () => {
	it('does nothing without the product or its set, or when the photos already match', async () => {
		const missing = setup({ rows: [] });
		await missing.service.syncPhotos('prd_b');
		expect(missing.reader.resolve).not.toHaveBeenCalled();
		const noSet = setup();
		await noSet.service.syncPhotos('prd_b');
		expect(noSet.reader.resolve).not.toHaveBeenCalled();
		const same = setup({
			rows: [product({ media: { gallery: ['ast_1'], compound: [], altOverrides: {} } })],
			bundle: bundleRow(),
			resolved: () => ({ levels: [level('g', [item({ imageAssetId: 'ast_1' })])] }),
		});
		await same.service.syncPhotos('prd_b');
		expect(same.products.save).not.toHaveBeenCalled();
	});

	it('links the pieces’ photos into the bundle’s simple gallery', async () => {
		const { service, products } = setup({
			bundle: bundleRow(),
			resolved: () => ({ levels: [level('g', [item({ imageAssetId: 'ast_1' })])] }),
		});
		await service.syncPhotos('prd_b');
		expect(products.save.mock.calls[0]?.[0]).toMatchObject({ imageMode: 'simple', media: { gallery: ['ast_1'] } });
	});
});

describe('bundle details', () => {
	const details = (over: Record<string, unknown> = {}) =>
		({
			title: { en: ' Wedding set ', bn: 'বিয়ের সেট' },
			shortDescription: both,
			description: { bn: 'Texte' },
			categoryIds: ['cat_1'],
			tags: ['wedding'],
			seo: { title: both, description: both },
			faqEnabled: true,
			faq: [],
			featured: true,
			showOnShop: false,
			lowStockThreshold: 2,
			...over,
		}) as never;

	it('needs an English name', async () => {
		const { service } = setup();
		await expect(service.saveDetails('kit', details({ title: { bn: 'সেট' } }), null)).rejects.toBeInstanceOf(
			BadRequestException,
		);
		await expect(service.saveDetails('kit', details({ title: { en: '  ' } }), null)).rejects.toBeInstanceOf(
			BadRequestException,
		);
	});

	it('saves the tabs, the FAQ and the search entry', async () => {
		const { service, products, catalog } = setup({
			rows: [product({ seo: { title: { en: 'Old' }, description: {} } })],
		});
		expect(await service.saveDetails('kit', details(), 'adm_1')).toEqual({ id: 'prd_b', slug: 'kit' });
		expect(products.save.mock.calls[0]?.[0]).toMatchObject({
			title: { en: 'Wedding set', bn: 'বিয়ের সেট' },
			description: { en: '', bn: 'Texte' },
			showOnShop: false,
			lowStockThreshold: 2,
			seo: { title: both, description: both },
		});
		expect(catalog.saveProductFaq).toHaveBeenCalledWith('prd_b', []);
		expect(catalog.record).toHaveBeenCalledWith('adm_1', 'catalog.bundle.details', 'prd_b', { showOnShop: false });
		const plain = setup();
		await plain.service.saveDetails('kit', details({ description: { en: 'Set', bn: 'সেট' } }), null);
		expect(plain.products.save.mock.calls[0]?.[0]).toMatchObject({ description: { en: 'Set', bn: 'সেট' } });
	});
});

describe('bundle price methods', () => {
	const body = (over: Record<string, unknown> = {}) => {
		const {
			id: _id,
			seeded: _seeded,
			version: _version,
			createdAt: _created,
			updatedAt: _updated,
			...rest
		} = method();
		return { ...rest, code: 'new_method', ...over } as never;
	};

	it('reads one method with how many bundles use it, and refuses an unknown one', async () => {
		const { service, bundles } = setup();
		bundles.countUsingMethod.mockResolvedValueOnce(3);
		expect(await service.method('bpm_fixed')).toMatchObject({ id: 'bpm_fixed', usedBy: 3 });
		await expect(service.method('bpm_none')).rejects.toBeInstanceOf(NotFoundException);
	});

	it('creates a method with a fresh id, refusing a taken code', async () => {
		const { service, methods, catalog } = setup();
		const made = await service.createMethod(body(), 'adm_1');
		expect(made).toMatchObject({ code: 'new_method', seeded: false, version: 1 });
		expect(made.id).toMatch(/^bpm_[0-9a-f]{8}$/);
		expect(methods.save).toHaveBeenCalledOnce();
		expect(catalog.record).toHaveBeenCalledWith('adm_1', 'catalog.bundle-method.create', made.id, {
			code: 'new_method',
		});
		await expect(service.createMethod(body({ code: 'fixed_price' }), null)).rejects.toBeInstanceOf(
			ConflictException,
		);
	});

	it('refuses a fixed price or a rule amount that is not one of the method’s numbers', async () => {
		const { service } = setup();
		await expect(service.createMethod(body({ base: { kind: 'fixed', input: 'nope' } }), null)).rejects.toThrow(
			'one of the numbers the method asks for',
		);
		const rule = (amount: unknown) => ({
			id: 'r1',
			then: [{ kind: 'percentOff', amount, level: null, items: [] }],
			otherwise: [{ kind: 'makeExtraFree', amount: null, level: null, items: [] }],
		});
		await expect(service.createMethod(body({ rules: [rule({ input: 'missing' })] }), null)).rejects.toThrow(
			'"missing"',
		);
		await expect(
			service.createMethod(body({ rules: [rule({ input: 'pct' }), rule(10)] }), null),
		).resolves.toMatchObject({
			code: 'new_method',
		});
		await expect(service.createMethod(body({ base: { kind: 'pieces' } }), null)).resolves.toMatchObject({
			base: { kind: 'pieces' },
		});
	});

	it('updates a method to its next version, keeping its own code and refusing another’s', async () => {
		const seeded = method({ seeded: true, version: 4, createdAt: '2026-11-01T00:00:00.000Z' });
		const other = method({ id: 'bpm_other', code: 'other_method' });
		const { service, catalog } = setup({ methods: [seeded, other] });
		const saved = await service.updateMethod('bpm_fixed', body({ code: 'fixed_price' }), 'adm_1');
		expect(saved).toMatchObject({
			id: 'bpm_fixed',
			seeded: true,
			version: 5,
			createdAt: '2026-11-01T00:00:00.000Z',
		});
		expect(catalog.record).toHaveBeenCalledWith('adm_1', 'catalog.bundle-method.update', 'bpm_fixed', {
			version: 5,
		});
		expect((await service.updateMethod('bpm_fixed', body({ code: 'brand_new' }), null)).code).toBe('brand_new');
		await expect(service.updateMethod('bpm_fixed', body({ code: 'other_method' }), null)).rejects.toBeInstanceOf(
			ConflictException,
		);
		await expect(service.updateMethod('bpm_none', body(), null)).rejects.toBeInstanceOf(NotFoundException);
	});

	it('deletes an unused method, and refuses one still pricing bundles', async () => {
		const { service, methods, bundles, catalog } = setup();
		await expect(service.deleteMethod('bpm_none', null)).rejects.toBeInstanceOf(NotFoundException);
		bundles.countUsingMethod.mockResolvedValueOnce(1);
		await expect(service.deleteMethod('bpm_fixed', null)).rejects.toThrow('prices 1 bundle: switch');
		bundles.countUsingMethod.mockResolvedValueOnce(2);
		await expect(service.deleteMethod('bpm_fixed', null)).rejects.toThrow('prices 2 bundles: switch');
		await service.deleteMethod('bpm_fixed', 'adm_1');
		expect(methods.deleteById).toHaveBeenCalledWith('bpm_fixed');
		expect(catalog.record).toHaveBeenCalledWith('adm_1', 'catalog.bundle-method.delete', 'bpm_fixed', {
			code: 'fixed_price',
		});
	});
});
