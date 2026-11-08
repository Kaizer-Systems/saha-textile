import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { BlogCategory, BlogPost, BlogTag, MediaAsset, SeoRedirect } from '@saha-textile/contracts';
import { blogPostVisible, compareBlogPosts } from '@saha-textile/core-domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminBlogController } from '../src/blog/admin-blog.controller';
import { BlogAdminService } from '../src/blog/blog-admin.service';
import { BlogPublicController } from '../src/blog/blog-public.controller';
import { BlogPublicService } from '../src/blog/blog-public.service';

const config = { locales: ['en', 'bn'] } as never;

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

	const postRepo = {
		findById: async (id: string) => posts.get(id) ?? null,
		findBySlug: async (slug: string) => [...posts.values()].find((post) => post.slug === slug) ?? null,
		list: async (filter: {
			status?: string;
			visibleAt?: string;
			categoryId?: string;
			tagId?: string;
			search?: string;
			page: number;
			pageSize: number;
		}) => {
			const rows = [...posts.values()]
				.filter((post) => !filter.status || post.status === filter.status)
				.filter((post) => !filter.visibleAt || blogPostVisible(post, filter.visibleAt))
				.filter((post) => !filter.categoryId || post.categoryIds.includes(filter.categoryId))
				.filter((post) => !filter.tagId || post.tagIds.includes(filter.tagId))
				.filter((post) => !filter.search || post.title['en']?.includes(filter.search))
				.sort(compareBlogPosts);
			const start = (filter.page - 1) * filter.pageSize;
			return {
				items: rows.slice(start, start + filter.pageSize),
				total: rows.length,
				page: filter.page,
				pageSize: filter.pageSize,
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
	return { admin, shop, posts, categories, tags, assets, assetRepo, redirects, audit };
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

describe('blog admin service', () => {
	let h: ReturnType<typeof harness>;

	beforeEach(async () => {
		h = harness();
		await h.admin.saveTerm(
			'category',
			null,
			{ name: { en: 'Saree guides', bn: 'শাড়ির গাইড' }, description: {}, slug: 'saree-guides', status: 'live' },
			'adm_1',
		);
	});

	const categoryId = () => [...h.categories.values()][0]?.id as string;

	it('creates a draft at an address made from the English title, article sanitised, byline defaulted', async () => {
		const row = await h.admin.create(write(), 'adm_1');
		expect(row.post.slug).toBe('how-to-spot-a-real-banarasi');
		expect(row.post.status).toBe('draft');
		expect(row.post.content['en']).toBe('<p>Seven checks.</p>');
		expect(row.post.author).toEqual({ en: 'Saha Textile', bn: 'সাহা টেক্সটাইল' });
		expect(row.cover?.url).toBe('https://cdn.example/b800');
		expect(h.audit.map((entry) => entry.action)).toContain('blog.post.create');
	});

	it('gives a second post with the same title its own address', async () => {
		await h.admin.create(write(), null);
		const second = await h.admin.create(write(), null);
		expect(second.post.slug).toBe('how-to-spot-a-real-banarasi-2');
	});

	it('refuses a post without an English title, an unknown term or a non-blog picture', async () => {
		await expect(h.admin.create(write({ title: { bn: 'শিরোনাম' } }), null)).rejects.toThrow(BadRequestException);
		await expect(h.admin.create(write({ categoryIds: ['nope'] }), null)).rejects.toThrow('Unknown blog category');
		h.assets.set('med_product', asset({ id: 'med_product', purpose: 'product' }));
		await expect(h.admin.create(write({ coverAssetId: 'med_product' }), null)).rejects.toThrow('Blog images');
	});

	it('writes the cover alt, title and caption to the picture', async () => {
		await h.admin.create(
			write({ coverText: { alt: { en: ' Red ' }, title: { bn: 'শিরোনাম' }, caption: {} } }),
			null,
		);
		const stored = h.assets.get('med_cover');
		expect(stored?.text.alt).toEqual({ en: 'Red', bn: 'লাল বেনারসি' });
		expect(stored?.text.title).toEqual({ bn: 'শিরোনাম' });
	});

	it('blocks Go Live until every language is complete, then sets the publish date', async () => {
		const { post } = await h.admin.create(write({ title: { en: 'Only English' } }), null);
		const blocked = await h.admin.goLive(post.id, null);
		expect(blocked.live).toBe(false);
		expect(blocked.gaps).toEqual([
			{ field: 'title', locale: 'bn' },
			{ field: 'category', locale: null },
		]);

		await h.admin.update(post.id, write({ categoryIds: [categoryId()] }), null);
		const done = await h.admin.goLive(post.id, 'adm_1');
		expect(done).toEqual({ live: true, gaps: [] });
		expect(h.posts.get(post.id)?.publishedAt).toBeTruthy();
		expect(h.audit.map((entry) => entry.action)).toContain('blog.post.go-live');
	});

	it('refuses an edit that empties a language of a live post', async () => {
		const { post } = await h.admin.create(write({ categoryIds: [categoryId()] }), null);
		await h.admin.goLive(post.id, null);
		await expect(
			h.admin.update(post.id, write({ categoryIds: [categoryId()], content: { en: '<p>x</p>' } }), null),
		).rejects.toThrow(BadRequestException);
	});

	it('leaves a redirect from an old address and jumps older ones straight to the new one', async () => {
		const { post } = await h.admin.create(write({ categoryIds: [categoryId()] }), null);
		await h.admin.update(post.id, write({ slug: 'real-banarasi', categoryIds: [categoryId()] }), null);
		await h.admin.update(post.id, write({ slug: 'real-banarasi-checks', categoryIds: [categoryId()] }), null);
		expect(h.redirects.get('/blog/how-to-spot-a-real-banarasi')?.targetPath).toBe('/blog/real-banarasi-checks');
		expect(h.redirects.get('/blog/real-banarasi')?.targetPath).toBe('/blog/real-banarasi-checks');

		// Going back to an old address makes it a page again.
		await h.admin.update(post.id, write({ slug: 'real-banarasi', categoryIds: [categoryId()] }), null);
		expect(h.redirects.has('/blog/real-banarasi')).toBe(false);
		expect(h.redirects.get('/blog/real-banarasi-checks')?.targetPath).toBe('/blog/real-banarasi');
	});

	it('takes a post down, and a deleted published post leaves its address gone', async () => {
		const { post } = await h.admin.create(write({ categoryIds: [categoryId()] }), null);
		await h.admin.goLive(post.id, null);
		await h.admin.takeDown(post.id, null);
		expect(h.posts.get(post.id)?.status).toBe('draft');
		await h.admin.remove(post.id, null);
		expect(h.posts.has(post.id)).toBe(false);
		expect(h.redirects.get(`/blog/${post.slug}`)?.statusCode).toBe(410);
		await expect(h.admin.detail(post.id)).rejects.toThrow(NotFoundException);

		// A new post at that address clears the 410.
		await h.admin.create(write(), null);
		expect(h.redirects.has(`/blog/${post.slug}`)).toBe(false);
	});

	it('saves a live term only with every language, and detaches a deleted one', async () => {
		await expect(
			h.admin.saveTerm(
				'tag',
				null,
				{ name: { en: 'Silk' }, description: {}, slug: 'silk', status: 'live' },
				null,
			),
		).rejects.toThrow(BadRequestException);
		const draft = await h.admin.saveTerm(
			'tag',
			null,
			{ name: { en: 'Silk' }, description: {}, slug: 'silk', status: 'draft' },
			null,
		);
		await expect(
			h.admin.saveTerm(
				'tag',
				null,
				{ name: { en: 'Again' }, description: {}, slug: 'silk', status: 'draft' },
				null,
			),
		).rejects.toThrow('already taken');
		const { post } = await h.admin.create(write({ tagIds: [draft.id] }), null);
		await h.admin.removeTerm('tag', draft.id, null);
		expect(h.posts.get(post.id)?.tagIds).toEqual([]);
		await expect(h.admin.removeTerm('tag', draft.id, null)).rejects.toThrow(NotFoundException);
	});

	it('lists posts for the admin with their cover preview', async () => {
		await h.admin.create(write(), null);
		const page = await h.admin.list({ page: 1, pageSize: 20 });
		expect(page.total).toBe(1);
		expect(page.items[0]?.cover?.alt).toEqual({ en: 'A red Banarasi', bn: 'লাল বেনারসি' });
	});
});

describe('blog public service', () => {
	let h: ReturnType<typeof harness>;

	beforeEach(async () => {
		h = harness();
		const category = await h.admin.saveTerm(
			'category',
			null,
			{ name: { en: 'Saree guides', bn: 'শাড়ির গাইড' }, description: {}, slug: 'saree-guides', status: 'live' },
			null,
		);
		const tag = await h.admin.saveTerm(
			'tag',
			null,
			{ name: { en: 'Banarasi', bn: 'বেনারসি' }, description: {}, slug: 'banarasi', status: 'live' },
			null,
		);
		const { post } = await h.admin.create(write({ categoryIds: [category.id], tagIds: [tag.id] }), null);
		await h.admin.goLive(post.id, null);
		await h.admin.create(write({ title: { en: 'Draft only', bn: 'খসড়া' } }), null);
	});

	it('lists only live posts, in the language asked for', async () => {
		const page = await h.shop.list({ locale: 'bn', page: 1, pageSize: 10 });
		expect(page.total).toBe(1);
		const card = page.items[0];
		expect(card?.title).toBe('আসল বেনারসি চেনার উপায়');
		expect(card?.excerpt).toBe('সাতটি পরীক্ষা।');
		expect(card?.author).toBe('সাহা টেক্সটাইল');
		expect(card?.cover?.alt).toBe('লাল বেনারসি');
		expect(card?.categories).toEqual([{ slug: 'saree-guides', name: 'শাড়ির গাইড' }]);
	});

	it('filters by category and tag, and an unknown one lists nothing', async () => {
		expect((await h.shop.list({ locale: 'en', page: 1, pageSize: 10, tag: 'banarasi' })).total).toBe(1);
		expect((await h.shop.list({ locale: 'en', page: 1, pageSize: 10, category: 'nothing' })).total).toBe(0);
	});

	it('reads one post with its search title and share picture', async () => {
		const post = await h.shop.post('how-to-spot-a-real-banarasi', 'en');
		expect(post.seoTitle).toBe('How to Spot a Real Banarasi | Saha Textile');
		expect(post.seoDescription).toBe('Seven checks.');
		expect(post.shareImage?.assetId).toBe('med_cover');
		expect(post.content).toBe('<p>Seven checks.</p>');
		await expect(h.shop.post('draft-only', 'en')).rejects.toThrow(NotFoundException);
		await expect(h.shop.post('missing', 'xx')).rejects.toThrow(NotFoundException);
	});

	it('names categories and tags that hold a live post', async () => {
		expect(await h.shop.terms('category', 'bn')).toEqual([{ slug: 'saree-guides', name: 'শাড়ির গাইড', count: 1 }]);
		expect(await h.shop.terms('tag', 'en')).toEqual([{ slug: 'banarasi', name: 'Banarasi', count: 1 }]);
	});

	it('lists every live post in both languages for the sitemap', async () => {
		expect(await h.shop.sitemapPaths()).toEqual([
			'/en/blog/how-to-spot-a-real-banarasi',
			'/bn/blog/how-to-spot-a-real-banarasi',
		]);
	});
});

describe('blog controllers', () => {
	it('hand public reads to the service', async () => {
		const service = {
			list: vi.fn(async () => 'list'),
			post: vi.fn(async () => 'post'),
			terms: vi.fn(async () => 'terms'),
		};
		const controller = new BlogPublicController(service as never);
		expect(await controller.list({} as never)).toBe('list');
		expect(await controller.post('slug', { locale: 'bn' })).toBe('post');
		expect(service.post).toHaveBeenLastCalledWith('slug', 'bn');
		await controller.categories({ locale: 'en' });
		expect(service.terms).toHaveBeenLastCalledWith('category', 'en');
		await controller.tags({ locale: 'bn' });
		expect(service.terms).toHaveBeenLastCalledWith('tag', 'bn');
	});

	it('hand admin writes to the service with the actor', async () => {
		const service = {
			list: vi.fn(async () => 'list'),
			detail: vi.fn(async () => 'detail'),
			create: vi.fn(async () => 'created'),
			update: vi.fn(async () => 'updated'),
			goLive: vi.fn(async () => ({ live: true, gaps: [] })),
			takeDown: vi.fn(async () => undefined),
			remove: vi.fn(async () => undefined),
			listTerms: vi.fn(async () => []),
			saveTerm: vi.fn(async () => ({ id: 't', gaps: [] })),
			removeTerm: vi.fn(async () => undefined),
		};
		const principal = { userId: 'adm_1' } as never;
		const controller = new AdminBlogController(service as never);
		expect(await controller.list({} as never)).toBe('list');
		expect(await controller.detail('p')).toBe('detail');
		expect(await controller.create({} as never, principal)).toBe('created');
		expect(await controller.update('p', {} as never, principal)).toBe('updated');
		await controller.goLive('p', principal);
		expect(service.goLive).toHaveBeenLastCalledWith('p', 'adm_1');
		expect(await controller.status('p', { status: 'live' }, undefined)).toEqual({ live: true, gaps: [] });
		expect(await controller.status('p', { status: 'draft' }, principal)).toEqual({ live: false, gaps: [] });
		expect(service.takeDown).toHaveBeenLastCalledWith('p', 'adm_1');
		await controller.remove('p', principal);
		await controller.categories();
		await controller.createCategory({} as never, principal);
		await controller.updateCategory('c', {} as never, principal);
		await controller.removeCategory('c', principal);
		await controller.tags();
		await controller.createTag({} as never, principal);
		await controller.updateTag('t', {} as never, principal);
		await controller.removeTag('t', principal);
		expect(service.saveTerm).toHaveBeenCalledWith('tag', 't', {}, 'adm_1');
		expect(service.removeTerm).toHaveBeenLastCalledWith('tag', 't', 'adm_1');
	});
});
