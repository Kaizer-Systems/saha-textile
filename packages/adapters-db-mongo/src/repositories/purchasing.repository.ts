import { randomUUID } from 'node:crypto';

import {
	type AdjustmentRequest,
	InventorySettings,
	LocationStock,
	ShopDetails,
	type PurchaseEntry,
	type PurchaseOrder,
	type PurchaseReturn,
	type StockCount,
	type Supplier,
	type SupplierPayment,
} from '@saha-textile/contracts';
import {
	type AdjustmentRequestRepository,
	type DocumentListFilter,
	type InventorySettingsRepository,
	type ShopDetailsRepository,
	type LastPurchaseFact,
	type ListPage,
	type NumberAllocatorPort,
	type OpeningStockRecord,
	type OpeningStockRepository,
	type PurchaseEntryRepository,
	type PurchaseOrderRepository,
	type PurchaseReturnRepository,
	SHOP_LOW_STOCK_THRESHOLD,
	StaleVersionError,
	StockMovementRefusedError,
	type StockCountRepository,
	type StockHoldRecord,
	type StockHoldRepository,
	type StockItemFacts,
	type StockLayerRow,
	type StockLedgerRow,
	type StockMovementPort,
	type StockReadRepository,
	type SupplierItemCodeRepository,
	type SupplierListFilter,
	type SupplierPaymentRepository,
	type SupplierRepository,
	type TransactionContext,
	normalizeBillNumber,
} from '@saha-textile/core-domain';
import type { Model, PipelineStage, QueryFilter } from 'mongoose';

type FilterQuery<T> = QueryFilter<T>;

import {
	type AggregateDoc,
	AttributeDefinitionModel,
	CategoryModel,
	type InventoryCostLayerDoc,
	type InventoryLedgerDoc,
	InventoryCostLayerModel,
	InventoryLedgerModel,
	InventorySettingsModel,
	LocationStockModel,
	ShopDetailsModel,
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
} from '../models/index';
import { sessionFrom } from '../transaction-manager';

/* ------------------------------------------------------------------ shared helpers */

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** `{ id, …rest }` → `{ _id, …rest }`. */
function toDoc<T extends { id: string }>(value: T): AggregateDoc {
	const { id, ...rest } = value;
	return { _id: id, ...rest };
}

/** `{ _id, …rest }` → `{ id, …rest }`, dropping Mongo's own keys. */
function fromDoc<T>(doc: AggregateDoc | null | undefined): T | null {
	if (!doc) return null;
	const { _id, __v, ...rest } = doc as AggregateDoc & { __v?: unknown };
	void __v;
	return { id: _id, ...rest } as T;
}

/** A named list filter, falling back to the unfiltered list for an unknown name. */
function pick(
	filters: Record<string, (today: string) => FilterQuery<AggregateDoc>>,
	name: string,
	today: string,
): FilterQuery<AggregateDoc> {
	const build = filters[name];
	return build ? build(today) : {};
}

const page = (filter: { page: number; pageSize: number }) => ({
	skip: (Math.max(filter.page, 1) - 1) * filter.pageSize,
	limit: filter.pageSize,
});

/**
 * Insert at version 1, or update only when the stored version is the one the caller read.
 * A miss raises `StaleVersionError` with who changed it, so the screen can say so.
 */
async function versionedSave(
	model: Model<AggregateDoc>,
	entity: string,
	value: { id: string; version: number; updatedAt?: string },
	extra: Record<string, unknown>,
	expectedVersion: number | null,
	context?: TransactionContext,
): Promise<number> {
	const session = sessionFrom(context);
	const doc = { ...toDoc(value as { id: string }), ...extra };
	if (expectedVersion === null) {
		await model.create([{ ...doc, version: 1 }], { session });
		return 1;
	}
	const next = expectedVersion + 1;
	const { _id, ...rest } = doc;
	const result = await model
		.updateOne({ _id, version: expectedVersion }, { $set: { ...rest, version: next } }, { session })
		.exec();
	if (result.matchedCount === 0) {
		const current = await model
			.findById(_id)
			.session(session ?? null)
			.lean<AggregateDoc>()
			.exec();
		if (!current) throw new Error(`${entity} ${String(_id)} does not exist`);
		throw new StaleVersionError(entity, String(_id), {
			version: Number(current.version ?? 0),
			updatedAt: String(current.updatedAt ?? ''),
			updatedBy: (current.updatedBy as string | null | undefined) ?? null,
		});
	}
	return next;
}

/* ------------------------------------------------------------------ suppliers */

export class MongoSupplierRepository implements SupplierRepository {
	async findById(id: string, context?: TransactionContext): Promise<Supplier | null> {
		const doc = await SupplierModel.findOne({ _id: id, deletedAt: null })
			.session(sessionFrom(context) ?? null)
			.lean<AggregateDoc>()
			.exec();
		return fromDoc<Supplier>(doc);
	}

	async findByGstin(gstin: string): Promise<Supplier | null> {
		return fromDoc<Supplier>(await SupplierModel.findOne({ gstin, deletedAt: null }).lean<AggregateDoc>().exec());
	}

	async findByPan(pan: string): Promise<Supplier[]> {
		const docs = await SupplierModel.find({ pan, deletedAt: null }).lean<AggregateDoc[]>().exec();
		return docs.map((doc) => fromDoc<Supplier>(doc) as Supplier);
	}

	async list(filter: SupplierListFilter, owedBySupplier: ReadonlyMap<string, number>): Promise<ListPage<Supplier>> {
		// One record per business (orders brief, 2026-11-20): the Suppliers page lists those that sell to us.
		const query: FilterQuery<AggregateDoc> = { deletedAt: null, 'roles.supplier': { $ne: false } };
		if (filter.filter === 'inactive') query.active = false;
		if (filter.filter === 'owed')
			query._id = { $in: [...owedBySupplier].filter(([, owed]) => owed > 0).map(([id]) => id) };
		if (filter.q) {
			const pattern = new RegExp(escapeRegex(filter.q), 'i');
			query.$or = [
				{ legalName: pattern },
				{ shortName: pattern },
				{ gstin: pattern },
				{ 'address.city': pattern },
			];
		}
		const { skip, limit } = page(filter);
		const [docs, total] = await Promise.all([
			SupplierModel.find(query).sort({ legalName: 1 }).skip(skip).limit(limit).lean<AggregateDoc[]>().exec(),
			SupplierModel.countDocuments(query).exec(),
		]);
		return { items: docs.map((doc) => fromDoc<Supplier>(doc) as Supplier), total };
	}

	async hasDocuments(id: string): Promise<boolean> {
		const [entries, orders] = await Promise.all([
			PurchaseInvoiceModel.exists({ supplierId: id }).exec(),
			PurchaseOrderModel.exists({ supplierId: id }).exec(),
		]);
		return Boolean(entries || orders);
	}

	async save(supplier: Supplier, context?: TransactionContext): Promise<void> {
		const { _id, ...rest } = toDoc(supplier);
		await SupplierModel.updateOne(
			{ _id },
			{ $set: { ...rest, deletedAt: null } },
			{ upsert: true, session: sessionFrom(context) },
		).exec();
	}

	async softDelete(id: string, actorId: string | null, at: string): Promise<void> {
		await SupplierModel.updateOne(
			{ _id: id },
			{ $set: { deletedAt: at, deletedBy: actorId, active: false } },
		).exec();
	}

	async countActive(): Promise<{ all: number; inactive: number }> {
		const [all, inactive] = await Promise.all([
			SupplierModel.countDocuments({ deletedAt: null, 'roles.supplier': { $ne: false } }).exec(),
			SupplierModel.countDocuments({ deletedAt: null, active: false, 'roles.supplier': { $ne: false } }).exec(),
		]);
		return { all, inactive };
	}
}

