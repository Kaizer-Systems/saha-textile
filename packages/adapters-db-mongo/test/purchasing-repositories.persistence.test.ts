import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { connectMongo, disconnectMongo } from '../src/connection';
import {
	CategoryModel,
	InventoryCostLayerModel,
	InventoryLedgerModel,
	OpeningStockModel,
	ProductModel,
	ProductVariantModel,
	PurchaseInvoiceModel,
	PurchaseOrderModel,
	PurchaseReturnModel,
	SequenceModel,
	StockAdjustmentModel,
	StockCountModel,
	StockHoldModel,
	SupplierItemCodeModel,
	SupplierModel,
	SupplierPaymentModel,
} from '../src/models/index';
import {
	MongoAdjustmentRequestRepository,
	MongoInventorySettingsRepository,
	MongoNumberAllocator,
	MongoOpeningStockRepository,
	MongoPurchaseEntryRepository,
	MongoPurchaseOrderRepository,
	MongoPurchaseReturnRepository,
	MongoStockCountRepository,
	MongoStockHoldRepository,
	MongoStockReadRepository,
	MongoSupplierItemCodeRepository,
	MongoSupplierPaymentRepository,
	MongoSupplierRepository,
} from '../src/repositories/purchasing.repository';
import { hasMongoEnv } from './mongo-test-env';

/**
 * Every purchases and stock repository read and write, against the real replica set, on rows of this run only.
 *
 *   MONGODB_DB_NAME=saha_textile_test RUN_DB_IT=1 pnpm --filter @saha-textile/adapters-db-mongo test
 */
const P = 'it_purx_';
const RUN = randomUUID().slice(0, 8);
const id = (name: string) => `${P}${name}_${RUN}`;
const at = '2026-11-20T10:00:00.000Z';
const today = '2026-11-20';
const listFilter = (over: Record<string, unknown> = {}) =>
	({ filter: 'all', q: '', page: 1, pageSize: 50, today, supplierId: id('sup'), ...over }) as never;

