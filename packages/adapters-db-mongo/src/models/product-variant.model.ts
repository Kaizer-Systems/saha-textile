import { type Model, Schema, model, models } from 'mongoose';

/**
 * Purchasable SKU rows (`productVariants`) — first-class, not embedded in the product.
 *
 * Stock lives here, never on the parent product, so a stock write touches one small
 * document instead of rewriting a large product with its media and options.
 */
export interface ProductVariantDoc {
	_id: string;
	productId: string;
	sku: string;
	status: string;
	optionSelections: Array<{ attributeCode: string; termCode: string }>;
	optionSelectionHash: string;
	isBaseVariant: boolean;
	priceINR: number;
	compareAtPriceINR: number | null;
	salePriceINR: number | null;
	saleWindow?: { startsAt: Date | null; endsAt: Date | null };
	stock: { tracked: boolean; quantity: number; lowStockThreshold: number | null; allowBackorder: boolean };
	shippingProfile?: Record<string, number | null>;
	taxProfile?: { hsnCode: string | null; taxClassId: string | null };
	media?: { primaryAssetId: string | null };
	createdAt?: Date;
	updatedAt?: Date;
}

const ProductVariantSchema = new Schema<ProductVariantDoc>(
	{
		_id: { type: String, required: true },
		productId: { type: String, required: true },
		sku: { type: String, required: true },
		status: { type: String, enum: ['draft', 'live', 'disabled', 'discontinued'], default: 'draft' },
		optionSelections: {
			type: [{ _id: false, attributeCode: String, termCode: String }],
			default: [],
		},
		optionSelectionHash: { type: String, required: true },
		isBaseVariant: { type: Boolean, default: false },
		priceINR: { type: Number, required: true },
		compareAtPriceINR: { type: Number, default: null },
		salePriceINR: { type: Number, default: null },
		saleWindow: { type: Schema.Types.Mixed },
		stock: {
			tracked: { type: Boolean, default: true },
			quantity: { type: Number, default: 0 },
			lowStockThreshold: { type: Number, default: null },
			allowBackorder: { type: Boolean, default: false },
		},
		shippingProfile: { type: Schema.Types.Mixed },
		taxProfile: { type: Schema.Types.Mixed },
		media: { type: Schema.Types.Mixed },
	},
	{ collection: 'productVariants', timestamps: true },
);

/** One row per option combination per product — the duplicate guard. */
ProductVariantSchema.index({ productId: 1, optionSelectionHash: 1 }, { unique: true });
/** SKUs are globally unique (`DEC-SKU`). */
ProductVariantSchema.index({ sku: 1 }, { unique: true });
/** Listing a product's purchasable rows. */
ProductVariantSchema.index({ productId: 1, status: 1 });
/** Search/reindex sweeps by recency. */
ProductVariantSchema.index({ status: 1, updatedAt: -1 });

export const ProductVariantModel: Model<ProductVariantDoc> =
	(models.ProductVariant as Model<ProductVariantDoc>) ??
	model<ProductVariantDoc>('ProductVariant', ProductVariantSchema);
