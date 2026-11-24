import { describe, expect, it, vi } from 'vitest';

import { StockReportsService } from '../src/purchasing/stock-reports.service';

const withCost = { userId: 'adm_1', permissions: ['stock.cost'] } as never;
const noCost = { userId: 'adm_2', permissions: [] } as never;

const fact = (over: Record<string, unknown>) => ({
	variantId: 'v1',
	productId: 'p1',
	sku: 'SAR-1',
	title: { en: 'Baluchari saree' },
	optionsLabel: 'maroon',
	galleryAssetId: null,
	soldBy: 'piece',
	onHand: 0,
	held: 0,
	lowStockLevel: null,
	madeToOrder: false,
	productStatus: 'published',
	tracked: true,
	categoryName: 'Sarees',
	sellingPriceINR: 1000,
	...over,
});

function build(over: { stock?: object; entries?: object; orders?: object; support?: object } = {}) {
	const stock = {
		list: vi.fn(async () => ({ items: [] })),
		soldSince: vi.fn(async () => new Map()),
		openLayers: vi.fn(async () => []),
		lastSoldOn: vi.fn(async () => new Map()),
		valuationAsOf: vi.fn(async () => []),
		items: vi.fn(async () => new Map()),
		search: vi.fn(async () => []),
		ledger: vi.fn(async () => ({ items: [], total: 0 })),
		...over.stock,
	};
	const entries = {
		lastPurchases: vi.fn(async () => new Map()),
		postedBetween: vi.fn(async () => []),
		openPayables: vi.fn(async () => []),
		...over.entries,
	};
	const orders = { draftsFromReorder: vi.fn(async (groups: unknown) => groups), ...over.orders };
	const support = {
		thumbnails: vi.fn(async () => new Map([['img_1', 'https://cdn.test/img_1.webp']])),
		today: () => '2026-11-24',
		homeState: async () => '19',
		names: vi.fn(async () => new Map([['adm_1', 'Rina']])),
		settings: async () => ({ unpaidAlertDays: 150 }),
		...over.support,
	};
	return {
		service: new StockReportsService(stock as never, entries as never, orders as never, support as never),
		stock,
		entries,
		orders,
	};
}

describe('stock reports: reorder list (i07)', () => {
	it('lists only tracked, stocked-to-order items that are low or running out, soonest out first', async () => {
		const { service } = build({
			stock: {
				list: async () => ({
					items: [
						fact({ variantId: 'v1', onHand: 1, lowStockLevel: 2, galleryAssetId: 'img_1' }),
						fact({ variantId: 'v2', sku: 'SAR-2', title: {}, onHand: 3, galleryAssetId: 'img_gone' }),
						fact({ variantId: 'v3', onHand: 0, lowStockLevel: 0 }),
						fact({ variantId: 'v4', onHand: 1, lowStockLevel: 5, madeToOrder: true }),
						fact({ variantId: 'v5', onHand: 1, lowStockLevel: 5, productStatus: 'discontinued' }),
						fact({ variantId: 'v6', onHand: 1, lowStockLevel: 5, tracked: false }),
						fact({ variantId: 'v7', onHand: 50 }),
					],
				}),
				soldSince: async () => new Map([['v2', 60]]),
			},
			entries: {
				lastPurchases: async () =>
					new Map([
						['v1', { supplierId: 'sup_1', supplierName: 'Bishnupur Weavers', unitPriceExGstINR: 6200 }],
					]),
			},
		});
		const { items } = await service.reorder(withCost);
		expect(items.map((row) => [row.variantId, row.daysLeft])).toEqual([
			['v3', null],
			['v1', null],
			['v2', 3],
		]);
		const [, v1, v2] = items;
		expect(v1).toMatchObject({
			title: 'Baluchari saree',
			imageUrl: 'https://cdn.test/img_1.webp',
			lastSupplierName: 'Bishnupur Weavers',
			lastCostINR: 6200,
			soldLast60Days: 0,
		});
		expect(v2).toMatchObject({ title: 'SAR-2', imageUrl: null, lastSupplierId: null, lastCostINR: null });
	});

	it('hides the last cost from someone who may not see cost', async () => {
		const { service } = build({
			stock: { list: async () => ({ items: [fact({ onHand: 0, lowStockLevel: 1 })] }) },
			entries: {
				lastPurchases: async () =>
					new Map([['v1', { supplierId: 's', supplierName: 'S', unitPriceExGstINR: 9 }]]),
			},
		});
		expect((await service.reorder(noCost)).items[0]?.lastCostINR).toBeNull();
	});
});