export class MongoSupplierItemCodeRepository implements SupplierItemCodeRepository {
	async findVariant(supplierId: string, code: string): Promise<string | null> {
		const doc = await SupplierItemCodeModel.findOne({ supplierId, code: code.trim().toUpperCase() }).lean().exec();
		return doc?.variantId ?? null;
	}

	async codesFor(supplierId: string, variantIds: readonly string[]): Promise<Map<string, string>> {
		const docs = await SupplierItemCodeModel.find({ supplierId, variantId: { $in: [...variantIds] } })
			.lean()
			.exec();
		return new Map(docs.map((doc) => [doc.variantId, doc.code]));
	}

	async remember(supplierId: string, code: string, variantId: string, context?: TransactionContext): Promise<void> {
		const normalized = code.trim().toUpperCase();
		if (!normalized) return;
		await SupplierItemCodeModel.updateOne(
			{ supplierId, code: normalized },
			{ $set: { variantId, updatedAt: new Date().toISOString() }, $setOnInsert: { _id: `sic_${randomUUID()}` } },
			{ upsert: true, session: sessionFrom(context) },
		).exec();
	}
}

/* ------------------------------------------------------------------ orders */

const ORDER_FILTERS: Record<string, (today: string) => FilterQuery<AggregateDoc>> = {
	all: () => ({}),
	draft: () => ({ status: 'draft' }),
	sent: () => ({ status: 'sent' }),
	part_received: () => ({ status: 'part_received' }),
	late: (today) => ({ status: { $in: ['sent', 'part_received'] }, expectedBy: { $lt: today } }),
	closed: () => ({ status: { $in: ['received', 'closed_short', 'cancelled'] } }),
};

export class MongoPurchaseOrderRepository implements PurchaseOrderRepository {
	async findById(id: string, context?: TransactionContext): Promise<PurchaseOrder | null> {
		return fromDoc<PurchaseOrder>(
			await PurchaseOrderModel.findById(id)
				.session(sessionFrom(context) ?? null)
				.lean<AggregateDoc>()
				.exec(),
		);
	}

	async list(filter: DocumentListFilter): Promise<ListPage<PurchaseOrder> & { counts: Record<string, number> }> {
		const base: FilterQuery<AggregateDoc> = {};
		if (filter.supplierId) base.supplierId = filter.supplierId;
		if (filter.q) {
			const pattern = new RegExp(escapeRegex(filter.q), 'i');
			base.$or = [{ number: pattern }, { supplierName: pattern }, { 'lines.sku': pattern }];
		}
		const query = { ...base, ...pick(ORDER_FILTERS, filter.filter, filter.today) };
		const { skip, limit } = page(filter);
		const [docs, total, counts] = await Promise.all([
			PurchaseOrderModel.find(query)
				.sort({ createdAt: -1 })
				.skip(skip)
				.limit(limit)
				.lean<AggregateDoc[]>()
				.exec(),
			PurchaseOrderModel.countDocuments(query).exec(),
			countEach(PurchaseOrderModel, base, ORDER_FILTERS, filter.today),
		]);
		return { items: docs.map((doc) => fromDoc<PurchaseOrder>(doc) as PurchaseOrder), total, counts };
	}

	save(order: PurchaseOrder, expectedVersion: number | null, context?: TransactionContext): Promise<number> {
		return versionedSave(PurchaseOrderModel, 'purchase_order', order, {}, expectedVersion, context);
	}

	async remove(id: string): Promise<void> {
		await PurchaseOrderModel.deleteOne({ _id: id, status: 'draft' }).exec();
	}

	async openForSupplier(supplierId: string): Promise<PurchaseOrder[]> {
		const docs = await PurchaseOrderModel.find({ supplierId, status: { $in: ['sent', 'part_received'] } })
			.sort({ createdAt: 1 })
			.lean<AggregateDoc[]>()
			.exec();
		return docs.map((doc) => fromDoc<PurchaseOrder>(doc) as PurchaseOrder);
	}
}

async function countEach(
	model: Model<AggregateDoc>,
	base: FilterQuery<AggregateDoc>,
	filters: Record<string, (today: string) => FilterQuery<AggregateDoc>>,
	today: string,
): Promise<Record<string, number>> {
	const entries = await Promise.all(
		Object.entries(filters).map(
			async ([key, build]) => [key, await model.countDocuments({ ...base, ...build(today) }).exec()] as const,
		),
	);
	return Object.fromEntries(entries);
}

/* ------------------------------------------------------------------ entries */

const ENTRY_FILTERS: Record<string, (today: string) => FilterQuery<AggregateDoc>> = {
	all: () => ({}),
	draft: () => ({ status: 'draft' }),
	checked: () => ({ status: 'checked' }),
	unpaid: () => ({ status: 'posted', paymentStatus: { $ne: 'paid' } }),
	void: () => ({ status: 'void' }),
};

export class MongoPurchaseEntryRepository implements PurchaseEntryRepository {
	async findById(id: string, context?: TransactionContext): Promise<PurchaseEntry | null> {
		return fromDoc<PurchaseEntry>(
			await PurchaseInvoiceModel.findById(id)
				.session(sessionFrom(context) ?? null)
				.lean<AggregateDoc>()
				.exec(),
		);
	}

	async list(filter: DocumentListFilter): Promise<ListPage<PurchaseEntry> & { counts: Record<string, number> }> {
		const base: FilterQuery<AggregateDoc> = {};
		if (filter.q) {
			const pattern = new RegExp(escapeRegex(filter.q), 'i');
			base.$or = [
				{ number: pattern },
				{ billNumber: pattern },
				{ supplierName: pattern },
				{ 'lines.sku': pattern },
			];
		}
		if (filter.supplierId) base.supplierId = filter.supplierId;
		if (filter.from || filter.to)
			base.billDate = {
				...(filter.from ? { $gte: filter.from } : {}),
				...(filter.to ? { $lte: filter.to } : {}),
			};
		const query = { ...base, ...pick(ENTRY_FILTERS, filter.filter, filter.today) };
		const { skip, limit } = page(filter);
		const [docs, total, counts] = await Promise.all([
			PurchaseInvoiceModel.find(query)
				.sort({ createdAt: -1 })
				.skip(skip)
				.limit(limit)
				.lean<AggregateDoc[]>()
				.exec(),
			PurchaseInvoiceModel.countDocuments(query).exec(),
			countEach(PurchaseInvoiceModel, base, ENTRY_FILTERS, filter.today),
		]);
		return { items: docs.map((doc) => fromDoc<PurchaseEntry>(doc) as PurchaseEntry), total, counts };
	}

	save(entry: PurchaseEntry, expectedVersion: number | null, context?: TransactionContext): Promise<number> {
		return versionedSave(
			PurchaseInvoiceModel,
			'purchase_entry',
			entry,
			{ billNumberKey: normalizeBillNumber(entry.billNumber) },
			expectedVersion,
			context,
		);
	}

	async remove(id: string): Promise<void> {
		await PurchaseInvoiceModel.deleteOne({ _id: id, status: { $in: ['draft', 'checked'] } }).exec();
	}

	async findByBill(
		supplierId: string,
		normalizedBillNumber: string,
		excludeId: string | null,
	): Promise<PurchaseEntry | null> {
		const query: FilterQuery<AggregateDoc> = {
			supplierId,
			billNumberKey: normalizedBillNumber,
			status: { $ne: 'void' },
		};
		if (excludeId) query._id = { $ne: excludeId };
		return fromDoc<PurchaseEntry>(await PurchaseInvoiceModel.findOne(query).lean<AggregateDoc>().exec());
	}

	async findLookalike(
		supplierId: string,
		billDate: string,
		totalINR: number,
		excludeId: string | null,
	): Promise<PurchaseEntry | null> {
		const query: FilterQuery<AggregateDoc> = {
			supplierId,
			billDate,
			'totals.totalINR': totalINR,
			status: { $ne: 'void' },
		};
		if (excludeId) query._id = { $ne: excludeId };
		return fromDoc<PurchaseEntry>(await PurchaseInvoiceModel.findOne(query).lean<AggregateDoc>().exec());
	}

