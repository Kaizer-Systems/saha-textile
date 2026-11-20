import { type Model, Schema, model, models } from 'mongoose';

import { COLLECTION_NAMES } from '../collection-names';

/**
 * Orders and checkout build (brief v2.1, approved 2026-11-20): payments, payment requests,
 * shipments, the businesses' two accounts, zones, coupons and their uses.
 *
 * Each record is stored in the shape of its contract (`@saha-textile/contracts`) with `_id` for
 * `id`, parsed with zod on read. The schemas name only the fields that queries and indexes use;
 * the rest of the shape is the contract's (`strict: false`, as the purchases module does). Every
 * field a filter uses is declared: the connection sets `strictQuery`, which drops undeclared ones.
 */

const loose = { strict: false, versionKey: false, timestamps: false } as const;

export interface OrdersBuildDoc {
	_id: string;
	[key: string]: unknown;
}

/* ------------------------------------------------------------------ payments */

const PaymentSchema = new Schema<OrdersBuildDoc>(
	{
		_id: { type: String, required: true },
		orderId: { type: String, required: true },
		method: { type: String, required: true },
		state: { type: String, required: true },
		recordedAt: { type: String, required: true },
		/** Gateway payments: `${gateway}:${reference}`, so a capture reported twice is recorded once. */
		gatewayKey: { type: String, default: null },
		/** Lower-case reference, for the orders list search. */
		referenceKey: { type: String, default: null },
	},
	{ ...loose, collection: COLLECTION_NAMES.Payment },
);
PaymentSchema.index({ orderId: 1, recordedAt: 1 });
PaymentSchema.index({ gatewayKey: 1 }, { unique: true, partialFilterExpression: { gatewayKey: { $type: 'string' } } });
PaymentSchema.index({ referenceKey: 1 });

export const PaymentModel: Model<OrdersBuildDoc> =
	(models.Payment as Model<OrdersBuildDoc>) ?? model<OrdersBuildDoc>('Payment', PaymentSchema);

/* ------------------------------------------------------------------ payment requests */

const PaymentRequestSchema = new Schema<OrdersBuildDoc>(
	{
		_id: { type: String, required: true },
		orderId: { type: String, required: true },
		status: { type: String, required: true },
		expiresAt: { type: String, required: true },
		tokenHash: { type: String, required: true },
		gatewayKey: { type: String, default: null },
		createdAt: { type: String, required: true },
	},
	{ ...loose, collection: COLLECTION_NAMES.PaymentRequest },
);
PaymentRequestSchema.index({ orderId: 1, createdAt: 1 });
PaymentRequestSchema.index({ tokenHash: 1 }, { unique: true });
PaymentRequestSchema.index(
	{ gatewayKey: 1 },
	{ unique: true, partialFilterExpression: { gatewayKey: { $type: 'string' } } },
);
PaymentRequestSchema.index({ status: 1, expiresAt: 1 });

export const PaymentRequestModel: Model<OrdersBuildDoc> =
	(models.PaymentRequest as Model<OrdersBuildDoc>) ?? model<OrdersBuildDoc>('PaymentRequest', PaymentRequestSchema);

/* ------------------------------------------------------------------ shop payment attempts */

const PaymentAttemptSchema = new Schema<OrdersBuildDoc>(
	{
		_id: { type: String, required: true },
		orderId: { type: String, required: true },
		state: { type: String, required: true },
		/** When the status enquiry runs again while the attempt is pending. */
		nextCheckAt: { type: String, default: null },
		createdAt: { type: String, required: true },
	},
	{ ...loose, collection: COLLECTION_NAMES.PaymentAttempt },
);
PaymentAttemptSchema.index({ orderId: 1, createdAt: 1 });
PaymentAttemptSchema.index(
	{ state: 1, nextCheckAt: 1 },
	{ partialFilterExpression: { nextCheckAt: { $type: 'string' } } },
);

export const PaymentAttemptModel: Model<OrdersBuildDoc> =
	(models.PaymentAttempt as Model<OrdersBuildDoc>) ?? model<OrdersBuildDoc>('PaymentAttempt', PaymentAttemptSchema);

/* ------------------------------------------------------------------ shipments */

