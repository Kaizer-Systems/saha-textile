import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
	type BlogCategory,
	type BlogPost,
	type BlogTag,
	DEFAULT_BLOG_AUTHOR,
	type MediaAsset,
	type PublicBlogCard,
	type PublicBlogListResponse,
	type PublicBlogPost,
	type PublicBlogQuery,
	type PublicBlogTerm,
	type ResolvedImage,
} from '@saha-textile/contracts';
import {
	type BlogCategoryRepository,
	type BlogPostRepository,
	type BlogTagRepository,
	type MediaAssetRepository,
	type StoragePort,
	blogExcerpt,
	readingMinutes,
	resolveImage,
} from '@saha-textile/core-domain';

import { LanguageStore } from '../languages/language-store';
import {
	BLOG_CATEGORY_REPOSITORY,
	BLOG_POST_REPOSITORY,
	BLOG_TAG_REPOSITORY,
	MEDIA_ASSET_REPOSITORY,
	STORAGE_PORT,
} from '../infra/tokens';

const FALLBACK = 'en';
const BRAND = 'Saha Textile';
const SEO_DESCRIPTION_LIMIT = 160;

type Term = BlogCategory | BlogTag;

/**
 * The shop's blog, in one language. Only live posts whose publish date has come are readable;
 * every text falls back to English where a language is empty, though Go Live keeps that from
 * happening on a live post.
 */
@Injectable()
export class BlogPublicService {
	constructor(
		@Inject(BLOG_POST_REPOSITORY) private readonly posts: BlogPostRepository,
		@Inject(BLOG_CATEGORY_REPOSITORY) private readonly categories: BlogCategoryRepository,
		@Inject(BLOG_TAG_REPOSITORY) private readonly tags: BlogTagRepository,
		@Inject(MEDIA_ASSET_REPOSITORY) private readonly assets: MediaAssetRepository,
		@Inject(STORAGE_PORT) private readonly storage: StoragePort,
		private readonly languages: LanguageStore,
	) {}

	async list(query: PublicBlogQuery): Promise<PublicBlogListResponse> {
		const locale = this.locale(query.locale);
		const [categories, tags] = await Promise.all([this.liveTerms(this.categories), this.liveTerms(this.tags)]);
		const category = query.category ? categories.find((row) => row.slug === query.category) : undefined;
		const tag = query.tag ? tags.find((row) => row.slug === query.tag) : undefined;
		// An unknown or retired category or tag lists nothing rather than everything.
		if ((query.category && !category) || (query.tag && !tag)) {
			return { items: [], total: 0, page: query.page, pageSize: query.pageSize };
		}
		const page = await this.posts.list({
			visibleAt: new Date().toISOString(),
			categoryId: category?.id,
			tagId: tag?.id,
			page: query.page,
			pageSize: query.pageSize,
		});
		const assets = await this.assetMap(page.items.map((post) => post.coverAssetId));
		return {
			items: page.items.map((post) => this.card(post, locale, assets, categories, tags)),
			total: page.total,
			page: page.page,
			pageSize: page.pageSize,
		};
	}

	async post(slug: string, requested: string): Promise<PublicBlogPost> {
		const locale = this.locale(requested);
		const post = await this.posts.findBySlug(slug);
		const now = new Date().toISOString();
		if (!post || post.status !== 'live' || !post.publishedAt || post.publishedAt > now) {
			throw new NotFoundException('No such post');
		}
		const [categories, tags, assets] = await Promise.all([
			this.liveTerms(this.categories),
			this.liveTerms(this.tags),
			this.assetMap([post.coverAssetId, post.shareImageAssetId]),
		]);
		const card = this.card(post, locale, assets, categories, tags);
		const text = (map: Record<string, string>) => map[locale] || map[FALLBACK] || '';
		const shareImage = post.shareImageAssetId
			? this.image(assets.get(post.shareImageAssetId), locale, post.imageVersions?.[post.shareImageAssetId])
			: null;
		const seoDescription = text(post.seoDescription) || card.excerpt;
		return {
			...card,
			content: text(post.content),
			seoTitle: text(post.seoTitle) || `${card.title} | ${BRAND}`,
			seoDescription:
				seoDescription.length > SEO_DESCRIPTION_LIMIT
					? `${seoDescription.slice(0, SEO_DESCRIPTION_LIMIT - 1).trimEnd()}…`
					: seoDescription,
			shareImage: shareImage ?? card.cover,
			updatedAt: post.updatedAt ?? post.publishedAt,
		};
	}

