import { randomUUID } from 'node:crypto';

import type { PurchaseEntry, PurchaseOrder } from '@saha-textile/contracts';
import { SHOP_LOW_STOCK_THRESHOLD, StaleVersionError, StockMovementRefusedError } from '@saha-textile/core-domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildMongoConfig } from '../src/config';
import { connectMongo, disconnectMongo } from '../src/connection';
import {
	AttributeDefinitionModel,
	InventoryCostLayerModel,
	InventoryLedgerModel,
	ProductModel,
	ProductVariantModel,
	PurchaseInvoiceModel,
	PurchaseOrderModel,
	SequenceModel,
	SupplierItemCodeModel,
} from '../src/models/index';
import { InsufficientStockError, MongoInventoryRepository } from '../src/repositories/inventory.repository';
import {
	MongoNumberAllocator,
	MongoPurchaseEntryRepository,
	MongoPurchaseOrderRepository,
	MongoStockMovement,
	MongoStockReadRepository,
	MongoSupplierItemCodeRepository,
} from '../src/repositories/purchasing.repository';
import { MongoTransactionManager } from '../src/transaction-manager';

/**
 * Purchases and stock persistence against the real replica set. The guards that keep stock
 * honest (held pieces never sold, numbers never repeated, a bill never entered twice) only
 * show under real concurrency and real unique indexes, so these drive the database itself.
 *
 *   MONGODB_PORT=27018 RUN_DB_IT=1 pnpm --filter @saha-textile/adapters-db-mongo test
 */
function hasMongoEnv(): boolean {
	if (process.env.RUN_DB_IT !== '1') return false;
	try {
		buildMongoConfig();
		return true;
	} catch {
		return false;
	}
}

const P = 'it_pur_';
const RUN = randomUUID().slice(0, 8).toUpperCase();
const at = () => new Date().toISOString();

