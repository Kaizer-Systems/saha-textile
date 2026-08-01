import { randomUUID } from 'node:crypto';

import type { InventoryCostLayer, InventoryLedgerEntry, VariantStockSnapshot } from '@saha-textile/contracts';
import type {
	InventoryCostLayerRepository,
	InventoryLedgerFilter,
	InventoryRepository,
	Paginated,
	TransactionContext,
} from '@saha-textile/core-domain';

import {
	InventoryCostLayerModel,
	type InventoryCostLayerDoc,
	InventoryLedgerModel,
	type InventoryLedgerDoc,
	ProductVariantModel,
} from '../models/index';
import { sessionFrom } from '../transaction-manager';

const iso = (value: Date): string => new Date(value).toISOString();

/** Raised when a movement would take tracked stock negative without backorder allowed. */
export class InsufficientStockError extends Error {
	constructor(readonly variantId: string) {
		super(`insufficient stock for variant ${variantId}`);
		this.name = 'InsufficientStockError';
	}
}

const toLedgerEntry = (doc: InventoryLedgerDoc): InventoryLedgerEntry => ({
	id: doc._id,
	variantId: doc.variantId,
	productId: doc.productId,
	quantityDelta: doc.quantityDelta,
	balanceAfter: doc.balanceAfter,
	source: doc.source as InventoryLedgerEntry['source'],
	reasonCode: (doc.reasonCode as InventoryLedgerEntry['reasonCode']) ?? null,
	note: doc.note ?? null,
	referenceType: doc.referenceType ?? null,
	referenceId: doc.referenceId ?? null,
	actorUserId: doc.actorUserId ?? null,
	createdAt: iso(doc.createdAt),
});

export class MongoInventoryRepository implements InventoryRepository {
	async getSnapshot(variantId: string): Promise<VariantStockSnapshot | null> {
		const doc = await ProductVariantModel.findById(variantId)
			.select('stock')
			.lean<{ _id: string; stock: { quantity: number; lowStockThreshold: number | null } }>()
			.exec();
		if (!doc) return null;

		return {
			variantId: doc._id,
			onHand: doc.stock?.quantity ?? 0,
			// Reservations are a seam (`DEC-STOCK-RESERVE`); until that engine exists,
			// nothing is reserved and available equals on-hand.
			reserved: 0,
			available: doc.stock?.quantity ?? 0,
			lowStockThreshold: doc.stock?.lowStockThreshold ?? null,
		};
	}

	async getSnapshots(variantIds: readonly string[]): Promise<VariantStockSnapshot[]> {
		const docs = await ProductVariantModel.find({ _id: { $in: [...variantIds] } })
			.select('stock')
			.lean<Array<{ _id: string; stock: { quantity: number; lowStockThreshold: number | null } }>>()
			.exec();

		return docs.map((doc) => ({
			variantId: doc._id,
			onHand: doc.stock?.quantity ?? 0,
			reserved: 0,
			available: doc.stock?.quantity ?? 0,
			lowStockThreshold: doc.stock?.lowStockThreshold ?? null,
		}));
	}

	/**
	 * Moves stock and appends the ledger row.
	 *
	 * The stock change is a SINGLE conditional `$inc`, not read-then-write: two concurrent
	 * checkouts must not both read the same balance and each write it back, which is how
	 * overselling happens. The condition (`quantity >= |delta|` for a tracked decrement
	 * without backorder) lives in the query itself, so the guard cannot be raced either —
	 * a decrement that would go negative matches no document and throws.
	 *
	 * When a transaction context is supplied, the `$inc` and the ledger insert commit
	 * together; without one the `$inc` is still atomic on its own, and the ledger row
	 * follows immediately.
	 */
	async applyDelta(
		entry: Omit<InventoryLedgerEntry, 'id' | 'balanceAfter'>,
		context?: TransactionContext,
	): Promise<InventoryLedgerEntry> {
		const session = sessionFrom(context);

		const guard =
			entry.quantityDelta < 0
				? {
						$or: [
							{ 'stock.tracked': false },
							{ 'stock.allowBackorder': true },
							{ 'stock.quantity': { $gte: Math.abs(entry.quantityDelta) } },
						],
					}
				: {};

		const updated = await ProductVariantModel.findOneAndUpdate(
			{ _id: entry.variantId, ...guard },
			{ $inc: { 'stock.quantity': entry.quantityDelta } },
			{ returnDocument: 'after', session },
		)
			.select('stock')
			.lean<{ _id: string; stock: { quantity: number } }>()
			.exec();

		if (!updated) throw new InsufficientStockError(entry.variantId);

		const row: InventoryLedgerDoc = {
			_id: `led_${randomUUID()}`,
			variantId: entry.variantId,
			productId: entry.productId,
			quantityDelta: entry.quantityDelta,
			balanceAfter: updated.stock.quantity,
			source: entry.source,
			reasonCode: entry.reasonCode ?? null,
			note: entry.note ?? null,
			referenceType: entry.referenceType ?? null,
			referenceId: entry.referenceId ?? null,
			actorUserId: entry.actorUserId ?? null,
			createdAt: new Date(entry.createdAt),
		};

		await InventoryLedgerModel.create([row], { session });
		return toLedgerEntry(row);
	}

