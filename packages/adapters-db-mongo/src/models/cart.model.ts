import { type Model, Schema, model, models } from 'mongoose';

export interface CartDoc {
	_id: string;
	userId: string | null;
	guestToken: string | null;
	currency: string;
	lines: unknown[];
	createdAt?: Date;
	updatedAt?: Date;
}

const CartSchema = new Schema<CartDoc>(
	{
		_id: { type: String, required: true },
		userId: { type: String, default: null },
		/** HMAC hash of the opaque `st_guest` cookie — never the raw bearer. */
		guestToken: { type: String, default: null },
		currency: { type: String, default: 'INR' },
		lines: { type: [Schema.Types.Mixed], default: [] },
	},
	{ collection: 'carts', timestamps: true },
);

CartSchema.index({ userId: 1 });
CartSchema.index({ guestToken: 1 });

export const CartModel: Model<CartDoc> = (models.Cart as Model<CartDoc>) ?? model<CartDoc>('Cart', CartSchema);
