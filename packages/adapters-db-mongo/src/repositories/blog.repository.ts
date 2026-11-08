import { type BlogCategory, type BlogPost, type BlogTag, blogPostAssetIds } from '@saha-textile/contracts';
import type { BlogPostFilter, BlogPostRepository, BlogTermRepository, Paginated } from '@saha-textile/core-domain';
import type { Model } from 'mongoose';

import { BlogCategoryModel, BlogPostModel, BlogTagModel, type BlogPostDoc, type BlogTermDoc } from '../models/index';

const iso = (value: Date | null | undefined): string | undefined => (value ? new Date(value).toISOString() : undefined);

const toPost = (doc: BlogPostDoc): BlogPost => ({
	id: doc._id,
	slug: doc.slug,
	title: doc.title ?? {},
	excerpt: doc.excerpt ?? {},
	content: doc.content ?? {},
	coverAssetId: doc.coverAssetId ?? null,
	shareImageAssetId: doc.shareImageAssetId ?? null,
	categoryIds: doc.categoryIds ?? [],
	tagIds: doc.tagIds ?? [],
	featured: !!doc.featured,
	sticky: !!doc.sticky,
	author: doc.author ?? {},
	publishedAt: iso(doc.publishedAt) ?? null,
	seoTitle: doc.seoTitle ?? {},
	seoDescription: doc.seoDescription ?? {},
	status: doc.status === 'live' ? 'live' : 'draft',
	createdAt: iso(doc.createdAt),
	updatedAt: iso(doc.updatedAt),
});

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Sticky first, then newest, then id, so pages never shuffle. */
const ORDER = { sticky: -1, publishedAt: -1, _id: 1 } as const;

export class MongoBlogPostRepository implements BlogPostRepository {
	async findById(id: string): Promise<BlogPost | null> {
		const doc = await BlogPostModel.findById(id).lean<BlogPostDoc>().exec();
		return doc ? toPost(doc) : null;
	}

	async findBySlug(slug: string): Promise<BlogPost | null> {
		const doc = await BlogPostModel.findOne({ slug }).lean<BlogPostDoc>().exec();
		return doc ? toPost(doc) : null;
	}

	async list(filter: BlogPostFilter): Promise<Paginated<BlogPost>> {
		const query: Record<string, unknown> = {};
		if (filter.status) query.status = filter.status;
		if (filter.visibleAt) {
			query.status = 'live';
			query.publishedAt = { $ne: null, $lte: new Date(filter.visibleAt) };
		}
		if (filter.categoryId) query.categoryIds = filter.categoryId;
		if (filter.tagId) query.tagIds = filter.tagId;
		if (filter.search?.trim()) {
			const pattern = new RegExp(escapeRegex(filter.search.trim()), 'i');
			query.$or = [{ 'title.en': pattern }, { slug: pattern }];
		}
		const [docs, total] = await Promise.all([
			BlogPostModel.find(query)
				.sort(ORDER)
				.skip((filter.page - 1) * filter.pageSize)
				.limit(filter.pageSize)
				.lean<BlogPostDoc[]>()
				.exec(),
			BlogPostModel.countDocuments(query).exec(),
		]);
		return { items: docs.map(toPost), total, page: filter.page, pageSize: filter.pageSize };
	}

	async countVisibleByTerm(
		now: string,
	): Promise<{ categories: Record<string, number>; tags: Record<string, number> }> {
		const match = { status: 'live', publishedAt: { $ne: null, $lte: new Date(now) } };
		const count = async (field: 'categoryIds' | 'tagIds') => {
			const rows = await BlogPostModel.aggregate<{ _id: string; count: number }>([
				{ $match: match },
				{ $unwind: `$${field}` },
				{ $group: { _id: `$${field}`, count: { $sum: 1 } } },
			]).exec();
			return Object.fromEntries(rows.map((row) => [row._id, row.count]));
		};
		const [categories, tags] = await Promise.all([count('categoryIds'), count('tagIds')]);
		return { categories, tags };
	}

	async save(post: BlogPost): Promise<BlogPost> {
		const { id, createdAt: _createdAt, updatedAt: _updatedAt, publishedAt, ...rest } = post;
		await BlogPostModel.updateOne(
			{ _id: id },
			{
				$set: {
					...rest,
					assetIds: blogPostAssetIds(post),
					publishedAt: publishedAt ? new Date(publishedAt) : null,
				},
			},
			{ upsert: true },
		).exec();
		return (await this.findById(id)) ?? post;
	}

	async remove(id: string): Promise<void> {
		await BlogPostModel.deleteOne({ _id: id }).exec();
	}

	async detachTerm(kind: 'category' | 'tag', id: string): Promise<void> {
		const field = kind === 'category' ? 'categoryIds' : 'tagIds';
		await BlogPostModel.updateMany({ [field]: id }, { $pull: { [field]: id } }).exec();
	}
}

const toTerm = <T extends BlogCategory | BlogTag>(doc: BlogTermDoc, ordered: boolean): T =>
	({
		id: doc._id,
		slug: doc.slug,
		name: doc.name ?? {},
		description: doc.description ?? {},
		status: doc.status === 'live' ? 'live' : 'draft',
		...(ordered ? { displayOrder: doc.displayOrder ?? 0 } : {}),
		createdAt: iso(doc.createdAt),
		updatedAt: iso(doc.updatedAt),
	}) as T;

class MongoBlogTermRepository<T extends BlogCategory | BlogTag> implements BlogTermRepository<T> {
	constructor(
		private readonly termModel: Model<BlogTermDoc>,
		private readonly ordered: boolean,
	) {}

	async list(): Promise<T[]> {
		const sort: Record<string, 1> = this.ordered ? { displayOrder: 1, slug: 1 } : { slug: 1 };
		const docs = await this.termModel.find().sort(sort).lean<BlogTermDoc[]>().exec();
		return docs.map((doc) => toTerm<T>(doc, this.ordered));
	}

	async findById(id: string): Promise<T | null> {
		const doc = await this.termModel.findById(id).lean<BlogTermDoc>().exec();
		return doc ? toTerm<T>(doc, this.ordered) : null;
	}

	async findBySlug(slug: string): Promise<T | null> {
		const doc = await this.termModel.findOne({ slug }).lean<BlogTermDoc>().exec();
		return doc ? toTerm<T>(doc, this.ordered) : null;
	}

	async findManyByIds(ids: readonly string[]): Promise<T[]> {
		if (!ids.length) return [];
		const docs = await this.termModel
			.find({ _id: { $in: [...ids] } })
			.lean<BlogTermDoc[]>()
			.exec();
		return docs.map((doc) => toTerm<T>(doc, this.ordered));
	}

	async save(term: T): Promise<T> {
		const { id, createdAt: _createdAt, updatedAt: _updatedAt, ...rest } = term;
		await this.termModel.updateOne({ _id: id }, { $set: rest }, { upsert: true }).exec();
		return (await this.findById(id)) ?? term;
	}

	async remove(id: string): Promise<void> {
		await this.termModel.deleteOne({ _id: id }).exec();
	}
}

export class MongoBlogCategoryRepository extends MongoBlogTermRepository<BlogCategory> {
	constructor() {
		super(BlogCategoryModel, true);
	}
}

export class MongoBlogTagRepository extends MongoBlogTermRepository<BlogTag> {
	constructor() {
		super(BlogTagModel, false);
	}
}