describe('stock reports: reorder to purchase orders', () => {
	it('groups ticked lines by the chosen or last supplier, at the last price or nothing', async () => {
		const { service, orders } = build({
			entries: {
				lastPurchases: async () => new Map([['v1', { supplierId: 'sup_1', unitPriceExGstINR: 6200 }]]),
			},
		});
		await service.reorderToOrders(
			[
				{ variantId: 'v1', quantity: 2 },
				{ variantId: 'v2', quantity: 1, supplierId: 'sup_1' },
				{ variantId: 'v3', quantity: 4, supplierId: 'sup_2' },
			],
			withCost,
		);
		expect(orders.draftsFromReorder).toHaveBeenCalledWith(
			[
				{
					supplierId: 'sup_1',
					lines: [
						expect.objectContaining({ variantId: 'v1', agreedPriceINR: 6200, gstRatePct: 5 }),
						expect.objectContaining({ variantId: 'v2', agreedPriceINR: 0 }),
					],
				},
				{ supplierId: 'sup_2', lines: [expect.objectContaining({ variantId: 'v3', quantity: 4 })] },
			],
			'adm_1',
		);
	});

	it('asks for a supplier for an item never bought before', async () => {
		const { service } = build();
		await expect(service.reorderToOrders([{ variantId: 'v9', quantity: 1 }], undefined)).rejects.toMatchObject({
			response: { message: 'supplier_required', issues: [{ path: ['supplier_required', 'v9'] }] },
		});
	});
});

describe('stock reports: ageing (i08)', () => {
	const layer = (over: Record<string, unknown>) => ({
		variantId: 'v1',
		receivedAt: '2026-11-01T00:00:00.000Z',
		quantityRemaining: 1,
		unitCostINR: 100,
		sourceType: 'purchase_invoice',
		purchaseInvoiceId: 'pi_1',
		...over,
	});

	function ageingService() {
		return build({
			stock: {
				list: async () => ({
					items: [
						fact({ variantId: 'v1', onHand: 2, galleryAssetId: 'img_1' }),
						fact({ variantId: 'v2', title: {}, onHand: 1, galleryAssetId: 'img_gone' }),
						fact({ variantId: 'v3', onHand: 1 }),
						fact({ variantId: 'v4', onHand: 0 }),
					],
				}),
				openLayers: async () => [
					// v1: two on hand from the newest two layers; the oldest layer is already sold through FIFO.
					layer({ variantId: 'v1', receivedAt: '2025-01-01T00:00:00.000Z', quantityRemaining: 3 }),
					layer({ variantId: 'v1', receivedAt: '2026-11-20T00:00:00.000Z', quantityRemaining: 1 }),
					layer({
						variantId: 'v1',
						receivedAt: '2026-06-01T00:00:00.000Z',
						quantityRemaining: 1,
						unitCostINR: 50,
					}),
					layer({ variantId: 'v1', receivedAt: '2026-01-01T00:00:00.000Z', quantityRemaining: 0 }),
					// v2: opening stock, received "tomorrow" (a clock skew): age 0, no supplier to return it to.
					layer({ variantId: 'v2', receivedAt: '2026-11-25T00:00:00.000Z', sourceType: 'opening_stock' }),
				],
				lastSoldOn: async () => new Map([['v1', '2026-11-10']]),
			},
		});
	}

	it('puts each piece on hand in its band by the day it came in, oldest rows first', async () => {
		const { service } = ageingService();
		const report = await service.ageing({ page: 1, pageSize: 10 }, withCost);
		expect(report.bands.map((band) => [band.units, band.valueINR])).toEqual([
			[2, 200],
			[1, 50],
			[0, 0],
			[0, 0],
		]);
		expect(report.rows.map((row) => [row.variantId, row.oldestPieceDays])).toEqual([
			['v1', 176],
			['v2', 0],
			// v3 has stock but no open layers (uncosted): nothing to age.
			['v3', 0],
		]);
		expect(report.rows[0]).toMatchObject({
			title: 'Baluchari saree',
			imageUrl: 'https://cdn.test/img_1.webp',
			lastSoldOn: '2026-11-10',
			valueAtCostINR: 150,
			canReturnToSupplier: true,
		});
		expect(report.rows[1]).toMatchObject({
			title: 'SAR-1',
			imageUrl: null,
			lastSoldOn: null,
			canReturnToSupplier: false,
		});
		expect(report.rows[2]?.imageUrl).toBeNull();
		expect(report.total).toBe(3);
	});

	it('filters to one band, pages, and hides value without the cost permission', async () => {
		const { service } = ageingService();
		const band1 = await service.ageing({ band: 1, page: 1, pageSize: 10 }, noCost);
		expect(band1.rows.map((row) => row.variantId)).toEqual(['v1']);
		expect(band1.rows[0]?.valueAtCostINR).toBeNull();
		expect(band1.bands[0]?.valueINR).toBeNull();
		const second = await service.ageing({ page: 2, pageSize: 2 }, withCost);
		expect(second.rows.map((row) => row.variantId)).toEqual(['v3']);
	});
});

