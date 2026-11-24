import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { BlogCategory, BlogPost, BlogTag, MediaAsset, SeoRedirect } from '@saha-textile/contracts';
import { blogPostVisible, compareBlogPosts } from '@saha-textile/core-domain';
import { describe, expect, it, vi } from 'vitest';

import { BlogAdminService } from '../src/blog/blog-admin.service';
import { BlogPublicService } from '../src/blog/blog-public.service';
import { LanguageStore } from '../src/languages/language-store';

const config = LanguageStore.fixed(['en', 'bn']);

const asset = (overrides: Partial<MediaAsset> = {}): MediaAsset =>
	({
		id: 'med_cover',
		kind: 'image',
		purpose: 'blog',
		originalStorageKey: 'media/med_cover/original.jpg',
		slug: 'banarasi',
		width: 1774,
		height: 887,
		derivatives: [
			{ role: 'blog', width: 800, height: 400, format: 'image/webp', storageKey: 'b800', roleVersion: 1 },
			{ role: 'blog', width: 1600, height: 800, format: 'image/webp', storageKey: 'b1600', roleVersion: 1 },
		],
		visibility: 'public',
		processing: { state: 'ready', attempts: 1, error: null, processedAt: null },
		warnings: [],
		text: { alt: { en: 'A red Banarasi', bn: 'লাল বেনারসি' }, title: {}, caption: {} },
		dominantColor: null,
		thumbHash: null,
		uploadedBy: { type: 'admin', id: 'a1' },
		deletedAt: null,
		...overrides,
	}) as never;

/** In-memory stand-ins for the repositories the services read. */
function harness() {
	const posts = new Map<string, BlogPost>();
	const categories = new Map<string, BlogCategory>();
	const tags = new Map<string, BlogTag>();
	const assets = new Map<string, MediaAsset>([['med_cover', asset()]]);
	const redirects = new Map<string, SeoRedirect>();
	const audit: { action: string; entityId: string | null }[] = [];
	let filter: unknown = null;

	const postRepo = {
		findById: async (id: string) => posts.get(id) ?? null,
		findBySlug: async (slug: string) => [...posts.values()].find((post) => post.slug === slug) ?? null,
		list: async (filter_: {
			status?: string;
			visibleAt?: string;
			categoryId?: string;
			tagId?: string;
			search?: string;
			page: number;
			pageSize: number;
		}) => {
			filter = filter_;
			const rows = [...posts.values()]
				.filter((post) => !filter_.status || post.status === filter_.status)
				.filter((post) => !filter_.visibleAt || blogPostVisible(post, filter_.visibleAt))
				.filter((post) => !filter_.categoryId || post.categoryIds.includes(filter_.categoryId))
				.filter((post) => !filter_.tagId || post.tagIds.includes(filter_.tagId))
				.filter((post) => !filter_.search || post.title['en']?.includes(filter_.search))
				.sort(compareBlogPosts);
			const start = (filter_.page - 1) * filter_.pageSize;
			return {
				items: rows.slice(start, start + filter_.pageSize),
				total: rows.length,
				page: filter_.page,
				pageSize: filter_.pageSize,
			};
		},
		countVisibleByTerm: async (now: string) => {
			const counts = { categories: {} as Record<string, number>, tags: {} as Record<string, number> };
			for (const post of posts.values()) {
				if (!blogPostVisible(post, now)) continue;
				for (const id of post.categoryIds) counts.categories[id] = (counts.categories[id] ?? 0) + 1;
				for (const id of post.tagIds) counts.tags[id] = (counts.tags[id] ?? 0) + 1;
			}
			return counts;
		},
		save: async (post: BlogPost) => {
			posts.set(post.id, { ...post, updatedAt: '2026-11-08T00:00:00.000Z' });
			return posts.get(post.id) as BlogPost;
		},
		remove: async (id: string) => void posts.delete(id),
		detachTerm: async (kind: 'category' | 'tag', id: string) => {
			for (const post of posts.values()) {
				if (kind === 'category') post.categoryIds = post.categoryIds.filter((row) => row !== id);
				else post.tagIds = post.tagIds.filter((row) => row !== id);
			}
		},
	};
	const termRepo = <T extends BlogCategory | BlogTag>(store: Map<string, T>) => ({
		list: async () => [...store.values()],
		findById: async (id: string) => store.get(id) ?? null,
		findBySlug: async (slug: string) => [...store.values()].find((term) => term.slug === slug) ?? null,
		findManyByIds: async (ids: readonly string[]) => ids.flatMap((id) => store.get(id) ?? []),
		save: async (term: T) => {
			store.set(term.id, term);
			return term;
		},
		remove: async (id: string) => void store.delete(id),
	});
	const assetRepo = {
		findById: async (id: string) => assets.get(id) ?? null,
		findManyByIds: async (ids: readonly string[]) => ids.flatMap((id) => assets.get(id) ?? []),
		update: vi.fn(async (next: MediaAsset) => {
			assets.set(next.id, next);
			return next;
		}),
	};
	const redirectRepo = {
		list: async () => [...redirects.values()],
		findBySource: async (source: string) => redirects.get(source) ?? null,
		save: async (row: SeoRedirect) => {
			redirects.set(row.sourcePath, row);
			return row;
		},
		remove: async (source: string) => void redirects.delete(source),
	};
	const storage = { getUrl: (key: string) => `https://cdn.example/${key}` };
	const auditRepo = { append: async (entry: { action: string; entityId: string | null }) => void audit.push(entry) };

	const admin = new BlogAdminService(
		postRepo as never,
		termRepo(categories) as never,
		termRepo(tags) as never,
		assetRepo as never,
		redirectRepo as never,
		storage as never,
		config,
		auditRepo as never,
	);
	const shop = new BlogPublicService(
		postRepo as never,
		termRepo(categories) as never,
		termRepo(tags) as never,
		assetRepo as never,
		storage as never,
		config,
	);
	return { admin, shop, posts, categories, tags, assets, assetRepo, redirects, audit, lastFilter: () => filter };
}

