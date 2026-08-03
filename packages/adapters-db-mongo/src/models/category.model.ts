import { type Model, Schema, model, models } from 'mongoose';

export interface CategoryDoc {
	_id: string;
	name: Record<string, string>;
	slug: string;
	parentId: string | null;
	path: string[];
	ancestors: string[];
	depth: number;
	isBannerCollection: boolean;
	displayOrder: number;
	seo?: Record<string, unknown>;
	media?: Record<string, unknown>;
	createdAt?: Date;
	updatedAt?: Date;
}

const CategorySchema = new Schema<CategoryDoc>(
	{
		_id: { type: String, required: true },
		name: { type: Schema.Types.Mixed, required: true },
		slug: { type: String, required: true },
		parentId: { type: String, default: null },
		path: { type: [String], default: [] },
		ancestors: { type: [String], default: [] },
		depth: { type: Number, default: 0 },
		isBannerCollection: { type: Boolean, default: false },
		displayOrder: { type: Number, default: 0 },
		seo: { type: Schema.Types.Mixed },
		media: { type: Schema.Types.Mixed },
	},
	{ collection: 'categories', timestamps: true },
);

CategorySchema.index({ slug: 1 }, { unique: true });
CategorySchema.index({ parentId: 1 });
CategorySchema.index({ path: 1 });
CategorySchema.index({ ancestors: 1 });

export const CategoryModel: Model<CategoryDoc> =
	(models.Category as Model<CategoryDoc>) ?? model<CategoryDoc>('Category', CategorySchema);
