import { type Model, Schema, model, models } from 'mongoose';

/** One public address in one language (`seoRoutes`). */
export interface SeoRouteDoc {
	_id: string;
	path: string;
	locale: 'en' | 'fr';
	title: string;
	description: string;
	canonicalPath: string;
	robots: string;
	indexable: boolean;
	entityType?: string;
	entityId?: string;
}

const SeoRouteSchema = new Schema<SeoRouteDoc>(
	{
		_id: { type: String, required: true },
		path: { type: String, required: true },
		locale: { type: String, enum: ['en', 'fr'], required: true },
		title: { type: String, required: true },
		description: { type: String, default: '' },
		canonicalPath: { type: String, required: true },
		robots: { type: String, default: 'index,follow' },
		indexable: { type: Boolean, default: true },
		entityType: { type: String },
		entityId: { type: String },
	},
	{ collection: 'seoRoutes', timestamps: true },
);

SeoRouteSchema.index({ path: 1, locale: 1 }, { unique: true });
SeoRouteSchema.index({ indexable: 1, locale: 1 });

export const SeoRouteModel: Model<SeoRouteDoc> =
	(models.SeoRoute as Model<SeoRouteDoc>) ?? model<SeoRouteDoc>('SeoRoute', SeoRouteSchema);
