import { type Model, Schema, model, models } from 'mongoose';

/** One customer waiting on one variant (`stockAlerts`). */
export interface StockAlertDoc {
	_id: string;
	customerId: string;
	productId: string;
	variantId: string;
	createdAt: Date;
	notifiedAt?: Date | null;
	lastError?: string | null;
}

const StockAlertSchema = new Schema<StockAlertDoc>(
	{
		_id: { type: String, required: true },
		customerId: { type: String, required: true },
		productId: { type: String, required: true },
		variantId: { type: String, required: true },
		createdAt: { type: Date, required: true },
		notifiedAt: { type: Date, default: null },
		lastError: { type: String, default: null },
	},
	{ collection: 'stockAlerts' },
);

StockAlertSchema.index({ customerId: 1, variantId: 1 }, { unique: true });
StockAlertSchema.index({ notifiedAt: 1, createdAt: 1, _id: 1 });

export const StockAlertModel: Model<StockAlertDoc> =
	(models.StockAlert as Model<StockAlertDoc>) ?? model<StockAlertDoc>('StockAlert', StockAlertSchema);

/** One week's saved analytics (`productInsightSets`). */
export interface ProductInsightSetDoc {
	_id: string;
	generatedAt: Date;
	bestseller: string[];
	trending: string[];
	relations: number;
}

const ProductInsightSetSchema = new Schema<ProductInsightSetDoc>(
	{
		_id: { type: String, required: true },
		generatedAt: { type: Date, required: true },
		bestseller: { type: [String], default: [] },
		trending: { type: [String], default: [] },
		relations: { type: Number, default: 0 },
	},
	{ collection: 'productInsightSets' },
);

export const ProductInsightSetModel: Model<ProductInsightSetDoc> =
	(models.ProductInsightSet as Model<ProductInsightSetDoc>) ??
	model<ProductInsightSetDoc>('ProductInsightSet', ProductInsightSetSchema);