	async lastPurchases(
		variantIds: readonly string[],
		excludeEntryId: string | null,
	): Promise<Map<string, LastPurchaseFact>> {
		if (variantIds.length === 0) return new Map();
		const match: FilterQuery<AggregateDoc> = { status: 'posted', 'lines.variantId': { $in: [...variantIds] } };
		if (excludeEntryId) match._id = { $ne: excludeEntryId };
		const rows = await PurchaseInvoiceModel.aggregate<{
			_id: string;
			unitPriceExGstINR: number;
			number: string | null;
			supplierId: string;
			supplierName: string;
			billDate: string;
		}>([
			{ $match: match },
			{ $sort: { postedAt: -1 } },
			{ $unwind: '$lines' },
			{ $match: { 'lines.variantId': { $in: [...variantIds] }, 'lines.freeOnBill': { $ne: true } } },
			{
				$group: {
					_id: '$lines.variantId',
					unitPriceExGstINR: { $first: '$lines.unitPriceExGstINR' },
					number: { $first: '$number' },
					supplierId: { $first: '$supplierId' },
					supplierName: { $first: '$supplierName' },
					billDate: { $first: '$billDate' },
				},
			},
		]).exec();
		return new Map(
			rows.map((row) => [
				row._id,
				{
					variantId: row._id,
					unitPriceExGstINR: row.unitPriceExGstINR ?? 0,
					entryNumber: row.number,
					supplierId: row.supplierId,
					supplierName: row.supplierName,
					billDate: row.billDate,
				},
			]),
		);
	}

	async openPayables(supplierId?: string): Promise<PurchaseEntry[]> {
		const query: FilterQuery<AggregateDoc> = { status: 'posted', paymentStatus: { $ne: 'paid' } };
		if (supplierId) query.supplierId = supplierId;
		const docs = await PurchaseInvoiceModel.find(query).sort({ dueOn: 1 }).lean<AggregateDoc[]>().exec();
		return docs.map((doc) => fromDoc<PurchaseEntry>(doc) as PurchaseEntry);
	}

	async postedBetween(from: string, to: string): Promise<PurchaseEntry[]> {
		const docs = await PurchaseInvoiceModel.find({ status: 'posted', billDate: { $gte: from, $lte: to } })
			.sort({ billDate: 1, number: 1 })
			.lean<AggregateDoc[]>()
			.exec();
		return docs.map((doc) => fromDoc<PurchaseEntry>(doc) as PurchaseEntry);
	}

	async forSupplier(supplierId: string): Promise<PurchaseEntry[]> {
		const docs = await PurchaseInvoiceModel.find({ supplierId })
			.sort({ billDate: 1 })
			.lean<AggregateDoc[]>()
			.exec();
		return docs.map((doc) => fromDoc<PurchaseEntry>(doc) as PurchaseEntry);
	}

	async claimRequestKey(key: string, entryId: string, context?: TransactionContext): Promise<'claimed' | 'seen'> {
		const result = await PurchaseInvoiceModel.updateOne(
			{ _id: entryId, postRequestKey: null },
			{ $set: { postRequestKey: key } },
			{ session: sessionFrom(context) },
		).exec();
		if (result.modifiedCount === 1) return 'claimed';
		return 'seen';
	}
}

/* ------------------------------------------------------------------ payments */

export class MongoSupplierPaymentRepository implements SupplierPaymentRepository {
	async forEntry(entryId: string): Promise<SupplierPayment[]> {
		const docs = await SupplierPaymentModel.find({ purchaseEntryId: entryId })
			.sort({ paidOn: 1 })
			.lean<AggregateDoc[]>()
			.exec();
		return docs.map((doc) => fromDoc<SupplierPayment>(doc) as SupplierPayment);
	}

	async forSupplier(supplierId: string): Promise<SupplierPayment[]> {
		const docs = await SupplierPaymentModel.find({ supplierId }).sort({ paidOn: 1 }).lean<AggregateDoc[]>().exec();
		return docs.map((doc) => fromDoc<SupplierPayment>(doc) as SupplierPayment);
	}

	async save(payment: SupplierPayment, context?: TransactionContext): Promise<void> {
		const { _id, ...rest } = toDoc(payment);
		await SupplierPaymentModel.updateOne(
			{ _id },
			{ $set: rest },
			{ upsert: true, session: sessionFrom(context) },
		).exec();
	}

	async findById(id: string): Promise<SupplierPayment | null> {
		return fromDoc<SupplierPayment>(await SupplierPaymentModel.findById(id).lean<AggregateDoc>().exec());
	}
}

/* ------------------------------------------------------------------ returns */

const RETURN_FILTERS: Record<string, (today: string) => FilterQuery<AggregateDoc>> = {
	all: () => ({}),
	draft: () => ({ status: 'draft' }),
	sent: () => ({ status: 'sent' }),
	// Sent and nothing settled yet: waiting for the supplier's credit note or refund.
	waiting: () => ({ status: 'sent', settledINR: 0 }),
	settled: () => ({ status: 'settled' }),
};

export class MongoPurchaseReturnRepository implements PurchaseReturnRepository {
	async findById(id: string, context?: TransactionContext): Promise<PurchaseReturn | null> {
		return fromDoc<PurchaseReturn>(
			await PurchaseReturnModel.findById(id)
				.session(sessionFrom(context) ?? null)
				.lean<AggregateDoc>()
				.exec(),
		);
	}

	async list(filter: DocumentListFilter): Promise<ListPage<PurchaseReturn> & { counts: Record<string, number> }> {
		const base: FilterQuery<AggregateDoc> = {};
		if (filter.supplierId) base.supplierId = filter.supplierId;
		if (filter.q) {
			const pattern = new RegExp(escapeRegex(filter.q), 'i');
			base.$or = [
				{ number: pattern },
				{ supplierName: pattern },
				{ purchaseEntryNumber: pattern },
				{ 'lines.sku': pattern },
			];
		}
		const query = { ...base, ...pick(RETURN_FILTERS, filter.filter, filter.today) };
		const { skip, limit } = page(filter);
		const [docs, total, counts] = await Promise.all([
			PurchaseReturnModel.find(query)
				.sort({ createdAt: -1 })
				.skip(skip)
				.limit(limit)
				.lean<AggregateDoc[]>()
				.exec(),
			PurchaseReturnModel.countDocuments(query).exec(),
			countEach(PurchaseReturnModel, base, RETURN_FILTERS, filter.today),
		]);
		return { items: docs.map((doc) => fromDoc<PurchaseReturn>(doc) as PurchaseReturn), total, counts };
	}

	save(doc: PurchaseReturn, expectedVersion: number | null, context?: TransactionContext): Promise<number> {
		return versionedSave(PurchaseReturnModel, 'purchase_return', doc, {}, expectedVersion, context);
	}

	async remove(id: string): Promise<void> {
		await PurchaseReturnModel.deleteOne({ _id: id, status: 'draft' }).exec();
	}

	async forEntry(entryId: string): Promise<PurchaseReturn[]> {
		const docs = await PurchaseReturnModel.find({ purchaseEntryId: entryId }).lean<AggregateDoc[]>().exec();
		return docs.map((doc) => fromDoc<PurchaseReturn>(doc) as PurchaseReturn);
	}

	async claimSendKey(key: string, returnId: string, context?: TransactionContext): Promise<'claimed' | 'seen'> {
		const result = await PurchaseReturnModel.updateOne(
			{ _id: returnId, sendRequestKey: null },
			{ $set: { sendRequestKey: key } },
			{ session: sessionFrom(context) },
		).exec();
		return result.modifiedCount === 1 ? 'claimed' : 'seen';
	}

