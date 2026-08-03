import { type Model, Schema, model, models } from 'mongoose';

/**
 * Catalog STRUCTURE collections: where a category sits in the DAG, and how its listing
 * page filters. Grouped here because they are read together on every category page.
 */

/**
 * A category's position in the taxonomy DAG (`categoryPlacements`).
 *
 * Identity lives in `categories`; POSITION lives here, which is what lets one category
 * hang under several merchandising contexts without duplicating products.
 */
export interface CategoryPlacementDoc {
	_id: string;
	categoryId: string;
	parentCategoryId: string | null;
	pathCategoryIds: string[];
	pathSlugs: string[];
	/** `pathSlugs.join('/')` — the scalar the uniqueness index actually needs. */
	pathKey: string;
	pathLabel: string;
	depth: number;
	isCanonical: boolean;
	displayOrder: number;
	status: string;
	createdAt?: Date;
	updatedAt?: Date;
}

const CategoryPlacementSchema = new Schema<CategoryPlacementDoc>(
	{
		_id: { type: String, required: true },
		categoryId: { type: String, required: true },
		parentCategoryId: { type: String, default: null },
		pathCategoryIds: { type: [String], required: true },
		pathSlugs: { type: [String], required: true },
		pathKey: { type: String, required: true },
		pathLabel: { type: String, required: true },
		depth: { type: Number, required: true },
		isCanonical: { type: Boolean, default: false },
		displayOrder: { type: Number, default: 0 },
		status: { type: String, enum: ['draft', 'live', 'disabled', 'discontinued'], default: 'draft' },
	},
	{ collection: 'categoryPlacements', timestamps: true },
);

/**
 * A URL path resolves to exactly one placement — two would be a duplicate-content bug.
 *
 * Indexed on the joined `pathKey`, NOT on `pathSlugs`. A unique index over an array field
 * is MULTIKEY: it enforces uniqueness per ELEMENT, so `['sarees']` and
 * `['sarees','pure-silk']` would collide on the shared segment and no category could ever
 * have a child. The scalar key is what expresses "the whole path is unique".
 */
CategoryPlacementSchema.index({ pathKey: 1 }, { unique: true });
/**
 * At most ONE canonical placement per category. Partial so the non-canonical placements
 * of the same category do not collide with each other.
 */
CategoryPlacementSchema.index({ categoryId: 1 }, { unique: true, partialFilterExpression: { isCanonical: true } });
/** Menu and subtree rendering. */
CategoryPlacementSchema.index({ parentCategoryId: 1, status: 1, displayOrder: 1 });
/** Subtree moves rewrite every descendant, found by ancestor id. */
CategoryPlacementSchema.index({ pathCategoryIds: 1 });

export const CategoryPlacementModel: Model<CategoryPlacementDoc> =
	(models.CategoryPlacement as Model<CategoryPlacementDoc>) ??
	model<CategoryPlacementDoc>('CategoryPlacement', CategoryPlacementSchema);

/** Sidebar/off-canvas filter configuration for one scope (`categoryFacetConfigs`). */
export interface CategoryFacetConfigDoc {
	_id: string;
	scope: string;
	categoryId?: string | null;
	categoryPlacementId?: string | null;
	productGroupId?: string | null;
	facets: unknown[];
	status: string;
	createdAt?: Date;
	updatedAt?: Date;
}

const CategoryFacetConfigSchema = new Schema<CategoryFacetConfigDoc>(
	{
		_id: { type: String, required: true },
		scope: { type: String, enum: ['global', 'category', 'category_placement', 'product_group'], required: true },
		categoryId: { type: String, default: null },
		categoryPlacementId: { type: String, default: null },
		productGroupId: { type: String, default: null },
		facets: { type: [Schema.Types.Mixed], default: [] },
		status: { type: String, enum: ['draft', 'live', 'disabled', 'discontinued'], default: 'draft' },
	},
	{ collection: 'categoryFacetConfigs', timestamps: true },
);

// Resolution order at read time is placement → category → product group → global, so each
// scope gets its own lookup index.
CategoryFacetConfigSchema.index({ categoryPlacementId: 1, status: 1 });
CategoryFacetConfigSchema.index({ categoryId: 1, status: 1 });
CategoryFacetConfigSchema.index({ productGroupId: 1, status: 1 });
CategoryFacetConfigSchema.index({ scope: 1, status: 1 });

export const CategoryFacetConfigModel: Model<CategoryFacetConfigDoc> =
	(models.CategoryFacetConfig as Model<CategoryFacetConfigDoc>) ??
	model<CategoryFacetConfigDoc>('CategoryFacetConfig', CategoryFacetConfigSchema);

/** Reusable attribute master (`attributeDefinitions`) — the option-group source. */
export interface AttributeDefinitionDoc {
	_id: string;
	code: string;
	label: Record<string, string>;
	defaultRole: string;
	defaultDisplayStyle: string;
	valueType: string;
	terms: unknown[];
	filterConfig?: Record<string, unknown>;
	createdAt?: Date;
	updatedAt?: Date;
}

const AttributeDefinitionSchema = new Schema<AttributeDefinitionDoc>(
	{
		_id: { type: String, required: true },
		code: { type: String, required: true },
		label: { type: Schema.Types.Mixed, required: true },
		defaultRole: {
			type: String,
			enum: ['filter_only', 'variation_axis', 'named_add_on', 'bundle_component_option', 'descriptive', 'search'],
			default: 'filter_only',
		},
		defaultDisplayStyle: {
			type: String,
			enum: [
				'rectangle',
				'circle',
				'image_swatch',
				'color_swatch',
				'radio',
				'dropdown',
				'image_tile',
				'radio_bar',
			],
			default: 'rectangle',
		},
		valueType: { type: String, enum: ['term', 'color', 'number', 'text'], default: 'term' },
		terms: { type: [Schema.Types.Mixed], default: [] },
		filterConfig: { type: Schema.Types.Mixed },
	},
	{ collection: 'attributeDefinitions', timestamps: true },
);

AttributeDefinitionSchema.index({ code: 1 }, { unique: true });

export const AttributeDefinitionModel: Model<AttributeDefinitionDoc> =
	(models.AttributeDefinition as Model<AttributeDefinitionDoc>) ??
	model<AttributeDefinitionDoc>('AttributeDefinition', AttributeDefinitionSchema);
