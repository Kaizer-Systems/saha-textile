import { type Model, Schema, model, models } from 'mongoose';

export interface ProductDoc {
	_id: string;
	type: 'simple' | 'variable';
	sku: string;
	title: Record<string, string>;
	slug: string;
	description?: Record<string, string>;
	categoryIds: string[];
	tags: string[];
	basePriceINR: number;
	media: { gallery: string[] };
	attributes: unknown[];
	variations: unknown[];
	addons: unknown[];
	relatedProductIds: string[];
	crossSellIds: string[];
	upsellIds: string[];
	seo?: Record<string, unknown>;
	ratingsSummary: { avg: number; count: number };
	/** Owner lock: only `live` is storefront-queryable. See core-domain product-visibility. */
	status: 'draft' | 'live' | 'disabled' | 'discontinued';
	lifecycle?: {
		liveAt?: Date | null;
		disabledAt?: Date | null;
		discontinuedAt?: Date | null;
		richDataPurgedAt?: Date | null;
		statusReason?: string | null;
	};
	createdAt?: Date;
	updatedAt?: Date;
}

const ProductSchema = new Schema<ProductDoc>(
	{
		_id: { type: String, required: true },
		type: { type: String, enum: ['simple', 'variable'], required: true },
		sku: { type: String, required: true },
		title: { type: Schema.Types.Mixed, required: true },
		slug: { type: String, required: true },
		description: { type: Schema.Types.Mixed },
		categoryIds: { type: [String], default: [] },
		tags: { type: [String], default: [] },
		basePriceINR: { type: Number, required: true },
		media: { type: Schema.Types.Mixed, default: { gallery: [] } },
		attributes: { type: [Schema.Types.Mixed], default: [] },
		variations: { type: [Schema.Types.Mixed], default: [] },
		addons: { type: [Schema.Types.Mixed], default: [] },
		relatedProductIds: { type: [String], default: [] },
		crossSellIds: { type: [String], default: [] },
		upsellIds: { type: [String], default: [] },
		seo: { type: Schema.Types.Mixed },
		ratingsSummary: { type: Schema.Types.Mixed, default: { avg: 0, count: 0 } },
		status: { type: String, enum: ['draft', 'live', 'disabled', 'discontinued'], default: 'draft' },
		lifecycle: { type: Schema.Types.Mixed, default: {} },
	},
	{ timestamps: true },
);

ProductSchema.index({ slug: 1 }, { unique: true });
ProductSchema.index({ sku: 1 }, { unique: true });
ProductSchema.index({ categoryIds: 1 });
ProductSchema.index({ tags: 1 });
ProductSchema.index({ status: 1 });
// Public listings always filter on status first, then narrow by category/recency.
ProductSchema.index({ status: 1, categoryIds: 1, createdAt: -1 });
// Retention job: find discontinued products whose window has elapsed and that still hold rich data.
ProductSchema.index({ status: 1, 'lifecycle.discontinuedAt': 1 });

export const ProductModel: Model<ProductDoc> =
	(models.Product as Model<ProductDoc>) ?? model<ProductDoc>('Product', ProductSchema);
