import { type Model, Schema, model, models } from 'mongoose';

/**
 * Append-only stock movements (`inventoryLedger`).
 *
 * There is no update path: a mistake is corrected with a compensating row, so the history
 * of how a quantity reached its current value is always intact. `balanceAfter` is recorded
 * on each row so an audit can be read without replaying the whole ledger.
 */
export interface InventoryLedgerDoc {
	_id: string;
	variantId: string;
	productId: string;
	quantityDelta: number;
	balanceAfter: number;
	source: string;
	reasonCode: string | null;
	note: string | null;
	referenceType: string | null;
	referenceId: string | null;
	actorUserId: string | null;
	createdAt: Date;
}

const InventoryLedgerSchema = new Schema<InventoryLedgerDoc>(
	{
		_id: { type: String, required: true },
		variantId: { type: String, required: true },
		productId: { type: String, required: true },
		quantityDelta: { type: Number, required: true },
		balanceAfter: { type: Number, required: true },
		source: {
			type: String,
			enum: [
				'manual_adjustment',
				'purchase_invoice',
				'order_placed',
				'order_cancelled',
				'return_restocked',
				'reservation',
				'reservation_released',
				'system_migration',
			],
			required: true,
		},
		reasonCode: { type: String, default: null },
		note: { type: String, default: null },
		referenceType: { type: String, default: null },
		referenceId: { type: String, default: null },
		actorUserId: { type: String, default: null },
	},
	{ timestamps: { createdAt: true, updatedAt: false } },
);

/** The audit query: one variant's movements, newest first. */
InventoryLedgerSchema.index({ variantId: 1, createdAt: -1 });
/** Reconciling a specific order or purchase invoice against stock. */
InventoryLedgerSchema.index({ referenceType: 1, referenceId: 1 });
/** Reporting sweeps by movement type and period. */
InventoryLedgerSchema.index({ source: 1, createdAt: -1 });
/** No TTL: the ledger is permanent financial evidence. */

export const InventoryLedgerModel: Model<InventoryLedgerDoc> =
	(models.InventoryLedger as Model<InventoryLedgerDoc>) ??
	model<InventoryLedgerDoc>('InventoryLedger', InventoryLedgerSchema);

/**
 * FIFO cost layers (`inventoryCostLayers`).
 *
 * Admin/reporting only — FIFO and COGS detail is never customer-facing (owner lock), so no
 * public DTO may be derived from this shape.
 */
export interface InventoryCostLayerDoc {
	_id: string;
	variantId: string;
	purchaseInvoiceId: string | null;
	unitCostINR: number;
	quantityReceived: number;
	quantityRemaining: number;
	receivedAt: Date;
	createdAt?: Date;
}

const InventoryCostLayerSchema = new Schema<InventoryCostLayerDoc>(
	{
		_id: { type: String, required: true },
		variantId: { type: String, required: true },
		purchaseInvoiceId: { type: String, default: null },
		unitCostINR: { type: Number, required: true },
		quantityReceived: { type: Number, required: true },
		quantityRemaining: { type: Number, required: true },
		receivedAt: { type: Date, required: true },
	},
	{ timestamps: { createdAt: true, updatedAt: false } },
);

/**
 * The FIFO draw: open layers for a variant, OLDEST first. The partial filter keeps
 * exhausted layers out of the index the hot path scans.
 */
InventoryCostLayerSchema.index(
	{ variantId: 1, receivedAt: 1 },
	{ partialFilterExpression: { quantityRemaining: { $gt: 0 } } },
);
InventoryCostLayerSchema.index({ purchaseInvoiceId: 1 });

export const InventoryCostLayerModel: Model<InventoryCostLayerDoc> =
	(models.InventoryCostLayer as Model<InventoryCostLayerDoc>) ??
	model<InventoryCostLayerDoc>('InventoryCostLayer', InventoryCostLayerSchema);
