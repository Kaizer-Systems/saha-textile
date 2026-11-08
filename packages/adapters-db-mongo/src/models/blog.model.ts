import { BlogStatus } from '@saha-textile/contracts';
import { type Model, Schema, model, models } from 'mongoose';

/**
 * The blog (owner log § blog, 2026-11-08): posts, categories and tags, every text per language.
 *
 * `assetIds` on a post is the denormalised list of the pictures it points at (cover and share
 * picture), written on every save; it is what the media reference counter and GC query.
 */
export interface BlogPostDoc {
	_id: string;
	slug: string;
	title: Record<string, string>;
	excerpt: Record<string, string>;
	content: Record<string, string>;
	coverAssetId: string | null;
	shareImageAssetId: string | null;
	assetIds: string[];
	categoryIds: string[];
	tagIds: string[];
	featured: boolean;
	sticky: boolean;
	author: Record<string, string>;
	publishedAt: Date | null;
	seoTitle: Record<string, string>;
	seoDescription: Record<string, string>;
	status: string;
	createdAt?: Date;
	updatedAt?: Date;
}

const BlogPostSchema = new Schema<BlogPostDoc>(
	{
		_id: { type: String, required: true },
		slug: { type: String, required: true },
		title: { type: Schema.Types.Mixed, default: {} },
		excerpt: { type: Schema.Types.Mixed, default: {} },
		content: { type: Schema.Types.Mixed, default: {} },
		coverAssetId: { type: String, default: null },
		shareImageAssetId: { type: String, default: null },
		assetIds: { type: [String], default: [] },
		categoryIds: { type: [String], default: [] },
		tagIds: { type: [String], default: [] },
		featured: { type: Boolean, default: false },
		sticky: { type: Boolean, default: false },
		author: { type: Schema.Types.Mixed, default: {} },
		publishedAt: { type: Date, default: null },
		seoTitle: { type: Schema.Types.Mixed, default: {} },
		seoDescription: { type: Schema.Types.Mixed, default: {} },
		status: { type: String, enum: BlogStatus.options, default: 'draft' },
	},
	{ collection: 'blogPosts', timestamps: true, minimize: false },
);

BlogPostSchema.index({ slug: 1 }, { unique: true });
/** The shop's list: live, published, sticky first, newest first. */
BlogPostSchema.index({ status: 1, sticky: -1, publishedAt: -1 });
BlogPostSchema.index({ categoryIds: 1 });
BlogPostSchema.index({ tagIds: 1 });
/** Media reference counting. */
BlogPostSchema.index({ assetIds: 1 });

export const BlogPostModel: Model<BlogPostDoc> =
	(models.BlogPost as Model<BlogPostDoc>) ?? model<BlogPostDoc>('BlogPost', BlogPostSchema);

export interface BlogTermDoc {
	_id: string;
	slug: string;
	name: Record<string, string>;
	description: Record<string, string>;
	status: string;
	displayOrder?: number;
	createdAt?: Date;
	updatedAt?: Date;
}

const termSchema = (collection: string, ordered: boolean) => {
	const schema = new Schema<BlogTermDoc>(
		{
			_id: { type: String, required: true },
			slug: { type: String, required: true },
			name: { type: Schema.Types.Mixed, default: {} },
			description: { type: Schema.Types.Mixed, default: {} },
			status: { type: String, enum: BlogStatus.options, default: 'draft' },
			...(ordered ? { displayOrder: { type: Number, default: 0 } } : {}),
		},
		{ collection, timestamps: true, minimize: false },
	);
	schema.index({ slug: 1 }, { unique: true });
	return schema;
};

export const BlogCategoryModel: Model<BlogTermDoc> =
	(models.BlogCategory as Model<BlogTermDoc>) ??
	model<BlogTermDoc>('BlogCategory', termSchema('blogCategories', true));

export const BlogTagModel: Model<BlogTermDoc> =
	(models.BlogTag as Model<BlogTermDoc>) ?? model<BlogTermDoc>('BlogTag', termSchema('blogTags', false));
