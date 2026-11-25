import { describe, expect, it, vi } from 'vitest';

import { PurchaseEntryBuilder, warningKey } from '../src/purchasing/purchase-entry-builder';

const TODAY = '2026-11-24';

const fact = (over: Record<string, unknown> = {}) => ({
	variantId: 'v1',
	productId: 'p1',
	sku: 'SAR-1',
	title: { en: 'Baluchari saree' },
	optionsLabel: 'maroon',
	galleryAssetId: null,
	soldBy: 'piece',
	sellingPriceINR: 2000,
	hsnCode: '5007',
	productStatus: 'published',
	productType: 'simple',
	tracked: true,
	...over,
});

const supplier = (over: Record<string, unknown> = {}) => ({
	id: 'sup_1',
	legalName: 'Bishnupur Weavers',
	active: true,
	taxType: 'intra_state',
	kind: 'regular',
	gstin: '19AAACB1234F1Z5',
	stateCode: '19',
	paymentTermsDays: 30,
	...over,
});

const orderLine = (over: Record<string, unknown> = {}) => ({
	lineId: 'pol_1',
	variantId: 'v1',
	quantity: 4,
	receivedQuantity: 1,
	...over,
});

const order = (over: Record<string, unknown> = {}) => ({
	id: 'po_1',
	number: 'PO/26-27/000001',
	supplierId: 'sup_1',
	supplierName: 'Bishnupur Weavers',
	status: 'sent',
	lines: [orderLine()],
	...over,
});

const write = (over: Record<string, unknown> = {}) => ({
	supplierId: 'sup_1',
	purchaseOrderId: null,
	billNumber: 'BW/1',
	billDate: '2026-11-20',
	goodsReceivedOn: '2026-11-22',
	pricesIncludeGst: false,
	freightINR: 0,
	freightGstRatePct: 0,
	roundOffINR: 0,
	printedTotalINR: null,
	billAttachmentAssetId: null,
	lines: [
		{
			variantId: 'v1',
			quantity: 2,
			unitPriceINR: 1000,
			freeOnBill: false,
			hsnOnBill: null,
			gstRatePct: 5,
			supplierItemCode: null,
			purchaseOrderLineId: null,
		},
	],
	...over,
});

interface Parts {
	supplier?: unknown;
	order?: unknown;
	facts?: Map<string, unknown>;
	last?: Map<string, unknown>;
	lookalike?: unknown;
	settings?: Record<string, unknown>;
}

function build(parts: Parts = {}) {
	const entries = {
		lastPurchases: vi.fn(async () => parts.last ?? new Map()),
		findLookalike: vi.fn(async () => parts.lookalike ?? null),
	};
	const builder = new PurchaseEntryBuilder(
		{ findById: async () => ('supplier' in parts ? parts.supplier : supplier()) } as never,
		{ findById: async () => ('order' in parts ? parts.order : order()) } as never,
		entries as never,
		{ items: async () => parts.facts ?? new Map([['v1', fact()]]) } as never,
		{
			settings: async () => ({
				booksClosedUpTo: null,
				priceChangeWarnPct: 10,
				marginFloorPct: 0,
				...parts.settings,
			}),
			today: () => TODAY,
			thumbnails: async () => new Map([['img_1', 'https://cdn.test/img_1.webp']]),
			attachment: async () => null,
			buyerUnderComposition: async () => false,
		} as never,
	);
	return { builder, entries };
}

