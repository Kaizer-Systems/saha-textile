import { describe, expect, it, vi } from 'vitest';

import { PurchaseItemsService, nextSkuFor } from '../src/purchasing/purchase-items.service';

const fact = (over: Record<string, unknown> = {}) => ({
	variantId: 'v1',
	productId: 'p1',
	sku: 'SAR-1',
	title: { en: 'Baluchari saree' },
	optionsLabel: 'maroon',
	galleryAssetId: null,
	soldBy: 'piece',
	productStatus: 'published',
	productType: 'simple',
	hsnCode: '5007',
	sellingPriceINR: 1000,
	mrpINR: null,
	onHand: 2,
	variantCount: 1,
	...over,
});

interface Parts {
	search?: unknown[];
	items?: Map<string, unknown>;
	bySku?: Map<string, unknown>;
	findVariant?: (supplierId: string, code: string) => Promise<string | null>;
	variantsOfProduct?: () => Promise<unknown[]>;
	category?: unknown;
	skus?: string[];
	takenSkus?: Set<string>;
	takenSlugs?: Set<string>;
	outbox?: () => Promise<void>;
}

function build(parts: Parts = {}) {
	const stock = {
		search: vi.fn(async () => parts.search ?? []),
		items: vi.fn(async (ids: string[]) => {
			const all = parts.items ?? new Map();
			return new Map(ids.filter((id) => all.has(id)).map((id) => [id, all.get(id)]));
		}),
		variantsOfProduct: vi.fn(parts.variantsOfProduct ?? (async () => [fact()])),
		bySku: vi.fn(async () => parts.bySku ?? new Map()),
		productSkusInCategory: vi.fn(async () => parts.skus ?? []),
	};
	const itemCodes = {
		codesFor: vi.fn(async () => new Map([['v1', 'BL-22']])),
		findVariant: vi.fn(parts.findVariant ?? (async () => null)),
		remember: vi.fn(async () => undefined),
	};
	const products = {
		findBySlug: vi.fn(async (slug: string) => (parts.takenSlugs?.has(slug) ? { id: 'x' } : null)),
		save: vi.fn(async (_row: Record<string, unknown>) => undefined),
	};
	const variants = {
		findBySku: vi.fn(async (sku: string) => (parts.takenSkus?.has(sku) ? { id: 'x' } : null)),
		save: vi.fn(async (_row: Record<string, unknown>) => undefined),
	};
	const support = {
		thumbnails: async () => new Map([['img_1', 'https://cdn.test/img_1.webp']]),
		record: vi.fn(async () => undefined),
		nameOf: async () => 'Rina',
	};
	const service = new PurchaseItemsService(
		stock as never,
		{ lastPurchases: async () => new Map([['v1', { unitPriceExGstINR: 900, entryNumber: 'PE/1' }]]) } as never,
		itemCodes as never,
		products as never,
		variants as never,
		{
			findById: async () => ('category' in parts ? parts.category : { hsnCode: '5007', returnable: true }),
		} as never,
		support as never,
		{ request: vi.fn(parts.outbox ?? (async () => undefined)) } as never,
	);
	return { service, stock, itemCodes, products, variants, support };
}

describe('the next SKU in a category', () => {
	it('has none without numbered SKUs, and counts on from the commonest prefix', () => {
		expect(nextSkuFor([])).toBeNull();
		expect(nextSkuFor(['SAREE', '0412'])).toBeNull();
		expect(nextSkuFor(['ST-BAN-0412', 'ST-BAN-0007', 'OLD-9', 'ST-BAN-X'])).toEqual({
			prefix: 'ST-BAN-',
			next: '0413',
		});
		expect(nextSkuFor(['A-1', 'B-7'])).toEqual({ prefix: 'B-', next: '8' });
	});
});

