import { PaymentGateway } from '@saha-textile/contracts';
import { type Model, Schema, model, models } from 'mongoose';

export interface OrderDoc {
	_id: string;
	orderNumber: string;
	userId: string | null;
	currency: string;
	locale?: string;
	lines: unknown[];
	subtotalINR: number;
	subtotalPaid: number;
	shipping?: Record<string, unknown>;
	promotionsApplied: unknown[];
	totalINR: number;
	totalPaid: number;
	gateway?: string;
	status: string;
	statusTimeline: unknown[];
	channel?: string;
	paymentStatus?: string;
	revision?: number;
	orderNumberKey?: string;
	searchKeys?: string[];
	idempotencyKey?: string;
	attention?: string[];
	createdAt?: Date;
	updatedAt?: Date;
}

const OrderSchema = new Schema<OrderDoc>(
	{
		_id: { type: String, required: true },
		orderNumber: { type: String, required: true },
		userId: { type: String, default: null },
		currency: { type: String, required: true },
		locale: { type: String, default: 'en' },
		lines: { type: [Schema.Types.Mixed], default: [] },
		subtotalINR: { type: Number, required: true },
		subtotalPaid: { type: Number, required: true },
		shipping: { type: Schema.Types.Mixed },
		promotionsApplied: { type: [Schema.Types.Mixed], default: [] },
		totalINR: { type: Number, required: true },
		totalPaid: { type: Number, required: true },
		gateway: { type: String, enum: PaymentGateway.options },
		status: { type: String, default: 'pending' },
		statusTimeline: { type: [Schema.Types.Mixed], default: [] },
		/* Orders and checkout build (2026-11-20). The rest of the order record (buyer, addresses, the
		   rate record, zone, coupons, balance, e-documents, history) is stored in the contract's shape
		   without a schema of its own (`strict: false`); these are the fields queries use. */
		channel: { type: String, default: 'shop' },
		paymentStatus: { type: String, default: 'unpaid' },
		revision: { type: Number, default: 0 },
		/** The order number with separators stripped, upper case: unique, and what search compares. */
		orderNumberKey: { type: String },
		/** Normalised search words: number forms, buyer name words, email, phone digits, tracking and payment references. */
		searchKeys: { type: [String], default: [] },
		/** The create-order screen's key, so a double click can't create two orders. */
		idempotencyKey: { type: String },
		/** Staff attention reasons (invoice address needed, a request expired unpaid…), kept in step with the order. */
		attention: { type: [String], default: [] },
	},
	{ collection: 'orders', timestamps: true, strict: false },
);

OrderSchema.index({ orderNumber: 1 }, { unique: true });
OrderSchema.index({ userId: 1, createdAt: -1 });
OrderSchema.index({ status: 1 });
OrderSchema.index({ status: 1, createdAt: -1 });
/** The admin home page's newest orders, in any status. */
OrderSchema.index({ createdAt: -1 });
OrderSchema.index(
	{ orderNumberKey: 1 },
	{ unique: true, partialFilterExpression: { orderNumberKey: { $type: 'string' } } },
);
OrderSchema.index(
	{ idempotencyKey: 1 },
	{ unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } },
);
OrderSchema.index({ searchKeys: 1, createdAt: -1 });
OrderSchema.index({ channel: 1, createdAt: -1 });
OrderSchema.index({ paymentStatus: 1, createdAt: -1 });
OrderSchema.index({ attention: 1, createdAt: -1 });
OrderSchema.index({ 'buyer.businessId': 1, createdAt: -1 });
OrderSchema.index({ 'buyer.customerId': 1, createdAt: -1 });

export const OrderModel: Model<OrderDoc> = (models.Order as Model<OrderDoc>) ?? model<OrderDoc>('Order', OrderSchema);