describe.skipIf(!hasMongoEnv())('purchases and stock persistence (integration, rs0)', () => {
	const allocator = new MongoNumberAllocator();
	const orders = new MongoPurchaseOrderRepository();
	const entries = new MongoPurchaseEntryRepository();
	const codes = new MongoSupplierItemCodeRepository();
	const movement = new MongoStockMovement();
	const inventory = new MongoInventoryRepository();
	const read = new MongoStockReadRepository();
	const transactions = new MongoTransactionManager();

	const productId = `${P}prod_${RUN}`;
	const metreProductId = `${P}metre_${RUN}`;

	const seedVariant = async (
		quantity: number,
		options: { held?: number; tracked?: boolean; product?: string; low?: number | null } = {},
	): Promise<string> => {
		const id = `${P}var_${randomUUID()}`;
		await ProductVariantModel.collection.insertOne({
			_id: id as never,
			productId: options.product ?? productId,
			sku: `ITPUR-${RUN}-${randomUUID().slice(0, 6)}`,
			status: 'live',
			optionSelections: [{ attributeCode: `${P}colour`, termCode: 'red' }],
			optionSelectionHash: `h_${randomUUID()}`,
			isBaseVariant: false,
			priceINR: 12_500,
			compareAtPriceINR: 14_000,
			salePriceINR: null,
			stock: {
				tracked: options.tracked ?? true,
				quantity,
				held: options.held ?? 0,
				lowStockThreshold: options.low ?? null,
				allowBackorder: false,
			},
		});
		return id;
	};

	const move = (variantId: string, quantityDelta: number, heldDelta: number, source = 'manual_adjustment') => ({
		variantId,
		productId,
		quantityDelta,
		heldDelta,
		source,
		reasonCode: null,
		note: 'integration',
		referenceType: null,
		referenceId: null,
		referenceNumber: null,
		actorUserId: `${P}user`,
		approverUserId: null,
		at: at(),
	});

	beforeAll(async () => {
		await connectMongo();
		await Promise.all([
			ProductVariantModel.syncIndexes(),
			InventoryLedgerModel.syncIndexes(),
			InventoryCostLayerModel.syncIndexes(),
			PurchaseInvoiceModel.syncIndexes(),
			PurchaseOrderModel.syncIndexes(),
			SequenceModel.syncIndexes(),
			SupplierItemCodeModel.syncIndexes(),
		]);
		await ProductModel.collection.insertMany([
			{
				_id: productId as never,
				type: 'variable',
				sku: `ITPUR-${RUN}`,
				title: { en: `Integration Banarasi ${RUN}`, bn: 'বেনারসি' },
				slug: `it-pur-${RUN.toLowerCase()}`,
				status: 'live',
				basePriceINR: 12_500,
				categoryIds: [],
				hsnCode: '5007',
				lowStockThreshold: null,
			},
			{
				_id: metreProductId as never,
				type: 'simple',
				sku: `ITPUR-M-${RUN}`,
				title: { en: `Integration Silk Yardage ${RUN}` },
				slug: `it-pur-m-${RUN.toLowerCase()}`,
				status: 'draft',
				basePriceINR: 900,
				soldBy: 'metre',
				categoryIds: [],
			},
		]);
		await AttributeDefinitionModel.collection.insertOne({
			_id: `${P}attr_${RUN}` as never,
			code: `${P}colour`,
			label: { en: 'Colour' },
			defaultRole: 'variant',
			defaultDisplayStyle: 'swatch',
			valueType: 'text',
			terms: [{ code: 'red', label: { en: 'Red', bn: 'লাল' }, slug: 'red', aliases: [], isBase: false }],
		});
	});

	afterAll(async () => {
		const ours = new RegExp(`^${P}`);
		await Promise.all([
			ProductVariantModel.deleteMany({ _id: ours }).exec(),
			ProductModel.deleteMany({ _id: ours }).exec(),
			AttributeDefinitionModel.deleteMany({ _id: ours }).exec(),
			InventoryLedgerModel.deleteMany({ variantId: ours }).exec(),
			InventoryCostLayerModel.deleteMany({ variantId: ours }).exec(),
			PurchaseInvoiceModel.deleteMany({ _id: ours }).exec(),
			PurchaseOrderModel.deleteMany({ _id: ours }).exec(),
			SequenceModel.deleteMany({ _id: new RegExp(`^IT${RUN}`) }).exec(),
			SupplierItemCodeModel.deleteMany({ supplierId: ours }).exec(),
		]);
		await disconnectMongo();
	});

	describe('document numbers', () => {
		it('counts up per series and financial year, each year from 1', async () => {
			const series = `IT${RUN}PE`;
			expect(await allocator.next(series, '2026-27')).toBe(1);
			expect(await allocator.next(series, '2026-27')).toBe(2);
			expect(await allocator.next(series, '2027-28')).toBe(1);
			expect(await allocator.next(`IT${RUN}OS`, '2026-27')).toBe(1);
		});

		it('never hands the same number to two simultaneous postings', async () => {
			const series = `IT${RUN}RACE`;
			const numbers = await Promise.all(Array.from({ length: 25 }, () => allocator.next(series, '2026-27')));
			expect([...numbers].sort((a, b) => a - b)).toEqual(Array.from({ length: 25 }, (_, index) => index + 1));
		});

		it('gives a number back when the posting that took it rolls back', async () => {
			const series = `IT${RUN}ROLL`;
			await allocator.next(series, '2026-27');
			await expect(
				transactions.withTransaction(async (context) => {
					await allocator.next(series, '2026-27', context);
					throw new Error('posting failed');
				}),
			).rejects.toThrow('posting failed');
			// No gap: the series stays continuous, as GST Rule 46 numbering expects.
			expect(await allocator.next(series, '2026-27')).toBe(2);
		});
	});

	describe('versioned saves', () => {
		const order = (version: number): PurchaseOrder =>
			({
				id: `${P}po_${RUN}`,
				number: `IT/${RUN}/1`,
				status: 'draft',
				supplierId: `${P}sup`,
				supplierName: 'Integration Weavers',
				expectedBy: '2026-12-01',
				lines: [],
				version,
				createdAt: at(),
				updatedAt: at(),
				updatedBy: `${P}user_a`,
			}) as unknown as PurchaseOrder;

		it('refuses a save made from a copy someone else has since changed, and says who', async () => {
			expect(await orders.save(order(1), null)).toBe(1);
			expect(await orders.save(order(1), 1)).toBe(2);
			const stale = orders.save(order(1), 1);
			await expect(stale).rejects.toBeInstanceOf(StaleVersionError);
			await stale.catch((error: StaleVersionError) => {
				expect(error.current.version).toBe(2);
				expect(error.current.updatedBy).toBe(`${P}user_a`);
			});
		});

		it('only deletes an order that is still a draft', async () => {
			await PurchaseOrderModel.updateOne({ _id: `${P}po_${RUN}` }, { $set: { status: 'sent' } }).exec();
			await orders.remove(`${P}po_${RUN}`);
			expect(await orders.findById(`${P}po_${RUN}`)).not.toBeNull();
		});
	});

	describe('purchase entries', () => {
		const entry = (
			id: string,
			billNumber: string,
			status: string,
			extra: Record<string, unknown> = {},
		): PurchaseEntry =>
			({
				id,
				number: null,
				status,
				paymentStatus: 'unpaid',
				supplierId: `${P}sup_${RUN}`,
				supplierName: 'Integration Weavers',
				billNumber,
				billDate: '2026-11-10',
				dueOn: '2026-12-10',
				lines: [],
				totals: { totalINR: 1000 },
				postRequestKey: null,
				version: 1,
				createdAt: at(),
				postedAt: null,
				...extra,
			}) as unknown as PurchaseEntry;

		it('stops the same bill being entered twice, however its number is typed', async () => {
			await entries.save(entry(`${P}pe_a_${RUN}`, 'BW/1042', 'draft'), null);
			// "bw-1042" normalises to the same key as "BW/1042".
			await expect(entries.save(entry(`${P}pe_b_${RUN}`, 'bw-1042', 'draft'), null)).rejects.toMatchObject({
				code: 11000,
			});
			expect(await entries.findByBill(`${P}sup_${RUN}`, 'BW1042', null)).not.toBeNull();
			expect(await entries.findByBill(`${P}sup_${RUN}`, 'BW1042', `${P}pe_a_${RUN}`)).toBeNull();
		});

		it('lets a voided bill be entered again', async () => {
			await PurchaseInvoiceModel.updateOne({ _id: `${P}pe_a_${RUN}` }, { $set: { status: 'void' } }).exec();
			await entries.save(entry(`${P}pe_c_${RUN}`, 'BW 1042', 'draft'), null);
			expect((await entries.findByBill(`${P}sup_${RUN}`, 'BW1042', null))?.id).toBe(`${P}pe_c_${RUN}`);
		});

		it('posts once for one request key, even when the button is pressed twice', async () => {
			expect(await entries.claimRequestKey(`${P}key_${RUN}`, `${P}pe_c_${RUN}`)).toBe('claimed');
			expect(await entries.claimRequestKey(`${P}key_${RUN}`, `${P}pe_c_${RUN}`)).toBe('seen');
		});

		it('remembers the last price paid per variant, ignoring free pieces and voided bills', async () => {
			const variantId = `${P}var_last_${RUN}`;
			const posted = (id: string, postedAt: string, price: number, free = false, status = 'posted') =>
				entry(id, `LP-${id}`, status, {
					number: `PE/${id}`,
					postedAt,
					lines: [{ variantId, unitPriceExGstINR: price, freeOnBill: free }],
				});
			await entries.save(posted(`${P}pe_old_${RUN}`, '2026-10-01T00:00:00.000Z', 8600), null);
			await entries.save(posted(`${P}pe_new_${RUN}`, '2026-11-01T00:00:00.000Z', 9100), null);
			await entries.save(posted(`${P}pe_free_${RUN}`, '2026-11-05T00:00:00.000Z', 0, true), null);
			await entries.save(posted(`${P}pe_void_${RUN}`, '2026-11-06T00:00:00.000Z', 1, false, 'void'), null);
			const last = await entries.lastPurchases([variantId], null);
			expect(last.get(variantId)?.unitPriceExGstINR).toBe(9100);
			// Editing the newest entry compares against the one before it, not itself.
			expect(
				(await entries.lastPurchases([variantId], `${P}pe_new_${RUN}`)).get(variantId)?.unitPriceExGstINR,
			).toBe(8600);
		});

		it("learns a supplier's own item code", async () => {
			await codes.remember(`${P}sup_${RUN}`, ' kb-77 ', `${P}var_code`);
			expect(await codes.findVariant(`${P}sup_${RUN}`, 'KB-77')).toBe(`${P}var_code`);
			await codes.remember(`${P}sup_${RUN}`, 'KB-77', `${P}var_code_2`);
			expect(await codes.findVariant(`${P}sup_${RUN}`, 'kb-77')).toBe(`${P}var_code_2`);
		});
	});

	describe('held pieces', () => {
		it('holds and releases, and records both counts on the ledger row', async () => {
			const variantId = await seedVariant(5);
			const hold = await movement.move(move(variantId, 0, 2, 'hold'));
			expect(hold).toMatchObject({ onHandAfter: 5, heldAfter: 2 });
			const release = await movement.move(move(variantId, 0, -1, 'release'));
			expect(release.heldAfter).toBe(1);
			const rows = await read.ledger({ variantId, page: 1, pageSize: 10 });
			expect(rows.items.map((row) => [row.source, row.heldDelta, row.heldAfter])).toEqual([
				['release', -1, 1],
				['hold', 2, 2],
			]);
		});

		it('never sells a held piece', async () => {
			const variantId = await seedVariant(5, { held: 2 });
			const sale = {
				variantId,
				productId,
				quantityDelta: -4,
				source: 'order_placed' as const,
				reasonCode: null,
				note: null,
				referenceType: null,
				referenceId: null,
				actorUserId: null,
				createdAt: at(),
			};
			await expect(inventory.applyDelta(sale)).rejects.toBeInstanceOf(InsufficientStockError);
			const sold = await inventory.applyDelta({ ...sale, quantityDelta: -3 });
			expect(sold.balanceAfter).toBe(2);
			expect(sold.heldAfter).toBe(2);
		});

		it('refuses to hold more than is on hand, release more than is held, or remove held pieces', async () => {
			const variantId = await seedVariant(3, { held: 1 });
			await expect(movement.move(move(variantId, 0, 3, 'hold'))).rejects.toBeInstanceOf(
				StockMovementRefusedError,
			);
			await expect(movement.move(move(variantId, 0, -2, 'release'))).rejects.toBeInstanceOf(
				StockMovementRefusedError,
			);
			// Removing 3 would leave 0 on hand under 1 held.
			await expect(movement.move(move(variantId, -3, 0))).rejects.toBeInstanceOf(StockMovementRefusedError);
			// A held piece written off leaves on-hand and held together.
			expect(await movement.move(move(variantId, -1, -1))).toMatchObject({ onHandAfter: 2, heldAfter: 0 });
			expect((await read.ledger({ variantId, page: 1, pageSize: 10 })).total).toBe(1);
		});

		it('lets exactly as many simultaneous holds through as there are pieces', async () => {
			const variantId = await seedVariant(5);
			const outcomes = await Promise.allSettled(
				Array.from({ length: 12 }, () => movement.move(move(variantId, 0, 1, 'hold'))),
			);
			expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(5);
			const after = await ProductVariantModel.findById(variantId).lean().exec();
			expect(after?.stock).toMatchObject({ quantity: 5, held: 5 });
		});

		it('keeps pieces for orders: never more than is free, released and sold with the ledger (DEC-STOCK-RESERVE)', async () => {
			const variantId = await seedVariant(5, { held: 1 });
			const keep = (quantityDelta: number, reservedDelta: number, source: string) => ({
				...move(variantId, quantityDelta, 0, source),
				reservedDelta,
			});
			// 5 on hand, 1 held: 4 free, so keeping 5 is refused and keeping 3 is not.
			await expect(movement.move(keep(0, 5, 'reservation'))).rejects.toBeInstanceOf(StockMovementRefusedError);
			await movement.move(keep(0, 3, 'reservation'));
			// Removing 2 would leave 3 on hand under 1 held + 3 kept.
			await expect(movement.move(move(variantId, -2, 0))).rejects.toBeInstanceOf(StockMovementRefusedError);
			await expect(movement.move(keep(0, -4, 'reservation_released'))).rejects.toBeInstanceOf(
				StockMovementRefusedError,
			);
			await movement.move(keep(0, -1, 'reservation_released'));
			await movement.move(keep(-2, -2, 'order_placed'));
			const after = await ProductVariantModel.findById(variantId).lean().exec();
			expect(after?.stock).toMatchObject({ quantity: 3, held: 1, reserved: 0 });
			const rows = await InventoryLedgerModel.find({ variantId }).sort({ createdAt: 1 }).lean().exec();
			expect(rows.map((row) => [row.source, row.reservedDelta, row.reservedAfter])).toEqual([
				['reservation', 3, 3],
				['reservation_released', -1, 2],
				['order_placed', -2, 0],
			]);
		});

		it('moves untracked items without a guard', async () => {
			const variantId = await seedVariant(0, { tracked: false });
			expect((await movement.move(move(variantId, -2, 0))).onHandAfter).toBe(-2);
		});

		it('rolls stock and its ledger row back together', async () => {
			const variantId = await seedVariant(4);
			await expect(
				transactions.withTransaction(async (context) => {
					await movement.move(move(variantId, 3, 0, 'purchase_invoice'), context);
					throw new Error('posting failed');
				}),
			).rejects.toThrow('posting failed');
			const after = await ProductVariantModel.findById(variantId).lean().exec();
			expect(after?.stock.quantity).toBe(4);
			expect((await read.ledger({ variantId, page: 1, pageSize: 10 })).total).toBe(0);
		});
	});

	describe('cost layers', () => {
		it('takes pieces from a named layer and refuses more than it holds', async () => {
			const variantId = await seedVariant(3);
			await InventoryCostLayerModel.collection.insertOne({
				_id: `${P}layer_${RUN}` as never,
				variantId,
				purchaseInvoiceId: `${P}pe_layer`,
				sourceType: 'purchase_invoice',
				sourceLineId: `${P}line_1`,
				sourceNumber: 'PE/26-27/000001',
				quantityReceived: 3,
				quantityRemaining: 3,
				unitCostINR: 9295.6143,
				receivedAt: new Date('2026-11-10T06:00:00.000Z'),
				createdAt: new Date(),
			});
			await expect(movement.consumeLayer(`${P}layer_${RUN}`, 4)).rejects.toBeInstanceOf(
				StockMovementRefusedError,
			);
			await movement.consumeLayer(`${P}layer_${RUN}`, 2);
			const [layer] = await read.layersForEntry(`${P}pe_layer`);
			expect(layer).toMatchObject({
				quantityRemaining: 1,
				sourceNumber: 'PE/26-27/000001',
				unitCostINR: 9295.6143,
			});
			expect((await read.openLayers([variantId])).map((row) => row.id)).toEqual([`${P}layer_${RUN}`]);
		});

		it('values stock as it stood at the end of a past day, by when each layer was posted', async () => {
			const variantId = await seedVariant(0);
			await InventoryCostLayerModel.collection.insertMany([
				{
					_id: `${P}val_a_${RUN}` as never,
					variantId,
					purchaseInvoiceId: null,
					sourceType: 'opening_stock',
					quantityReceived: 2,
					quantityRemaining: 0,
					unitCostINR: 100,
					receivedAt: new Date('2026-04-01T00:00:00.000Z'),
					createdAt: new Date('2026-04-01T00:00:00.000Z'),
				},
				{
					_id: `${P}val_b_${RUN}` as never,
					variantId,
					purchaseInvoiceId: null,
					sourceType: 'purchase_invoice',
					quantityReceived: 3,
					quantityRemaining: 3,
					unitCostINR: 150,
					receivedAt: new Date('2026-06-01T00:00:00.000Z'),
					createdAt: new Date('2026-06-01T00:00:00.000Z'),
				},
			]);
			// 5 in by June, 2 sold in July (the oldest went first), then 1 more sold in October.
			await ProductVariantModel.updateOne({ _id: variantId }, { $set: { 'stock.quantity': 2 } }).exec();
			await InventoryLedgerModel.collection.insertMany([
				{
					_id: `${P}led_apr_${RUN}` as never,
					variantId,
					productId,
					quantityDelta: 2,
					balanceAfter: 2,
					source: 'opening_stock',
					createdAt: new Date('2026-04-01T00:00:00.000Z'),
				},
				{
					_id: `${P}led_jun_${RUN}` as never,
					variantId,
					productId,
					quantityDelta: 3,
					balanceAfter: 5,
					source: 'purchase_invoice',
					createdAt: new Date('2026-06-01T00:00:00.000Z'),
				},
				{
					_id: `${P}led_jul_${RUN}` as never,
					variantId,
					productId,
					quantityDelta: -2,
					balanceAfter: 3,
					source: 'order_placed',
					createdAt: new Date('2026-07-10T00:00:00.000Z'),
				},
				{
					_id: `${P}led_oct_${RUN}` as never,
					variantId,
					productId,
					quantityDelta: -1,
					balanceAfter: 2,
					source: 'order_placed',
					createdAt: new Date('2026-10-10T00:00:00.000Z'),
				},
			]);
			const august = (await read.valuationAsOf('2026-08-31T18:29:59.999Z')).find(
				(row) => row.variantId === variantId,
			);
			// 3 pieces on 31 August, all from the June layer at ₹150.
			expect(august).toEqual({ variantId, units: 3, valueINR: 450, uncostedUnits: 0 });
			const may = (await read.valuationAsOf('2026-05-31T18:29:59.999Z')).find(
				(row) => row.variantId === variantId,
			);
			expect(may).toEqual({ variantId, units: 2, valueINR: 200, uncostedUnits: 0 });
			// Stock typed in with no ledger row or layer behind it is counted but shown as uncosted.
			const typedIn = await seedVariant(4);
			expect((await read.valuationAsOf(at())).find((row) => row.variantId === typedIn)).toEqual({
				variantId: typedIn,
				units: 4,
				valueINR: 0,
				uncostedUnits: 4,
			});
			// Units sold since a day, cancelled orders netted off.
			expect((await read.soldSince([variantId], '2026-07-01T00:00:00.000Z')).get(variantId)).toBe(3);
			expect((await read.lastSoldOn([variantId])).get(variantId)).toBe('2026-10-10');
		});
	});

	describe('stock read side', () => {
		it('describes an item with its option names, held pieces and shop defaults', async () => {
			const variantId = await seedVariant(4, { held: 1 });
			const facts = (await read.items([variantId])).get(variantId);
			expect(facts).toMatchObject({
				productId,
				optionsLabel: 'Red',
				onHand: 4,
				held: 1,
				soldBy: 'piece',
				productType: 'variable',
				hsnCode: '5007',
				sellingPriceINR: 12_500,
				mrpINR: 14_000,
				lowStockLevel: SHOP_LOW_STOCK_THRESHOLD,
				title: { en: `Integration Banarasi ${RUN}`, bn: 'বেনারসি' },
			});
		});

		it('filters the stock list by low, out and held, counting each', async () => {
			await seedVariant(1, { low: 3 }); // low
			await seedVariant(2, { held: 2 }); // out to sell, held
			await seedVariant(0, { tracked: false }); // untracked: never low or out
			const list = await read.list({
				q: `ITPUR-${RUN}`,
				filter: 'all',
				page: 1,
				pageSize: 100,
				olderThan: '2026-05-21T00:00:00.000Z',
			});
			expect(list.counts.low).toBeGreaterThanOrEqual(1);
			const held = await read.list({
				q: `ITPUR-${RUN}`,
				filter: 'held',
				page: 1,
				pageSize: 100,
				olderThan: at(),
			});
			expect(held.items.every((item) => item.held > 0)).toBe(true);
			const out = await read.list({ q: `ITPUR-${RUN}`, filter: 'out', page: 1, pageSize: 100, olderThan: at() });
			expect(out.items.every((item) => item.tracked && item.onHand - item.held <= 0)).toBe(true);
			expect(out.items.some((item) => !item.tracked)).toBe(false);
		});

		it('finds a metre item by title words and reports it as metres', async () => {
			const variantId = await seedVariant(425, { product: metreProductId });
			const found = await read.search(`silk yardage ${RUN}`, 10);
			const row = found.find((item) => item.variantId === variantId);
			expect(row?.soldBy).toBe('metre');
			expect(row?.onHand).toBe(425);
		});
	});
});