	async forSupplier(supplierId: string): Promise<PurchaseReturn[]> {
		const docs = await PurchaseReturnModel.find({ supplierId })
			.sort({ createdAt: 1 })
			.lean<AggregateDoc[]>()
			.exec();
		return docs.map((doc) => fromDoc<PurchaseReturn>(doc) as PurchaseReturn);
	}
}

/* ------------------------------------------------------------------ holds, adjustments, counts */

export class MongoStockHoldRepository implements StockHoldRepository {
	async findById(id: string, context?: TransactionContext): Promise<StockHoldRecord | null> {
		return fromDoc<StockHoldRecord>(
			await StockHoldModel.findById(id)
				.session(sessionFrom(context) ?? null)
				.lean<AggregateDoc>()
				.exec(),
		);
	}

	async open(filter: {
		reason?: string;
		q?: string;
		variantIds?: readonly string[];
		page: number;
		pageSize: number;
	}) {
		const base: FilterQuery<AggregateDoc> = { status: 'open' };
		if (filter.variantIds) base.variantId = { $in: [...filter.variantIds] };
		const query = { ...base, ...(filter.reason ? { reason: filter.reason } : {}) };
		const { skip, limit } = page(filter);
		const [docs, total, grouped] = await Promise.all([
			StockHoldModel.find(query).sort({ since: 1 }).skip(skip).limit(limit).lean<AggregateDoc[]>().exec(),
			StockHoldModel.countDocuments(query).exec(),
			StockHoldModel.aggregate<{ _id: string; units: number }>([
				{ $match: base },
				{ $group: { _id: '$reason', units: { $sum: '$quantity' } } },
			]).exec(),
		]);
		const counts: Record<string, number> = { all: grouped.reduce((sum, row) => sum + row.units, 0) };
		for (const row of grouped) counts[row._id] = row.units;
		return { items: docs.map((doc) => fromDoc<StockHoldRecord>(doc) as StockHoldRecord), total, counts };
	}

	async openForVariant(variantId: string): Promise<StockHoldRecord[]> {
		const docs = await StockHoldModel.find({ variantId, status: 'open' })
			.sort({ since: 1 })
			.lean<AggregateDoc[]>()
			.exec();
		return docs.map((doc) => fromDoc<StockHoldRecord>(doc) as StockHoldRecord);
	}

	async save(hold: StockHoldRecord, context?: TransactionContext): Promise<void> {
		const { _id, ...rest } = toDoc(hold);
		await StockHoldModel.updateOne({ _id }, { $set: rest }, { upsert: true, session: sessionFrom(context) }).exec();
	}
}

/** An adjustment request without the store's own bookkeeping (request key, seen time). */
function stripRequestDoc(doc: AggregateDoc): AdjustmentRequest {
	const { requestKey: _key, requesterSeenAt: _seen, ...rest } = doc;
	return fromDoc<AdjustmentRequest>(rest as AggregateDoc) as AdjustmentRequest;
}

export class MongoAdjustmentRequestRepository implements AdjustmentRequestRepository {
	async findById(id: string, context?: TransactionContext): Promise<AdjustmentRequest | null> {
		const doc = await StockAdjustmentModel.findById(id)
			.session(sessionFrom(context) ?? null)
			.lean<AggregateDoc>()
			.exec();
		return doc ? stripRequestDoc(doc) : null;
	}

	async list(filter: { status: 'pending' | 'approved' | 'rejected'; q?: string; page: number; pageSize: number }) {
		const query: FilterQuery<AggregateDoc> =
			filter.status === 'approved'
				? { status: { $in: ['approved', 'applied'] }, decidedBy: { $ne: null } }
				: { status: filter.status };
		if (filter.q) {
			const pattern = new RegExp(escapeRegex(filter.q), 'i');
			query.$or = [{ sku: pattern }, { title: pattern }, { requestedByName: pattern }];
		}
		const { skip, limit } = page(filter);
		const [docs, total] = await Promise.all([
			StockAdjustmentModel.find(query)
				.sort({ requestedAt: -1 })
				.skip(skip)
				.limit(limit)
				.lean<AggregateDoc[]>()
				.exec(),
			StockAdjustmentModel.countDocuments(query).exec(),
		]);
		return { items: docs.map(stripRequestDoc), total };
	}

	pendingCount(): Promise<number> {
		return StockAdjustmentModel.countDocuments({ status: 'pending' }).exec();
	}

	async findByRequestKey(key: string): Promise<AdjustmentRequest | null> {
		const doc = await StockAdjustmentModel.findOne({ requestKey: key }).lean<AggregateDoc>().exec();
		return doc ? stripRequestDoc(doc) : null;
	}

	async save(request: AdjustmentRequest, requestKey: string | null, context?: TransactionContext): Promise<void> {
		const { _id, ...rest } = toDoc(request);
		await StockAdjustmentModel.updateOne(
			{ _id },
			{ $set: rest, $setOnInsert: { requestKey, requesterSeenAt: null } },
			{ upsert: true, session: sessionFrom(context) },
		).exec();
	}

	async unseenDecisions(requesterId: string): Promise<AdjustmentRequest[]> {
		const docs = await StockAdjustmentModel.find({
			requestedBy: requesterId,
			status: { $in: ['rejected', 'applied'] },
			selfApproved: false,
			requesterSeenAt: null,
		})
			.sort({ decidedAt: -1 })
			.limit(20)
			.lean<AggregateDoc[]>()
			.exec();
		return docs.map(stripRequestDoc);
	}

	async markSeen(requesterId: string, ids: readonly string[]): Promise<void> {
		await StockAdjustmentModel.updateMany(
			{ _id: { $in: [...ids] }, requestedBy: requesterId },
			{ $set: { requesterSeenAt: new Date().toISOString() } },
		).exec();
	}
}

/* ------------------------------------------------------------------ opening stock */

export class MongoOpeningStockRepository implements OpeningStockRepository {
	async findByRequestKey(key: string): Promise<OpeningStockRecord | null> {
		return fromDoc<OpeningStockRecord>(
			await OpeningStockModel.findOne({ requestKey: key }).lean<AggregateDoc>().exec(),
		);
	}

	async save(record: OpeningStockRecord, context?: TransactionContext): Promise<void> {
		await OpeningStockModel.create([toDoc(record)], { session: sessionFrom(context) });
	}

	async list(): Promise<OpeningStockRecord[]> {
		const docs = await OpeningStockModel.find().sort({ postedAt: -1 }).lean<AggregateDoc[]>().exec();
		return docs.map((doc) => fromDoc<OpeningStockRecord>(doc) as OpeningStockRecord);
	}
}

export class MongoStockCountRepository implements StockCountRepository {
	async findById(id: string, context?: TransactionContext): Promise<StockCount | null> {
		return fromDoc<StockCount>(
			await StockCountModel.findById(id)
				.session(sessionFrom(context) ?? null)
				.lean<AggregateDoc>()
				.exec(),
		);
	}

	async list(filter: { filter: string; page: number; pageSize: number }) {
		const filters: Record<string, FilterQuery<AggregateDoc>> = {
			all: {},
			counting: { status: 'counting' },
			review: { status: { $in: ['review', 'awaiting_approval'] } },
			posted: { status: 'posted' },
		};
		const query = filters[filter.filter] ?? {};
		const { skip, limit } = page(filter);
		const [docs, total, ...counts] = await Promise.all([
			StockCountModel.find(query, { lines: 0 })
				.sort({ startedAt: -1 })
				.skip(skip)
				.limit(limit)
				.lean<AggregateDoc[]>()
				.exec(),
			StockCountModel.countDocuments(query).exec(),
			...Object.values(filters).map((value) => StockCountModel.countDocuments(value).exec()),
		]);
		const keys = Object.keys(filters);
		return {
			items: docs.map((doc) => fromDoc<StockCount>({ ...doc, lines: [] }) as StockCount),
			total,
			// One count per filter, in the filters' own order.
			counts: Object.fromEntries(keys.map((key, index) => [key, counts[index] as number])),
		};
	}