const ShipmentSchema = new Schema<OrdersBuildDoc>(
	{
		_id: { type: String, required: true },
		orderId: { type: String, required: true },
		courierName: { type: String, required: true },
		/** Lower-case tracking number, for the orders list search. */
		trackingKey: { type: String, required: true },
		createdAt: { type: String, required: true },
	},
	{ ...loose, collection: COLLECTION_NAMES.Shipment },
);
ShipmentSchema.index({ orderId: 1, createdAt: 1 });
ShipmentSchema.index({ trackingKey: 1 });
ShipmentSchema.index({ courierName: 1 });

export const ShipmentModel: Model<OrdersBuildDoc> =
	(models.Shipment as Model<OrdersBuildDoc>) ?? model<OrdersBuildDoc>('Shipment', ShipmentSchema);

/* ------------------------------------------------------------------ the two accounts */

const LedgerEntrySchema = new Schema<OrdersBuildDoc>(
	{
		_id: { type: String, required: true },
		businessId: { type: String, required: true },
		side: { type: String, required: true },
		amountINR: { type: Number, required: true },
		at: { type: String, required: true },
		documentId: { type: String, required: true },
	},
	{ ...loose, collection: COLLECTION_NAMES.LedgerEntry },
);
LedgerEntrySchema.index({ businessId: 1, side: 1, at: 1 });
LedgerEntrySchema.index({ documentId: 1 });

export const LedgerEntryModel: Model<OrdersBuildDoc> =
	(models.LedgerEntry as Model<OrdersBuildDoc>) ?? model<OrdersBuildDoc>('LedgerEntry', LedgerEntrySchema);

/* ------------------------------------------------------------------ zones */

const PriceZoneSchema = new Schema<OrdersBuildDoc>(
	{
		_id: { type: String, required: true },
		code: { type: String, required: true },
		status: { type: String, required: true },
		/** RETAIL: never deleted (declared because `strictQuery` drops undeclared filter fields). */
		system: { type: Boolean, default: false },
		revision: { type: Number, required: true },
	},
	{ ...loose, collection: COLLECTION_NAMES.PriceZone },
);
PriceZoneSchema.index({ code: 1 }, { unique: true });

export const PriceZoneModel: Model<OrdersBuildDoc> =
	(models.PriceZone as Model<OrdersBuildDoc>) ?? model<OrdersBuildDoc>('PriceZone', PriceZoneSchema);

/* ------------------------------------------------------------------ coupons */

const CouponSchema = new Schema<OrdersBuildDoc>(
	{
		_id: { type: String, required: true },
		code: { type: String, required: true },
		title: { type: String, default: '' },
		enabled: { type: Boolean, required: true },
		/** `{ shop, admin }`: where the coupon can be used. */
		channels: { type: Schema.Types.Mixed, default: { shop: true, admin: true } },
		usedCount: { type: Number, default: 0 },
		totalUses: { type: Number, default: null },
		revision: { type: Number, required: true },
		validFrom: { type: String, default: null },
		validUntil: { type: String, default: null },
		deletedAt: { type: String, default: null },
	},
	{ ...loose, collection: COLLECTION_NAMES.Coupon },
);
CouponSchema.index({ code: 1 }, { unique: true, partialFilterExpression: { deletedAt: null } });
CouponSchema.index({ deletedAt: 1, enabled: 1, validUntil: 1 });

export const CouponModel: Model<OrdersBuildDoc> =
	(models.Coupon as Model<OrdersBuildDoc>) ?? model<OrdersBuildDoc>('Coupon', CouponSchema);

/** One use of a coupon on one order, by one buyer (per-customer limits). */
const CouponUseSchema = new Schema<OrdersBuildDoc>(
	{
		_id: { type: String, required: true },
		couponId: { type: String, required: true },
		buyerKey: { type: String, required: true },
		orderId: { type: String, required: true },
		at: { type: String, required: true },
	},
	{ ...loose, collection: COLLECTION_NAMES.CouponUse },
);
CouponUseSchema.index({ couponId: 1, orderId: 1 }, { unique: true });
CouponUseSchema.index({ couponId: 1, buyerKey: 1 });

export const CouponUseModel: Model<OrdersBuildDoc> =
	(models.CouponUse as Model<OrdersBuildDoc>) ?? model<OrdersBuildDoc>('CouponUse', CouponUseSchema);