const write = (overrides: Record<string, unknown> = {}) =>
	({
		title: { en: 'How to Spot a Real Banarasi', bn: 'আসল বেনারসি চেনার উপায়' },
		excerpt: {},
		content: {
			en: '<p>Seven checks.</p><script>alert(1)</script>',
			bn: '<p>সাতটি পরীক্ষা।</p>',
		},
		coverAssetId: 'med_cover',
		shareImageAssetId: null,
		categoryIds: [],
		tagIds: [],
		featured: false,
		sticky: false,
		author: {},
		seoTitle: {},
		seoDescription: {},
		...overrides,
	}) as never;

type Harness = ReturnType<typeof harness>;

/** A live category and a draft post in it, ready to go live. */
const ready = async (h: Harness) => {
	await h.admin.saveTerm(
		'category',
		null,
		{ name: { en: 'Saree guides', bn: 'শাড়ির গাইড' }, description: {}, slug: 'saree-guides', status: 'live' },
		'adm_1',
	);
	const categoryId = [...h.categories.values()][0]?.id as string;
	const row = await h.admin.create(write({ categoryIds: [categoryId] }), 'adm_1');
	return { post: row.post, categoryId };
};
const issuesOf = async (promise: Promise<unknown>) => {
	try {
		await promise;
	} catch (error) {
		expect(error).toBeInstanceOf(BadRequestException);
		return ((error as BadRequestException).getResponse() as { issues?: unknown[] }).issues;
	}
	throw new Error('expected a refusal');
};

