import { randomUUID } from 'node:crypto';

import { EMPTY_SHOP_DETAILS } from '@saha-textile/contracts';
import { StaleVersionError } from '@saha-textile/core-domain';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { connectMongo, disconnectMongo } from '../src/connection';
import {
	AttributeDefinitionModel,
	CategoryModel,
	InventoryCostLayerModel,
	InventoryLedgerModel,
	InventorySettingsModel,
	LocationStockModel,
	ProductModel,
	ProductVariantModel,
	PurchaseInvoiceModel,
	PurchaseOrderModel,
	ShopDetailsModel,
	StockCountModel,
} from '../src/models/index';
import {
	MongoAdjustmentRequestRepository,
	MongoInventorySettingsRepository,
	MongoPurchaseEntryRepository,
	MongoPurchaseOrderRepository,
	MongoPurchaseReturnRepository,
	MongoShopDetailsRepository,
	MongoStockCountRepository,
	MongoStockHoldRepository,
	MongoStockMovement,
	MongoStockReadRepository,
	MongoSupplierItemCodeRepository,
} from '../src/repositories/purchasing.repository';
import { hasMongoEnv } from './mongo-test-env';

/**
 * The purchases and stock repository's remaining reads and writes: rows missing what the schema would add, lists
 * without a supplier or a search, the shop's own details, and the stock reads' labels, search and paging. Rows of
 * this run only, except the two single settings rows (inventory, shop), which are put back as they were.
 */
const P = 'it_purl_';
const RUN = randomUUID().slice(0, 8);
const id = (name: string) => `${P}${name}_${RUN}`;
const today = '2026-11-24';
const raw = (model: { collection: { insertOne: (doc: never) => Promise<unknown> } }, doc: Record<string, unknown>) =>
	model.collection.insertOne(doc as never);

