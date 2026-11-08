import { z } from 'zod';

import { Id, IsoDateTime, LocalizedText, Slug } from './common';
import { ResolvedImage } from './media';

/**
 * The shop's blog (owner log § blog, 2026-11-08): posts, blog categories and blog tags.
 *
 * Every text is stored per language (`{ en, bn }`) and nothing goes live until every active
 * language is complete, the same rule products follow. A post's address is made from its English
 * title and is the same in both languages; an old address keeps working through a redirect row.
 */

export const BlogStatus = z.enum(['draft', 'live']);
export type BlogStatus = z.infer<typeof BlogStatus>;

/** The byline a new post starts with. The owner can name a person per post. */
export const DEFAULT_BLOG_AUTHOR: Readonly<Record<string, string>> = { en: 'Saha Textile', bn: 'সাহা টেক্সটাইল' };

const Text = z.record(z.string(), z.string().max(2_000));
/** An article body: rich text, sanitised on the way in. */
const Body = z.record(z.string(), z.string().max(200_000));

export const BlogCategory = z.object({
	id: Id,
	slug: Slug,
	name: LocalizedText,
	description: LocalizedText.default({}),
	status: BlogStatus.default('draft'),
	displayOrder: z.number().int().default(0),
	createdAt: IsoDateTime.optional(),
	updatedAt: IsoDateTime.optional(),
});
export type BlogCategory = z.infer<typeof BlogCategory>;

export const BlogTag = z.object({
	id: Id,
	slug: Slug,
	name: LocalizedText,
	description: LocalizedText.default({}),
	status: BlogStatus.default('draft'),
	createdAt: IsoDateTime.optional(),
	updatedAt: IsoDateTime.optional(),
});
export type BlogTag = z.infer<typeof BlogTag>;

export const BlogPost = z.object({
	id: Id,
	slug: Slug,
	title: LocalizedText,
	/** The summary under the title. Empty means the opening of the article. */
	excerpt: LocalizedText.default({}),
	/** Sanitised rich text per language. */
	content: LocalizedText.default({}),
	coverAssetId: Id.nullable().default(null),
	/** The picture link previews use. Empty means the cover. */
	shareImageAssetId: Id.nullable().default(null),
	categoryIds: z.array(Id).default([]),
	tagIds: z.array(Id).default([]),
	featured: z.boolean().default(false),
	sticky: z.boolean().default(false),
	author: LocalizedText.default({}),
	/** Set when the post first goes live; the owner may back-date or schedule it. */
	publishedAt: IsoDateTime.nullable().default(null),
	seoTitle: LocalizedText.default({}),
	seoDescription: LocalizedText.default({}),
	status: BlogStatus.default('draft'),
	createdAt: IsoDateTime.optional(),
	updatedAt: IsoDateTime.optional(),
});
export type BlogPost = z.infer<typeof BlogPost>;

/** Every media asset a post points at; the media garbage collector reads this list. */
export const blogPostAssetIds = (post: Pick<BlogPost, 'coverAssetId' | 'shareImageAssetId'>): string[] => [
	...new Set([post.coverAssetId, post.shareImageAssetId].filter((id): id is string => !!id)),
];

// ── Admin writes ───────────────────────────────────────────────────────────────

export const BlogCategoryWrite = z.object({
	name: Text,
	description: Text.default({}),
	slug: Slug,
	/** Live only when every language has a name; otherwise the save is refused with the gaps. */
	status: BlogStatus.default('draft'),
	displayOrder: z.number().int().optional(),
});
export type BlogCategoryWrite = z.infer<typeof BlogCategoryWrite>;

export const BlogTagWrite = z.object({
	name: Text,
	description: Text.default({}),
	slug: Slug,
	status: BlogStatus.default('draft'),
});
export type BlogTagWrite = z.infer<typeof BlogTagWrite>;

/** The cover's own words, written to the picture in the media library. */
export const BlogCoverText = z.object({
	alt: Text.default({}),
	title: Text.default({}),
	caption: Text.default({}),
});
export type BlogCoverText = z.infer<typeof BlogCoverText>;