describe('blog admin: the remaining cases', () => {
	it('refuses to save a live post that would lose its cover, naming the gap with no language', async () => {
		const h = harness();
		const { post, categoryId } = await ready(h);
		expect((await h.admin.goLive(post.id, 'adm_1')).live).toBe(true);
		const issues = await issuesOf(
			h.admin.update(post.id, write({ categoryIds: [categoryId], coverAssetId: null }), null),
		);
		expect(issues).toContainEqual(expect.objectContaining({ path: ['cover', ''] }));
	});

	it('saves a live post with nothing missing, taking the publish date sent', async () => {
		const h = harness();
		const { post, categoryId } = await ready(h);
		await h.admin.goLive(post.id, 'adm_1');
		const saved = await h.admin.update(
			post.id,
			write({ categoryIds: [categoryId], publishedAt: '2026-11-01T00:00:00.000Z' }),
			'adm_1',
		);
		expect(saved.post).toMatchObject({ status: 'live', publishedAt: '2026-11-01T00:00:00.000Z' });
	});

	it('refuses a save without an English title, and an unknown post', async () => {
		const h = harness();
		const { post } = await ready(h);
		await expect(h.admin.update(post.id, write({ title: { en: '  ' } }), null)).rejects.toBeInstanceOf(
			BadRequestException,
		);
		await expect(h.admin.update('post_none', write(), null)).rejects.toBeInstanceOf(NotFoundException);
	});

	it('goes live once, takes nothing down from a draft, and leaves no address behind a post never published', async () => {
		const h = harness();
		const { post } = await ready(h);
		await h.admin.goLive(post.id, 'adm_1');
		await h.admin.goLive(post.id, 'adm_1');
		expect(h.audit.filter((entry) => entry.action === 'blog.post.go-live')).toHaveLength(1);
		const draft = await h.admin.create(write({ title: { en: 'Draft only', bn: 'খসড়া' } }), 'adm_1');
		await h.admin.takeDown(draft.post.id, 'adm_1');
		expect(h.audit.some((entry) => entry.action === 'blog.post.take-down')).toBe(false);
		await h.admin.remove(draft.post.id, 'adm_1');
		expect(h.redirects.size).toBe(0);
	});

	it('names the cover as missing when its picture is gone or deleted', async () => {
		const h = harness();
		const { post } = await ready(h);
		h.assets.set('med_deleted', asset({ id: 'med_deleted', deletedAt: '2026-11-20T00:00:00.000Z' }));
		for (const coverAssetId of ['med_none', 'med_deleted']) {
			h.posts.set(post.id, { ...post, coverAssetId });
			expect((await h.admin.goLive(post.id, 'adm_1')).gaps).toContainEqual({ field: 'cover', locale: null });
		}
	});

	it('refuses an unknown tag and a picture not in the library, keeps a byline given, and needs English letters in the address', async () => {
		const h = harness();
		await expect(h.admin.create(write({ tagIds: ['btag_none'] }), null)).rejects.toThrow('Unknown blog tag');
		await expect(h.admin.create(write({ coverAssetId: 'med_none' }), null)).rejects.toThrow(
			'not in the media library',
		);
		expect((await h.admin.create(write({ author: { en: 'Rina Das' } }), null)).post.author).toEqual({
			en: 'Rina Das',
		});
		await expect(h.admin.create(write({ title: { en: '!!!' } }), null)).rejects.toThrow(
			'English letters or digits',
		);
	});

	it('shows no preview for a picture with no blog size, and the widest when none reaches 800', async () => {
		const h = harness();
		const { post } = await ready(h);
		h.assets.set(
			'med_card',
			asset({
				id: 'med_card',
				derivatives: [
					{ role: 'card', width: 400, height: 533, format: 'image/webp', storageKey: 'c400', roleVersion: 1 },
				] as never,
			}),
		);
		h.assets.set(
			'med_small',
			asset({
				id: 'med_small',
				derivatives: [
					{ role: 'blog', width: 400, height: 200, format: 'image/webp', storageKey: 'b400', roleVersion: 1 },
				] as never,
			}),
		);
		h.posts.set(post.id, { ...post, coverAssetId: 'med_card', shareImageAssetId: 'med_small' });
		const row = await h.admin.detail(post.id);
		expect(row.cover?.url).toBe('');
		expect(row.shareImage?.url).toBe('https://cdn.example/b400');
	});

	it('lists categories and tags, refuses a name without English or an unknown term, and keeps a category’s order', async () => {
		const h = harness();
		await h.admin.saveTerm(
			'tag',
			null,
			{ name: { en: 'Silk' }, description: {}, slug: 'silk', status: 'draft' },
			null,
		);
		expect(await h.admin.listTerms('tag')).toHaveLength(1);
		expect(await h.admin.listTerms('category')).toEqual([]);
		await expect(
			h.admin.saveTerm(
				'tag',
				null,
				{ name: { bn: 'রেশম' }, description: {}, slug: 'resham', status: 'draft' },
				null,
			),
		).rejects.toBeInstanceOf(BadRequestException);
		await expect(
			h.admin.saveTerm(
				'tag',
				'btag_none',
				{ name: { en: 'Silk' }, description: {}, slug: 'silk-2', status: 'draft' },
				null,
			),
		).rejects.toBeInstanceOf(NotFoundException);
		const made = await h.admin.saveTerm(
			'category',
			null,
			{ name: { en: 'Guides' }, description: {}, slug: 'guides', status: 'draft', displayOrder: 4 } as never,
			null,
		);
		await h.admin.saveTerm(
			'category',
			made.id,
			{ name: { en: 'Guides' }, description: {}, slug: 'guides', status: 'draft' },
			null,
		);
		expect(h.categories.get(made.id)?.displayOrder).toBe(4);
	});

	it('records nothing when there is no audit store', async () => {
		const h = harness();
		Object.defineProperty(h.admin, 'audit', { value: null });
		await h.admin.saveTerm(
			'tag',
			null,
			{ name: { en: 'Silk' }, description: {}, slug: 'silk', status: 'draft' },
			null,
		);
		expect(h.audit).toEqual([]);
	});
});