	async listLedger(filter: InventoryLedgerFilter): Promise<Paginated<InventoryLedgerEntry>> {
		const query: Record<string, unknown> = {};
		if (filter.variantId) query.variantId = filter.variantId;
		if (filter.productId) query.productId = filter.productId;
		if (filter.source) query.source = filter.source;
		if (filter.from || filter.to) {
			query.createdAt = {
				...(filter.from ? { $gte: new Date(filter.from) } : {}),
				...(filter.to ? { $lte: new Date(filter.to) } : {}),
			};
		}

		const page = filter.page && filter.page > 0 ? filter.page : 1;
		const pageSize = filter.pageSize && filter.pageSize > 0 ? filter.pageSize : 20;

		const [docs, total] = await Promise.all([
			InventoryLedgerModel.find(query)
				.sort({ createdAt: -1 })
				.skip((page - 1) * pageSize)
				.limit(pageSize)
				.lean<InventoryLedgerDoc[]>()
				.exec(),
			InventoryLedgerModel.countDocuments(query).exec(),
		]);

		return { items: docs.map(toLedgerEntry), total, page, pageSize };
	}
}

const toCostLayer = (doc: InventoryCostLayerDoc): InventoryCostLayer => ({
	id: doc._id,
	variantId: doc.variantId,
	purchaseInvoiceId: doc.purchaseInvoiceId ?? null,
	unitCostINR: doc.unitCostINR,
	quantityReceived: doc.quantityReceived,
	quantityRemaining: doc.quantityRemaining,
	receivedAt: iso(doc.receivedAt),
	createdAt: doc.createdAt ? iso(doc.createdAt) : undefined,
});

export class MongoInventoryCostLayerRepository implements InventoryCostLayerRepository {
	async listOpenLayers(variantId: string): Promise<InventoryCostLayer[]> {
		const docs = await InventoryCostLayerModel.find({ variantId, quantityRemaining: { $gt: 0 } })
			.sort({ receivedAt: 1 })
			.lean<InventoryCostLayerDoc[]>()
			.exec();
		return docs.map(toCostLayer);
	}

	async createLayer(layer: InventoryCostLayer, context?: TransactionContext): Promise<InventoryCostLayer> {
		const { id, receivedAt, createdAt, ...rest } = layer;
		await InventoryCostLayerModel.create(
			[
				{
					_id: id,
					...rest,
					receivedAt: new Date(receivedAt),
					createdAt: createdAt ? new Date(createdAt) : new Date(),
				},
			],
			{ session: sessionFrom(context) },
		);
		return layer;
	}

	/**
	 * Draws `quantity` oldest-first and returns exactly what came from where, so COGS can be
	 * computed and audited rather than estimated.
	 *
	 * Each layer is decremented with a conditional update that also asserts the layer still
	 * holds what was planned; if a concurrent draw took it first, that layer contributes
	 * nothing and the loop moves on. Callers run this inside a transaction so a partially
	 * consumed set rolls back together with the movement that triggered it.
	 */
	async consumeFifo(
		input: { variantId: string; quantity: number },
		context?: TransactionContext,
	): Promise<Array<{ layerId: string; quantity: number; unitCostINR: number }>> {
		if (input.quantity <= 0) return [];
		const session = sessionFrom(context);

		const layers = await InventoryCostLayerModel.find({ variantId: input.variantId, quantityRemaining: { $gt: 0 } })
			.sort({ receivedAt: 1 })
			.session(session ?? null)
			.lean<InventoryCostLayerDoc[]>()
			.exec();

		const allocations: Array<{ layerId: string; quantity: number; unitCostINR: number }> = [];
		let outstanding = input.quantity;

		for (const layer of layers) {
			if (outstanding <= 0) break;
			const take = Math.min(outstanding, layer.quantityRemaining);

			const updated = await InventoryCostLayerModel.findOneAndUpdate(
				{ _id: layer._id, quantityRemaining: { $gte: take } },
				{ $inc: { quantityRemaining: -take } },
				{ returnDocument: 'after', session },
			)
				.lean<InventoryCostLayerDoc>()
				.exec();

			if (!updated) continue;
			allocations.push({ layerId: layer._id, quantity: take, unitCostINR: layer.unitCostINR });
			outstanding -= take;
		}

		if (outstanding > 0) {
			// Fewer costed units exist than are being sold. Surfacing this is deliberate:
			// silently costing the remainder at zero would corrupt margin reporting.
			throw new Error(
				`insufficient FIFO cost layers for variant ${input.variantId}: ${outstanding} unit(s) uncosted`,
			);
		}

		return allocations;
	}

	/** Reverses a consumption (cancellation, restocked return) back onto its own layers. */
	async releaseFifo(
		input: { variantId: string; allocations: Array<{ layerId: string; quantity: number }> },
		context?: TransactionContext,
	): Promise<void> {
		const session = sessionFrom(context);
		for (const allocation of input.allocations) {
			await InventoryCostLayerModel.updateOne(
				{ _id: allocation.layerId, variantId: input.variantId },
				{ $inc: { quantityRemaining: allocation.quantity } },
				{ session },
			).exec();
		}
	}
}
