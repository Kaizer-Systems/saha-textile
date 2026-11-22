import {
	CatalogStatus,
	ProductRelationSource,
	ProductRelationTargetType,
	ProductRelationType,
} from '@saha-textile/contracts';
import { type Model, Schema, model, models } from 'mongoose';

/**
 * Bundles (`productBundles`): a set built in the bundle builder (owner, 22 Nov 2026). Levels, extras, the price
 * method and rules are validated by the `ProductBundle` contract on every write, so they are stored as documents.
 * `stock` is the worked-out stock, refreshed whenever a piece's stock moves.
 */
export interface ProductBundleDoc {
	_id: string;
	productId: string;
	levels: unknown[];
	extras: unknown[];
	pricing: unknown;
	saleWindow: unknown;
	styledPhoto: unknown;
	dearerReason: string | null;
	stock: unknown;
	/** Product ids of every piece and extra, for "Used in" and stock refreshes. */
	memberIds: string[];
	methodId: string | null;
	status: string;
	createdAt?: Date;
	updatedAt?: Date;
}

const ProductBundleSchema = new Schema<ProductBundleDoc>(
	{
		_id: { type: String, required: true },
		productId: { type: String, required: true },
		levels: { type: [Schema.Types.Mixed], default: [] },
		extras: { type: [Schema.Types.Mixed], default: [] },
		pricing: { type: Schema.Types.Mixed, default: null },
		saleWindow: { type: Schema.Types.Mixed, default: null },
		styledPhoto: { type: Schema.Types.Mixed, default: null },
		dearerReason: { type: String, default: null },
		stock: { type: Schema.Types.Mixed, default: null },
		memberIds: { type: [String], default: [] },
		methodId: { type: String, default: null },
		status: { type: String, enum: CatalogStatus.options, default: 'draft' },
	},
	{ collection: 'productBundles', timestamps: true, minimize: false },
);

/**
 * One bundle per product. This is also the index `isBundleProduct()` reads to enforce
 * `DEC-BUNDLE-NESTING` at the write path — the lookup has to be cheap because it runs for
 * every component of every bundle being saved.
 */
ProductBundleSchema.index({ productId: 1 }, { unique: true });
ProductBundleSchema.index({ memberIds: 1 });
ProductBundleSchema.index({ methodId: 1 });

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
			enum: ProductRelationType.options,
			required: true,
		},
		targetType: { type: String, enum: ProductRelationTargetType.options, default: 'product' },
		targetId: { type: String, required: true },
		surfaces: { type: [String], default: [] },
		rank: { type: Number, default: 0 },
		source: { type: String, enum: ProductRelationSource.options, default: 'manual' },
		insightSetId: { type: String, default: null },
		reason: { type: String, default: null },
		startsAt: { type: Date, default: null },
		endsAt: { type: Date, default: null },
		status: { type: String, enum: CatalogStatus.options, default: 'draft' },
	},
	{ collection: 'productRelations', timestamps: true },
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

export interface SeoRedirectDoc {
	_id: string;
	sourcePath: string;
	statusCode: 301 | 302 | 410;
	targetPath?: string;
	reason: string;
	entityType?: string;
	entityId?: string;
	createdAt?: Date;
	updatedAt?: Date;
}

const SeoRedirectSchema = new Schema<SeoRedirectDoc>(
	{
		_id: { type: String, required: true },
		sourcePath: { type: String, required: true },
		statusCode: { type: Number, enum: [301, 302, 410], required: true },
		targetPath: { type: String },
		reason: { type: String, required: true },
		entityType: { type: String },
		entityId: { type: String },
	},
	{ collection: 'seoRedirects', timestamps: true },
);

SeoRedirectSchema.index({ sourcePath: 1 }, { unique: true });

export const SeoRedirectModel: Model<SeoRedirectDoc> =
	(models.SeoRedirect as Model<SeoRedirectDoc>) ?? model<SeoRedirectDoc>('SeoRedirect', SeoRedirectSchema);

export interface AddonTemplateDoc {
	_id: string;
	code: string;
	label: Record<string, string> | string;
	priceINR: number;
	fields?: unknown[];
	sizeGuide?: Array<{ size: string; values: Record<string, number> }>;
}

const AddonTemplateSchema = new Schema<AddonTemplateDoc>(
	{
		_id: { type: String, required: true },
		code: { type: String, required: true },
		label: { type: Schema.Types.Mixed, required: true },
		priceINR: { type: Number, required: true },
		fields: { type: [Schema.Types.Mixed], default: [] },
		sizeGuide: { type: [Schema.Types.Mixed], default: [] },
	},
	{ collection: 'addonTemplates', timestamps: true },
);

AddonTemplateSchema.index({ code: 1 }, { unique: true });

export const AddonTemplateModel: Model<AddonTemplateDoc> =
	(models.AddonTemplate as Model<AddonTemplateDoc>) ?? model<AddonTemplateDoc>('AddonTemplate', AddonTemplateSchema);

/** Products › Bundle price methods (`bundlePriceMethods`): the "Set price is" list, made in the method builder. */
export interface BundlePriceMethodDoc {
	_id: string;
	code: string;
	name: Record<string, string>;
	help: Record<string, string>;
	inputs: unknown[];
	base: unknown;
	rules: unknown[];
	combine: string;
	active: boolean;
	seeded: boolean;
	version: number;
	sortOrder: number;
	createdAt?: Date;
	updatedAt?: Date;
}

const BundlePriceMethodSchema = new Schema<BundlePriceMethodDoc>(
	{
		_id: { type: String, required: true },
		code: { type: String, required: true },
		name: { type: Schema.Types.Mixed, required: true },
		help: { type: Schema.Types.Mixed, required: true },
		inputs: { type: [Schema.Types.Mixed], default: [] },
		base: { type: Schema.Types.Mixed, required: true },
		rules: { type: [Schema.Types.Mixed], default: [] },
		combine: { type: String, enum: ['first', 'all'], default: 'all' },
		active: { type: Boolean, default: true },
		seeded: { type: Boolean, default: false },
		version: { type: Number, default: 1 },
		sortOrder: { type: Number, default: 0 },
	},
	{ collection: 'bundlePriceMethods', timestamps: true, minimize: false },
);
BundlePriceMethodSchema.index({ code: 1 }, { unique: true });

export const BundlePriceMethodModel: Model<BundlePriceMethodDoc> =
	(models.BundlePriceMethod as Model<BundlePriceMethodDoc>) ??
	model<BundlePriceMethodDoc>('BundlePriceMethod', BundlePriceMethodSchema);