	/** Live categories or tags that have at least one post on the shop, with their counts. */
	async terms(kind: 'category' | 'tag', requested: string): Promise<PublicBlogTerm[]> {
		const locale = this.locale(requested);
		const repository = kind === 'category' ? this.categories : this.tags;
		const [terms, counts] = await Promise.all([
			this.liveTerms(repository),
			this.posts.countVisibleByTerm(new Date().toISOString()),
		]);
		const byId = kind === 'category' ? counts.categories : counts.tags;
		return terms
			.map((term) => ({
				slug: term.slug,
				name: term.name[locale] || term.name[FALLBACK] || term.slug,
				count: byId[term.id] ?? 0,
			}))
			.filter((term) => term.count > 0);
	}

	/** Every live post's address, for the sitemap: one per language. */
	async sitemapPaths(): Promise<string[]> {
		const paths: string[] = [];
		const now = new Date().toISOString();
		for (let page = 1; ; page += 1) {
			const batch = await this.posts.list({ visibleAt: now, page, pageSize: 100 });
			for (const post of batch.items) {
				for (const locale of this.languages.shop()) paths.push(`/${locale}/blog/${post.slug}`);
			}
			if (page * batch.pageSize >= batch.total) break;
		}
		return paths;
	}

	private card(
		post: BlogPost,
		locale: string,
		assets: Map<string, MediaAsset>,
		categories: readonly Term[],
		tags: readonly Term[],
	): PublicBlogCard {
		const text = (map: Record<string, string>) => map[locale] || map[FALLBACK] || '';
		const content = text(post.content);
		const term = (row: Term) => ({ slug: row.slug, name: row.name[locale] || row.name[FALLBACK] || row.slug });
		return {
			id: post.id,
			slug: post.slug,
			title: text(post.title),
			excerpt: blogExcerpt(text(post.excerpt), content),
			author: text(post.author) || DEFAULT_BLOG_AUTHOR[locale] || DEFAULT_BLOG_AUTHOR[FALLBACK] || BRAND,
			publishedAt: post.publishedAt as string,
			featured: post.featured,
			sticky: post.sticky,
			readingMinutes: readingMinutes(content),
			cover: post.coverAssetId
				? this.image(assets.get(post.coverAssetId), locale, post.imageVersions?.[post.coverAssetId])
				: null,
			categories: categories.filter((row) => post.categoryIds.includes(row.id)).map(term),
			tags: tags.filter((row) => post.tagIds.includes(row.id)).map(term),
		};
	}

	/** A picture drawn from the version the post stored for it (else the shop's own pick, R4-1). */
	private image(asset: MediaAsset | undefined, locale: string, versionId?: string | null): ResolvedImage | null {
		if (!asset || asset.deletedAt) return null;
		return resolveImage({
			asset,
			getUrl: (key) => this.storage.getUrl(key),
			locale,
			fallbackLocale: FALLBACK,
			roles: ['blog'],
			versionId: versionId ?? null,
		});
	}

	private async liveTerms<T extends Term>(repository: { list(): Promise<T[]> }): Promise<T[]> {
		return (await repository.list()).filter((term) => term.status === 'live');
	}

	private async assetMap(ids: readonly (string | null)[]): Promise<Map<string, MediaAsset>> {
		const wanted = [...new Set(ids.filter((id): id is string => !!id))];
		if (!wanted.length) return new Map();
		return new Map((await this.assets.findManyByIds(wanted)).map((asset) => [asset.id, asset]));
	}

	private locale(requested: string): string {
		return this.languages.shop().includes(requested) ? requested : FALLBACK;
	}
}
