import { type Model, Schema, model, models } from 'mongoose';

/**
 * One saved product of a signed-in customer (owner decision 2026-11-08). The id is
 * `customerId:productId`, so saving twice is one row; guests keep their list in a session
 * cookie and never reach this collection.
 */
export interface WishlistItemDoc {
	_id: string;
	customerId: string;
	productId: string;
	addedAt: Date;
}

const WishlistItemSchema = new Schema<WishlistItemDoc>(
	{
		_id: { type: String, required: true },
		customerId: { type: String, required: true },
		productId: { type: String, required: true },
		addedAt: { type: Date, required: true },
	},
	{ collection: 'wishlistItems', versionKey: false },
);

/** A customer's list, newest first. */
WishlistItemSchema.index({ customerId: 1, addedAt: -1 });

export const WishlistItemModel: Model<WishlistItemDoc> =
	(models.WishlistItem as Model<WishlistItemDoc>) ?? model<WishlistItemDoc>('WishlistItem', WishlistItemSchema);