describe('purchase entry builder: refusals', () => {
	it('refuses a missing or inactive supplier, closed books and goods received tomorrow', async () => {
		await expect(build({ supplier: null }).builder.build(write() as never, null, null)).rejects.toThrow(
			'Supplier not found',
		);
		await expect(
			build({ supplier: supplier({ active: false }) }).builder.build(write() as never, null, null),
		).rejects.toMatchObject({ response: { message: 'supplier_inactive' } });
		await expect(
			build({ settings: { booksClosedUpTo: '2026-11-21' } }).builder.build(write() as never, null, null),
		).rejects.toMatchObject({
			response: { message: 'books_closed', issues: [{ path: ['books_closed', 'billDate'] }] },
		});
		await expect(
			build().builder.build(write({ goodsReceivedOn: '2026-11-25' }) as never, null, null),
		).rejects.toMatchObject({ response: { message: 'received_in_future' } });
	});

	it('keeps an existing bill of a supplier made inactive since', async () => {
		const { builder } = build({ supplier: supplier({ active: false }) });
		const built = await builder.build(
			write() as never,
			{ id: 'pe_1', supplierId: 'sup_1', lines: [] } as never,
			null,
		);
		expect(built.entry.id).toBe('pe_1');
	});

	it('refuses a missing order, another supplier’s order and one not waiting for goods', async () => {
		await expect(
			build({ order: null }).builder.build(write({ purchaseOrderId: 'po_9' }) as never, null, null),
		).rejects.toThrow('Purchase order not found');
		await expect(
			build({ order: order({ supplierId: 'sup_2' }) }).builder.build(
				write({ purchaseOrderId: 'po_1' }) as never,
				null,
				null,
			),
		).rejects.toMatchObject({ response: { message: 'order_other_supplier' } });
		await expect(
			build({ order: order({ status: 'received' }) }).builder.build(
				write({ purchaseOrderId: 'po_1' }) as never,
				null,
				null,
			),
		).rejects.toMatchObject({ response: { message: 'order_not_open' } });
	});

	it('lets an entry keep its link to an order that has since closed, and takes a part-received order', async () => {
		const closed = build({ order: order({ status: 'received' }) });
		const kept = await closed.builder.build(
			write({ purchaseOrderId: 'po_1' }) as never,
			{ id: 'pe_1', supplierId: 'sup_1', purchaseOrderId: 'po_1', lines: [] } as never,
			null,
		);
		expect(kept.entry.purchaseOrderNumber).toBe('PO/26-27/000001');
		const part = build({ order: order({ status: 'part_received' }) });
		expect((await part.builder.build(write({ purchaseOrderId: 'po_1' }) as never, null, null)).order?.id).toBe(
			'po_1',
		);
	});

	it('refuses items that are gone, bundles, discontinued and untracked items', async () => {
		const refusal = async (facts: Map<string, unknown>) =>
			build({ facts })
				.builder.build(write() as never, null, null)
				.catch((error: { response: unknown }) => error.response);
		expect(await refusal(new Map())).toMatchObject({ message: 'unknown_item' });
		expect(await refusal(new Map([['v1', fact({ productType: 'bundle' })]]))).toMatchObject({
			issues: [{ message: 'SAR-1 is a bundle: bundles have no stock of their own; enter their contents.' }],
		});
		expect(await refusal(new Map([['v1', fact({ productStatus: 'discontinued' })]]))).toMatchObject({
			issues: [{ message: 'SAR-1 is discontinued and cannot take stock.' }],
		});
		expect(await refusal(new Map([['v1', fact({ tracked: false })]]))).toMatchObject({ message: 'untracked_item' });
	});

	it('refuses a line naming an order line that is not there or is for another item', async () => {
		const line = (purchaseOrderLineId: string, lineId?: string) => ({
			...write().lines[0],
			purchaseOrderLineId,
			...(lineId ? { lineId } : {}),
		});
		await expect(
			build().builder.build(
				write({ purchaseOrderId: 'po_1', lines: [line('pol_9', 'pel_1')] }) as never,
				null,
				null,
			),
		).rejects.toMatchObject({ response: { issues: [{ path: ['order_line_mismatch', 'pel_1'] }] } });
		await expect(
			build({ order: order({ lines: [orderLine({ variantId: 'v2' })] }) }).builder.build(
				write({ purchaseOrderId: 'po_1', lines: [line('pol_1')] }) as never,
				null,
				null,
			),
		).rejects.toMatchObject({ response: { issues: [{ path: ['order_line_mismatch'] }] } });
	});
});