describe('purchase items: options and search', () => {
	it('answers no options for no items, and leaves codes out without a supplier', async () => {
		const { service, itemCodes } = build();
		expect(await service.options([], 'sup_1')).toEqual([]);
		const [option] = await service.options([fact({ title: {}, galleryAssetId: 'img_gone' })] as never, null);
		expect(option).toMatchObject({ title: 'SAR-1', imageUrl: null, supplierItemCode: null, lastCostINR: 900 });
		expect(itemCodes.codesFor).not.toHaveBeenCalled();
		const [pictured] = await service.options(
			[fact({ variantId: 'v2', galleryAssetId: 'img_1' })] as never,
			'sup_1',
		);
		expect(pictured).toMatchObject({
			imageUrl: 'https://cdn.test/img_1.webp',
			lastCostINR: null,
			lastEntryNumber: null,
		});
	});

	it('searches without a supplier code when no supplier is chosen', async () => {
		const { service, itemCodes } = build({ search: [fact()] });
		const found = await service.search({ q: 'SAR', limit: 10 } as never);
		expect(found.map((row) => row.variantId)).toEqual(['v1']);
		expect(itemCodes.findVariant).not.toHaveBeenCalled();
	});

	it('puts the item the supplier’s code names first, fetching it when the search missed it', async () => {
		const missed = build({
			search: [fact()],
			items: new Map([['v9', fact({ variantId: 'v9', sku: 'THEIRS-9' })]]),
			findVariant: async () => 'v9',
		});
		const first = await missed.service.search({ q: 'BL-9', limit: 10, supplierId: 'sup_1' } as never);
		expect(first.map((row) => row.variantId)).toEqual(['v9', 'v1']);
		const gone = build({ search: [fact()], findVariant: async () => 'v9' });
		expect(
			(await gone.service.search({ q: 'BL-9', limit: 10, supplierId: 'sup_1' } as never)).map((r) => r.variantId),
		).toEqual(['v1']);
		const among = build({
			search: [fact(), fact({ variantId: 'v2' }), fact({ variantId: 'v3' })],
			findVariant: async () => 'v2',
		});
		expect(
			(await among.service.search({ q: 'BL', limit: 2, supplierId: 'sup_1' } as never)).map((r) => r.variantId),
		).toEqual(['v2', 'v1']);
	});

	it('reads lines by variant ids in the order asked, skipping ones that are gone', async () => {
		const { service } = build({
			items: new Map([
				['v1', fact()],
				['v2', fact({ variantId: 'v2' })],
			]),
		});
		expect((await service.byVariants(['v2', 'v9', 'v1'], null)).map((row) => row.variantId)).toEqual(['v2', 'v1']);
	});

	it('lists every row of a product, or says the product is missing', async () => {
		expect((await build().service.variantGrid('p1', 'sup_1'))[0]?.supplierItemCode).toBe('BL-22');
		await expect(build({ variantsOfProduct: async () => [] }).service.variantGrid('p9', null)).rejects.toThrow(
			'Product not found',
		);
	});
});

describe('purchase items: spreadsheet import (p13)', () => {
	it('matches by SKU or the supplier’s code, and marks prices, blocked items and repeats', async () => {
		const { service } = build({
			bySku: new Map([
				['SAR-1', fact()],
				['BUN-1', fact({ variantId: 'vb', sku: 'BUN-1', productType: 'bundle' })],
				['FAB-1', fact({ variantId: 'vm', sku: 'FAB-1', soldBy: 'metre' })],
				['DIS-1', fact({ variantId: 'vd', sku: 'DIS-1', productStatus: 'discontinued' })],
			]),
			items: new Map([['v7', fact({ variantId: 'v7', sku: 'SAR-7' })]]),
			findVariant: async (_supplier, code) => (code === 'BL-7' ? 'v7' : null),
		});
		const row = (n: number, code: string, quantity: number, unitPriceINR: number) => ({
			row: n,
			code,
			quantity,
			unitPriceINR,
			hsn: null,
			gstRatePct: 5,
		});
		const result = await service.importRows({
			supplierId: 'sup_1',
			rows: [
				row(1, ' SAR-1 ', 2, 900),
				row(2, 'BL-7', 1, 500),
				row(3, 'NEW-1', 1, 100),
				row(4, 'BUN-1', 1, 100),
				row(5, 'FAB-1', 2.5, 30),
				row(6, 'SAR-1', 1, 950),
				row(7, 'NEW-2', 1, -1),
				row(8, '', 0, 1),
				row(9, 'FAB-1', 2.55, 30),
				row(10, 'DIS-1', 1, 100),
			],
		} as never);
		expect(result.rows.map((r) => [r.row, r.result, r.problem, r.quantity])).toEqual([
			[1, 'problem', 'repeated_at_other_price', 2],
			[2, 'ready', null, 1],
			[3, 'needs_product', null, 1],
			[4, 'problem', 'blocked_product', 1],
			[5, 'ready', null, 25],
			[6, 'problem', 'repeated_at_other_price', 1],
			[7, 'problem', 'price_invalid', 1],
			[8, 'problem', 'quantity_below_one', 0],
			[9, 'problem', 'quantity_below_one', 26],
			[10, 'problem', 'blocked_product', 1],
		]);
		expect(result.counts).toEqual({ ready: 2, needsProduct: 1, problems: 7 });
	});

	it('refuses a price that is not a number', async () => {
		const { service } = build();
		const result = await service.importRows({
			supplierId: 'sup_1',
			rows: [{ row: 1, code: 'X', quantity: 1, unitPriceINR: Number.NaN, hsn: null, gstRatePct: 5 }],
		} as never);
		expect(result.rows[0]?.problem).toBe('price_invalid');
	});
});