	save(count: StockCount, expectedVersion: number | null, context?: TransactionContext): Promise<number> {
		return versionedSave(StockCountModel, 'stock_count', count, {}, expectedVersion, context);
	}

	async lastDifferences(): Promise<string[]> {
		const last = await StockCountModel.findOne({ status: 'posted' })
			.sort({ postedAt: -1 })
			.lean<AggregateDoc>()
			.exec();
		const lines = (last?.lines as Array<{ variantId: string; difference: number | null }> | undefined) ?? [];
		return lines.filter((line) => (line.difference ?? 0) !== 0).map((line) => line.variantId);
	}
}

/* ------------------------------------------------------------------ numbers and settings */

/** `sequences`: an atomic `$inc` per series and financial year, inside the caller's transaction. */
export class MongoNumberAllocator implements NumberAllocatorPort {
	async next(series: string, fiscalYear: string, context?: TransactionContext): Promise<number> {
		const doc = await SequenceModel.findOneAndUpdate(
			{ _id: `${series}:${fiscalYear}` },
			{ $inc: { seq: 1 } },
			{ upsert: true, returnDocument: 'after', session: sessionFrom(context) },
		)
			.lean()
			.exec();
		// An upsert that answers the document after the change always has one.
		return (doc as { seq: number }).seq;
	}

	async peek(series: string, fiscalYear: string): Promise<number> {
		const doc = await SequenceModel.findById(`${series}:${fiscalYear}`).lean().exec();
		return (doc?.seq ?? 0) + 1;
	}
}

export class MongoInventorySettingsRepository implements InventorySettingsRepository {
	async get(): Promise<InventorySettings> {
		const doc = await InventorySettingsModel.findById('inventory').lean<AggregateDoc>().exec();
		const { _id, ...rest } = doc ?? { _id: 'inventory' };
		void _id;
		return InventorySettings.parse(rest);
	}

	async save(settings: InventorySettings): Promise<void> {
		await InventorySettingsModel.updateOne({ _id: 'inventory' }, { $set: settings }, { upsert: true }).exec();
	}
}

export class MongoShopDetailsRepository implements ShopDetailsRepository {
	async get(): Promise<ShopDetails | null> {
		const doc = await ShopDetailsModel.findById('shop').lean<AggregateDoc>().exec();
		if (!doc) return null;
		const { _id, ...rest } = doc;
		void _id;
		return ShopDetails.parse(rest);
	}

	/**
	 * Writes only over the copy the editor read. A first save (`expectedUpdatedAt` null) inserts;
	 * if someone saved first, the insert hits the existing `_id` and is refused the same way.
	 */
	async save(details: ShopDetails, expectedUpdatedAt: string | null): Promise<void> {
		const filter = { _id: 'shop', updatedAt: expectedUpdatedAt };
		try {
			const result = await ShopDetailsModel.updateOne(
				filter,
				{ $set: details },
				{ upsert: expectedUpdatedAt === null },
			).exec();
			if (result.matchedCount === 1 || result.upsertedCount === 1) return;
		} catch (error) {
			if ((error as { code?: number }).code !== 11000) throw error;
		}
		const current = await this.get();
		throw new StaleVersionError('shop_details', 'shop', {
			version: 0,
			updatedAt: current?.updatedAt ?? '',
			updatedBy: current?.updatedBy ?? null,
		});
	}
}

/* ------------------------------------------------------------------ stock movement */

export class MongoStockMovement implements StockMovementPort {
	/**
	 * One conditional update moves on-hand, held and reserved together, so the guard cannot be raced:
	 * the result must keep held ≥ 0, reserved ≥ 0 and on-hand ≥ held + reserved (held and reserved
	 * pieces are part of on-hand). Untracked variants skip the guard. The ledger row commits with it
	 * inside the caller's transaction.
	 */
	async move(input: Parameters<StockMovementPort['move']>[0], context?: TransactionContext) {
		const session = sessionFrom(context);
		const reservedDelta = input.reservedDelta ?? 0;
		const heldAfter = { $add: [{ $ifNull: ['$stock.held', 0] }, input.heldDelta] };
		const reservedAfter = { $add: [{ $ifNull: ['$stock.reserved', 0] }, reservedDelta] };
		const guard =
			input.quantityDelta < 0 || input.heldDelta !== 0 || reservedDelta !== 0
				? {
						$or: [
							{ 'stock.tracked': false },
							{
								$expr: {
									$and: [
										{ $gte: [heldAfter, 0] },
										{ $gte: [reservedAfter, 0] },
										{
											$gte: [
												{ $add: ['$stock.quantity', input.quantityDelta] },
												{ $add: [heldAfter, reservedAfter] },
											],
										},
									],
								},
							},
						],
					}
				: {};
		const updated = await ProductVariantModel.findOneAndUpdate(
			{ _id: input.variantId, ...guard },
			{
				$inc: {
					'stock.quantity': input.quantityDelta,
					'stock.held': input.heldDelta,
					...(reservedDelta ? { 'stock.reserved': reservedDelta } : {}),
				},
			},
			{ returnDocument: 'after', session },
		)
			.select('stock')
			.lean<{ _id: string; stock: { quantity: number; held?: number; reserved?: number } }>()
			.exec();
		if (!updated) throw new StockMovementRefusedError(input.variantId);

		const ledgerId = `led_${randomUUID()}`;
		await InventoryLedgerModel.create(
			[
				{
					_id: ledgerId,
					variantId: input.variantId,
					productId: input.productId,
					quantityDelta: input.quantityDelta,
					balanceAfter: updated.stock.quantity,
					heldDelta: input.heldDelta,
					// The $inc above always writes held, so the variant has it now.
					heldAfter: updated.stock.held as number,
					reservedDelta,
					reservedAfter: updated.stock.reserved ?? 0,
					source: input.source,
					reasonCode: input.reasonCode,
					note: input.note,
					referenceType: input.referenceType,
					referenceId: input.referenceId,
					referenceNumber: input.referenceNumber,
					actorUserId: input.actorUserId,
					approverUserId: input.approverUserId,
					locationId: input.locationId ?? null,
					createdAt: new Date(input.at),
				},
			],
			{ session },
		);
		if (input.locationId) {
			// The location's share of the variant moves with it, in the same transaction (F4).
			await LocationStockModel.updateOne(
				{ _id: `${input.variantId}:${input.locationId}` },
				{
					$inc: { onHand: input.quantityDelta, held: input.heldDelta, reserved: reservedDelta },
					$set: {
						variantId: input.variantId,
						productId: input.productId,
						locationId: input.locationId,
						updatedAt: input.at,
					},
				},
				{ upsert: true, session },
			).exec();
		}
		return { ledgerId, onHandAfter: updated.stock.quantity, heldAfter: updated.stock.held as number };
	}

	async locationStock(variantIds: readonly string[]): Promise<LocationStock[]> {
		if (!variantIds.length) return [];
		const docs = await LocationStockModel.find({ variantId: { $in: [...variantIds] } })
			.lean<AggregateDoc[]>()
			.exec();
		return docs.map((doc) => LocationStock.parse(doc));
	}