describe('purchase entry builder: a whole entry', () => {
	it('matches lines to the order by item, warns of extra and unordered pieces, and keeps a standing check', async () => {
		const { builder } = build({
			facts: new Map([
				['v1', fact({ galleryAssetId: 'img_1' })],
				['v2', fact({ variantId: 'v2', sku: 'SAR-2', title: {}, galleryAssetId: 'img_gone' })],
			]),
			last: new Map([['v1', { unitPriceExGstINR: 800 }]]),
			lookalike: { id: 'pe_7', billNumber: 'BW/0', number: 'PE/26-27/000007' },
		});
		const base = write().lines[0];
		const built = await builder.build(
			write({
				purchaseOrderId: 'po_1',
				lines: [
					{ ...base, lineId: 'pel_1', quantity: 2 },
					{ ...base, purchaseOrderLineId: 'pol_1', quantity: 2 },
					{ ...base, variantId: 'v2', quantity: 1 },
				],
			}) as never,
			{
				id: 'pe_1',
				supplierId: 'sup_1',
				purchaseOrderId: 'po_1',
				status: 'draft',
				createdBy: 'adm_9',
				checkedBy: 'adm_8',
				checkedAt: '2026-11-23T05:00:00.000Z',
				createdAt: '2026-11-23T04:00:00.000Z',
				version: 4,
				lines: [
					{
						lineId: 'pel_1',
						variantId: 'v1',
						quantity: 2,
						accepted: 2,
						damaged: 0,
						missing: 0,
						damageReason: null,
						damageNote: null,
						damagePhotoAssetIds: [],
					},
				],
			} as never,
			'adm_1',
		);
		const [kept, matched, unordered] = built.entry.lines;
		expect(kept).toMatchObject({
			lineId: 'pel_1',
			purchaseOrderLineId: 'pol_1',
			accepted: 2,
			imageUrl: 'https://cdn.test/img_1.webp',
		});
		expect(matched).toMatchObject({ purchaseOrderLineId: 'pol_1', accepted: null, notOrdered: false });
		expect(matched?.lineId).not.toBe('pel_1');
		expect(unordered).toMatchObject({
			title: 'SAR-2',
			imageUrl: null,
			notOrdered: true,
			purchaseOrderLineId: null,
		});
		const codes = built.entry.warnings.map((warning) => warning.code);
		expect(codes).toEqual(expect.arrayContaining(['not_ordered', 'price_jump', 'lookalike_bill']));
		expect(built.entry.warnings.find((warning) => warning.code === 'lookalike_bill')?.detail).toBe(
			'Bishnupur Weavers has another bill of the same total on the same day: BW/0 (PE/26-27/000007).',
		);
		expect(
			built.entry.warnings.filter((warning) => warning.detail === '1 more than the order still expects.'),
		).toHaveLength(1);
		expect(built.entry).toMatchObject({ createdBy: 'adm_9', checkedBy: 'adm_8', version: 4, status: 'draft' });
	});

	it('warns of a lookalike bill without its number, but not of the same bill again; dates out of order warn too', async () => {
		const unnumbered = build({ lookalike: { id: 'pe_7', billNumber: 'BW/0', number: null } });
		const built = await unnumbered.builder.build(
			write({ billDate: '2026-11-25', goodsReceivedOn: '2026-08-01' }) as never,
			null,
			'adm_1',
		);
		expect(built.entry.warnings.map((warning) => warning.code)).toEqual([
			'bill_in_future',
			'date_order',
			'lookalike_bill',
		]);
		expect(built.entry.warnings[2]?.detail).toBe(
			'Bishnupur Weavers has another bill of the same total on the same day: BW/0.',
		);
		const same = build({ lookalike: { id: 'pe_7', billNumber: 'BW/1', number: null } });
		expect((await same.builder.build(write() as never, null, null)).entry.warnings).toEqual([]);
	});

	it('charges no GST for a supplier without GST, and a new entry starts as a draft at version 1', async () => {
		const { builder } = build({ supplier: supplier({ taxType: 'none', kind: 'composition' }), order: null });
		const built = await builder.build(write({ freightINR: 100, freightGstRatePct: 18 }) as never, null, 'adm_1');
		expect(built.entry.lines[0]?.gstRatePct).toBe(0);
		expect(built.entry).toMatchObject({
			freightGstRatePct: 0,
			itcClaimable: false,
			status: 'draft',
			version: 1,
			createdBy: 'adm_1',
			purchaseOrderId: null,
		});
		expect(built.entry.id).toMatch(/^pe_/);
	});
});

describe('purchase entry builder: the write an entry stands for', () => {
	it('keys a warning by its code and line', () => {
		expect(warningKey({ code: 'price_jump', lineId: 'pel_1' })).toBe('price_jump:pel_1');
		expect(warningKey({ code: 'lookalike_bill', lineId: null })).toBe('lookalike_bill:');
	});

	it('carries the bill copy’s id, or none, and every line', () => {
		const entry = {
			supplierId: 'sup_1',
			purchaseOrderId: null,
			billNumber: 'BW/1',
			billDate: '2026-11-20',
			goodsReceivedOn: '2026-11-22',
			pricesIncludeGst: false,
			freightINR: 0,
			freightGstRatePct: 0,
			roundOffINR: 0,
			totals: { printedTotalINR: null },
			billAttachment: { assetId: 'bill_1' },
			lines: [
				{
					lineId: 'pel_1',
					variantId: 'v1',
					quantity: 2,
					unitPriceINR: 1000,
					freeOnBill: false,
					hsnOnBill: null,
					gstRatePct: 5,
					supplierItemCode: null,
					purchaseOrderLineId: null,
					accepted: 2,
				},
			],
			version: 2,
		};
		expect(PurchaseEntryBuilder.writeOf(entry as never)).toMatchObject({
			billAttachmentAssetId: 'bill_1',
			lines: [{ lineId: 'pel_1', variantId: 'v1', quantity: 2, purchaseOrderLineId: null }],
		});
		expect(
			PurchaseEntryBuilder.writeOf({ ...entry, billAttachment: null } as never).billAttachmentAssetId,
		).toBeNull();
	});
});