describe('stock reports: value on a day (i09)', () => {
	const rows = [
		{ variantId: 'v1', units: 2, valueINR: 200, uncostedUnits: 0 },
		{ variantId: 'v2', units: 150, valueINR: 300.5, uncostedUnits: 0 },
		{ variantId: 'v3', units: 1, valueINR: 0, uncostedUnits: 1 },
		{ variantId: 'v4', units: 0, valueINR: 0, uncostedUnits: 0 },
	];
	const facts = new Map([
		['v1', fact({ variantId: 'v1' })],
		[
			'v2',
			fact({
				variantId: 'v2',
				title: {},
				optionsLabel: '',
				soldBy: 'metre',
				categoryName: null,
				sellingPriceINR: undefined,
			}),
		],
	]);

	it('refuses a day after today', async () => {
		const { service } = build();
		await expect(service.valuation('2026-11-25', 'category')).rejects.toMatchObject({
			response: { message: 'date_in_future' },
		});
	});

	it('groups by category, with "No category" for items without one, metres priced per metre', async () => {
		const { service, stock } = build({
			stock: { valuationAsOf: async () => rows, items: async () => facts },
		});
		const report = await service.valuation('2026-03-31', 'category');
		expect(report.rows).toEqual([
			{ label: 'No category', units: 151, valueAtCostINR: 300.5, sellingValueINR: 0, sharePct: 60 },
			{ label: 'Sarees', units: 2, valueAtCostINR: 200, sellingValueINR: 2000, sharePct: 40 },
		]);
		expect(report).toMatchObject({ totalUnits: 153, totalValueINR: 500.5, uncostedUnits: 1 });
		expect(stock.valuationAsOf).toBeDefined();
	});

	it('groups by last supplier, or "Opening stock or no supplier"', async () => {
		const { service } = build({
			stock: { valuationAsOf: async () => rows.slice(0, 2), items: async () => facts },
			entries: { lastPurchases: async () => new Map([['v1', { supplierName: 'Bishnupur Weavers' }]]) },
		});
		const report = await service.valuation('2026-03-31', 'supplier');
		expect(report.rows.map((row) => row.label)).toEqual(['Opening stock or no supplier', 'Bishnupur Weavers']);
	});

	it('groups by product with its options, the variant id for an unknown one, and a 0 share when nothing has value', async () => {
		const { service } = build({
			stock: {
				valuationAsOf: async () => [
					{ variantId: 'v1', units: 1, valueINR: 0, uncostedUnits: 1 },
					{ variantId: 'v2', units: 1, valueINR: 0, uncostedUnits: 1 },
					{ variantId: 'v9', units: 1, valueINR: 0, uncostedUnits: 1 },
				],
				items: async () => facts,
			},
		});
		const report = await service.valuation('2026-03-31', 'product');
		expect(report.rows.map((row) => [row.label, row.sharePct])).toEqual([
			['Baluchari saree, maroon', 0],
			['v2', 0],
			['v9', 0],
		]);
	});
});