describe.skipIf(!hasMongoEnv())('purchases repositories: every read and write (integration, rs0)', () => {
	const suppliers = new MongoSupplierRepository();
	const codes = new MongoSupplierItemCodeRepository();
	const orders = new MongoPurchaseOrderRepository();
	const entries = new MongoPurchaseEntryRepository();
	const payments = new MongoSupplierPaymentRepository();
	const returns = new MongoPurchaseReturnRepository();
	const holds = new MongoStockHoldRepository();
	const requests = new MongoAdjustmentRequestRepository();
	const opening = new MongoOpeningStockRepository();
	const counts = new MongoStockCountRepository();
	const allocator = new MongoNumberAllocator();
	const settings = new MongoInventorySettingsRepository();
	const stock = new MongoStockReadRepository();

	const supplier = (key: string, over: Record<string, unknown> = {}) =>
		({
			id: id(key),
			legalName: `Integration Weavers ${key} ${RUN}`,
			shortName: key,
			gstin: `19${RUN.toUpperCase().slice(0, 5)}${key.length}Z1Z5`,
			pan: `PAN${RUN}`,
			active: true,
			roles: { supplier: true, customer: false },
			address: { city: 'Kolkata' },
			...over,
		}) as never;

	beforeAll(async () => {
		await connectMongo();
		await CategoryModel.collection.insertOne({ _id: id('cat') as never, name: { en: 'Silk' }, slug: id('cat') });
		await ProductModel.collection.insertOne({
			_id: id('prod') as never,
			type: 'simple',
			sku: `ITPX-${RUN}`,
			title: { en: `Integration Tussar ${RUN}` },
			slug: id('prod'),
			status: 'live',
			basePriceINR: 1000,
			categoryIds: [id('cat')],
		});
		await ProductVariantModel.collection.insertOne({
			_id: id('var') as never,
			productId: id('prod'),
			sku: `ITPX-${RUN}-V`,
			status: 'live',
			optionSelections: [],
			optionSelectionHash: `h_${RUN}`,
			isBaseVariant: true,
			priceINR: 1000,
			stock: { tracked: true, quantity: 5, held: 0, lowStockThreshold: null, allowBackorder: false },
		});
	});

	afterAll(async () => {
		const ours = new RegExp(`^${P}`);
		await Promise.all([
			CategoryModel.deleteMany({ _id: ours }).exec(),
			ProductModel.deleteMany({ _id: ours }).exec(),
			ProductVariantModel.deleteMany({ _id: ours }).exec(),
			InventoryLedgerModel.deleteMany({ variantId: ours }).exec(),
			InventoryCostLayerModel.deleteMany({ variantId: ours }).exec(),
			SupplierModel.deleteMany({ _id: ours }).exec(),
			SupplierItemCodeModel.deleteMany({ supplierId: ours }).exec(),
			PurchaseOrderModel.deleteMany({ _id: ours }).exec(),
			PurchaseInvoiceModel.deleteMany({ _id: ours }).exec(),
			SupplierPaymentModel.deleteMany({ _id: ours }).exec(),
			PurchaseReturnModel.deleteMany({ _id: ours }).exec(),
			StockHoldModel.deleteMany({ _id: ours }).exec(),
			StockAdjustmentModel.deleteMany({ _id: ours }).exec(),
			OpeningStockModel.deleteMany({ _id: ours }).exec(),
			StockCountModel.deleteMany({ _id: ours }).exec(),
			SequenceModel.deleteMany({ _id: new RegExp(`^${P}`) }).exec(),
		]);
		await disconnectMongo();
	});

	it('saves, finds, lists, counts and removes suppliers', async () => {
		await suppliers.save(supplier('sup'));
		// Its own GSTIN: the key length alone would give it the same one as `sup` (unique index).
		await suppliers.save(supplier('off', { active: false, gstin: `19${RUN.toUpperCase().slice(0, 5)}9Z1Z5` }));
		expect((await suppliers.findById(id('sup')))?.legalName).toContain('Integration Weavers sup');
		expect(await suppliers.findByGstin(`19${RUN.toUpperCase().slice(0, 5)}3Z1Z5`)).not.toBeNull();
		expect((await suppliers.findByPan(`PAN${RUN}`)).length).toBeGreaterThanOrEqual(2);
		const listed = await suppliers.list(
			{ filter: 'all', q: `Weavers off ${RUN}`, page: 1, pageSize: 10 } as never,
			new Map(),
		);
		expect(listed.items.map((row) => row.id)).toEqual([id('off')]);
		const inactive = await suppliers.list(
			{ filter: 'inactive', q: RUN, page: 1, pageSize: 10 } as never,
			new Map(),
		);
		expect(inactive.items.map((row) => row.id)).toContain(id('off'));
		const owed = await suppliers.list(
			{ filter: 'owed', page: 0, pageSize: 10 } as never,
			new Map([
				[id('sup'), 500],
				[id('off'), 0],
			]),
		);
		expect(owed.items.map((row) => row.id)).toEqual([id('sup')]);
		expect(await suppliers.hasDocuments(id('sup'))).toBe(false);
		expect((await suppliers.countActive()).all).toBeGreaterThanOrEqual(1);
		await suppliers.softDelete(id('off'), 'adm_1', at);
		expect(await suppliers.findById(id('off'))).toBeNull();
	});

	it('remembers supplier item codes, ignoring a blank one', async () => {
		await codes.remember(id('sup'), ' ab-1 ', id('var'));
		await codes.remember(id('sup'), '   ', id('var'));
		expect(await codes.findVariant(id('sup'), 'AB-1')).toBe(id('var'));
		expect(await codes.codesFor(id('sup'), [id('var')])).toEqual(new Map([[id('var'), 'AB-1']]));
	});

	it('lists purchase orders by filter and search, late ones and open ones', async () => {
		const order = (key: string, status: string, expectedBy: string) =>
			({
				id: id(key),
				number: `ITPO/${RUN}/${key}`,
				status,
				supplierId: id('sup'),
				supplierName: 'Integration Weavers',
				expectedBy,
				lines: [{ sku: `ITPX-${RUN}-V` }],
				createdAt: at,
				updatedAt: at,
				updatedBy: null,
			}) as never;
		await orders.save(order('po_late', 'sent', '2026-11-01'), null);
		await orders.save(order('po_draft', 'draft', '2026-12-01'), null);
		const late = await orders.list(listFilter({ filter: 'late', q: `ITPO/${RUN}` }));
		expect(late.items.map((row) => row.id)).toEqual([id('po_late')]);
		expect(late.counts.all).toBe(2);
		expect((await orders.list(listFilter({ filter: 'no_such_filter' }))).total).toBe(2);
		expect((await orders.openForSupplier(id('sup'))).map((row) => row.id)).toEqual([id('po_late')]);
		expect(await suppliers.hasDocuments(id('sup'))).toBe(true);
	});

	it('finds entries by bill, lookalike and last price, lists them, claims post keys and removes drafts', async () => {
		const entry = (key: string, status: string, over: Record<string, unknown> = {}) =>
			({
				id: id(key),
				number: `ITPE/${RUN}/${key}`,
				status,
				paymentStatus: 'unpaid',
				supplierId: id('sup'),
				supplierName: 'Integration Weavers',
				billNumber: `B-${key}`,
				billDate: '2026-11-10',
				dueOn: '2026-12-10',
				postedAt: at,
				postRequestKey: null,
				totals: { totalINR: 1180 },
				lines: [{ variantId: id('var'), sku: `ITPX-${RUN}-V`, unitPriceExGstINR: 900, freeOnBill: false }],
				createdAt: at,
				updatedAt: at,
				updatedBy: null,
				...over,
			}) as never;
		await entries.save(entry('pe_posted', 'posted'), null);
		await entries.save(entry('pe_draft', 'draft', { billNumber: 'B-draft', totals: { totalINR: 5 } }), null);
		expect((await entries.findById(id('pe_posted')))?.status).toBe('posted');
		expect((await entries.findByBill(id('sup'), 'BPEPOSTED', id('pe_posted')))?.id ?? null).toBeNull();
		expect(await entries.findByBill(id('sup'), 'BPEPOSTED', null)).toBeDefined();
		expect(await entries.findLookalike(id('sup'), '2026-11-10', 1180, id('pe_posted'))).toBeNull();
		expect((await entries.findLookalike(id('sup'), '2026-11-10', 1180, null))?.id).toBe(id('pe_posted'));
		expect(await entries.lastPurchases([], null)).toEqual(new Map());
		expect((await entries.lastPurchases([id('var')], null)).get(id('var'))).toMatchObject({
			unitPriceExGstINR: 900,
		});
		expect((await entries.lastPurchases([id('var')], id('pe_posted'))).size).toBe(0);
		const listed = await entries.list(
			listFilter({ filter: 'unpaid', q: `ITPE/${RUN}`, from: '2026-11-01', to: '2026-11-30' }),
		);
		expect(listed.items.map((row) => row.id)).toEqual([id('pe_posted')]);
		expect((await entries.list(listFilter({ from: '2026-11-01' }))).total).toBe(2);
		expect((await entries.list(listFilter({ to: '2026-11-30' }))).total).toBe(2);
		expect((await entries.openPayables(id('sup'))).map((row) => row.id)).toEqual([id('pe_posted')]);
		expect((await entries.openPayables()).length).toBeGreaterThanOrEqual(1);
		expect((await entries.postedBetween('2026-11-10', '2026-11-10')).map((row) => row.id)).toContain(
			id('pe_posted'),
		);
		expect((await entries.forSupplier(id('sup'))).length).toBe(2);
		expect(await entries.claimRequestKey(`key_${RUN}`, id('pe_posted'))).toBe('claimed');
		expect(await entries.claimRequestKey(`key_${RUN}`, id('pe_posted'))).toBe('seen');
		await entries.remove(id('pe_draft'));
		expect(await entries.findById(id('pe_draft'))).toBeNull();
	});

	it('saves supplier payments and finds them by entry, supplier and id', async () => {
		await payments.save({
			id: id('pay'),
			purchaseEntryId: id('pe_posted'),
			supplierId: id('sup'),
			paidOn: today,
			amountINR: 100,
		} as never);
		expect((await payments.findById(id('pay')))?.amountINR).toBe(100);
		expect((await payments.forEntry(id('pe_posted'))).map((row) => row.id)).toEqual([id('pay')]);
		expect((await payments.forSupplier(id('sup'))).map((row) => row.id)).toEqual([id('pay')]);
	});

	it('saves, lists, claims and removes purchase returns', async () => {
		const ret = (key: string, status: string) =>
			({
				id: id(key),
				number: `ITPR/${RUN}/${key}`,
				kind: 'return_goods',
				origin: 'manual',
				status,
				settledINR: 0,
				supplierId: id('sup'),
				supplierName: 'Integration Weavers',
				purchaseEntryId: id('pe_posted'),
				purchaseEntryNumber: `ITPE/${RUN}`,
				sendRequestKey: null,
				lines: [],
				createdAt: at,
				updatedAt: at,
				updatedBy: null,
			}) as never;
		await returns.save(ret('pr_sent', 'sent'), null);
		await returns.save(ret('pr_draft', 'draft'), null);
		expect((await returns.findById(id('pr_sent')))?.status).toBe('sent');
		const waiting = await returns.list(listFilter({ filter: 'waiting', q: `ITPR/${RUN}` }));
		expect(waiting.items.map((row) => row.id)).toEqual([id('pr_sent')]);
		expect((await returns.forEntry(id('pe_posted'))).length).toBe(2);
		expect((await returns.forSupplier(id('sup'))).length).toBe(2);
		expect(await returns.claimSendKey(`send_${RUN}`, id('pr_sent'))).toBe('claimed');
		expect(await returns.claimSendKey(`send_${RUN}`, id('pr_sent'))).toBe('seen');
		await returns.remove(id('pr_draft'));
		expect(await returns.findById(id('pr_draft'))).toBeNull();
	});

	it('saves holds and lists the open ones by reason and item', async () => {
		await holds.save({
			id: id('hold'),
			variantId: id('var'),
			quantity: 2,
			reason: 'damaged',
			status: 'open',
			since: at,
		} as never);
		expect((await holds.findById(id('hold')))?.quantity).toBe(2);
		const open = await holds.open({ reason: 'damaged', variantIds: [id('var')], page: 1, pageSize: 10 });
		expect(open.items.map((row) => row.id)).toEqual([id('hold')]);
		expect(open.counts).toMatchObject({ all: 2, damaged: 2 });
		expect((await holds.open({ variantIds: [id('var')], page: 1, pageSize: 10 })).total).toBe(1);
		expect((await holds.openForVariant(id('var'))).map((row) => row.id)).toEqual([id('hold')]);
	});

	it('saves adjustment requests, lists them by state and search, and marks decisions seen', async () => {
		const request = (key: string, status: string, over: Record<string, unknown> = {}) =>
			({
				id: id(key),
				status,
				sku: `ITPX-${RUN}-V`,
				title: 'Integration Tussar',
				requestedBy: id('staff'),
				requestedByName: 'Asha Roy',
				requestedAt: at,
				decidedBy: status === 'pending' ? null : id('boss'),
				decidedAt: status === 'pending' ? null : at,
				selfApproved: false,
				...over,
			}) as never;
		await requests.save(request('req_pending', 'pending'), `rk_${RUN}`);
		await requests.save(request('req_rejected', 'rejected'), null);
		await requests.save(request('req_applied', 'applied'), null);
		expect((await requests.findById(id('req_pending')))?.status).toBe('pending');
		expect(await requests.findById(id('nothing'))).toBeNull();
		expect((await requests.findByRequestKey(`rk_${RUN}`))?.id).toBe(id('req_pending'));
		expect(await requests.findByRequestKey(`none_${RUN}`)).toBeNull();
		expect(
			(await requests.list({ status: 'pending', q: `ITPX-${RUN}`, page: 1, pageSize: 10 })).items.map(
				(row) => row.id,
			),
		).toEqual([id('req_pending')]);
		expect((await requests.list({ status: 'approved', q: `ITPX-${RUN}`, page: 1, pageSize: 10 })).total).toBe(1);
		expect(await requests.pendingCount()).toBeGreaterThanOrEqual(1);
		expect((await requests.unseenDecisions(id('staff'))).map((row) => row.id).sort()).toEqual(
			[id('req_applied'), id('req_rejected')].sort(),
		);
		await requests.markSeen(id('staff'), [id('req_applied'), id('req_rejected')]);
		expect(await requests.unseenDecisions(id('staff'))).toEqual([]);
	});

	it('records opening stock once per request key and lists it', async () => {
		await opening.save({
			id: id('open'),
			number: `ITOS/${RUN}`,
			requestKey: `os_${RUN}`,
			postedAt: at,
			lines: [],
		} as never);
		expect((await opening.findByRequestKey(`os_${RUN}`))?.id).toBe(id('open'));
		expect((await opening.list()).map((row) => row.id)).toContain(id('open'));
	});

	it('saves stock counts, lists them by stage, and reads the last count’s differences', async () => {
		await counts.save(
			{
				id: id('count'),
				number: `ITSC/${RUN}`,
				status: 'posted',
				startedAt: '2099-01-01T00:00:00.000Z',
				postedAt: '2099-01-02T00:00:00.000Z',
				lines: [
					{ variantId: id('var'), difference: -1 },
					{ variantId: id('same'), difference: 0 },
					{ variantId: id('blank'), difference: null },
				],
				createdAt: at,
				updatedAt: at,
				updatedBy: null,
			} as never,
			null,
		);
		expect((await counts.findById(id('count')))?.status).toBe('posted');
		const posted = await counts.list({ filter: 'posted', page: 1, pageSize: 1 });
		expect(posted.items[0]).toMatchObject({ id: id('count'), lines: [] });
		expect(posted.counts.posted).toBeGreaterThanOrEqual(1);
		expect((await counts.list({ filter: 'unknown', page: 1, pageSize: 1 })).total).toBeGreaterThanOrEqual(1);
		expect(await counts.lastDifferences()).toEqual([id('var')]);
	});

	it('peeks at the next number without taking it, and reads the stock settings', async () => {
		expect(await allocator.peek(`${P}series`, '2026-27')).toBe(1);
		await allocator.next(`${P}series`, '2026-27');
		expect(await allocator.peek(`${P}series`, '2026-27')).toBe(2);
		expect(await settings.get()).toBeDefined();
	});

	it('reads stock facts by product, SKU and category, with the first category’s name', async () => {
		const ofProduct = await stock.variantsOfProduct(id('prod'));
		expect(ofProduct.map((fact) => fact.variantId)).toEqual([id('var')]);
		expect(ofProduct[0]?.categoryName).toBe('Silk');
		expect([...(await stock.bySku([`ITPX-${RUN}-V`])).keys()]).toEqual([`ITPX-${RUN}-V`]);
		expect(await stock.bySku([])).toEqual(new Map());
		expect(await stock.productSkusInCategory(id('cat'))).toEqual([`ITPX-${RUN}`]);
		expect(await stock.variantIdsInScope({ kind: 'categories', categoryIds: [id('cat')] })).toEqual([id('var')]);
		expect(await stock.withMovements([id('var')])).toEqual(new Set([id('var')]));
		expect(await stock.variantsWithLayersBefore('2000-01-01T00:00:00.000Z', 1, 10)).toEqual({
			variantIds: [],
			total: 0,
		});
	});

	it('lists stock by search and category, totals it, and reads layers and sales of an item', async () => {
		const listed = await stock.list({
			q: `Integration Tussar ${RUN}`,
			categoryId: id('cat'),
			olderThan: new Date().toISOString(),
			filter: 'all',
			page: 1,
			pageSize: 10,
		} as never);
		expect(listed.items.map((row) => row.variantId)).toEqual([id('var')]);
		expect(await stock.totals()).toBeDefined();
		expect(await stock.layersOf(id('var'))).toEqual([]);
		expect(await stock.openLayers([id('var')])).toEqual([]);
		expect(await stock.layersForEntry(id('nothing'))).toEqual([]);
		expect(await stock.soldSince([id('var')], '2000-01-01T00:00:00.000Z')).toEqual(new Map());
		expect(await stock.soldSince(null, '2999-01-01T00:00:00.000Z')).toEqual(new Map());
	});
});