describe.skipIf(!hasMongoEnv())('purchases and stock repositories: the remaining cases (integration, rs0)', () => {
	const codes = new MongoSupplierItemCodeRepository();
	const orders = new MongoPurchaseOrderRepository();
	const entries = new MongoPurchaseEntryRepository();
	const returns = new MongoPurchaseReturnRepository();
	const holds = new MongoStockHoldRepository();
	const requests = new MongoAdjustmentRequestRepository();
	const counts = new MongoStockCountRepository();
	const settings = new MongoInventorySettingsRepository();
	const shop = new MongoShopDetailsRepository();
	const movement = new MongoStockMovement();
	const stock = new MongoStockReadRepository();
	const colour = `c_${RUN}`;
	const bare = `b_${RUN}`;

	beforeAll(async () => {
		await connectMongo();
		await raw(CategoryModel, { _id: id('cat'), slug: id('cat') });
		await raw(AttributeDefinitionModel, { _id: id('attr_colour'), code: colour, terms: [{ code: 'red' }] });
		await raw(AttributeDefinitionModel, { _id: id('attr_bare'), code: bare });
		await raw(ProductModel, {
			_id: id('p_plain'),
			type: 'simple',
			sku: `PL-${RUN}`,
			slug: id('p_plain'),
			status: 'live',
			categoryIds: [id('cat')],
		});
		await raw(ProductModel, {
			_id: id('p_var'),
			type: 'variable',
			sku: `VR-${RUN}`,
			title: { en: `Lastedge Kantha ${RUN}` },
			slug: id('p_var'),
			status: 'draft',
		});
		await raw(ProductModel, {
			_id: id('p_set'),
			type: 'bundle',
			sku: `ST-${RUN}`,
			title: { en: `Lastedge Kantha set ${RUN}` },
			slug: id('p_set'),
			status: 'live',
		});
		await raw(ProductVariantModel, {
			_id: id('v_plain'),
			optionSelectionHash: `h_v_plain_${RUN}`,
			productId: id('p_plain'),
			sku: `LE-${RUN}-PLAIN`,
			isBaseVariant: true,
			priceINR: 100,
			optionSelections: [
				{ attributeCode: colour, termCode: 'red' },
				{ attributeCode: bare, termCode: 'x' },
			],
			stock: { quantity: 5 },
		});
		await raw(ProductVariantModel, {
			_id: id('v_var1'),
			optionSelectionHash: `h_v_var1_${RUN}`,
			productId: id('p_var'),
			sku: `LE-${RUN}-V1`,
			isBaseVariant: true,
			priceINR: 200,
			stock: { tracked: true, quantity: 1, held: 0 },
		});
		await raw(ProductVariantModel, {
			_id: id('v_var2'),
			optionSelectionHash: `h_v_var2_${RUN}`,
			productId: id('p_var'),
			sku: `LE-${RUN}-V2`,
			isBaseVariant: false,
			priceINR: 200,
			stock: { tracked: true, quantity: 1, held: 0 },
		});
		await raw(ProductVariantModel, {
			_id: id('v_set'),
			optionSelectionHash: `h_v_set_${RUN}`,
			productId: id('p_set'),
			sku: `LE-${RUN}-SET`,
			isBaseVariant: true,
			priceINR: 900,
		});
		await raw(ProductVariantModel, {
			_id: id('v_empty'),
			optionSelectionHash: `h_v_empty_${RUN}`,
			productId: id('p_plain'),
			sku: `LE-${RUN}-EMPTY`,
			isBaseVariant: false,
			priceINR: 100,
			stock: {},
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	afterAll(async () => {
		const ours = new RegExp(`^${P}`);
		await Promise.all([
			CategoryModel.deleteMany({ _id: ours }).exec(),
			AttributeDefinitionModel.deleteMany({ _id: ours }).exec(),
			ProductModel.deleteMany({ _id: ours }).exec(),
			ProductVariantModel.deleteMany({ _id: ours }).exec(),
			InventoryLedgerModel.deleteMany({ variantId: ours }).exec(),
			InventoryCostLayerModel.deleteMany({ variantId: ours }).exec(),
			LocationStockModel.deleteMany({ variantId: ours }).exec(),
			PurchaseOrderModel.deleteMany({ _id: ours }).exec(),
			PurchaseInvoiceModel.deleteMany({ _id: ours }).exec(),
			StockCountModel.deleteMany({ _id: ours }).exec(),
		]);
		await disconnectMongo();
	});

	it('refuses a versioned save of a document that is gone, and names an unversioned one as version 0', async () => {
		await expect(orders.save({ id: id('po_none'), version: 1 } as never, 3)).rejects.toThrow(
			`purchase_order ${id('po_none')} does not exist`,
		);
		await raw(PurchaseOrderModel, { _id: id('po_bare'), status: 'draft' });
		const refused = await orders.save({ id: id('po_bare'), version: 2 } as never, 7).catch((error) => error);
		expect(refused).toBeInstanceOf(StaleVersionError);
		expect((refused as StaleVersionError).current).toEqual({ version: 0, updatedAt: '', updatedBy: null });
	});

	it('finds no item for a code nobody remembered', async () => {
		expect(await codes.findVariant(id('sup'), 'NOPE')).toBeNull();
	});

	it('lists orders, entries, returns, holds and requests with no supplier, dates or search', async () => {
		const quiet = { filter: 'all', page: 1, pageSize: 5, today } as never;
		expect(
			(await orders.list({ filter: 'all', q: `none-${RUN}`, page: 1, pageSize: 5, today } as never)).items,
		).toEqual([]);
		expect(
			(await entries.list({ filter: 'all', q: `none-${RUN}`, page: 1, pageSize: 5, today } as never)).items,
		).toEqual([]);
		expect(Array.isArray((await returns.list(quiet)).items)).toBe(true);
		expect(Array.isArray((await holds.open({ page: 1, pageSize: 5 })).items)).toBe(true);
		expect(Array.isArray((await requests.list({ status: 'pending', page: 1, pageSize: 5 })).items)).toBe(true);
	});

	it('reads a last purchase price that was never written as nothing', async () => {
		await raw(PurchaseInvoiceModel, {
			_id: id('pe_bare'),
			status: 'posted',
			postedAt: new Date(),
			supplierId: id('sup'),
			supplierName: 'Lastedge Weavers',
			billDate: '2026-11-01',
			number: null,
			lines: [{ variantId: id('v_var2'), freeOnBill: false }],
		});
		const last = await entries.lastPurchases([id('v_var2')], null);
		expect(last.get(id('v_var2'))?.unitPriceExGstINR).toBe(0);
	});

	it('reads no differences from a posted count saved without its lines', async () => {
		await raw(StockCountModel, { _id: id('sc_bare'), status: 'posted', postedAt: '2099-01-01T00:00:00.000Z' });
		expect(await counts.lastDifferences()).toEqual([]);
	});

	it('saves the stock settings over the single settings row, and puts it back', async () => {
		const before = await InventorySettingsModel.collection.findOne({ _id: 'inventory' } as never);
		try {
			const current = await settings.get();
			await settings.save(current);
			expect(await settings.get()).toEqual(current);
		} finally {
			if (before) await InventorySettingsModel.collection.replaceOne({ _id: 'inventory' } as never, before);
			else await InventorySettingsModel.collection.deleteOne({ _id: 'inventory' } as never);
		}
	});

	it('reads and writes the shop’s own details only over the copy the editor read', async () => {
		const before = await ShopDetailsModel.collection.findOne({ _id: 'shop' } as never);
		await ShopDetailsModel.collection.deleteOne({ _id: 'shop' } as never);
		const first = '2026-11-24T05:00:00.000Z';
		const second = '2026-11-24T06:00:00.000Z';
		const details = { ...EMPTY_SHOP_DETAILS, legalName: 'K.R. Marketing', updatedAt: first, updatedBy: 'adm_1' };
		try {
			expect(await shop.get()).toBeNull();
			// An edit of a copy that was never saved: nobody to name.
			const none = await shop.save(details, first).catch((error) => error);
			expect((none as StaleVersionError).current).toEqual({ version: 0, updatedAt: '', updatedBy: null });
			await shop.save(details, null);
			expect(await shop.get()).toMatchObject({ legalName: 'K.R. Marketing', updatedAt: first });
			await shop.save({ ...details, legalName: 'K.R. Marketing (Kolkata)', updatedAt: second }, first);
			const stale = await shop.save(details, first).catch((error) => error);
			expect((stale as StaleVersionError).current).toEqual({
				version: 0,
				updatedAt: second,
				updatedBy: 'adm_1',
			});
			// A second first save meets the saved row: refused the same way.
			await expect(shop.save(details, null)).rejects.toBeInstanceOf(StaleVersionError);
			vi.spyOn(ShopDetailsModel, 'updateOne').mockImplementationOnce(
				() =>
					({
						exec: async () => {
							throw new Error('database down');
						},
					}) as never,
			);
			await expect(shop.save(details, second)).rejects.toThrow('database down');
		} finally {
			await ShopDetailsModel.collection.deleteOne({ _id: 'shop' } as never);
			if (before) await ShopDetailsModel.collection.insertOne(before);
		}
	});

	it('moves stock of an item saved without a held count, and reads nothing for no items', async () => {
		const moved = await movement.move({
			variantId: id('v_plain'),
			productId: id('p_plain'),
			quantityDelta: -1,
			heldDelta: 0,
			source: 'manual_adjustment',
			reasonCode: null,
			note: null,
			referenceType: 'adjustment',
			referenceId: id('adj'),
			referenceNumber: null,
			actorUserId: null,
			approverUserId: null,
			at: '2026-11-24T05:00:00.000Z',
		} as never);
		expect(moved).toMatchObject({ onHandAfter: 4, heldAfter: 0 });
		expect(await movement.locationStock([])).toEqual([]);
		await expect(movement.consumeLayer(id('layer_none'), 0)).resolves.toBeUndefined();
	});

	it('places unplaced stock of an item saved with an empty stock record as nothing on hand', async () => {
		await movement.placeUnlocatedStock(id('loc'));
		const placed = await LocationStockModel.findById(`${id('v_empty')}:${id('loc')}`)
			.lean()
			.exec();
		expect(placed).toMatchObject({ onHand: 0, held: 0, reserved: 0 });
	});

	it('names items with labels that are missing: options, terms, categories and titles', async () => {
		const items = await stock.items([id('v_plain'), id('v_var1'), id('v_empty')]);
		expect(items.get(id('v_plain'))).toMatchObject({
			optionsLabel: 'red · x',
			title: {},
			categoryName: '',
			categoryIds: [id('cat')],
		});
		expect(items.get(id('v_var1'))).toMatchObject({ optionsLabel: '', categoryIds: [], categoryName: null });
		expect(items.get(id('v_empty'))).toMatchObject({ onHand: 0, held: 0 });
		expect(await stock.items([])).toEqual(new Map());
	});

	it('searches by words, one row per variable product, never a set, an exact code by itself, and up to the limit', async () => {
		expect(await stock.search('   ', 5)).toEqual([]);
		const byWords = await stock.search(`Lastedge Kantha ${RUN}`, 5);
		expect(byWords.map((fact) => fact.productId)).toEqual([id('p_var')]);
		const exact = await stock.search(`LE-${RUN}-V2`, 5);
		expect(exact.map((fact) => fact.variantId)).toEqual([id('v_var2')]);
		expect(await stock.search(`LE-${RUN}`, 1)).toHaveLength(1);
	});

	it('lists stock without a search, and totals nothing when there is no stock at all', async () => {
		const listed = await stock.list({
			filter: 'all',
			page: 1,
			pageSize: 3,
			olderThan: '2000-01-01T00:00:00.000Z',
		} as never);
		expect(listed.items.length).toBeLessThanOrEqual(3);
		vi.spyOn(ProductVariantModel, 'aggregate').mockReturnValueOnce({ exec: async () => [] } as never);
		expect(await stock.totals()).toEqual({ pieces: 0, metresTenths: 0, low: 0, out: 0, held: 0 });
	});

	it('reads a stock batch saved before batches named their source', async () => {
		await raw(InventoryCostLayerModel, {
			_id: id('layer_bare'),
			variantId: id('v_plain'),
			receivedAt: new Date('2026-01-01T00:00:00.000Z'),
			quantityReceived: 2,
			quantityRemaining: 2,
			unitCostINR: 50,
			createdAt: new Date('2026-01-01T00:00:00.000Z'),
		});
		expect(await stock.layersOf(id('v_plain'))).toEqual([
			expect.objectContaining({
				id: id('layer_bare'),
				sourceType: 'purchase_invoice',
				sourceNumber: null,
				purchaseInvoiceId: null,
				sourceLineId: null,
			}),
		]);
		const paged = await stock.variantsWithLayersBefore('2026-06-01T00:00:00.000Z', 1, 100_000);
		expect(paged.variantIds).toContain(id('v_plain'));
		expect(paged.total).toBeGreaterThanOrEqual(1);
		expect((await stock.variantsWithLayersBefore('2026-06-01T00:00:00.000Z', 0, 1)).variantIds).toHaveLength(1);
	});

	it('filters the stock ledger by source, person, documents and either end of a date range', async () => {
		await raw(InventoryLedgerModel, {
			_id: id('led_bare'),
			variantId: id('v_plain'),
			productId: id('p_plain'),
			quantityDelta: 1,
			balanceAfter: 6,
			source: 'manual_adjustment',
			referenceId: id('ref1'),
			createdAt: new Date('2026-02-01T00:00:00.000Z'),
		});
		await raw(InventoryLedgerModel, {
			_id: id('led_sold'),
			variantId: id('v_plain'),
			productId: id('p_plain'),
			quantityDelta: -1,
			heldDelta: 0,
			balanceAfter: 5,
			heldAfter: 0,
			source: 'order_placed',
			referenceId: id('ref2'),
			actorUserId: id('adm'),
			createdAt: new Date('2026-03-01T00:00:00.000Z'),
		});
		const bySource = await stock.ledger({
			page: 1,
			pageSize: 10,
			source: 'manual_adjustment',
			referenceIds: [id('ref1')],
		} as never);
		expect(bySource.items).toEqual([
			expect.objectContaining({ id: id('led_bare'), heldDelta: 0, heldAfter: 0, note: null, actorUserId: null }),
		]);
		const byPerson = await stock.ledger({
			page: 1,
			pageSize: 10,
			actorId: id('adm'),
			from: '2026-01-01T00:00:00.000Z',
		} as never);
		expect(byPerson.items.map((row) => row.id)).toEqual([id('led_sold')]);
		const byItem = await stock.ledger({
			page: 1,
			pageSize: 10,
			variantId: id('v_plain'),
			to: '2026-12-31T00:00:00.000Z',
		} as never);
		// Newest first: the move made above (November), then March, then February.
		expect(byItem.items.map((row) => row.id).slice(-2)).toEqual([id('led_sold'), id('led_bare')]);
	});

	it('adds up what moved since a day, leaving out one document when asked', async () => {
		const all = await stock.movedSince([id('v_plain')], '2026-01-15T00:00:00.000Z', null);
		const without = await stock.movedSince([id('v_plain')], '2026-01-15T00:00:00.000Z', id('ref2'));
		expect((without.get(id('v_plain')) ?? 0) - (all.get(id('v_plain')) ?? 0)).toBe(1);
	});

	it('values no stock for an item with nothing on hand, and lists every item in scope', async () => {
		const valued = await stock.valuationAsOf('2026-12-31T23:59:59.999Z');
		expect(valued.some((row) => row.variantId === id('v_empty'))).toBe(false);
		expect(await stock.variantIdsInScope({ kind: 'all', categoryIds: [] })).toContain(id('v_plain'));
	});
});
