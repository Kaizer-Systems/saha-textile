import { randomUUID } from 'node:crypto';

import { BadRequestException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import {
	type AdminBlogImage,
	type AdminBlogListQuery,
	type AdminBlogListResponse,
	type AdminBlogPostRow,
	type AuditLog,
	BlogCategory,
	type BlogCategoryWrite,
	BlogPost,
	type BlogPostWrite,
	BlogTag,
	type BlogTagWrite,
	DEFAULT_BLOG_AUTHOR,
	GoLiveResult,
	type MediaAsset,
} from '@saha-textile/contracts';
import {
	type AuditLogRepository,
	type BlogCategoryRepository,
	type BlogPostRepository,
	type BlogTagRepository,
	type MediaAssetRepository,
	type SeoRedirectRepository,
	type StoragePort,
	blogGoLiveGaps,
	blogSlugFrom,
	blogTermGaps,
	repointedRows,
	resolveImage,
	sanitizeArticleHtml,
} from '@saha-textile/core-domain';

import { LanguageStore } from '../languages/language-store';
import {
	AUDIT_LOG_REPOSITORY,
	BLOG_CATEGORY_REPOSITORY,
	BLOG_POST_REPOSITORY,
	BLOG_TAG_REPOSITORY,
	MEDIA_ASSET_REPOSITORY,
	SEO_REDIRECT_REPOSITORY,
	STORAGE_PORT, LANGUAGE_COVERAGE_REPOSITORY } from '../infra/tokens';
import type { LanguageCoverageRepository } from '@saha-textile/core-domain';
import { missingFilter } from '../languages/missing-filter';

const PREVIEW_ROLES = ['blog'];

/** Trimmed text per language, empty languages dropped. */
const clean = (values: Readonly<Record<string, string>>): Record<string, string> =>
	Object.fromEntries(
		Object.entries(values)
			.map(([locale, value]) => [locale, value.trim()] as const)
			.filter(([, value]) => value.length > 0),
	);

const cleanHtml = (values: Readonly<Record<string, string>>): Record<string, string> =>
	Object.fromEntries(
		Object.entries(values)
			.map(([locale, html]) => [locale, sanitizeArticleHtml(html)] as const)
			.filter(([, html]) => html.length > 0),
	);

const postPath = (slug: string): string => `/blog/${slug}`;

/**
 * A save refused because a live post or term would lose a language. The gaps travel as field
 * issues (`[field, locale]`), the one part of an error body the API filter passes to the client.
 */
const gapRefusal = (gaps: GoLiveResult['gaps']): BadRequestException =>
	new BadRequestException({
		message: 'go_live_blocked',
		issues: gaps.map((gap) => ({
			path: [gap.field, gap.locale ?? ''],
			message: 'go_live_blocked',
			code: 'go_live_blocked',
		})),
	});

type TermKind = 'category' | 'tag';

/**
 * The admin side of the blog: posts, categories and tags, their Go Live checks, the redirect an
 * address change leaves behind, and an audit record for every write.
 */
@Injectable()
export class BlogAdminService {
	constructor(
		@Inject(BLOG_POST_REPOSITORY) private readonly posts: BlogPostRepository,
		@Inject(BLOG_CATEGORY_REPOSITORY) private readonly categories: BlogCategoryRepository,
		@Inject(BLOG_TAG_REPOSITORY) private readonly tags: BlogTagRepository,
		@Inject(MEDIA_ASSET_REPOSITORY) private readonly assets: MediaAssetRepository,
		@Inject(SEO_REDIRECT_REPOSITORY) private readonly redirects: SeoRedirectRepository,
		@Inject(STORAGE_PORT) private readonly storage: StoragePort,
		private readonly languages: LanguageStore,
		@Optional() @Inject(AUDIT_LOG_REPOSITORY) private readonly audit: AuditLogRepository | null = null,
		@Optional() @Inject(LANGUAGE_COVERAGE_REPOSITORY) private readonly coverage: LanguageCoverageRepository | null = null,
	) {}

	// ── Posts ──────────────────────────────────────────────────────────────────

	async list(query: AdminBlogListQuery): Promise<AdminBlogListResponse> {
		const page = await this.posts.list({
			...(await missingFilter(this.coverage, 'blog_posts', query.missing)),
			status: query.status,
			search: query.search,
			searchLocales: this.languages.shop(),
			page: query.page,
			pageSize: query.pageSize,
		});
		const assets = await this.assetMap(page.items.flatMap((post) => [post.coverAssetId, post.shareImageAssetId]));
		return {
			items: page.items.map((post) => this.row(post, assets)),
			total: page.total,
			page: page.page,
			pageSize: page.pageSize,
		};
	}

	async detail(id: string): Promise<AdminBlogPostRow> {
		const post = await this.requirePost(id);
		return this.row(post, await this.assetMap([post.coverAssetId, post.shareImageAssetId]));
	}

	/** A new post is a draft. Its address comes from the English title unless one is given. */
	async create(body: BlogPostWrite, actorUserId: string | null): Promise<AdminBlogPostRow> {
		const english = body.title['en']?.trim();
		if (!english) throw new BadRequestException('A post needs an English title');
		const slug = await this.freeSlug(body.slug ?? blogSlugFrom(english), null);
		const post = BlogPost.parse({
			id: `blg_${randomUUID()}`,
			slug,
			status: 'draft',
			publishedAt: body.publishedAt ?? null,
			...(await this.fields(body)),
		});
		const saved = await this.posts.save(post);
		// An address that once answered "gone" or redirected is a page again.
		if (await this.redirects.findBySource(postPath(slug))) await this.redirects.remove(postPath(slug));
		await this.writeCoverText(body);
		await this.record(actorUserId, 'blog.post.create', saved.id, { slug });
		return this.detail(saved.id);
	}

	/** Saves the form. A changed address leaves a permanent redirect from the old one. */
	async update(id: string, body: BlogPostWrite, actorUserId: string | null): Promise<AdminBlogPostRow> {
		const current = await this.requirePost(id);
		if (!body.title['en']?.trim()) throw new BadRequestException('A post needs an English title');
		const slug = body.slug && body.slug !== current.slug ? await this.freeSlug(body.slug, id) : current.slug;
		const next = BlogPost.parse({
			...current,
			...(await this.fields(body)),
			slug,
			publishedAt: body.publishedAt === undefined ? current.publishedAt : body.publishedAt,
		});
		// A live post keeps every language complete: an edit that empties one is refused.
		if (next.status === 'live') {
			const gaps = await this.gaps(next);
			if (gaps.length) throw gapRefusal(gaps);
		}
		const saved = await this.posts.save(next);
		if (slug !== current.slug) await this.moveAddress(current, slug);
		await this.writeCoverText(body);
		await this.record(actorUserId, 'blog.post.save', id, {
			slug,
			status: saved.status,
			...(slug !== current.slug ? { previousSlug: current.slug } : {}),
		});
		return this.detail(id);
	}

	/** The one check behind Go Live, from the form and from the list. */
	async goLive(id: string, actorUserId: string | null): Promise<GoLiveResult> {
		const post = await this.requirePost(id);
		const gaps = await this.gaps(post);
		if (gaps.length) return GoLiveResult.parse({ live: false, gaps });
		if (post.status !== 'live') {
			await this.posts.save({
				...post,
				status: 'live',
				publishedAt: post.publishedAt ?? new Date().toISOString(),
			});
			await this.record(actorUserId, 'blog.post.go-live', id, { slug: post.slug });
		}
		return GoLiveResult.parse({ live: true, gaps: [] });
	}

	/** Takes a post off the shop. Its address answers "not found" until it is live again. */
	async takeDown(id: string, actorUserId: string | null): Promise<void> {
		const post = await this.requirePost(id);
		if (post.status === 'draft') return;
		await this.posts.save({ ...post, status: 'draft' });
		await this.record(actorUserId, 'blog.post.take-down', id, { slug: post.slug });
	}

	/** Deletes a post. One that was ever published leaves its address answering "gone" (410). */
	async remove(id: string, actorUserId: string | null): Promise<void> {
		const post = await this.requirePost(id);
		await this.posts.remove(id);
		if (post.publishedAt) {
			const existing = await this.redirects.findBySource(postPath(post.slug));
			await this.redirects.save({
				id: existing?.id ?? `redir_${randomUUID()}`,
				sourcePath: postPath(post.slug),
				statusCode: 410,
				reason: 'manual',
				entityType: 'blog_post',
				entityId: post.id,
			});
		}
		await this.record(actorUserId, 'blog.post.delete', id, { slug: post.slug });
	}

	private async gaps(post: BlogPost) {
		const cover = post.coverAssetId ? await this.assets.findById(post.coverAssetId) : null;
		const usable = cover && !cover.deletedAt ? cover : null;
		const [categories, tags] = await Promise.all([
			this.categories.findManyByIds(post.categoryIds),
			this.tags.findManyByIds(post.tagIds),
		]);
		return blogGoLiveGaps({
			post,
			locales: this.languages.shop(),
			coverAlt: usable ? usable.text.alt : null,
			coverReady:
				!!usable &&
				usable.processing.state === 'ready' &&
				usable.derivatives.some((row) => row.role === 'blog'),
			categories,
			tags,
		});
	}

	/** The stored fields of a write: text cleaned, the article sanitised, pictures and terms checked. */
	private async fields(body: BlogPostWrite) {
		await this.requireBlogPicture(body.coverAssetId);
		await this.requireBlogPicture(body.shareImageAssetId);
		const categoryIds = [...new Set(body.categoryIds)];
		const tagIds = [...new Set(body.tagIds)];
		if ((await this.categories.findManyByIds(categoryIds)).length !== categoryIds.length) {
			throw new BadRequestException('Unknown blog category');
		}
		if ((await this.tags.findManyByIds(tagIds)).length !== tagIds.length) {
			throw new BadRequestException('Unknown blog tag');
		}
		const author = clean(body.author);
		return {
			title: clean(body.title),
			excerpt: clean(body.excerpt),
			content: cleanHtml(body.content),
			coverAssetId: body.coverAssetId,
			shareImageAssetId: body.shareImageAssetId,
			categoryIds,
			tagIds,
			featured: body.featured,
			sticky: body.sticky,
			author: Object.keys(author).length ? author : { ...DEFAULT_BLOG_AUTHOR },
			seoTitle: clean(body.seoTitle),
			seoDescription: clean(body.seoDescription),
		};
	}

	private async requireBlogPicture(assetId: string | null): Promise<void> {
		if (!assetId) return;
		const asset = await this.assets.findById(assetId);
		if (!asset || asset.deletedAt) throw new BadRequestException('That picture is not in the media library');
		if (asset.purpose !== 'blog') throw new BadRequestException('Blog pictures must be uploaded as Blog images');
	}

	/** The cover's alt, title and caption live on the picture, so every place it shows reads them. */
	private async writeCoverText(body: BlogPostWrite): Promise<void> {
		if (!body.coverAssetId || !body.coverText) return;
		const asset = await this.assets.findById(body.coverAssetId);
		if (!asset) return;
		const merge = (stored: Record<string, string>, typed: Record<string, string>) => ({
			...stored,
			...Object.fromEntries(Object.entries(typed).map(([locale, value]) => [locale, value.trim()])),
		});
		await this.assets.update({
			...asset,
			text: {
				alt: merge(asset.text.alt, body.coverText.alt),
				title: merge(asset.text.title, body.coverText.title),
				caption: merge(asset.text.caption, body.coverText.caption),
			},
		});
	}

	/**
	 * `/blog/old` now answers 301 to `/blog/new`, earlier addresses jump straight there, and a
	 * redirect that pointed away from the new address is dropped, since that address is live again.
	 */
	private async moveAddress(previous: BlogPost, slug: string): Promise<void> {
		const target = postPath(slug);
		if (await this.redirects.findBySource(target)) await this.redirects.remove(target);
		const existing = await this.redirects.findBySource(postPath(previous.slug));
		const saved = await this.redirects.save({
			id: existing?.id ?? `redir_${randomUUID()}`,
			sourcePath: postPath(previous.slug),
			statusCode: 301,
			targetPath: target,
			reason: 'slug_change',
			entityType: 'blog_post',
			entityId: previous.id,
		});
		const others = (await this.redirects.list()).filter((row) => row.sourcePath !== saved.sourcePath);
		for (const row of repointedRows(others, saved)) await this.redirects.save(row);
	}

	private async freeSlug(base: string, ownId: string | null): Promise<string> {
		const root = blogSlugFrom(base);
		if (!root) throw new BadRequestException('A post needs an address made of English letters or digits');
		for (let attempt = 1; ; attempt += 1) {
			const slug = attempt === 1 ? root : `${root}-${attempt}`;
			const taken = await this.posts.findBySlug(slug);
			if (!taken || taken.id === ownId) return slug;
		}
	}

	private async requirePost(id: string): Promise<BlogPost> {
		const post = (await this.posts.findById(id)) ?? (await this.posts.findBySlug(id));
		if (!post) throw new NotFoundException('No such post');
		return post;
	}

	private row(post: BlogPost, assets: Map<string, MediaAsset>): AdminBlogPostRow {
		return {
			post,
			cover: this.image(post.coverAssetId, assets),
			shareImage: this.image(post.shareImageAssetId, assets),
		};
	}

	private image(id: string | null, assets: Map<string, MediaAsset>): AdminBlogImage | null {
		const asset = id ? assets.get(id) : undefined;
		if (!asset) return null;
		const resolved = resolveImage({
			asset,
			getUrl: (key) => this.storage.getUrl(key),
			locale: 'en',
			fallbackLocale: 'en',
			roles: PREVIEW_ROLES,
		});
		const sources = resolved?.roles['blog'] ?? [];
		const preview = sources.find((source) => source.width >= 800) ?? sources.at(-1);
		return {
			id: asset.id,
			url: preview?.url ?? '',
			alt: asset.text.alt,
			title: asset.text.title,
			caption: asset.text.caption,
		};
	}

	private async assetMap(ids: readonly (string | null)[]): Promise<Map<string, MediaAsset>> {
		const wanted = [...new Set(ids.filter((id): id is string => !!id))];
		if (!wanted.length) return new Map();
		return new Map((await this.assets.findManyByIds(wanted)).map((asset) => [asset.id, asset]));
	}

	// ── Categories and tags ────────────────────────────────────────────────────

	listTerms(kind: TermKind): Promise<BlogCategory[] | BlogTag[]> {
		return kind === 'category' ? this.categories.list() : this.tags.list();
	}

	/**
	 * Saves a category or tag. Live needs a name in every language; otherwise nothing is saved
	 * and the gaps come back, the same answer Go Live gives.
	 */
	async saveTerm(
		kind: TermKind,
		id: string | null,
		body: BlogCategoryWrite | BlogTagWrite,
		actorUserId: string | null,
	): Promise<{ id: string; gaps: GoLiveResult['gaps'] }> {
		const name = clean(body.name);
		if (!name['en']) throw new BadRequestException('A name in English is required');
		const gaps = body.status === 'live' ? blogTermGaps({ name }, this.languages.shop()) : [];
		if (gaps.length) throw gapRefusal(gaps);
		const repository = this.termRepository(kind);
		const existing = id ? await repository.findById(id) : null;
		if (id && !existing) throw new NotFoundException('No such term');
		const sameSlug = await repository.findBySlug(body.slug);
		if (sameSlug && sameSlug.id !== id) throw new BadRequestException('That address is already taken');
		const termId = existing?.id ?? `${kind === 'category' ? 'bcat' : 'btag'}_${randomUUID()}`;
		const base = { id: termId, slug: body.slug, name, description: clean(body.description), status: body.status };
		const term =
			kind === 'category'
				? BlogCategory.parse({
						...base,
						displayOrder:
							(body as BlogCategoryWrite).displayOrder ??
							(existing as BlogCategory | null)?.displayOrder ??
							0,
					})
				: BlogTag.parse(base);
		await (repository as BlogCategoryRepository | BlogTagRepository).save(term as never);
		// A term taken off the shop takes no live post with it: the posts keep the term, and the
		// shop lists only live terms.
		await this.record(actorUserId, `blog.${kind}.save`, termId, { slug: body.slug, status: body.status });
		return { id: termId, gaps: [] };
	}

	async removeTerm(kind: TermKind, id: string, actorUserId: string | null): Promise<void> {
		const repository = this.termRepository(kind);
		const term = await repository.findById(id);
		if (!term) throw new NotFoundException('No such term');
		await this.posts.detachTerm(kind, id);
		await repository.remove(id);
		await this.record(actorUserId, `blog.${kind}.delete`, id, { slug: term.slug });
	}

	private termRepository(kind: TermKind): BlogCategoryRepository | BlogTagRepository {
		return kind === 'category' ? this.categories : this.tags;
	}

	private async record(
		actorUserId: string | null,
		action: string,
		entityId: string,
		metadata: Record<string, unknown>,
	) {
		if (!this.audit) return;
		const entry: AuditLog = {
			id: `audit_${randomUUID()}`,
			actorUserId,
			targetUserId: null,
			audience: 'admin',
			action,
			entityType: 'blog',
			entityId,
			severity: 'info',
			retentionTier: 'catalog_admin',
			diffs: [],
			metadata,
			requestId: null,
			ipHash: null,
			userAgentHash: null,
			createdAt: new Date().toISOString(),
		};
		await this.audit.append(entry);
	}
}
