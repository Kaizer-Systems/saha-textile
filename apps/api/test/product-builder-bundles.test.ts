import { NotFoundException } from '@nestjs/common';
import { Product } from '@saha-textile/contracts';
import { describe, expect, it, vi } from 'vitest';

import { ProductBuilderService } from '../src/catalog/product-builder.service';
import { LanguageStore } from '../src/languages/language-store';

const both = { en: 'Text', bn: 'Texte' };
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
const kit = (over: Record<string, unknown> = {}) =>
	product({ id: 'prd_b', slug: 'kit', type: 'bundle', sku: 'BND-0001', ...over });

interface Options {
	bundles?: boolean;
	methods?: 'none' | 'missing' | 'found';
	reader?: Record<string, unknown> | null;
	listed?: (query: Record<string, unknown>) => Array<{ sku: string }>;
}

function build(rows: Product[], options: Options = {}) {
	const catalog = {
		getProduct: vi.fn(async (id: string) => {
			const found = rows.find((row) => row.id === id || row.slug === id);
			if (!found) throw new NotFoundException('no');
			return found;
		}),
		record: vi.fn(async () => undefined),
		syncSearch: vi.fn(async () => undefined),
		productFaq: vi.fn(async () => []),
	};
	const products = {
		findBySlug: vi.fn(async (slug: string) => rows.find((row) => row.slug === slug) ?? null),
		findById: vi.fn(async (id: string) => rows.find((row) => row.id === id) ?? null),
		save: vi.fn(async (row: unknown) => row),
		list: vi.fn(async (query: Record<string, unknown>) => ({ items: options.listed?.(query) ?? [] })),
	};
	const variants = {
		save: vi.fn(async (row: unknown) => row),
		listForProduct: vi.fn(async () => [{ priceINR: 100 }]),
	};
	const media = {
		findById: vi.fn(async () => ({
			derivatives: [{ role: 'thumb' }, { role: 'card' }, { role: 'gallery' }],
			text: { alt: both },
		})),
	};
	const bundles = {
		findByProductId: vi.fn(async (): Promise<unknown> => null),
		isBundleProduct: vi.fn(async () => false),
		save: vi.fn(async (row: unknown) => row),
	};
	const methods =
		options.methods === 'missing'
			? { findById: async () => null }
			: options.methods === 'found'
				? { findById: async () => ({ id: 'bpm_pieces_added_up' }) }
				: null;
	const service = new ProductBuilderService(
		catalog as never,
		products as never,
		variants as never,
		LanguageStore.fixed(['en', 'bn']),
		media as never,
		options.bundles === false ? null : (bundles as never),
		methods as never,
		(options.reader ?? null) as never,
	);
	return { service, catalog, products, bundles };
}

const level = (items: Array<{ productId: string }>) => ({
	code: 'g',
	label: both,
	take: 1,
	source: { kind: 'items' },
	items: items.map((item) => ({ ...item, variantId: null, quantity: 1, priceInSetINR: null })),
	priceMode: 'difference',
});
const write = (items: Array<{ productId: string }> = [{ productId: 'prd_1' }]) =>
	({
		levels: [level(items)],
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
	}) as never;

const resolvedItem = (over: Record<string, unknown> = {}) => ({
	key: 'i1',
	live: true,
	isBundle: false,
	capacity: 3,
	...over,
});

