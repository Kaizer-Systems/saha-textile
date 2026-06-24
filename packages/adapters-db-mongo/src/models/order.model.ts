import { type Model, Schema, model, models } from 'mongoose';

export interface OrderDoc {
	_id: string;
	orderNumber: string;
	userId: string | null;
	currency: string;
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
	createdAt?: Date;
	updatedAt?: Date;
}

const OrderSchema = new Schema<OrderDoc>(
	{
		_id: { type: String, required: true },
		orderNumber: { type: String, required: true },
		userId: { type: String, default: null },
		currency: { type: String, required: true },
		lines: { type: [Schema.Types.Mixed], default: [] },
		subtotalINR: { type: Number, required: true },
		subtotalPaid: { type: Number, required: true },
		shipping: { type: Schema.Types.Mixed },
		promotionsApplied: { type: [Schema.Types.Mixed], default: [] },
		totalINR: { type: Number, required: true },
		totalPaid: { type: Number, required: true },
		gateway: { type: String, enum: ['ccavenue', 'paypal'] },
		status: { type: String, default: 'pending' },
		statusTimeline: { type: [Schema.Types.Mixed], default: [] },
	},
	{ timestamps: true },
);

OrderSchema.index({ orderNumber: 1 }, { unique: true });
OrderSchema.index({ userId: 1, createdAt: -1 });
OrderSchema.index({ status: 1 });

export const OrderModel: Model<OrderDoc> = (models.Order as Model<OrderDoc>) ?? model<OrderDoc>('Order', OrderSchema);
