import { BadRequestException } from '@nestjs/common';
import { Product, ProductVariant, ShopEvent } from '@saha-textile/contracts';
import { describe, expect, it, vi } from 'vitest';

import { ProductBulkService } from '../src/catalog/product-bulk.service';

const both = { en: 'Maroon Saree', bn: 'মেরুন শাড়ি' };
const product = (id: string, over: Record<string, unknown> = {}) =>
	Product.parse({
		id,
		type: 'simple',
		sku: `S-${id}`,
		title: both,
		slug: `saree-${id}`,
		categoryIds: ['c'],
		basePriceINR: 1000,
		media: { gallery: [`img-${id}`], compound: [], altOverrides: {} },
		status: 'disabled',
		...over,
	});
const variant = (productId: string, over: Record<string, unknown> = {}) =>
	ProductVariant.parse({
		id: `var_${productId}`,
		productId,
		sku: `S-${productId}`,
		status: 'live',
		optionSelections: [{ attributeCode: 'base', termCode: 'base' }],
		optionSelectionHash: 'h',
		isBaseVariant: true,
		priceINR: 1000,
		barcode: '890000',
		stock: { tracked: true, quantity: 4, lowStockThreshold: null, allowBackorder: false, held: 1 },
		...over,
	});
const event = (over: Record<string, unknown> = {}) =>
	ShopEvent.parse({ id: 'evt_1', type: 'sale', name: 'Winter', status: 'draft', ...over });

const bulk = (
	rows: Product[],
	options: { events?: ShopEvent[]; facts?: Record<string, boolean>; gaps?: unknown[] } = {},
) => {
	const catalog = {
		takeOff: vi.fn(async () => undefined),
		discontinue: vi.fn(async () => undefined),
		liveReplacement: vi.fn(async (path: string) => {
			if (path === '/product/gone') throw new BadRequestException('no');
			return { kind: 'product', path };
		}),
		deletionFacts: vi.fn(async () => ({
			hasStock: false,
			hasMovements: false,
			hasOrders: false,
			...options.facts,
		})),
		removeNeverLive: vi.fn(async () => undefined),
		inTransaction: vi.fn(async (write: () => Promise<void>) => write()),
		copyExtras: vi.fn(async () => undefined),
		record: vi.fn(async () => undefined),
	};
	const builder = {
		gapsFor: vi.fn(async () => options.gaps ?? []),
		goLive: vi.fn(async () => ({ live: true, gaps: [] })),
		freeSlug: vi.fn(async (base: string) => base),
	};
	const products = {
		findById: vi.fn(async (id: string) => rows.find((row) => row.id === id) ?? null),
		save: vi.fn(async (row: unknown) => row),
	};
	const taken = new Set(['S-p1-C1']);
	const variants = {
		listForProduct: vi.fn(async (id: string) => [variant(id)]),
		findBySku: vi.fn(async (sku: string) => (taken.has(sku) ? variant('x') : null)),
		save: vi.fn(async (row: unknown) => row),
	};
	const bundles = {
		findByProductId: vi.fn(async () => ({
			id: 'bnd_1',
			productId: 'p3',
			levels: [
				{
					code: 'g',
					label: { en: 'Saree' },
					take: 1,
					source: { kind: 'items' },
					items: [{ productId: 'p1', variantId: null, quantity: 1, priceInSetINR: null }],
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
			status: 'live',
		})),
		save: vi.fn(async (row: unknown) => row),
	};
	const events = {
		list: vi.fn(async () => ({ items: options.events ?? [], total: 0, page: 1, pageSize: 1000 })),
		listPublished: vi.fn(async () => []),
	};
	const drafts = { removeForProduct: vi.fn(async () => 1) };
	const service = new ProductBulkService(
		catalog as never,
		builder as never,
		products as never,
		variants as never,
		bundles as never,
		events as never,
		drafts as never,
	);
	return { service, catalog, builder, products, variants, bundles, drafts };
};

describe('product bulk actions: the remaining cases', () => {
	it('answers a dry run of Go Live and Take off shop without changing anything', async () => {
		const { service, builder, catalog } = bulk([product('p1'), product('p2', { status: 'live' })]);
		expect((await service.goLive({ ids: ['p1'], dryRun: true }, null)).rows[0]?.outcome).toBe('done');
		expect(builder.goLive).not.toHaveBeenCalled();
		expect((await service.takeOff({ ids: ['p2'], dryRun: true }, null)).rows[0]?.outcome).toBe('done');
		expect(catalog.takeOff).not.toHaveBeenCalled();
	});

	it('discontinues without a replacement, and answers a dry run without discontinuing', async () => {
		const { service, catalog } = bulk([product('p1')]);
		await service.discontinue({ ids: ['p1'], dryRun: true, replacementPath: null } as never, null);
		expect(catalog.liveReplacement).not.toHaveBeenCalled();
		expect(catalog.discontinue).not.toHaveBeenCalled();
	});

	it('refuses a product whose action fails with anything thrown, naming it by SKU when it has no English name', async () => {
		const { service, catalog } = bulk([product('p2', { status: 'live', title: { en: '', bn: 'শাড়ি' } })]);
		catalog.takeOff.mockRejectedValueOnce('not an error');
		expect((await service.takeOff({ ids: ['p2'], dryRun: false }, null)).rows[0]).toMatchObject({
			title: 'S-p2',
			outcome: 'refused',
			reason: 'failed',
		});
	});

	it('deletes with no event store, and refuses a product a sale names as an exception', async () => {
		const plain = bulk([product('p1')]);
		Object.defineProperty(plain.service, 'events', { value: null });
		expect((await plain.service.delete({ ids: ['p1'], dryRun: true }, null)).rows[0]?.outcome).toBe('done');
		const sale = event({
			sale: {
				categories: [
					{
						categoryId: 'c',
						rule: { kind: 'percent', value: 10, skuPrices: {} },
						exceptions: [{ productId: 'p1', mode: 'held', rule: null }],
					},
				],
				products: [],
				includeSets: false,
			},
		});
		const named = bulk([product('p1')], { events: [sale] });
		expect((await named.service.delete({ ids: ['p1'], dryRun: false }, null)).rows[0]).toMatchObject({
			reason: 'in_event',
		});
	});

	it('names a copy in each language, English’s way for one with no words of its own, and copies no set that was never stored', async () => {
		const set = product('p3', { type: 'bundle', title: { en: 'Wedding set', bn: '', hi: 'शादी सेट' } });
		const { service, products, bundles } = bulk([set]);
		bundles.findByProductId.mockResolvedValueOnce(null as never);
		await service.duplicate({ ids: ['p3'], dryRun: false }, 'adm');
		expect((products.save.mock.calls[0] as unknown as [Product])[0].title).toEqual({
			en: 'Copy of Wedding set',
			bn: '',
			hi: 'Copy of शादी सेट',
		});
		expect(bundles.save).not.toHaveBeenCalled();
	});
});
