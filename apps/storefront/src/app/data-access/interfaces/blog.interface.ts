import { IPaginateModel } from './core.interface';

/** The API's shapes (`PublicBlog*` in `@saha-textile/contracts`), as this app reads them. */
export interface ApiResolvedImage {
	assetId: string;
	width: number;
	height: number;
	alt: string;
	roles: Record<string, { url: string; width: number; height: number }[]>;
}

export interface ApiBlogTerm {
	slug: string;
	name: string;
	count: number;
}

export interface ApiBlogCard {
	id: string;
	slug: string;
	title: string;
	excerpt: string;
	author: string;
	publishedAt: string;
	featured: boolean;
	sticky: boolean;
	readingMinutes: number;
	cover: ApiResolvedImage | null;
	categories: { slug: string; name: string }[];
	tags: { slug: string; name: string }[];
}

export interface ApiBlogPost extends ApiBlogCard {
	content: string;
	seoTitle: string;
	seoDescription: string;
	shareImage: ApiResolvedImage | null;
	updatedAt: string;
}

export interface ApiBlogList {
	items: ApiBlogCard[];
	total: number;
	page: number;
	pageSize: number;
}

export interface IBlogModel extends IPaginateModel {
	data: IBlog[];
}

/** A cover as the blog cards draw it: one address for `src`, the rest for `srcset`. */
export interface IBlogImage {
	original_url: string;
	srcset: string;
	alt: string;
	width: number;
	height: number;
}

/** A post as the shop's blog cards, sidebar and post page draw it, in the page's language. */
export interface IBlog {
	id: string;
	title: string;
	slug: string;
	/** The summary under the title. */
	description: string;
	/** The article, sanitised by the API. Empty on a card. */
	content: string;
	author: string;
	published_at: string;
	/** The theme's templates read the date from here. */
	created_at: string;
	updated_at: string;
	reading_minutes: number;
	blog_thumbnail: IBlogImage | null;
	share_image: IBlogImage | null;
	categories: { slug: string; name: string }[];
	tags: { slug: string; name: string }[];
	is_featured: boolean;
	/** 1 when pinned to the top: the theme's sticky badge checks for it. */
	is_sticky: number;
	seo_title: string;
	seo_description: string;
}

/** The blog's role at its widest width up to `max`, and every width as a `srcset`. */
export function blogImage(image: ApiResolvedImage | null, max = 1600): IBlogImage | null {
	const sources = image?.roles['blog'] ?? [];
	if (!image || !sources.length) return null;
	const pick = [...sources].reverse().find((source) => source.width <= max) ?? sources[0];
	return {
		original_url: pick?.url ?? '',
		srcset: sources.map((source) => `${source.url} ${source.width}w`).join(', '),
		alt: image.alt,
		width: image.width,
		height: image.height,
	};
}

export function toBlog(card: ApiBlogCard | ApiBlogPost): IBlog {
	const post = 'content' in card ? card : null;
	return {
		id: card.id,
		title: card.title,
		slug: card.slug,
		description: card.excerpt,
		content: post?.content ?? '',
		author: card.author,
		published_at: card.publishedAt,
		created_at: card.publishedAt,
		updated_at: post?.updatedAt ?? card.publishedAt,
		reading_minutes: card.readingMinutes,
		blog_thumbnail: blogImage(card.cover),
		share_image: blogImage(post?.shareImage ?? null, 1200),
		categories: card.categories,
		tags: card.tags,
		is_featured: card.featured,
		is_sticky: card.sticky ? 1 : 0,
		seo_title: post?.seoTitle ?? card.title,
		seo_description: post?.seoDescription ?? card.excerpt,
	};
}