describe('the shop’s blog: the remaining cases', () => {
	const live = async (h: Harness, over: Partial<BlogPost> = {}) => {
		const { post } = await ready(h);
		await h.admin.goLive(post.id, 'adm_1');
		const stored = h.posts.get(post.id) as BlogPost;
		h.posts.set(post.id, { ...stored, publishedAt: '2026-11-01T00:00:00.000Z', ...over });
		return h.posts.get(post.id) as BlogPost;
	};

	it('shares its own picture, cuts a long description, and dates a post never edited by its publishing', async () => {
		const h = harness();
		const post = await live(h, {
			shareImageAssetId: 'med_cover',
			seoDescription: { en: 'word '.repeat(60), bn: 'শব্দ '.repeat(60) },
			updatedAt: undefined,
		});
		const page = await h.shop.post(post.slug, 'en');
		expect(page.shareImage).not.toBeNull();
		expect(page.seoDescription.endsWith('…')).toBe(true);
		expect(page.updatedAt).toBe('2026-11-01T00:00:00.000Z');
	});

	it('draws no cover for a post without one or with a picture gone, and the English byline in a language without its own', async () => {
		const h = harness();
		const post = await live(h, { coverAssetId: null, shareImageAssetId: 'med_gone', author: {} });
		Object.defineProperty(h.shop, 'languages', { value: LanguageStore.fixed(['en', 'bn', 'hi']) });
		const page = await h.shop.post(post.slug, 'hi');
		expect(page.cover).toBeNull();
		expect(page.shareImage).toBeNull();
		expect(page.author).toBe('Saha Textile');
	});

	it('names terms in English or by their address, counts a term with no posts as none, and leaves it out', async () => {
		const h = harness();
		await live(h);
		await h.admin.saveTerm(
			'tag',
			null,
			{ name: { en: 'Silk', bn: 'সিল্ক' }, description: {}, slug: 'silk', status: 'live' },
			null,
		);
		const categoryId = [...h.categories.values()][0]?.id as string;
		h.categories.set(categoryId, { ...(h.categories.get(categoryId) as BlogCategory), name: { bn: '' } as never });
		const terms = await h.shop.terms('category', 'bn');
		expect(terms).toEqual([{ slug: 'saree-guides', name: 'saree-guides', count: 1 }]);
		expect(await h.shop.terms('tag', 'en')).toEqual([]);
	});

	it('reads every page of live posts for the sitemap', async () => {
		const h = harness();
		const first = await live(h);
		for (let index = 0; index < 100; index += 1) {
			h.posts.set(`post_${index}`, { ...first, id: `post_${index}`, slug: `post-${index}` });
		}
		expect(await h.shop.sitemapPaths()).toHaveLength(101 * 2);
	});

	it('lists posts without pictures without reading the library', async () => {
		const h = harness();
		await live(h, { coverAssetId: null });
		const findManyByIds = vi.spyOn(h.assetRepo, 'findManyByIds');
		const list = await h.shop.list({ page: 1, pageSize: 10, locale: 'en' } as never);
		expect(list.items[0]?.cover).toBeNull();
		expect(findManyByIds).not.toHaveBeenCalled();
	});
});