	async placeUnlocatedStock(locationId: string): Promise<{ variants: number; ledgerRows: number; layers: number }> {
		const placed = new Set<string>((await LocationStockModel.distinct('variantId').exec()).map(String));
		const unplaced = await ProductVariantModel.find({
			$or: [{ 'stock.quantity': { $ne: 0 } }, { 'stock.held': { $gt: 0 } }, { 'stock.reserved': { $gt: 0 } }],
		})
			.select('productId stock')
			.lean<
				{ _id: string; productId: string; stock?: { quantity?: number; held?: number; reserved?: number } }[]
			>()
			.exec();
		const now = new Date().toISOString();
		const rows = unplaced
			.filter((variant) => !placed.has(String(variant._id)))
			.map((variant) => ({
				updateOne: {
					filter: { _id: `${variant._id}:${locationId}` },
					update: {
						$setOnInsert: {
							variantId: String(variant._id),
							productId: String(variant.productId),
							locationId,
							onHand: variant.stock?.quantity ?? 0,
							held: variant.stock?.held ?? 0,
							reserved: variant.stock?.reserved ?? 0,
							updatedAt: now,
						},
					},
					upsert: true,
				},
			}));
		if (rows.length) await LocationStockModel.bulkWrite(rows);
		const unset = { $or: [{ locationId: { $exists: false } }, { locationId: null }] };
		const [ledger, layers] = await Promise.all([
			InventoryLedgerModel.updateMany(unset, { $set: { locationId } }).exec(),
			InventoryCostLayerModel.updateMany(unset, { $set: { locationId } }).exec(),
		]);
		return { variants: rows.length, ledgerRows: ledger.modifiedCount, layers: layers.modifiedCount };
	}

	async consumeLayer(layerId: string, quantity: number, context?: TransactionContext): Promise<void> {
		if (quantity <= 0) return;
		const updated = await InventoryCostLayerModel.findOneAndUpdate(
			{ _id: layerId, quantityRemaining: { $gte: quantity } },
			{ $inc: { quantityRemaining: -quantity } },
			{ returnDocument: 'after', session: sessionFrom(context) },
		)
			.lean()
			.exec();
		if (!updated) throw new StockMovementRefusedError(`layer:${layerId}`);
	}
}

/* ------------------------------------------------------------------ stock read side */

interface ItemRow {
	_id: string;
	productId: string;
	sku: string;
	barcode?: string | null;
	optionSelections?: Array<{ attributeCode: string; termCode: string }>;
	isBaseVariant?: boolean;
	priceINR: number;
	salePriceINR?: number | null;
	compareAtPriceINR?: number | null;
	stock?: {
		tracked?: boolean;
		quantity?: number;
		held?: number;
		reserved?: number;
		lowStockThreshold?: number | null;
	};
	media?: { primaryAssetId?: string | null };
	taxProfile?: { hsnCode?: string | null };
	p: {
		_id: string;
		type: 'simple' | 'variable' | 'bundle';
		status: 'draft' | 'live' | 'disabled' | 'discontinued';
		title: Record<string, string>;
		soldBy?: 'piece' | 'metre';
		madeToOrder?: boolean;
		lowStockThreshold?: number | null;
		categoryIds?: string[];
		media?: { gallery?: string[] };
		hsnCode?: string | null;
	};
	variantCount?: number;
}

const productLookup: PipelineStage[] = [
	{
		$lookup: {
			from: 'products',
			localField: 'productId',
			foreignField: '_id',
			as: 'p',
			pipeline: [
				{
					$project: {
						type: 1,
						status: 1,
						title: 1,
						soldBy: 1,
						madeToOrder: 1,
						lowStockThreshold: 1,
						categoryIds: 1,
						media: 1,
						hsnCode: 1,
					},
				},
			],
		},
	},
	{ $unwind: '$p' },
];

const stockFields: PipelineStage = {
	$addFields: {
		onHand: { $ifNull: ['$stock.quantity', 0] },
		heldUnits: { $ifNull: ['$stock.held', 0] },
		lowLevel: {
			$ifNull: ['$stock.lowStockThreshold', { $ifNull: ['$p.lowStockThreshold', SHOP_LOW_STOCK_THRESHOLD] }],
		},
	},
};

export class MongoStockReadRepository implements StockReadRepository {
	private async labels(
		rows: readonly ItemRow[],
	): Promise<{ options: Map<string, string>; categories: Map<string, string> }> {
		const attributeCodes = new Set(
			rows.flatMap((row) => (row.optionSelections ?? []).map((pick) => pick.attributeCode)),
		);
		const categoryIds = new Set(rows.flatMap((row) => (row.p.categoryIds ?? []).slice(0, 1)));
		const [attributes, categories] = await Promise.all([
			attributeCodes.size
				? AttributeDefinitionModel.find({ code: { $in: [...attributeCodes] } }, { code: 1, terms: 1 })
						.lean<
							Array<{ code: string; terms?: Array<{ code: string; label?: Record<string, string> }> }>
						>()
						.exec()
				: Promise.resolve([]),
			categoryIds.size
				? CategoryModel.find({ _id: { $in: [...categoryIds] } }, { name: 1 })
						.lean<Array<{ _id: string; name?: Record<string, string> }>>()
						.exec()
				: Promise.resolve([]),
		]);
		const termLabel = new Map<string, string>();
		for (const attribute of attributes) {
			for (const term of attribute.terms ?? [])
				termLabel.set(`${attribute.code}:${term.code}`, term.label?.en ?? term.code);
		}
		const options = new Map<string, string>();
		for (const row of rows) {
			const label = (row.optionSelections ?? [])
				.map((pick) => termLabel.get(`${pick.attributeCode}:${pick.termCode}`) ?? pick.termCode)
				.join(' · ');
			options.set(row._id, label);
		}
		return {
			options,
			categories: new Map(
				categories.map((category: { _id: string; name?: Record<string, string> }) => [
					category._id,
					category.name?.en ?? '',
				]),
			),
		};
	}

	private async facts(rows: readonly ItemRow[]): Promise<StockItemFacts[]> {
		const { options, categories } = await this.labels(rows);
		return rows.map((row) => {
			const sale = row.salePriceINR ?? null;
			return {
				variantId: row._id,
				productId: row.productId,
				sku: row.sku,
				barcode: row.barcode ?? null,
				title: row.p.title ?? {},
				// labels() names every row it is given.
				optionsLabel: options.get(row._id) as string,
				galleryAssetId: row.media?.primaryAssetId ?? row.p.media?.gallery?.[0] ?? null,
				productType: row.p.type,
				productStatus: row.p.status,
				soldBy: row.p.soldBy ?? 'piece',
				madeToOrder: Boolean(row.p.madeToOrder),
				tracked: row.stock?.tracked !== false,
				hsnCode: row.taxProfile?.hsnCode ?? row.p.hsnCode ?? null,
				categoryIds: row.p.categoryIds ?? [],
				categoryName: categories.get(row.p.categoryIds?.[0] ?? '') ?? null,
				sellingPriceINR: sale ?? row.priceINR,
				mrpINR: row.compareAtPriceINR ?? null,
				onHand: row.stock?.quantity ?? 0,
				held: row.stock?.held ?? 0,
				reserved: row.stock?.reserved ?? 0,
				lowStockLevel: row.stock?.lowStockThreshold ?? row.p.lowStockThreshold ?? SHOP_LOW_STOCK_THRESHOLD,
				variantCount: row.variantCount ?? 1,
			};
		});
	}

	private async aggregateItems(
		match: FilterQuery<AggregateDoc>,
		extra: PipelineStage[] = [],
	): Promise<StockItemFacts[]> {
		const rows = await ProductVariantModel.aggregate<ItemRow>([
			{ $match: match },
			...productLookup,
			...extra,
			{
				$lookup: {
					from: 'productVariants',
					let: { pid: '$productId' },
					pipeline: [{ $match: { $expr: { $eq: ['$productId', '$$pid'] } } }, { $count: 'n' }],
					as: 'siblings',
				},
			},
			{ $addFields: { variantCount: { $ifNull: [{ $first: '$siblings.n' }, 1] } } },
		]).exec();
		return this.facts(rows);
	}

	async items(variantIds: readonly string[]): Promise<Map<string, StockItemFacts>> {
		if (variantIds.length === 0) return new Map();
		const facts = await this.aggregateItems({ _id: { $in: [...variantIds] } });
		return new Map(facts.map((fact) => [fact.variantId, fact]));
	}

	async variantsOfProduct(productId: string): Promise<StockItemFacts[]> {
		const facts = await this.aggregateItems({ productId }, [{ $sort: { isBaseVariant: -1, sku: 1 } }]);
		return facts;
	}