describe('stock reports: purchase register (i10)', () => {
	it('refuses reversed dates', async () => {
		const { service } = build();
		await expect(service.purchaseRegister('2026-11-02', '2026-11-01')).rejects.toMatchObject({
			response: { message: 'dates_reversed' },
		});
	});

	it('lists posted bills with the home State as the place of supply', async () => {
		const entry = {
			billDate: '2026-11-20',
			supplierName: 'Bishnupur Weavers',
			supplierGstin: null,
			billNumber: 'BW/1',
			number: null,
			totals: { taxableINR: 100, cgstINR: 2.5, sgstINR: 2.5, igstINR: 0, totalINR: 105 },
		};
		const { service } = build({ entries: { postedBetween: async () => [entry, { ...entry, number: 'PE/1' }] } });
		const { rows } = await service.purchaseRegister('2026-11-01', '2026-11-30');
		expect(rows[0]).toMatchObject({ placeOfSupply: '19-West Bengal', entryNumber: '', reverseCharge: false });
		expect(rows[1]?.entryNumber).toBe('PE/1');
		const abroad = build({
			entries: { postedBetween: async () => [entry] },
			support: { homeState: async () => '00' },
		});
		expect((await abroad.service.purchaseRegister('2026-11-01', '2026-11-30')).rows[0]?.placeOfSupply).toBe('00-');
	});
});

describe('stock reports: movements', () => {
	it('answers nothing when the search finds no item', async () => {
		const { service, stock } = build();
		expect(await service.movements({ q: 'nothing', page: 1, pageSize: 20 } as never)).toEqual({
			items: [],
			total: 0,
		});
		expect(stock.ledger).not.toHaveBeenCalled();
	});

	it('reads one item’s ledger between two Indian days, naming people and items', async () => {
		const { service, stock } = build({
			stock: {
				search: async () => [{ variantId: 'v1' }, { variantId: 'v2' }],
				ledger: vi.fn(async () => ({
					items: [
						{ variantId: 'v1', actorUserId: 'adm_1', approverUserId: 'adm_gone' },
						{ variantId: 'v9', actorUserId: null, approverUserId: null },
						{ variantId: 'v1', actorUserId: 'adm_gone', approverUserId: null },
					],
					total: 3,
				})),
				items: async () => new Map([['v1', fact({ soldBy: 'metre' })]]),
			},
		});
		const out = await service.movements({
			q: 'SAR',
			source: 'sale',
			actorId: 'adm_1',
			from: '2026-11-01',
			to: '2026-11-02',
			page: 1,
			pageSize: 20,
		} as never);
		expect(stock.ledger).toHaveBeenCalledWith({
			variantId: 'v1',
			source: 'sale',
			actorId: 'adm_1',
			from: '2026-10-31T18:30:00.000Z',
			to: '2026-11-02T18:29:59.999Z',
			page: 1,
			pageSize: 20,
		});
		expect(out.items).toEqual([
			expect.objectContaining({
				sku: 'SAR-1',
				title: 'Baluchari saree',
				soldBy: 'metre',
				actorName: 'Rina',
				approverName: 'Someone',
			}),
			expect.objectContaining({ sku: 'v9', title: '', soldBy: 'piece', actorName: null, approverName: null }),
			expect.objectContaining({ actorName: 'Someone', approverName: null }),
		]);
		expect(out.total).toBe(3);
	});

	it('reads every item without a search or dates', async () => {
		const { service, stock } = build();
		await service.movements({ page: 1, pageSize: 20 } as never);
		expect(stock.ledger).toHaveBeenCalledWith(
			expect.objectContaining({ variantId: undefined, from: undefined, to: undefined }),
		);
	});
});

describe('stock reports: unpaid bills', () => {
	it('lists bills with money left, oldest first, flagging those near the 180-day rule', async () => {
		const bill = (over: Record<string, unknown>) => ({
			id: 'pe_1',
			number: 'PE/1',
			supplierId: 'sup_1',
			supplierName: 'Bishnupur Weavers',
			billNumber: 'BW/1',
			billDate: '2026-11-01',
			dueOn: null,
			totals: { totalINR: 100 },
			paidINR: 0,
			creditedINR: 0,
			...over,
		});
		const { service } = build({
			entries: {
				openPayables: async () => [
					bill({}),
					bill({ id: 'pe_2', billDate: '2026-05-01' }),
					bill({ id: 'pe_3', paidINR: 100 }),
				],
			},
		});
		const report = await service.unpaidBills();
		expect(report.alertDays).toBe(150);
		expect(report.rows.map((row) => [row.id, row.days, row.nearLimit, row.leftINR])).toEqual([
			['pe_2', 207, true, 100],
			['pe_1', 23, false, 100],
		]);
	});
});