describe('product builder: bundles', () => {
	it('numbers a new bundle after the highest BND number, skipping a number already taken', async () => {
		const { service, products } = build([], {
			listed: (query) => {
				if (query['type'] === 'bundle') return [{ sku: 'BND-0002' }, { sku: 'OLD-SKU' }];
				return query['search'] === 'BND-0003'
					? [{ sku: 'BND-0003' }]
					: [{ sku: `${String(query['search'])}9` }];
			},
		});
		await service.create(
			{ type: 'bundle', sku: 'ignored', title: { en: 'Wedding set' }, basePriceINR: 900 } as never,
			'adm_1',
		);
		expect(products.save.mock.calls[0]?.[0]).toMatchObject({
			type: 'bundle',
			sku: 'BND-0004',
			basePriceINR: 0,
			status: 'disabled',
		});
	});

	it('starts bundle numbers at BND-0001 when there are none', async () => {
		const { service, products } = build([]);
		await service.create({ type: 'bundle', sku: '', title: { en: 'First set' }, basePriceINR: 0 } as never, null);
		expect(products.save.mock.calls[0]?.[0]).toMatchObject({ sku: 'BND-0001' });
	});

	it('takes the set live with its product, once, and leaves it when missing or already live', async () => {
		const draft = build([kit()]);
		draft.bundles.findByProductId.mockResolvedValueOnce({ id: 'bnd_1', status: 'draft' });
		expect(await draft.service.goLive('kit', 'adm_1')).toEqual({ live: true, gaps: [] });
		expect(draft.bundles.save).toHaveBeenCalledWith({ id: 'bnd_1', status: 'live' });

		const live = build([kit({ status: 'live' })]);
		live.bundles.findByProductId.mockResolvedValueOnce({ id: 'bnd_1', status: 'live' });
		await live.service.goLive('kit', null);
		expect(live.bundles.save).not.toHaveBeenCalled();

		const none = build([kit({ status: 'live' })]);
		await none.service.goLive('kit', null);
		expect(none.bundles.save).not.toHaveBeenCalled();

		const off = build([kit()], { bundles: false });
		expect((await off.service.goLive('kit', null)).live).toBe(true);
	});

	it('names a bundle with no set yet, and skips the set checks without a reader or for a plain product', async () => {
		const reader = { resolve: vi.fn(), toQuote: vi.fn() };
		const { service } = build([kit()], { reader });
		expect(await service.bundleGaps(kit())).toEqual([{ field: 'bundle:no_levels', locale: null }]);
		expect(await service.bundleGaps(product())).toEqual([]);
		expect(await build([kit()]).service.bundleGaps(kit())).toEqual([]);
		expect(await build([kit()], { bundles: false, reader }).service.bundleGaps(kit())).toEqual([]);
		expect(reader.resolve).not.toHaveBeenCalled();
	});

	it('turns the set’s errors into gaps, naming the level where there is one', async () => {
		const quote = { method: { inputs: [{ code: 'percent' }] }, params: {}, levels: [], rules: [] };
		const reader = {
			resolve: vi.fn(async () => ({
				method: null,
				levels: [
					{ code: 'g', take: 1, items: [] },
					{ code: 'h', take: 1, items: [resolvedItem({ key: 'i2', live: false, capacity: 0 })] },
				],
				extras: [resolvedItem({ key: 'x' })],
			})),
			toQuote: vi.fn(() => quote),
		};
		const { service, bundles } = build([kit()], { reader });
		bundles.findByProductId.mockResolvedValue({ id: 'bnd_1', dearerReason: null });
		expect((await service.bundleGaps(kit())).map((gap) => gap.field)).toEqual([
			'bundle:method_inactive',
			'bundle:level_empty:g',
			'bundle:level_sold_out:h',
			'bundle:item_not_live:h',
			'bundle:input_missing',
		]);
		reader.resolve.mockResolvedValueOnce({
			method: { active: true },
			levels: [{ code: 'g', take: 1, items: [] }],
			extras: [],
		} as never);
		expect((await service.bundleGaps(kit())).map((gap) => gap.field)).toEqual([
			'bundle:level_empty:g',
			'bundle:input_missing',
		]);
	});

	it('refuses a bundle holding itself or another bundle, and an unknown price method', async () => {
		const itself = build([kit(), product()]);
		await expect(itself.service.saveBundle('kit', write([{ productId: 'prd_b' }]), null)).rejects.toThrow(
			'may not contain itself',
		);

		const nested = build([kit(), kit({ id: 'prd_c', slug: 'other-kit' })]);
		await expect(nested.service.saveBundle('kit', write([{ productId: 'prd_c' }]), null)).rejects.toThrow(
			'may not contain a bundle',
		);

		const unpriced = build([kit(), product()], { methods: 'missing' });
		await expect(unpriced.service.saveBundle('kit', write(), null)).rejects.toThrow('Choose how the set is priced');
	});

	it('saves a live product’s set as live, with its worked-out stock', async () => {
		const stock = { available: 4, low: false };
		const reader = { resolve: vi.fn(async (row: unknown) => row), stock: vi.fn(() => stock) };
		const { service, bundles } = build([kit({ status: 'live', lowStockThreshold: 2 }), product()], {
			methods: 'found',
			reader,
		});
		await service.saveBundle('kit', write(), 'adm_1');
		expect(bundles.save.mock.calls[0]?.[0]).toMatchObject({ productId: 'prd_b', status: 'live', stock });
		expect(reader.stock).toHaveBeenCalledWith(expect.objectContaining({ productId: 'prd_b' }), 2);
	});
});