	async search(q: string, limit: number): Promise<StockItemFacts[]> {
		const text = q.trim();
		if (!text) return [];
		const prefix = new RegExp(`^${escapeRegex(text)}`, 'i');
		const words = text
			.split(/\s+/)
			.filter(Boolean)
			.map((word) => new RegExp(`\\b${escapeRegex(word)}`, 'i'));
		const products = await ProductModel.find({ $and: words.map((word) => ({ 'title.en': word })) }, { _id: 1 })
			.limit(50)
			.lean<Array<{ _id: string }>>()
			.exec();
		const facts = await this.aggregateItems(
			{
				$or: [
					{ sku: prefix },
					{ barcode: text },
					{ productId: { $in: products.map((product) => product._id) } },
				],
			},
			[
				{
					$addFields: {
						rank: {
							$switch: {
								branches: [
									{ case: { $eq: ['$p.status', 'live'] }, then: 0 },
									{ case: { $eq: ['$p.status', 'draft'] }, then: 1 },
									{ case: { $eq: ['$p.status', 'disabled'] }, then: 2 },
								],
								default: 3,
							},
						},
					},
				},
				{ $sort: { rank: 1, isBaseVariant: -1, sku: 1 } },
				{ $limit: Math.max(limit * 4, 20) },
			],
		);
		// One row per product for a variable product (the variant grid opens from it), else per variant.
		const seen = new Set<string>();
		const out: StockItemFacts[] = [];
		for (const fact of facts) {
			// Bundles hold no stock of their own (V2, A14): no purchase or stock picker offers them.
			if (fact.productType === 'bundle') continue;
			const exactSku = fact.sku.toLowerCase() === text.toLowerCase() || fact.barcode === text;
			const key = fact.productType === 'variable' && !exactSku ? `p:${fact.productId}` : `v:${fact.variantId}`;
			if (seen.has(key)) continue;
			seen.add(key);
			out.push(fact);
			if (out.length >= limit) break;
		}
		return out;
	}

	async bySku(skus: readonly string[]): Promise<Map<string, StockItemFacts>> {
		if (skus.length === 0) return new Map();
		const facts = await this.aggregateItems({ sku: { $in: [...skus] } });
		return new Map(facts.map((fact) => [fact.sku, fact]));
	}

	async list(filter: Parameters<StockReadRepository['list']>[0]) {
		const match: FilterQuery<AggregateDoc> = {};
		if (filter.q) {
			const pattern = new RegExp(escapeRegex(filter.q), 'i');
			const products = await ProductModel.find({ 'title.en': pattern }, { _id: 1 })
				.limit(500)
				.lean<Array<{ _id: string }>>()
				.exec();
			match.$or = [
				{ sku: pattern },
				{ barcode: filter.q },
				{ productId: { $in: products.map((product) => product._id) } },
			];
		}
		const older = await InventoryCostLayerModel.distinct('variantId', {
			quantityRemaining: { $gt: 0 },
			receivedAt: { $lt: new Date(filter.olderThan) },
		}).exec();
		const scope: PipelineStage[] = [
			{ $match: match },
			...productLookup,
			{
				$match: {
					'p.type': { $ne: 'bundle' },
					...(filter.categoryId ? { 'p.categoryIds': filter.categoryId } : {}),
				},
			},
			stockFields,
			{ $addFields: { free: { $subtract: ['$onHand', '$heldUnits'] } } },
		];
		const conditions: Record<typeof filter.filter, FilterQuery<AggregateDoc>> = {
			all: {},
			low: {
				'stock.tracked': { $ne: false },
				$expr: { $and: [{ $gt: ['$free', 0] }, { $lte: ['$free', '$lowLevel'] }] },
			},
			out: { 'stock.tracked': { $ne: false }, free: { $lte: 0 }, 'p.madeToOrder': { $ne: true } },
			held: { heldUnits: { $gt: 0 } },
			older_180: { _id: { $in: older } },
		};
		const { skip, limit } = page(filter);
		const [result] = await ProductVariantModel.aggregate<{
			items: ItemRow[];
			total: Array<{ n: number }>;
			low: Array<{ n: number }>;
			out: Array<{ n: number }>;
			held: Array<{ n: number }>;
			older: Array<{ n: number }>;
		}>([
			...scope,
			{
				$facet: {
					items: [
						{ $match: conditions[filter.filter] },
						{ $sort: { sku: 1 } },
						{ $skip: skip },
						{ $limit: limit },
					],
					total: [{ $match: conditions[filter.filter] }, { $count: 'n' }],
					low: [{ $match: conditions.low }, { $count: 'n' }],
					out: [{ $match: conditions.out }, { $count: 'n' }],
					held: [{ $match: conditions.held }, { $count: 'n' }],
					older: [{ $match: conditions.older_180 }, { $count: 'n' }],
				},
			},
		]).exec();
		// A $facet stage always answers exactly one document.
		const items = await this.facts((result as { items: ItemRow[] }).items);
		const n = (rows: Array<{ n: number }> | undefined) => rows?.[0]?.n ?? 0;
		return {
			items,
			total: n(result?.total),
			counts: { low: n(result?.low), out: n(result?.out), held: n(result?.held), older180: n(result?.older) },
		};
	}

	async totals() {
		const [row] = await ProductVariantModel.aggregate<{
			pieces: number;
			metres: number;
			low: number;
			out: number;
			held: number;
		}>([
			...productLookup,
			{ $match: { 'p.type': { $ne: 'bundle' }, 'stock.tracked': { $ne: false } } },
			stockFields,
			{ $addFields: { free: { $subtract: ['$onHand', '$heldUnits'] }, metre: { $eq: ['$p.soldBy', 'metre'] } } },
			{
				$group: {
					_id: null,
					pieces: { $sum: { $cond: ['$metre', 0, '$onHand'] } },
					metres: { $sum: { $cond: ['$metre', '$onHand', 0] } },
					low: {
						$sum: { $cond: [{ $and: [{ $gt: ['$free', 0] }, { $lte: ['$free', '$lowLevel'] }] }, 1, 0] },
					},
					out: {
						$sum: { $cond: [{ $and: [{ $lte: ['$free', 0] }, { $ne: ['$p.madeToOrder', true] }] }, 1, 0] },
					},
					held: { $sum: { $cond: ['$metre', 0, '$heldUnits'] } },
				},
			},
		]).exec();
		return {
			pieces: row?.pieces ?? 0,
			metresTenths: row?.metres ?? 0,
			low: row?.low ?? 0,
			out: row?.out ?? 0,
			held: row?.held ?? 0,
		};
	}

	private async layerRows(query: QueryFilter<InventoryCostLayerDoc>): Promise<StockLayerRow[]> {
		const docs = await InventoryCostLayerModel.find(query).sort({ receivedAt: 1 }).lean().exec();
		return docs.map((doc) => ({
			id: doc._id,
			variantId: doc.variantId,
			receivedAt: new Date(doc.receivedAt).toISOString(),
			sourceType: doc.sourceType ?? 'purchase_invoice',
			sourceNumber: doc.sourceNumber ?? null,
			purchaseInvoiceId: doc.purchaseInvoiceId ?? null,
			sourceLineId: doc.sourceLineId ?? null,
			quantityReceived: doc.quantityReceived,
			quantityRemaining: doc.quantityRemaining,
			unitCostINR: doc.unitCostINR,
		}));
	}

	openLayers(variantIds: readonly string[]) {
		return this.layerRows({ variantId: { $in: [...variantIds] }, quantityRemaining: { $gt: 0 } });
	}

	layersOf(variantId: string) {
		return this.layerRows({ variantId });
	}

	layersForEntry(entryId: string) {
		return this.layerRows({ purchaseInvoiceId: entryId });
	}