/** The post form. A new post starts as a draft; Go Live is its own call. */
export const BlogPostWrite = z.object({
	title: Text,
	/** Left out on a new post, the address is made from the English title. */
	slug: Slug.optional(),
	excerpt: Text.default({}),
	content: Body.default({}),
	coverAssetId: Id.nullable().default(null),
	coverText: BlogCoverText.optional(),
	shareImageAssetId: Id.nullable().default(null),
	categoryIds: z.array(Id).max(10).default([]),
	tagIds: z.array(Id).max(30).default([]),
	featured: z.boolean().default(false),
	sticky: z.boolean().default(false),
	author: Text.default({}),
	publishedAt: IsoDateTime.nullable().optional(),
	seoTitle: Text.default({}),
	seoDescription: Text.default({}),
});
export type BlogPostWrite = z.infer<typeof BlogPostWrite>;

/** `POST /admin/blog/posts/:id/status` — the list's switch: take a post off the shop, or try Go Live. */
export const BlogStatusWrite = z.object({ status: BlogStatus });
export type BlogStatusWrite = z.infer<typeof BlogStatusWrite>;

export const AdminBlogListQuery = z.object({
	search: z.string().max(100).optional(),
	status: BlogStatus.optional(),
	page: z.coerce.number().int().positive().default(1),
	pageSize: z.coerce.number().int().positive().max(100).default(20),
});
export type AdminBlogListQuery = z.infer<typeof AdminBlogListQuery>;

/** A picture as the admin form previews it. */
export const AdminBlogImage = z.object({
	id: Id,
	url: z.string(),
	alt: LocalizedText,
	title: LocalizedText,
	caption: LocalizedText,
});
export type AdminBlogImage = z.infer<typeof AdminBlogImage>;

export const AdminBlogPostRow = z.object({
	post: BlogPost,
	cover: AdminBlogImage.nullable(),
	shareImage: AdminBlogImage.nullable(),
});
export type AdminBlogPostRow = z.infer<typeof AdminBlogPostRow>;

export const AdminBlogListResponse = z.object({
	items: z.array(AdminBlogPostRow),
	total: z.number().int().nonnegative(),
	page: z.number().int().positive(),
	pageSize: z.number().int().positive(),
});
export type AdminBlogListResponse = z.infer<typeof AdminBlogListResponse>;

// ── Public reads (one language, resolved by the API) ───────────────────────────

export const PublicBlogQuery = z.object({
	locale: z
		.string()
		.regex(/^[a-z]{2}$/)
		.default('en'),
	page: z.coerce.number().int().positive().default(1),
	pageSize: z.coerce.number().int().positive().max(50).default(10),
	category: Slug.optional(),
	tag: Slug.optional(),
});
export type PublicBlogQuery = z.infer<typeof PublicBlogQuery>;

/** `?locale=` on a single post and on the category and tag lists. */
export const PublicBlogLocaleQuery = z.object({
	locale: z
		.string()
		.regex(/^[a-z]{2}$/)
		.default('en'),
});
export type PublicBlogLocaleQuery = z.infer<typeof PublicBlogLocaleQuery>;

export const PublicBlogTerm = z.object({
	slug: z.string(),
	name: z.string(),
	count: z.number().int().nonnegative(),
});
export type PublicBlogTerm = z.infer<typeof PublicBlogTerm>;

export const PublicBlogCard = z.object({
	id: Id,
	slug: z.string(),
	title: z.string(),
	excerpt: z.string(),
	author: z.string(),
	publishedAt: IsoDateTime,
	featured: z.boolean(),
	sticky: z.boolean(),
	readingMinutes: z.number().int().positive(),
	cover: ResolvedImage.nullable(),
	categories: z.array(PublicBlogTerm.omit({ count: true })),
	tags: z.array(PublicBlogTerm.omit({ count: true })),
});
export type PublicBlogCard = z.infer<typeof PublicBlogCard>;

export const PublicBlogPost = PublicBlogCard.extend({
	content: z.string(),
	seoTitle: z.string(),
	seoDescription: z.string(),
	shareImage: ResolvedImage.nullable(),
	updatedAt: IsoDateTime,
});
export type PublicBlogPost = z.infer<typeof PublicBlogPost>;

export const PublicBlogListResponse = z.object({
	items: z.array(PublicBlogCard),
	total: z.number().int().nonnegative(),
	page: z.number().int().positive(),
	pageSize: z.number().int().positive(),
});
export type PublicBlogListResponse = z.infer<typeof PublicBlogListResponse>;
