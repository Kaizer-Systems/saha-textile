import { randomUUID } from 'node:crypto';

import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import {
	AdminUser,
	PERMISSION_CODES,
	type PurchaseEntry,
	type PurchaseEntryWrite,
	type ShopDetailsWrite,
	type StockAdjustmentWrite,
	type SupplierWrite,
} from '@saha-textile/contracts';
import {
	AttributeDefinitionModel,
	CategoryModel,
	MongoAdjustmentRequestRepository,
	MongoAdminUserRepository,
	MongoAdminUserRoleAssignmentRepository,
	MongoAuditLogRepository,
	MongoInventoryCostLayerRepository,
	MongoInventoryRepository,
	MongoInventorySettingsRepository,
	MongoMediaAssetRepository,
	MongoNumberAllocator,
	MongoOpeningStockRepository,
	MongoProductRepository,
	MongoProductVariantRepository,
	MongoPurchaseEntryRepository,
	MongoPurchaseOrderRepository,
	MongoPurchaseReturnRepository,
	MongoRoleRepository,
	MongoShopDetailsRepository,
	MongoStockCountRepository,
	MongoStockHoldRepository,
	MongoStockMovement,
	MongoStockReadRepository,
	MongoSupplierItemCodeRepository,
	MongoSupplierPaymentRepository,
	MongoSupplierRepository,
	MongoTransactionManager,
	ProductModel,
	ProductVariantModel,
	buildMongoConfig,
	connectMongo,
	disconnectMongo,
	getMongoose,
} from '@saha-textile/adapters-db-mongo';
import { gstinCheckCharacter } from '@saha-textile/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { AuthenticatedPrincipal } from '../src/auth/session.guard';
import { InventorySettingsService } from '../src/purchasing/inventory-settings.service';
import { OpeningStockService } from '../src/purchasing/opening-stock.service';
import { PurchaseEntriesService } from '../src/purchasing/purchase-entries.service';
import { PurchaseEntryBuilder, warningKey } from '../src/purchasing/purchase-entry-builder';
import { PurchaseItemsService } from '../src/purchasing/purchase-items.service';
import { PurchaseOrderDocument } from '../src/purchasing/purchase-order-document';
import { PurchaseOrdersService } from '../src/purchasing/purchase-orders.service';
import { PurchaseReturnsService } from '../src/purchasing/purchase-returns.service';
import { PurchasingSupport } from '../src/purchasing/purchasing-support';
import { ShopDetailsService } from '../src/purchasing/shop-details.service';
import { StockApprovalsService } from '../src/purchasing/stock-approvals.service';
import { StockCountsService } from '../src/purchasing/stock-counts.service';
import { StockWriter } from '../src/purchasing/stock-writer';
import { StockService } from '../src/purchasing/stock.service';
import { SuppliersService } from '../src/purchasing/suppliers.service';

/**
 * Purchases and stock end to end, on a database of its own (dropped afterwards): the services
 * wired to the real Mongo repositories, because posting, returns, write-offs and counts are only
 * right if their transactions, guards and request keys hold on the real thing.
 *
 *   MONGODB_PORT=27018 RUN_DB_IT=1 pnpm --filter @saha-textile/api test -- purchasing-flow
 */
process.env.MONGODB_DB_NAME = 'saha_textile_it_purchasing_flow';

function hasMongoEnv(): boolean {
	if (process.env.RUN_DB_IT !== '1') return false;
	try {
		buildMongoConfig();
		return true;
	} catch {
		return false;
	}
}

const OWNER = 'adm_owner_it';
const STAFF = 'adm_rina_it';
const principal = (userId: string, permissions: readonly string[]): AuthenticatedPrincipal => ({
	userId,
	sessionId: `ses_${userId}`,
	audience: 'admin',
	role: 'admin',
	permissions: [...permissions],
});
const owner = principal(OWNER, PERMISSION_CODES);
/** Godown staff: counts, checks goods, asks for write-offs; cannot approve or see cost (brief X01). */
const staff = principal(STAFF, [
	'purchase.index',
	'purchase.create',
	'purchase.check',
	'stock.index',
	'stock.adjust',
	'stock.hold',
	'stock_count.count',
	'purchase_return.index',
]);

const gstin = (state: string, pan: string, entity = '1') => {
	const first14 = `${state}${pan}${entity}Z`;
	return first14 + gstinCheckCharacter(first14);
};

const refusalCode = async (work: Promise<unknown>): Promise<string> => {
	try {
		await work;
	} catch (error) {
		if (
			error instanceof BadRequestException ||
			error instanceof ConflictException ||
			error instanceof ForbiddenException
		) {
			const body = error.getResponse() as { issues?: Array<{ code?: string }> };
			return body.issues?.[0]?.code ?? 'refused';
		}
		throw error;
	}
	throw new Error('expected a refusal, but it went through');
};