	async ledger(filter: Parameters<StockReadRepository['ledger']>[0]) {
		const query: QueryFilter<InventoryLedgerDoc> = {};
		if (filter.variantId) query.variantId = filter.variantId;
		if (filter.source) query.source = filter.source;
		if (filter.actorId) query.actorUserId = filter.actorId;
		if (filter.referenceIds) query.referenceId = { $in: [...filter.referenceIds] };
		if (filter.from || filter.to) {
			query.createdAt = {
				...(filter.from ? { $gte: new Date(filter.from) } : {}),
				...(filter.to ? { $lte: new Date(filter.to) } : {}),
			};
		}
		const { skip, limit } = page(filter);
		const [docs, total] = await Promise.all([
			InventoryLedgerModel.find(query).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit).lean().exec(),
			InventoryLedgerModel.countDocuments(query).exec(),
		]);
		const items: StockLedgerRow[] = docs.map((doc) => ({
			id: doc._id,
			variantId: doc.variantId,
			productId: doc.productId,
			quantityDelta: doc.quantityDelta,
			heldDelta: doc.heldDelta ?? 0,
			balanceAfter: doc.balanceAfter,
			heldAfter: doc.heldAfter ?? 0,
			source: doc.source,
			reasonCode: doc.reasonCode ?? null,
			note: doc.note ?? null,
			referenceType: doc.referenceType ?? null,
			referenceId: doc.referenceId ?? null,
			referenceNumber: doc.referenceNumber ?? null,
			actorUserId: doc.actorUserId ?? null,
			approverUserId: doc.approverUserId ?? null,
			createdAt: new Date(doc.createdAt).toISOString(),
		}));
		return { items, total };
	}

	async soldSince(variantIds: readonly string[] | null, since: string): Promise<Map<string, number>> {
		const match: FilterQuery<AggregateDoc> = {
			source: { $in: ['order_placed', 'order_cancelled'] },
			createdAt: { $gte: new Date(since) },
		};
		if (variantIds) match.variantId = { $in: [...variantIds] };
		const rows = await InventoryLedgerModel.aggregate<{ _id: string; units: number }>([
			{ $match: match },
			{ $group: { _id: '$variantId', units: { $sum: { $multiply: ['$quantityDelta', -1] } } } },
		]).exec();
		return new Map(rows.map((row) => [row._id, Math.max(0, row.units)]));
	}

	async movedSince(
		variantIds: readonly string[],
		since: string,
		excludeReferenceId: string | null,
	): Promise<Map<string, number>> {
		const match: FilterQuery<AggregateDoc> = {
			variantId: { $in: [...variantIds] },
			createdAt: { $gt: new Date(since) },
		};
		if (excludeReferenceId) match.referenceId = { $ne: excludeReferenceId };
		const rows = await InventoryLedgerModel.aggregate<{ _id: string; units: number }>([
			{ $match: match },
			{ $group: { _id: '$variantId', units: { $sum: '$quantityDelta' } } },
		]).exec();
		return new Map(rows.map((row) => [row._id, row.units]));
	}

	async withMovements(variantIds: readonly string[]): Promise<Set<string>> {
		const ids = await InventoryLedgerModel.distinct('variantId', { variantId: { $in: [...variantIds] } }).exec();
		const stocked = await ProductVariantModel.distinct('_id', {
			_id: { $in: [...variantIds] },
			'stock.quantity': { $ne: 0 },
		}).exec();
		return new Set([...ids.map(String), ...stocked.map(String)]);
	}

	async lastSoldOn(variantIds: readonly string[]): Promise<Map<string, string>> {
		const rows = await InventoryLedgerModel.aggregate<{ _id: string; at: Date }>([
			{ $match: { variantId: { $in: [...variantIds] }, source: 'order_placed' } },
			{ $group: { _id: '$variantId', at: { $max: '$createdAt' } } },
		]).exec();
		return new Map(rows.map((row) => [row._id, new Date(row.at).toISOString().slice(0, 10)]));
	}

	async variantsWithLayersBefore(before: string, pageNumber: number, pageSize: number) {
		const rows = await InventoryCostLayerModel.aggregate<{ _id: string; oldest: Date }>([
			{ $match: { quantityRemaining: { $gt: 0 }, receivedAt: { $lt: new Date(before) } } },
			{ $group: { _id: '$variantId', oldest: { $min: '$receivedAt' } } },
			{ $sort: { oldest: 1 } },
		]).exec();
		const skip = (Math.max(pageNumber, 1) - 1) * pageSize;
		return { variantIds: rows.slice(skip, skip + pageSize).map((row) => row._id), total: rows.length };
	}

	/**
	 * Stock value on a past day: every layer received by then, less what left it after then is
	 * not tracked per layer, so the value is rebuilt from the ledger: units on that day per
	 * variant (current on-hand minus movements after the day), valued at the layers received by
	 * then, newest kept (FIFO keeps the newest pieces).
	 */
	async valuationAsOf(
		endOfDay: string,
	): Promise<Array<{ variantId: string; units: number; valueINR: number; uncostedUnits: number }>> {
		const end = new Date(endOfDay);
		const [after, current, layers] = await Promise.all([
			InventoryLedgerModel.aggregate<{ _id: string; units: number }>([
				{ $match: { createdAt: { $gt: end } } },
				{ $group: { _id: '$variantId', units: { $sum: '$quantityDelta' } } },
			]).exec(),
			ProductVariantModel.find({ 'stock.tracked': { $ne: false } }, { 'stock.quantity': 1 })
				.lean<Array<{ _id: string; stock?: { quantity?: number } }>>()
				.exec(),
			InventoryCostLayerModel.find(
				// Layers as they stood that day: recorded (posted) by its end, so a closed period never changes.
				{ createdAt: { $lte: end } },
				{ variantId: 1, receivedAt: 1, quantityReceived: 1, unitCostINR: 1 },
			)
				.sort({ createdAt: -1 })
				.lean()
				.exec(),
		]);
		const moved = new Map(after.map((row) => [row._id, row.units]));
		const byVariant = new Map<string, Array<{ quantity: number; unitCostINR: number }>>();
		for (const layer of layers) {
			const list = byVariant.get(layer.variantId) ?? [];
			list.push({ quantity: layer.quantityReceived, unitCostINR: layer.unitCostINR });
			byVariant.set(layer.variantId, list);
		}
		const out: Array<{ variantId: string; units: number; valueINR: number; uncostedUnits: number }> = [];
		for (const variant of current) {
			const units = (variant.stock?.quantity ?? 0) - (moved.get(variant._id) ?? 0);
			if (units <= 0) continue;
			let left = units;
			let paise = 0;
			for (const layer of byVariant.get(variant._id) ?? []) {
				if (left <= 0) break;
				const take = Math.min(left, layer.quantity);
				paise += Math.round(take * layer.unitCostINR * 100);
				left -= take;
			}
			// Units the layers cannot cover (stock typed in before the ledger) have no cost: say so.
			out.push({ variantId: variant._id, units, valueINR: paise / 100, uncostedUnits: Math.max(0, left) });
		}
		return out;
	}

	async productSkusInCategory(categoryId: string): Promise<string[]> {
		const ids = await ProductModel.distinct('sku', { categoryIds: categoryId }).exec();
		return ids.map(String);
	}

	async variantIdsInScope(scope: { kind: 'all' | 'categories'; categoryIds: readonly string[] }): Promise<string[]> {
		const productQuery: Record<string, unknown> = { type: { $ne: 'bundle' }, status: { $ne: 'discontinued' } };
		if (scope.kind === 'categories') productQuery.categoryIds = { $in: [...scope.categoryIds] };
		const products = await ProductModel.find(productQuery, { _id: 1 }).lean<Array<{ _id: string }>>().exec();
		const ids = await ProductVariantModel.distinct('_id', {
			productId: { $in: products.map((product) => product._id) },
			'stock.tracked': { $ne: false },
		}).exec();
		return ids.map(String);
	}
}
