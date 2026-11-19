import { type Model, Schema, model, models } from 'mongoose';

import { COLLECTION_NAMES } from '../collection-names';

/**
 * Shipping rule sets (brief approved 2026-11-19). Rule set bodies are block trees stored as they
 * are and parsed with the contracts' zod schemas on every read, so a stored body that no longer
 * fits is caught at the boundary rather than priced.
 */
export interface ShippingRuleSetDoc {
	_id: string;
	name: string;
	description: string;
	use: string;
	kind: string;
	premadeKey: string | null;
	copiedFromId: string | null;
	activeVersion: number | null;
	draft: unknown;
	hasDraftChanges: boolean;
	testCarts: unknown[];
	revision: number;
	createdAt: Date;
	updatedAt: Date;
	updatedBy: string | null;
}

/** A version made active; `_id` is `{ruleSetId}:{version}`. Never changed after it is written. */
export interface ShippingRuleSetVersionDoc {
	_id: string;
	ruleSetId: string;
	version: number;
	body: unknown;
	activatedAt: Date;
	activatedBy: string | null;
	acceptedChanges: unknown[];
}

export interface ShippingExceptionDoc {
	_id: string;
	target: unknown;
	domestic: unknown;
	international: unknown;
	note: string;
	updatedAt: Date;
	updatedBy: string | null;
}

/** The zone settings: one document, `_id` `zones`. */
export interface ShippingProviderConfigDoc {
	_id: string;
	settings: unknown;
	revision: number;
	updatedAt: Date;
	updatedBy: string | null;
}

const ShippingRuleSetSchema = new Schema<ShippingRuleSetDoc>(
	{
		_id: { type: String, required: true },
		name: { type: String, required: true },
		description: { type: String, default: '' },
		use: { type: String, required: true },
		kind: { type: String, required: true },
		premadeKey: { type: String, default: null },
		copiedFromId: { type: String, default: null },
		activeVersion: { type: Number, default: null },
		draft: { type: Schema.Types.Mixed, required: true },
		hasDraftChanges: { type: Boolean, default: true },
		testCarts: { type: [Schema.Types.Mixed], default: [] },
		revision: { type: Number, required: true },
		createdAt: { type: Date, required: true },
		updatedAt: { type: Date, required: true },
		updatedBy: { type: String, default: null },
	},
	{ collection: COLLECTION_NAMES.ShippingRuleSet, timestamps: false, minimize: false },
);
ShippingRuleSetSchema.index(
	{ premadeKey: 1 },
	{ unique: true, partialFilterExpression: { premadeKey: { $type: 'string' } } },
);

const ShippingRuleSetVersionSchema = new Schema<ShippingRuleSetVersionDoc>(
	{
		_id: { type: String, required: true },
		ruleSetId: { type: String, required: true },
		version: { type: Number, required: true },
		body: { type: Schema.Types.Mixed, required: true },
		activatedAt: { type: Date, required: true },
		activatedBy: { type: String, default: null },
		acceptedChanges: { type: [Schema.Types.Mixed], default: [] },
	},
	{ collection: COLLECTION_NAMES.ShippingRuleSetVersion, timestamps: false, minimize: false },
);
ShippingRuleSetVersionSchema.index({ ruleSetId: 1, version: -1 }, { unique: true });

const ShippingExceptionSchema = new Schema<ShippingExceptionDoc>(
	{
		_id: { type: String, required: true },
		target: { type: Schema.Types.Mixed, required: true },
		domestic: { type: Schema.Types.Mixed, required: true },
		international: { type: Schema.Types.Mixed, required: true },
		note: { type: String, default: '' },
		updatedAt: { type: Date, required: true },
		updatedBy: { type: String, default: null },
	},
	{ collection: COLLECTION_NAMES.ShippingException, timestamps: false, minimize: false },
);
ShippingExceptionSchema.index({ 'target.categoryId': 1 }, { sparse: true });
ShippingExceptionSchema.index({ 'target.productId': 1 }, { sparse: true });

const ShippingProviderConfigSchema = new Schema<ShippingProviderConfigDoc>(
	{
		_id: { type: String, required: true },
		settings: { type: Schema.Types.Mixed, required: true },
		revision: { type: Number, required: true },
		updatedAt: { type: Date, required: true },
		updatedBy: { type: String, default: null },
	},
	{ collection: COLLECTION_NAMES.ShippingProviderConfig, timestamps: false, minimize: false },
);

export const ShippingRuleSetModel: Model<ShippingRuleSetDoc> =
	(models.ShippingRuleSet as Model<ShippingRuleSetDoc>) ??
	model<ShippingRuleSetDoc>('ShippingRuleSet', ShippingRuleSetSchema);
export const ShippingRuleSetVersionModel: Model<ShippingRuleSetVersionDoc> =
	(models.ShippingRuleSetVersion as Model<ShippingRuleSetVersionDoc>) ??
	model<ShippingRuleSetVersionDoc>('ShippingRuleSetVersion', ShippingRuleSetVersionSchema);
export const ShippingExceptionModel: Model<ShippingExceptionDoc> =
	(models.ShippingException as Model<ShippingExceptionDoc>) ??
	model<ShippingExceptionDoc>('ShippingException', ShippingExceptionSchema);
export const ShippingProviderConfigModel: Model<ShippingProviderConfigDoc> =
	(models.ShippingProviderConfig as Model<ShippingProviderConfigDoc>) ??
	model<ShippingProviderConfigDoc>('ShippingProviderConfig', ShippingProviderConfigSchema);
