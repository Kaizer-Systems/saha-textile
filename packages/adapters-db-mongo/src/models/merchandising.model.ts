import { type Model, Schema, model, models } from 'mongoose';

/** Bundles (`productBundles`) — a compound product that resolves to component lines. */
export interface ProductBundleDoc {
	_id: string;
	productId: string;
	bundleType: string;
	pricePolicy: string;
	fixedPriceINR: number | null;
	groups: unknown[];
	status: string;
	createdAt?: Date;
	updatedAt?: Date;
}

const ProductBundleSchema = new Schema<ProductBundleDoc>(
	{
		_id: { type: String, required: true },
		productId: { type: String, required: true },
		bundleType: { type: String, enum: ['fixed_kit', 'choose_one_per_group', 'optional_addons'], required: true },
		pricePolicy: {
			type: String,
			enum: ['sum_components', 'fixed_bundle_price', 'discounted_components'],
			required: true,
		},
		fixedPriceINR: { type: Number, default: null },
		groups: { type: [Schema.Types.Mixed], default: [] },
		status: { type: String, enum: ['draft', 'live', 'disabled', 'discontinued'], default: 'draft' },
	},
	{ timestamps: true },
);

/**
 * One bundle per product. This is also the index `isBundleProduct()` reads to enforce
 * `DEC-BUNDLE-NESTING` at the write path — the lookup has to be cheap because it runs for
 * every component of every bundle being saved.
 */
ProductBundleSchema.index({ productId: 1 }, { unique: true });

export const ProductBundleModel: Model<ProductBundleDoc> =
	(models.ProductBundle as Model<ProductBundleDoc>) ?? model<ProductBundleDoc>('ProductBundle', ProductBundleSchema);

/** Merchandising relations (`productRelations`) — discovery only, never pricing. */
export interface ProductRelationDoc {
	_id: string;
	sourceProductId: string;
	relationType: string;
	targetType: string;
	targetId: string;
	surfaces: string[];
	rank: number;
	source: string;
	insightSetId: string | null;
	reason: string | null;
	startsAt: Date | null;
	endsAt: Date | null;
	status: string;
	createdAt?: Date;
	updatedAt?: Date;
}

const ProductRelationSchema = new Schema<ProductRelationDoc>(
	{
		_id: { type: String, required: true },
		sourceProductId: { type: String, required: true },
		relationType: {
			type: String,
			enum: [
				'related',
				'upsell',
				'cross_sell',
				'bought_together',
				'complete_the_look',
				'substitute',
				'same_collection',
			],
			required: true,
		},
		targetType: { type: String, enum: ['product', 'variant', 'product_group'], default: 'product' },
		targetId: { type: String, required: true },
		surfaces: { type: [String], default: [] },
		rank: { type: Number, default: 0 },
		source: { type: String, enum: ['manual', 'insight_set', 'imported_woocommerce'], default: 'manual' },
		insightSetId: { type: String, default: null },
		reason: { type: String, default: null },
		startsAt: { type: Date, default: null },
		endsAt: { type: Date, default: null },
		status: { type: String, enum: ['draft', 'live', 'disabled', 'discontinued'], default: 'draft' },
	},
	{ timestamps: true },
);

/** The rail query: relations of one type for one product, in display order. */
ProductRelationSchema.index({ sourceProductId: 1, relationType: 1, status: 1, rank: 1 });
/** Auto-pause sweeps by target when a product leaves `live`. */
ProductRelationSchema.index({ targetId: 1, status: 1 });
/** Replacing a weekly insight set rewrites its rows as a unit. */
ProductRelationSchema.index({ insightSetId: 1 });
/** The same relationship must not be recorded twice for one surface set. */
ProductRelationSchema.index({ sourceProductId: 1, relationType: 1, targetId: 1 }, { unique: true });

export const ProductRelationModel: Model<ProductRelationDoc> =
	(models.ProductRelation as Model<ProductRelationDoc>) ??
	model<ProductRelationDoc>('ProductRelation', ProductRelationSchema);