describe('purchase items: draft product from a bill line (p05)', () => {
	const body = (over: Record<string, unknown> = {}) => ({
		name: 'Peacock Baluchari',
		categoryId: 'cat_1',
		sellingPriceINR: 1000,
		mrpINR: null,
		soldBy: 'piece',
		skuPrefix: null,
		...over,
	});

	it('suggests the next SKU, or none, with the category’s HSN; refuses a missing category', async () => {
		expect(await build({ skus: ['ST-0009'] }).service.draftProductDefaults('cat_1')).toEqual({
			categoryId: 'cat_1',
			hsnCode: '5007',
			returnable: true,
			skuPrefix: 'ST-',
			skuNext: '0010',
		});
		expect(await build().service.draftProductDefaults('cat_1')).toMatchObject({ skuPrefix: null, skuNext: null });
		await expect(build({ category: null }).service.draftProductDefaults('cat_9')).rejects.toThrow(
			'Category not found',
		);
	});

	it('refuses an MRP below the price and a category without a prefix', async () => {
		await expect(build().service.createDraftProduct(body({ mrpINR: 900 }) as never, null)).rejects.toMatchObject({
			response: { message: 'mrp_below_selling' },
		});
		await expect(build().service.createDraftProduct(body() as never, null)).rejects.toMatchObject({
			response: { message: 'sku_prefix_required' },
		});
		await expect(
			build().service.createDraftProduct(body({ skuPrefix: '  ' }) as never, null),
		).rejects.toMatchObject({
			response: { message: 'sku_prefix_required' },
		});
	});

	it('makes a draft at the category’s next free SKU and a free slug, remembering the supplier’s code', async () => {
		const { service, products, variants, itemCodes, support } = build({
			skus: ['ST-0009'],
			takenSkus: new Set(['ST-0010']),
			takenSlugs: new Set(['peacock-baluchari', 'peacock-baluchari-2']),
			outbox: async () => Promise.reject(new Error('queue down')),
		});
		const option = await service.createDraftProduct(
			body({ mrpINR: 1200, supplierId: 'sup_1', supplierItemCode: 'BL-1' }) as never,
			'adm_1',
		);
		expect(products.save.mock.calls[0]?.[0]).toMatchObject({
			sku: 'ST-0011',
			slug: 'peacock-baluchari-3',
			status: 'draft',
		});
		expect(variants.save.mock.calls[0]?.[0]).toMatchObject({
			priceINR: 1200,
			compareAtPriceINR: 1200,
			salePriceINR: 1000,
		});
		expect(itemCodes.remember).toHaveBeenCalledWith('sup_1', 'BL-1', expect.stringMatching(/^var_/));
		expect(support.record).toHaveBeenCalledWith(
			expect.objectContaining({ text: expect.stringContaining('(HSN 5007 from the category)') }),
		);
		expect(option?.supplierItemCode).toBe('BL-22');
	});

	it('starts a typed prefix at 0001, names a nameless slug "product", and prints "not set" for a missing HSN', async () => {
		const { service, products, variants, itemCodes, support } = build({
			category: { hsnCode: null, returnable: false },
			skus: ['OTHER-0005'],
		});
		await service.createDraftProduct(body({ name: '!!!', skuPrefix: 'new-', mrpINR: 1000 }) as never, null);
		expect(products.save.mock.calls[0]?.[0]).toMatchObject({ sku: 'NEW-0001', slug: 'product' });
		expect(variants.save.mock.calls[0]?.[0]).toMatchObject({ priceINR: 1000, salePriceINR: null });
		expect(itemCodes.remember).not.toHaveBeenCalled();
		expect(support.record).toHaveBeenCalledWith(
			expect.objectContaining({ text: expect.stringContaining('(HSN not set from the category)') }),
		);
		const plain = build({ skus: ['ST-0001'] });
		await plain.service.createDraftProduct(body({ supplierId: 'sup_1' }) as never, null);
		expect(plain.variants.save.mock.calls[0]?.[0]).toMatchObject({ priceINR: 1000, compareAtPriceINR: null });
		expect(plain.itemCodes.remember).not.toHaveBeenCalled();
	});

	it('gives up after fifty taken SKUs, and says the product is missing if it can’t be read back', async () => {
		const taken = new Set(Array.from({ length: 50 }, (_, at) => `ST-${String(at + 2).padStart(4, '0')}`));
		await expect(
			build({ skus: ['ST-0001'], takenSkus: taken }).service.createDraftProduct(body() as never, null),
		).rejects.toMatchObject({
			response: { message: 'sku_unavailable', issues: [{ message: 'No free SKU found after ST-52.' }] },
		});
		await expect(
			build({ skus: ['ST-0001'], variantsOfProduct: async () => [] }).service.createDraftProduct(
				body() as never,
				null,
			),
		).rejects.toThrow('Product not found');
	});
});