describe.skipIf(!hasMongoEnv())('purchases and stock, end to end (rs0)', () => {
	const repos = {
		suppliers: new MongoSupplierRepository(),
		itemCodes: new MongoSupplierItemCodeRepository(),
		orders: new MongoPurchaseOrderRepository(),
		entries: new MongoPurchaseEntryRepository(),
		payments: new MongoSupplierPaymentRepository(),
		returns: new MongoPurchaseReturnRepository(),
		holds: new MongoStockHoldRepository(),
		requests: new MongoAdjustmentRequestRepository(),
		counts: new MongoStockCountRepository(),
		opening: new MongoOpeningStockRepository(),
		numbers: new MongoNumberAllocator(),
		settings: new MongoInventorySettingsRepository(),
		movement: new MongoStockMovement(),
		read: new MongoStockReadRepository(),
		layers: new MongoInventoryCostLayerRepository(),
		products: new MongoProductRepository(),
		variants: new MongoProductVariantRepository(),
	};
	const storage = { getUrl: (key: string) => `https://cdn.example.test/${key}` } as never;
	const roleRepository = new MongoRoleRepository();
	const assignmentRepository = new MongoAdminUserRoleAssignmentRepository();
	const support = new PurchasingSupport(
		repos.settings,
		new MongoAdminUserRepository(),
		new MongoAuditLogRepository(),
		new MongoMediaAssetRepository(),
		storage,
		new MongoTransactionManager(),
		roleRepository,
		assignmentRepository,
		new MongoShopDetailsRepository(),
	);
	const outbox = { request: async () => undefined } as never;
	const categories = {
		findById: async (id: string) => {
			const doc = await CategoryModel.findById(id).lean().exec();
			return doc
				? { id: doc._id, hsnCode: (doc as { hsnCode?: string }).hsnCode ?? null, returnable: true }
				: null;
		},
	} as never;
	const suppliers = new SuppliersService(
		repos.suppliers,
		repos.itemCodes,
		repos.entries,
		repos.payments,
		repos.returns,
		support,
		{ forSupplier: async () => [] },
		{ forSupplier: async () => [] },
	);
	const items = new PurchaseItemsService(
		repos.read,
		repos.entries,
		repos.itemCodes,
		repos.products,
		repos.variants,
		categories,
		support,
		outbox,
	);
	// The books are tested on their own (books-posting.test.ts); this flow is about purchases and stock.
	const noBooks = {
		purchaseEntryPosted: async () => null,
		purchaseEntryVoided: async () => null,
		supplierPaid: async () => null,
		supplierPaymentReversed: async () => null,
		purchaseReturnSent: async () => null,
		purchaseReturnSettled: async () => null,
	} as never;
	const builder = new PurchaseEntryBuilder(repos.suppliers, repos.orders, repos.entries, repos.read, support);
	const entries = new PurchaseEntriesService(
		repos.entries,
		repos.orders,
		repos.returns,
		repos.payments,
		repos.itemCodes,
		repos.read,
		repos.movement,
		repos.layers,
		repos.numbers,
		repos.products,
		builder,
		support,
		noBooks,
		outbox,
	);
	const orders = new PurchaseOrdersService(
		repos.orders,
		repos.entries,
		repos.suppliers,
		repos.itemCodes,
		repos.read,
		repos.numbers,
		new PurchaseOrderDocument(null),
		support,
		null,
		null,
		null,
	);
	const returns = new PurchaseReturnsService(
		repos.returns,
		repos.entries,
		repos.read,
		repos.holds,
		repos.movement,
		repos.numbers,
		support,
		noBooks,
		outbox,
	);
	const writer = new StockWriter(repos.read, repos.movement, repos.layers, repos.holds, outbox);
	const stock = new StockService(
		repos.read,
		repos.holds,
		repos.requests,
		repos.entries,
		repos.orders,
		writer,
		support,
	);
	const counts = new StockCountsService(repos.counts, repos.read, repos.requests, repos.numbers, writer, support);
	const approvals = new StockApprovalsService(repos.requests, writer, counts, support);
	const opening = new OpeningStockService(
		repos.read,
		repos.opening,
		repos.layers,
		repos.movement,
		repos.numbers,
		writer,
		support,
	);
	const settingsService = new InventorySettingsService(repos.settings, support);
	const shop = new ShopDetailsService(
		new MongoShopDetailsRepository(),
		repos.suppliers,
		new PurchaseOrderDocument(null),
		support,
	);
	const inventory = new MongoInventoryRepository();

	const today = support.today();
	const ids = {
		banarasi: 'prd_it_banarasi',
		red: 'var_it_ban_red',
		gold: 'var_it_ban_gold',
		tant: 'prd_it_tant',
		tantBw: 'var_it_tant_bw',
		fabric: 'prd_it_fabric',
		fabricVar: 'var_it_fabric',
		bundle: 'prd_it_bundle',
		bundleVar: 'var_it_bundle',
		gone: 'prd_it_gone',
		goneVar: 'var_it_gone',
		category: 'cat_it_banarasi',
	};

	const variantDoc = (id: string, productId: string, sku: string, price: number, term = 'base') => ({
		_id: id,
		productId,
		sku,
		status: 'live',
		optionSelections: [{ attributeCode: term === 'base' ? 'base' : 'colour', termCode: term }],
		optionSelectionHash: `h_${id}`,
		isBaseVariant: term === 'base',
		priceINR: price,
		compareAtPriceINR: null,
		salePriceINR: null,
		stock: { tracked: true, quantity: 0, held: 0, lowStockThreshold: null, allowBackorder: false },
	});

	beforeAll(async () => {
		await connectMongo();
		const db = getMongoose().connection.db;
		if (!db) throw new Error('no database');
		await db.dropDatabase();
		await Promise.all(Object.values(getMongoose().models).map((model) => model.syncIndexes()));
		await new MongoAdminUserRepository().save(
			AdminUser.parse({
				id: OWNER,
				email: 'owner@example.test',
				displayName: 'Moulik',
				role: 'admin',
				status: 'active',
			}),
		);
		await new MongoAdminUserRepository().save(
			AdminUser.parse({
				id: STAFF,
				email: 'rina@example.test',
				displayName: 'Rina',
				role: 'staff',
				status: 'active',
			}),
		);
		await CategoryModel.collection.insertOne({
			_id: ids.category as never,
			name: { en: 'Banarasi' },
			slug: 'banarasi-it',
			parentId: null,
			path: [ids.category],
			ancestors: [],
			depth: 0,
			isBannerCollection: false,
			displayOrder: 0,
			hsnCode: '5007',
			returnable: true,
		});
		await ProductModel.collection.insertMany([
			{
				_id: ids.banarasi as never,
				type: 'variable',
				sku: 'ST-BAN-0412',
				title: { en: 'Red Banarasi Katan Silk Saree' },
				slug: 'it-banarasi',
				status: 'live',
				basePriceINR: 15_500,
				categoryIds: [ids.category],
				hsnCode: '5007',
			},
			{
				_id: ids.tant as never,
				type: 'simple',
				sku: 'ST-TNT-1108',
				title: { en: 'Shantipur Tant Cotton Saree' },
				slug: 'it-tant',
				status: 'live',
				basePriceINR: 1_890,
				categoryIds: [ids.category],
				hsnCode: '5208',
			},
			{
				_id: ids.fabric as never,
				type: 'simple',
				sku: 'ST-FAB-0007',
				title: { en: 'Mulmul Cotton Fabric' },
				slug: 'it-fabric',
				status: 'live',
				basePriceINR: 260,
				soldBy: 'metre',
				categoryIds: [],
				hsnCode: '5208',
			},
			{
				_id: ids.bundle as never,
				type: 'bundle',
				sku: 'ST-BND-0001',
				title: { en: 'Festive Bundle' },
				slug: 'it-bundle',
				status: 'live',
				basePriceINR: 9_000,
				categoryIds: [],
			},
			{
				_id: ids.gone as never,
				type: 'simple',
				sku: 'ST-OLD-0001',
				title: { en: 'Old Saree' },
				slug: 'it-gone',
				status: 'discontinued',
				basePriceINR: 900,
				categoryIds: [],
			},
		]);
		await ProductVariantModel.collection.insertMany([
			variantDoc(ids.red, ids.banarasi, 'ST-BAN-0412-RD', 15_500, 'red'),
			variantDoc(ids.gold, ids.banarasi, 'ST-BAN-0412-GD', 15_500, 'gold'),
			variantDoc(ids.tantBw, ids.tant, 'ST-TNT-1108-BW', 1_890),
			variantDoc(ids.fabricVar, ids.fabric, 'ST-FAB-0007', 260),
			variantDoc(ids.bundleVar, ids.bundle, 'ST-BND-0001', 9_000),
			variantDoc(ids.goneVar, ids.gone, 'ST-OLD-0001', 900),
		] as never[]);
		await AttributeDefinitionModel.collection.insertOne({
			_id: 'attr_it_colour' as never,
			code: 'colour',
			label: { en: 'Colour' },
			terms: [
				{ code: 'red', label: { en: 'Red' } },
				{ code: 'gold', label: { en: 'Gold' } },
			],
		});
	});

	afterAll(async () => {
		await getMongoose().connection.db?.dropDatabase();
		await disconnectMongo();
	});

	const supplierWrite = (overrides: Partial<SupplierWrite> = {}): SupplierWrite => ({
		legalName: 'Banaras Silk Weavers Co-op',
		shortName: 'BSW',
		kind: 'regular',
		gstin: gstin('09', 'AAACB1234B'),
		pan: null,
		stateCode: '09',
		address: { line: 'Madanpura', city: 'Varanasi', pin: '221001' },
		contactName: null,
		phone: null,
		email: 'orders@bsw.example.test',
		paymentTermsDays: 30,
		usesItemCodes: true,
		notes: null,
		active: true,
		...overrides,
	});

	let banaras = '';
	let shantipur = '';
	let composition = '';

	describe('suppliers (s01–s03)', () => {
		it('works out the tax from the GSTIN and refuses the same GSTIN twice', async () => {
			const bsw = await suppliers.create(supplierWrite(), OWNER);
			expect(bsw.taxType).toBe('inter_state');
			banaras = bsw.id;
			const stg = await suppliers.create(
				supplierWrite({
					legalName: 'Shantipur Tant Ghar',
					gstin: gstin('19', 'AAHFS7782K'),
					stateCode: '19',
					paymentTermsDays: 15,
				}),
				OWNER,
			);
			expect(stg.taxType).toBe('intra_state');
			shantipur = stg.id;
			const comp = await suppliers.create(
				supplierWrite({
					legalName: 'Bhagalpur Tussar Udyog',
					kind: 'composition',
					gstin: gstin('10', 'AAAFB9999C'),
					stateCode: '10',
				}),
				OWNER,
			);
			expect(comp.taxType).toBe('none');
			composition = comp.id;
			expect(await refusalCode(suppliers.create(supplierWrite({ legalName: 'Copy' }), OWNER))).toBe(
				'gstin_taken',
			);
		});

		it('names the right last character for a wrong GSTIN and shows a branch with the same PAN', async () => {
			const good = gstin('27', 'AAACB1234B');
			const wrong = good.slice(0, 14) + (good.endsWith('0') ? '1' : '0');
			expect((await suppliers.checkGstin(wrong, null)).expectedLastCharacter).toBe(good[14]);
			const branch = await suppliers.checkGstin(good, null);
			expect(branch.problem).toBeNull();
			expect(branch.samePan.map((row) => row.id)).toContain(banaras);
		});
	});

	const lineOf = (
		variantId: string,
		quantity: number,
		unitPriceINR: number,
		extra: Partial<PurchaseEntryWrite['lines'][number]> = {},
	) => ({
		variantId,
		quantity,
		unitPriceINR,
		freeOnBill: false,
		hsnOnBill: null,
		gstRatePct: 5,
		supplierItemCode: null,
		purchaseOrderLineId: null,
		...extra,
	});
	const entryWrite = (overrides: Partial<PurchaseEntryWrite> = {}): PurchaseEntryWrite => ({
		supplierId: banaras,
		purchaseOrderId: null,
		billNumber: 'BSW/2026-27/0418',
		billDate: today,
		goodsReceivedOn: today,
		pricesIncludeGst: false,
		freightINR: 1_800,
		freightGstRatePct: 5,
		roundOffINR: 0,
		printedTotalINR: null,
		billAttachmentAssetId: null,
		lines: [lineOf(ids.red, 6, 8_600), lineOf(ids.gold, 4, 9_000, { supplierItemCode: 'BSW-G-77' })],
		...overrides,
	});

	let first: PurchaseEntry;

	describe('purchase entry: draft to posted (p02–p09)', () => {
		it('saves a draft with IGST, freight shared by value, and refuses the same bill typed differently', async () => {
			first = await entries.create(entryWrite(), owner);
			expect(first.status).toBe('draft');
			expect(first.totals.taxableINR).toBe(6 * 8_600 + 4 * 9_000 + 1_800);
			expect(first.totals.igstINR).toBe(Math.round((6 * 8_600 + 4 * 9_000 + 1_800) * 0.05 * 100) / 100);
			expect(first.lines.reduce((sum, line) => sum + line.freightShareINR, 0)).toBe(1_800);
			expect(await refusalCode(entries.create(entryWrite({ billNumber: 'bsw 2026 27 0418' }), owner))).toBe(
				'duplicate_bill',
			);
		});

		it('blocks the goods check until the printed total matches within ₹1', async () => {
			expect(await refusalCode(entries.checkGoods(first.id, { lines: [] }, owner))).toBe('printed_total_missing');
			first = await entries.update(
				first.id,
				{ ...entryWrite({ printedTotalINR: first.totals.totalINR + 5 }), version: first.version },
				owner,
			);
			expect(await refusalCode(entries.checkGoods(first.id, { lines: [] }, owner))).toBe('total_mismatch');
			first = await entries.update(
				first.id,
				{ ...entryWrite({ printedTotalINR: first.totals.totalINR + 0.6 }), version: first.version },
				owner,
			);
			expect(first.totals.matchesPrinted).toBe(true);
		});

		it('refuses a stale save and names who saved first', async () => {
			const stale = first.version - 1;
			const code = await refusalCode(
				entries.update(
					first.id,
					{ ...entryWrite({ printedTotalINR: first.totals.printedTotalINR }), version: stale },
					staff,
				),
			);
			expect(code).toBe('stale_version');
		});

		it('refuses bundles and discontinued items, and future goods dates', async () => {
			expect(
				await refusalCode(
					entries.create(entryWrite({ billNumber: 'B-X1', lines: [lineOf(ids.bundleVar, 1, 100)] }), owner),
				),
			).toBe('blocked_product');
			expect(
				await refusalCode(
					entries.create(entryWrite({ billNumber: 'B-X2', lines: [lineOf(ids.goneVar, 1, 100)] }), owner),
				),
			).toBe('blocked_product');
			const tomorrow = new Date(Date.parse(`${today}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
			expect(
				await refusalCode(entries.create(entryWrite({ billNumber: 'B-X3', goodsReceivedOn: tomorrow }), owner)),
			).toBe('received_in_future');
		});

		it('checks goods: the three counts must add up and damage needs a reason', async () => {
			const [red, gold] = first.lines;
			if (!red || !gold) throw new Error('lines');
			expect(
				await refusalCode(
					entries.checkGoods(
						first.id,
						{
							lines: [
								{
									lineId: red.lineId,
									accepted: 5,
									damaged: 0,
									missing: 0,
									damageReason: null,
									damageNote: null,
									damagePhotoAssetIds: [],
								},
								{
									lineId: gold.lineId,
									accepted: 4,
									damaged: 0,
									missing: 0,
									damageReason: null,
									damageNote: null,
									damagePhotoAssetIds: [],
								},
							],
						},
						staff,
					),
				),
			).toBe('goods_check_sum');
			expect(
				await refusalCode(
					entries.checkGoods(
						first.id,
						{
							lines: [
								{
									lineId: red.lineId,
									accepted: 5,
									damaged: 1,
									missing: 0,
									damageReason: null,
									damageNote: null,
									damagePhotoAssetIds: [],
								},
								{
									lineId: gold.lineId,
									accepted: 4,
									damaged: 0,
									missing: 0,
									damageReason: null,
									damageNote: null,
									damagePhotoAssetIds: [],
								},
							],
						},
						staff,
					),
				),
			).toBe('goods_check_reason');
			first = await entries.checkGoods(
				first.id,
				{
					lines: [
						{
							lineId: red.lineId,
							accepted: 5,
							damaged: 1,
							missing: 0,
							damageReason: 'damaged_on_arrival',
							damageNote: 'Zari pulled',
							damagePhotoAssetIds: [],
						},
						{
							lineId: gold.lineId,
							accepted: 3,
							damaged: 0,
							missing: 1,
							damageReason: null,
							damageNote: null,
							damagePhotoAssetIds: [],
						},
					],
				},
				staff,
			);
			expect(first.status).toBe('checked');
		});

		it('posts only when every current warning was accepted; then once per request key', async () => {
			const preview = await entries.postPreview(first.id, owner);
			expect(preview.numberPreview).toMatch(/^PE\/\d{2}-\d{2}\/000001$/);
			const keys = preview.warnings.map(warningKey);
			if (keys.length) {
				expect(
					await refusalCode(
						entries.post(first.id, { acceptWarningCodes: [], requestKey: 'post-key-0001' }, owner),
					),
				).toBe('warnings_changed');
			}
			const posted = await entries.post(
				first.id,
				{ acceptWarningCodes: keys, requestKey: 'post-key-0002' },
				owner,
			);
			expect(posted.status).toBe('posted');
			expect(posted.number).toBe(preview.numberPreview);
			const again = await entries.post(
				first.id,
				{ acceptWarningCodes: keys, requestKey: 'post-key-0002' },
				owner,
			);
			expect(again.number).toBe(posted.number);
			first = posted;

			// Good pieces only: damaged and missing stay out of stock.
			const facts = await repos.read.items([ids.red, ids.gold]);
			expect(facts.get(ids.red)?.onHand).toBe(5);
			expect(facts.get(ids.gold)?.onHand).toBe(3);
			const layers = await repos.read.layersForEntry(first.id);
			expect(layers.map((layer) => layer.quantityReceived).sort()).toEqual([3, 5]);
			// The goods check made a return draft for the damaged saree and a claim for the missing one.
			const drafts = await returns.forEntry(first.id);
			expect(drafts.map((doc) => doc.kind).sort()).toEqual(['return_goods', 'short_supply']);
			// Their own item code was learnt.
			expect(await repos.itemCodes.findVariant(banaras, 'bsw-g-77')).toBe(ids.gold);
		});

		it('hides cost and margin from people without stock.cost', async () => {
			const seen = await entries.get(first.id, staff);
			expect(seen.lines.every((line) => line.unitCostINR === null && line.marginPct === null)).toBe(true);
			expect(seen.totals.costIntoStockINR).toBeNull();
			const ownerView = await entries.get(first.id, owner);
			expect(ownerView.lines.every((line) => typeof line.unitCostINR === 'number')).toBe(true);
		});
	});

	describe('finding items, importing a sheet, and a new design from the bill (p03, p05, p13)', () => {
		it("finds an item by the supplier's own code first", async () => {
			const found = await items.search({ q: 'BSW-G-77', supplierId: banaras, limit: 8 });
			expect(found[0]?.variantId).toBe(ids.gold);
			expect(found[0]?.supplierItemCode).toBe('BSW-G-77');
			expect(found[0]?.lastEntryNumber).toBe(first.number);
		});

		it('sorts a supplier sheet into ready, needs a product and problems', async () => {
			const result = await items.importRows({
				supplierId: banaras,
				rows: [
					{ row: 1, code: 'ST-BAN-0412-RD', quantity: 2, unitPriceINR: 8_600, hsn: '5007', gstRatePct: 5 },
					{ row: 2, code: 'BSW-G-77', quantity: 1, unitPriceINR: 9_000, hsn: '', gstRatePct: null },
					{ row: 3, code: 'BSW-NEW-1', quantity: 1, unitPriceINR: 5_000, hsn: '', gstRatePct: null },
					{ row: 4, code: 'ST-TNT-1108-BW', quantity: 0, unitPriceINR: 1_050, hsn: '', gstRatePct: null },
					{ row: 5, code: 'ST-FAB-0007', quantity: 2.55, unitPriceINR: 180, hsn: '', gstRatePct: null },
					{ row: 6, code: 'ST-BND-0001', quantity: 1, unitPriceINR: 100, hsn: '', gstRatePct: null },
				],
			});
			expect(result.rows.map((row) => [row.result, row.problem])).toEqual([
				['ready', null],
				['ready', null],
				['needs_product', null],
				['problem', 'quantity_below_one'],
				['problem', 'quantity_below_one'],
				['problem', 'blocked_product'],
			]);
			expect(result.counts).toEqual({ ready: 2, needsProduct: 1, problems: 3 });
		});

		it('makes a draft product with the next SKU and the category HSN', async () => {
			const defaults = await items.draftProductDefaults(ids.category);
			expect(defaults.hsnCode).toBe('5007');
			const made = await items.createDraftProduct(
				{
					name: 'Gold Tissue Banarasi Saree',
					categoryId: ids.category,
					sellingPriceINR: 15_500,
					mrpINR: 16_500,
					supplierId: banaras,
					supplierItemCode: 'BSW-T-031',
					soldBy: 'piece',
					skuPrefix: 'ST-BAN-',
				},
				OWNER,
			);
			expect(made?.sku).toBe('ST-BAN-0413');
			expect(made?.status).toBe('draft');
			expect(made?.hsnCode).toBe('5007');
			expect(await repos.itemCodes.findVariant(banaras, 'BSW-T-031')).toBe(made?.variantId);
			expect(
				await refusalCode(
					items.createDraftProduct(
						{
							name: 'Cheap',
							categoryId: ids.category,
							sellingPriceINR: 900,
							mrpINR: 800,
							soldBy: 'piece',
							skuPrefix: 'ST-BAN-',
							supplierItemCode: null,
						},
						OWNER,
					),
				),
			).toBe('mrp_below_selling');
		});
	});

	describe('payments (p11)', () => {
		it('takes part payments, refuses more than is left, and reverses with a reason', async () => {
			const total = first.totals.totalINR;
			expect(
				await refusalCode(
					entries.recordPayment(
						first.id,
						{ amountINR: total + 1, paidOn: today, mode: 'upi', reference: null, proofAssetId: null },
						OWNER,
					),
				),
			).toBe('overpayment');
			let paid = await entries.recordPayment(
				first.id,
				{ amountINR: 50_000, paidOn: today, mode: 'bank_transfer', reference: 'UTR1', proofAssetId: null },
				OWNER,
			);
			expect(paid.paymentStatus).toBe('part_paid');
			const [payment] = await entries.paymentsFor(first.id);
			if (!payment) throw new Error('payment');
			paid = await entries.reversePayment(first.id, payment.id, 'Bounced cheque', OWNER);
			expect(paid.paymentStatus).toBe('unpaid');
			expect(paid.paidINR).toBe(0);
			first = paid;
		});
	});

	describe('purchase returns (r01–r04)', () => {
		it('caps a return by what is free, naming held pieces, then sends and settles in parts', async () => {
			const red = first.lines.find((line) => line.variantId === ids.red);
			if (!red) throw new Error('red line');
			// Hold 3 of the 5 red sarees for a photoshoot: only 2 are free to return.
			await stock.adjust(
				{
					variantId: ids.red,
					action: 'hold',
					quantity: 3,
					reasonCode: null,
					holdReason: 'photoshoot',
					holdId: null,
					note: 'Catalogue shoot',
					photoAssetIds: [],
					requestKey: 'hold-key-0001',
				},
				owner,
			);
			const write = {
				purchaseEntryId: first.id,
				kind: 'return_goods' as const,
				reason: 'quality_after_accepting' as const,
				noteToSupplier: 'Stains',
				photoAssetIds: [],
				lines: [{ entryLineId: red.lineId, quantity: 3 }],
				holdId: null,
			};
			expect(await refusalCode(returns.create(write, OWNER))).toBe('return_capped');
			const draft = await returns.create({ ...write, lines: [{ entryLineId: red.lineId, quantity: 2 }] }, OWNER);
			const sent = await returns.send(
				draft.id,
				{ courier: 'DTDC', docket: 'D1', requestKey: 'send-key-0001' },
				OWNER,
			);
			expect(sent.number).toMatch(/^DN\//);
			expect(sent.challanNumber).toMatch(/^DC\//);
			expect(
				(await returns.send(draft.id, { courier: null, docket: null, requestKey: 'send-key-0001' }, OWNER))
					.number,
			).toBe(sent.number);
			expect((await repos.read.items([ids.red])).get(ids.red)?.onHand).toBe(3);
			// The bill now owes less; a part settlement leaves the rest open.
			const entry = await entries.get(first.id, owner);
			expect(entry.creditedINR).toBe(sent.totalINR);
			expect(
				await refusalCode(
					returns.settle(
						sent.id,
						{
							how: 'credit_note',
							reference: 'CN1',
							date: today,
							amountINR: sent.totalINR + 1,
							attachmentAssetId: null,
						},
						OWNER,
					),
				),
			).toBe('settle_too_much');
			const part = await returns.settle(
				sent.id,
				{ how: 'credit_note', reference: 'CN1', date: today, amountINR: 100, attachmentAssetId: null },
				OWNER,
			);
			expect(part.status).toBe('sent');
			const rest = await returns.settle(
				sent.id,
				{
					how: 'refund',
					reference: 'NEFT',
					date: today,
					amountINR: sent.totalINR - 100,
					attachmentAssetId: null,
				},
				OWNER,
			);
			expect(rest.status).toBe('settled');
			const summary = await suppliers.summary(banaras);
			expect(summary.statement.map((row) => row.kind)).toContain('refund_received');
			// Bill − debit note + refund of all but the ₹100 credit note; the bounced payment nets to nothing.
			expect(summary.statement.at(-1)?.balanceINR).toBe(Math.round((first.totals.totalINR - 100) * 100) / 100);
			expect(summary.owedINR).toBe(Math.round((first.totals.totalINR - 100) * 100) / 100);
		});

		it('refuses to void an entry once a return has been sent', async () => {
			expect(await refusalCode(entries.void(first.id, { reason: 'Wrong supplier' }, OWNER))).toBe(
				'void_stock_moved',
			);
		});
	});

	describe('voiding a clean entry (p12)', () => {
		it('takes every piece back out and frees the bill number', async () => {
			let entry = await entries.create(
				entryWrite({
					supplierId: shantipur,
					billNumber: 'STG/1187',
					freightINR: 0,
					lines: [lineOf(ids.tantBw, 10, 1_050)],
				}),
				owner,
			);
			entry = await entries.update(
				entry.id,
				{
					...entryWrite({
						supplierId: shantipur,
						billNumber: 'STG/1187',
						freightINR: 0,
						lines: [lineOf(ids.tantBw, 10, 1_050, { lineId: entry.lines[0]?.lineId })],
						printedTotalINR: entry.totals.totalINR,
					}),
					version: entry.version,
				},
				owner,
			);
			expect(entry.totals.cgstINR).toBe(entry.totals.sgstINR);
			const line = entry.lines[0];
			if (!line) throw new Error('line');
			entry = await entries.checkGoods(
				entry.id,
				{
					lines: [
						{
							lineId: line.lineId,
							accepted: 10,
							damaged: 0,
							missing: 0,
							damageReason: null,
							damageNote: null,
							damagePhotoAssetIds: [],
						},
					],
				},
				owner,
			);
			const preview = await entries.postPreview(entry.id, owner);
			entry = await entries.post(
				entry.id,
				{ acceptWarningCodes: preview.warnings.map(warningKey), requestKey: 'post-key-0003' },
				owner,
			);
			expect((await repos.read.items([ids.tantBw])).get(ids.tantBw)?.onHand).toBe(10);
			const voided = await entries.void(entry.id, { reason: 'Entered against the wrong supplier' }, OWNER);
			expect(voided.status).toBe('void');
			expect((await repos.read.items([ids.tantBw])).get(ids.tantBw)?.onHand).toBe(0);
			// The same bill can be entered again once the wrong one is void.
			const again = await entries.create(
				entryWrite({
					supplierId: shantipur,
					billNumber: 'STG/1187',
					freightINR: 0,
					lines: [lineOf(ids.tantBw, 10, 1_050)],
				}),
				owner,
			);
			expect(again.status).toBe('draft');
		});
	});

	describe('write-offs and approvals (i04–i05b, P2)', () => {
		const writeOff = (key: string, extra: Partial<StockAdjustmentWrite> = {}): StockAdjustmentWrite => ({
			variantId: ids.gold,
			action: 'remove',
			quantity: 1,
			reasonCode: 'damage',
			holdReason: null,
			holdId: null,
			note: 'Water came through the godown roof',
			photoAssetIds: [],
			requestKey: key,
			...extra,
		});

		it('turns a write-off by staff into a request; nobody approves their own; a rejection needs a reason', async () => {
			const asked = await stock.adjust(writeOff('wo-key-0001'), staff);
			expect(asked.outcome).toBe('requested');
			expect((await repos.read.items([ids.gold])).get(ids.gold)?.onHand).toBe(3);
			// Pressing Save again does not raise a second request.
			expect((await stock.adjust(writeOff('wo-key-0001'), staff)).request?.id).toBe(asked.request?.id);
			const rina = principal(STAFF, [...staff.permissions, 'stock.approve']);
			expect(await refusalCode(approvals.approve(asked.request?.id ?? '', rina))).toBe('own_request');
			expect(await refusalCode(approvals.reject(asked.request?.id ?? '', ' ', owner))).toBe('reason_required');
			const approved = await approvals.approve(asked.request?.id ?? '', owner);
			expect(approved.status).toBe('applied');
			expect((await repos.read.items([ids.gold])).get(ids.gold)?.onHand).toBe(2);
			// The requester sees the decision in the bell.
			expect((await stock.alerts(staff)).decisions.map((row) => row.id)).toContain(asked.request?.id);
		});

		it('lets an approver write off directly, valued at FIFO cost, and logs it as self-approved', async () => {
			const done = await stock.adjust(writeOff('wo-key-0002'), owner);
			expect(done.outcome).toBe('applied');
			expect(done.request?.selfApproved).toBe(true);
			expect(done.request?.valueAtCostINR).toBeGreaterThan(9_000);
		});

		it('never takes out held pieces by mistake, and writes off a held piece from its hold', async () => {
			const holds = await stock.holdsOf(ids.red);
			const hold = holds[0];
			if (!hold) throw new Error('hold');
			expect(
				await refusalCode(stock.adjust(writeOff('wo-key-0003', { variantId: ids.red, quantity: 1 }), owner)),
			).toBe('adjustment_refused');
			const done = await stock.adjust(
				writeOff('wo-key-0004', { variantId: ids.red, quantity: 1, holdId: hold.id }),
				owner,
			);
			expect(done.heldAfter).toBe(2);
			expect(done.onHandAfter).toBe(2);
		});
	});

	describe('fabric by the metre', () => {
		it('stores tenths of a metre and costs per metre', async () => {
			let entry = await entries.create(
				entryWrite({
					supplierId: composition,
					billNumber: 'BTU/0071',
					freightINR: 0,
					lines: [lineOf(ids.fabricVar, 425, 180, { gstRatePct: 0 })],
				}),
				owner,
			);
			// Composition supplier: no GST lines, the full price is the cost.
			expect(entry.totals.igstINR + entry.totals.cgstINR).toBe(0);
			expect(entry.totals.totalINR).toBe(42.5 * 180);
			entry = await entries.update(
				entry.id,
				{
					...entryWrite({
						supplierId: composition,
						billNumber: 'BTU/0071',
						freightINR: 0,
						printedTotalINR: 7_650,
						lines: [lineOf(ids.fabricVar, 425, 180, { gstRatePct: 0, lineId: entry.lines[0]?.lineId })],
					}),
					version: entry.version,
				},
				owner,
			);
			const line = entry.lines[0];
			if (!line) throw new Error('line');
			expect(line.unitCostINR).toBe(180);
			entry = await entries.checkGoods(
				entry.id,
				{
					lines: [
						{
							lineId: line.lineId,
							accepted: 425,
							damaged: 0,
							missing: 0,
							damageReason: null,
							damageNote: null,
							damagePhotoAssetIds: [],
						},
					],
				},
				owner,
			);
			const preview = await entries.postPreview(entry.id, owner);
			expect(preview.intoStock).toBe('42.5 m');
			await entries.post(
				entry.id,
				{ acceptWarningCodes: preview.warnings.map(warningKey), requestKey: 'post-key-0004' },
				owner,
			);
			expect((await repos.read.items([ids.fabricVar])).get(ids.fabricVar)?.onHand).toBe(425);
		});
	});

	describe('stock counts (c01–c03)', () => {
		it('adds back sales during the count and posts differences as count corrections', async () => {
			const count = await counts.start(
				{
					scope: { kind: 'skus', categoryIds: [], variantIds: [ids.gold, ids.fabricVar] },
					blind: true,
					counterIds: [],
					label: 'Test shelf',
				},
				OWNER,
			);
			expect(count.number).toMatch(/^SC\//);
			// A counter on a blind count sees no expected figures.
			const blindView = await counts.get(count.id, staff);
			expect(blindView.lines.every((line) => line.expected === null)).toBe(true);
			// A sale happens during the count.
			await inventory.applyDelta({
				variantId: ids.gold,
				productId: ids.banarasi,
				quantityDelta: -1,
				source: 'order_placed',
				reasonCode: null,
				note: null,
				referenceType: null,
				referenceId: null,
				actorUserId: null,
				createdAt: new Date().toISOString(),
			});
			// Two phones count different lines at the same moment; neither loses the other's figure.
			await Promise.all([
				counts.enter(count.id, { lines: [{ variantId: ids.gold, counted: 0, note: null }] }, staff),
				counts.enter(
					count.id,
					{ lines: [{ variantId: ids.fabricVar, counted: 420, note: 'Short roll' }] },
					staff,
				),
			]);
			await counts.finish(count.id, OWNER);
			const review = await counts.get(count.id, owner);
			const gold = review.lines.find((line) => line.variantId === ids.gold);
			const fabric = review.lines.find((line) => line.variantId === ids.fabricVar);
			expect(gold?.expected).toBe(0);
			expect(gold?.difference).toBe(0);
			expect(fabric?.difference).toBe(-5);
			// Staff without Approve write-offs: the count waits for approval.
			const waiting = await counts.post(count.id, principal(STAFF, [...staff.permissions, 'stock_count.post']));
			expect(waiting.status).toBe('awaiting_approval');
			const request = (await approvals.list({ status: 'pending', page: 1, pageSize: 10 }, owner)).items.find(
				(row) => row.countId === count.id,
			);
			await approvals.approve(request?.id ?? '', owner);
			expect((await repos.read.items([ids.fabricVar])).get(ids.fabricVar)?.onHand).toBe(420);
			expect((await counts.get(count.id, owner)).status).toBe('posted');
		});
	});

	describe('opening stock (o01)', () => {
		it('refuses rows that are not ready, posts once per SKU, and never twice for one key', async () => {
			await ProductVariantModel.collection.insertOne(
				variantDoc('var_it_new', ids.tant, 'ST-TNT-1108-NEW', 1_890) as never,
			);
			const checked = await opening.check([
				{ row: 1, sku: 'ST-TNT-1108-NEW', quantity: 4, unitCostINR: 1_000, receivedOn: null, note: '' },
				{ row: 2, sku: 'NOPE-1', quantity: 1, unitCostINR: 1, receivedOn: null, note: '' },
				{ row: 3, sku: 'ST-BAN-0412-GD', quantity: 1, unitCostINR: 1, receivedOn: null, note: '' },
				{ row: 4, sku: 'ST-TNT-1108-NEW', quantity: 1, unitCostINR: null, receivedOn: null, note: '' },
			]);
			expect(checked.rows.map((row) => row.result)).toEqual([
				'repeated',
				'unknown_sku',
				'already_has_stock',
				'repeated',
			]);
			expect(await refusalCode(opening.post(checked.rows, 'os-key-0001', OWNER))).toBe('rows_not_ready');
			const rows = [
				{ row: 1, sku: 'ST-TNT-1108-NEW', quantity: 4, unitCostINR: 1_000, receivedOn: null, note: '' },
			];
			const ready = await opening.check(rows);
			expect(ready.counts).toMatchObject({ ready: 1, readyPieces: 4, readyTenths: 0 });
			const load = await opening.post(rows, 'os-key-0002', OWNER);
			expect(load.number).toMatch(/^OS\//);
			expect(ready.nextNumber).toBe(load.number);
			expect((await opening.post(rows, 'os-key-0002', OWNER)).id).toBe(load.id);
			expect(await refusalCode(opening.post(rows, 'os-key-0003', OWNER))).toBe('rows_not_ready');
			const listed = await opening.list(false);
			expect(listed[0]).toMatchObject({ number: load.number, skus: 1, totalUnits: 4, totalValueINR: null });
			expect((await opening.list(true))[0]?.totalValueINR).toBe(4_000);
		});

		it('takes received dates before the books-closed day (they only age the pieces) but not after today', async () => {
			await ProductVariantModel.collection.insertOne(
				variantDoc('var_it_old', ids.tant, 'ST-TNT-1108-OLD', 1_890) as never,
			);
			const future = new Date(Date.parse(`${today}T12:00:00Z`) + 2 * 86_400_000).toISOString().slice(0, 10);
			const late = await opening.check([
				{ row: 2, sku: 'ST-TNT-1108-OLD', quantity: 2, unitCostINR: 900, receivedOn: future, note: '' },
			]);
			expect(late.rows[0]?.result).toBe('date_invalid');
			expect(late.counts.invalid).toBe(1);
			const current = await settingsService.get();
			const yesterday = new Date(Date.parse(`${today}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
			await settingsService.update({ ...current, booksClosedUpTo: yesterday }, OWNER, { superAdmin: true });
			try {
				const load = await opening.post(
					[
						{
							row: 2,
							sku: 'ST-TNT-1108-OLD',
							quantity: 2,
							unitCostINR: 900,
							receivedOn: '2026-03-14',
							note: '',
						},
					],
					'os-key-0004',
					OWNER,
				);
				expect(load.rows[0]?.receivedOn).toBe('2026-03-14');
				await settingsService.update({ ...current, booksClosedUpTo: today }, OWNER, { superAdmin: true });
				await ProductVariantModel.collection.insertOne(
					variantDoc('var_it_closed', ids.tant, 'ST-TNT-1108-CLO', 1_890) as never,
				);
				expect(
					await refusalCode(
						opening.post(
							[
								{
									row: 2,
									sku: 'ST-TNT-1108-CLO',
									quantity: 1,
									unitCostINR: 900,
									receivedOn: null,
									note: '',
								},
							],
							'os-key-0005',
							OWNER,
						),
					),
				).toBe('books_closed');
			} finally {
				await settingsService.update({ ...current, booksClosedUpTo: null }, OWNER, { superAdmin: true });
			}
		});
	});

	describe('settings and step rules (x02, P1, P9)', () => {
		it('lets only the super admin change the steps or the books-closed date, and narrows a step to one role', async () => {
			const current = await settingsService.get();
			expect(
				await refusalCode(
					settingsService.update({ ...current, booksClosedUpTo: today }, STAFF, { superAdmin: false }),
				),
			).toBe('super_admin_only');
			expect(
				await refusalCode(
					settingsService.update(
						{ ...current, stepRules: { ...current.stepRules, postByDifferentPerson: true } },
						STAFF,
					),
				),
			).toBe('super_admin_only');
			// The other figures stay open to anyone with setting.edit.
			const saved = await settingsService.update({ ...current, marginFloorPct: 25 }, STAFF);
			expect(saved.marginFloorPct).toBe(25);

			const now = new Date().toISOString();
			await roleRepository.create({
				id: 'rol_it_counter',
				key: 'it-counter',
				label: 'Counter only',
				description: null,
				baseRole: 'staff',
				permissions: ['purchase.index', 'purchase.check'],
				isSystem: false,
				createdAt: now,
				updatedAt: now,
			});
			await roleRepository.create({
				id: 'rol_it_poster',
				key: 'it-poster',
				label: 'Poster',
				description: null,
				baseRole: 'staff',
				permissions: ['purchase.index', 'purchase.create', 'purchase.post'],
				isSystem: false,
				createdAt: now,
				updatedAt: now,
			});
			expect(
				await refusalCode(
					settingsService.update(
						{ ...saved, stepRules: { ...saved.stepRules, postRoleId: 'rol_it_counter' } },
						OWNER,
						{ superAdmin: true },
					),
				),
			).toBe('role_lacks_permission');
			await settingsService.update(
				{ ...saved, stepRules: { ...saved.stepRules, draftRoleId: 'rol_it_poster' } },
				OWNER,
				{ superAdmin: true },
			);
			const view = await settingsService.view(true);
			expect(view.stepRoleLabels).toEqual({ rol_it_poster: 'Poster' });
			try {
				const staffMaker = principal(STAFF, ['purchase.index', 'purchase.create']);
				expect(await refusalCode(entries.create(entryWrite({ billNumber: 'ROLE-1' }), staffMaker))).toBe(
					'step_role',
				);
				await assignmentRepository.assign({
					id: 'ura_it_poster',
					userId: STAFF,
					roleId: 'rol_it_poster',
					assignedByUserId: OWNER,
					assignedAt: now,
					revokedAt: null,
					revokedByUserId: null,
					revokeReason: null,
				});
				const made = await entries.create(entryWrite({ billNumber: 'ROLE-2' }), staffMaker);
				expect(made.status).toBe('draft');
				await entries.remove(made.id, STAFF);
			} finally {
				await settingsService.update(
					{ ...current, stepRules: { ...current.stepRules, draftRoleId: null } },
					OWNER,
					{ superAdmin: true },
				);
			}
		});
	});

	describe('books closed (P9)', () => {
		it('refuses bills dated on or before the books-closed day', async () => {
			const current = await settingsService.get();
			await settingsService.update({ ...current, booksClosedUpTo: today }, OWNER, { superAdmin: true });
			expect(await refusalCode(entries.create(entryWrite({ billNumber: 'LATE-1' }), owner))).toBe('books_closed');
			await settingsService.update({ ...current, booksClosedUpTo: null }, OWNER, { superAdmin: true });
		});
	});

	describe('purchase orders (po01–po04b)', () => {
		it('numbers an order when made, fills a purchase entry with what is still to come, and refuses cancelling after receipt', async () => {
			const tomorrow = new Date(Date.parse(`${today}T12:00:00Z`) + 3 * 86_400_000).toISOString().slice(0, 10);
			const order = await orders.create(
				{
					supplierId: shantipur,
					expectedBy: tomorrow,
					deliverTo: 'Godown, Hazra Road',
					noteToSupplier: null,
					internalNote: null,
					lines: [
						{
							variantId: ids.tantBw,
							quantity: 10,
							agreedPriceINR: 1_050,
							gstRatePct: 5,
							supplierItemCode: null,
							backorderLineIds: [],
						},
					],
				},
				OWNER,
			);
			expect(order.number).toMatch(/^PO\//);
			const sent = await orders.send(order.id, { via: 'pdf', to: [], subject: '', message: '' }, OWNER);
			expect(sent.status).toBe('sent');
			const draft = await orders.receiveDraft(order.id);
			let entry = await entries.create(
				{ ...draft, billNumber: 'STG/1201', lines: draft.lines.map((line) => ({ ...line, quantity: 6 })) },
				owner,
			);
			entry = await entries.update(
				entry.id,
				{
					...PurchaseEntryBuilder.writeOf(entry),
					printedTotalINR: entry.totals.totalINR,
					version: entry.version,
				},
				owner,
			);
			const line = entry.lines[0];
			if (!line) throw new Error('line');
			entry = await entries.checkGoods(
				entry.id,
				{
					lines: [
						{
							lineId: line.lineId,
							accepted: 6,
							damaged: 0,
							missing: 0,
							damageReason: null,
							damageNote: null,
							damagePhotoAssetIds: [],
						},
					],
				},
				owner,
			);
			const preview = await entries.postPreview(entry.id, owner);
			await entries.post(
				entry.id,
				{ acceptWarningCodes: preview.warnings.map(warningKey), requestKey: 'post-key-0005' },
				owner,
			);
			const after = await orders.get(order.id);
			expect(after.status).toBe('part_received');
			expect(after.lines[0]?.receivedQuantity).toBe(6);
			expect(after.lines[0]?.receivedOn[0]?.quantity).toBe(6);
			expect(await refusalCode(orders.cancel(order.id, 'No longer needed', OWNER))).toBe('order_part_received');
			const closed = await orders.closeShort(order.id, 'Supplier out of yarn', OWNER);
			expect(closed.status).toBe('closed_short');
		});
	});

	describe('the shop sells only what is free (DEC: held pieces)', () => {
		it('keeps held pieces out of free to sell', async () => {
			const facts = (await repos.read.items([ids.red])).get(ids.red);
			expect(facts && facts.onHand - facts.held).toBe(0);
			const sale = {
				variantId: ids.red,
				productId: ids.banarasi,
				quantityDelta: -1,
				source: 'order_placed' as const,
				reasonCode: null,
				note: null,
				referenceType: null,
				referenceId: null,
				actorUserId: null,
				createdAt: new Date().toISOString(),
			};
			await expect(inventory.applyDelta(sale)).rejects.toThrow();
		});
	});

	it('keeps every step in the audit trail, in sentences', async () => {
		const trail = await entries.activity(first.id);
		expect(trail.map((row) => row.text).join('\n')).toMatch(
			/Moulik posted PE\/\d{2}-\d{2}\/000001 from Banaras Silk Weavers Co-op/,
		);
		expect(randomUUID()).toBeTruthy();
	});

	describe('shop details (R3-1)', () => {
		const shopWrite = (overrides: Partial<ShopDetailsWrite> = {}): ShopDetailsWrite => ({
			legalName: 'Saha Textile',
			tradeName: '',
			gstin: gstin('19', 'AAPFS4821K'),
			address: '14 Hazra Road, Kalighat',
			city: 'Kolkata',
			pin: '700026',
			phone: '+91 33 4000 0000',
			email: 'accounts@shop.example.test',
			expectedUpdatedAt: null,
			...overrides,
		});
		let saved = '';

		it('reads home State 19 and lists what is missing until the details are saved', async () => {
			const view = await shop.view(true);
			expect(view.homeStateCode).toBe('19');
			expect(view.homeStateName).toBe('West Bengal');
			expect(view.missing).toEqual(expect.arrayContaining(['gstin', 'city', 'pin']));
			expect((await shop.view(false)).canEdit).toBe(false);
		});

		it('refuses a change without Edit shop details and logs the attempt', async () => {
			expect(await refusalCode(shop.update(shopWrite(), STAFF, { canEdit: false }))).toBe(
				'shop_details_edit_only',
			);
			const trail = await support.activity('shop_details', ['shop']);
			expect(trail.map((row) => row.text).join('\n')).toMatch(/tried to change the shop details/);
		});

		it('refuses a GSTIN with a wrong check digit, naming the right last character', async () => {
			const right = gstin('19', 'AAPFS4821K');
			const wrong = right.slice(0, 14) + (right.endsWith('A') ? 'B' : 'A');
			expect(await refusalCode(shop.update(shopWrite({ gstin: wrong }), OWNER, { canEdit: true }))).toBe(
				'gstin_check_digit',
			);
			expect(await shop.impact(wrong)).toMatchObject({
				problem: 'check_digit',
				expectedLastCharacter: right.slice(-1),
				stateTo: null,
			});
			expect((await shop.impact('19AAPF')).problem).toBe('shape');
		});

		it('saves with old and new values in the audit log, then refuses a save over a newer copy', async () => {
			const first = await shop.update(shopWrite(), OWNER, { canEdit: true });
			saved = first.updatedAt ?? '';
			expect(saved).not.toBe('');
			const trail = (await support.activity('shop_details', ['shop'])).map((row) => row.text).join('\n');
			expect(trail).toMatch(
				/Moulik changed the shop's GSTIN from empty to "19AAPFS4821K1Z."; the shop's legal name/,
			);
			expect(trail).toMatch(/PIN code from empty to "700026".*State unchanged \(West Bengal\)\./);
			// A second editor still holding the empty page saves late: refused, naming who saved first.
			expect(await refusalCode(shop.update(shopWrite({ city: 'Howrah' }), STAFF, { canEdit: true }))).toBe(
				'stale_version',
			);
			const view = await shop.view(true);
			expect(view.city).toBe('Kolkata');
			expect(view.missing).toEqual([]);
			expect(view.pan).toBe('AAPFS4821K');
		});

		it('keeps the letterhead a purchase order was sent with when the details change', async () => {
			const later = new Date(Date.parse(`${today}T12:00:00Z`) + 5 * 86_400_000).toISOString().slice(0, 10);
			const order = await orders.create(
				{
					supplierId: shantipur,
					expectedBy: later,
					deliverTo: 'Godown, Hazra Road',
					noteToSupplier: null,
					internalNote: null,
					lines: [
						{
							variantId: ids.tantBw,
							quantity: 4,
							agreedPriceINR: 1_050,
							gstRatePct: 5,
							supplierItemCode: null,
							backorderLineIds: [],
						},
					],
				},
				OWNER,
			);
			expect(order.shopSnapshot).toBeNull();
			const sent = await orders.send(order.id, { via: 'pdf', to: [], subject: '', message: '' }, OWNER);
			expect(sent.shopSnapshot?.legalName).toBe('Saha Textile');
			const next = await shop.update(
				shopWrite({ legalName: 'Saha Textile Private Limited', expectedUpdatedAt: saved }),
				OWNER,
				{
					canEdit: true,
				},
			);
			saved = next.updatedAt ?? '';
			const reread = await orders.get(order.id);
			expect(reread.shopSnapshot?.legalName).toBe('Saha Textile');
			expect(reread.shopSnapshot?.addressLines).toEqual([
				'14 Hazra Road, Kalighat',
				'Kolkata, West Bengal 700026',
			]);
			const html = new PurchaseOrderDocument(null).html(reread, null, reread.shopSnapshot!, {
				hasLogo: false,
				shopName: 'Saha Textile',
				themeColor: null,
			});
			expect(html).toContain('<strong>Saha Textile</strong>');
			expect(html).not.toContain('Private Limited');
		});

		it('moves suppliers between CGST + SGST and IGST when the GSTIN moves the State, and back', async () => {
			const maharashtra = gstin('27', 'AAPFS4821K');
			const impact = await shop.impact(maharashtra);
			expect(impact.stateChanges).toBe(true);
			expect(impact.stateTo).toEqual({ code: '27', name: 'Maharashtra' });
			expect(impact.toInterState.map((row) => row.id)).toContain(shantipur);
			expect(impact.toInterState.map((row) => row.id)).not.toContain(banaras);
			const moved = await shop.update(shopWrite({ gstin: maharashtra, expectedUpdatedAt: saved }), OWNER, {
				canEdit: true,
			});
			expect((await repos.suppliers.findById(shantipur))?.taxType).toBe('inter_state');
			expect((await repos.suppliers.findById(banaras))?.taxType).toBe('inter_state');
			expect(await support.homeState()).toBe('27');
			const trail = (await support.activity('shop_details', ['shop'])).map((row) => row.text).join('\n');
			expect(trail).toMatch(/State West Bengal → Maharashtra\./);
			expect(trail).toMatch(/now charge IGST|now charges IGST/);
			// Back to West Bengal: the same suppliers return to CGST + SGST.
			expect((await shop.impact(gstin('19', 'AAPFS4821K'))).toIntraState.map((row) => row.id)).toContain(
				shantipur,
			);
			await shop.update(shopWrite({ expectedUpdatedAt: moved.updatedAt }), OWNER, { canEdit: true });
			expect((await repos.suppliers.findById(shantipur))?.taxType).toBe('intra_state');
			expect((await shop.impact(gstin('19', 'AAPFS4821K'))).stateChanges).toBe(false);
		});
	});
});
