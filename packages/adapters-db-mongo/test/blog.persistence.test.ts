import { BlogPost } from '@saha-textile/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { connectMongo, disconnectMongo } from '../src/connection';
import { BlogCategoryModel, BlogPostModel, BlogTagModel } from '../src/models/index';
import {
	MongoBlogCategoryRepository,
	MongoBlogPostRepository,
	MongoBlogTagRepository,
} from '../src/repositories/blog.repository';
import { MEDIA_OWNER_REGISTRY } from '../src/repositories/media-owner-registry';
import { hasMongoEnv, runPrefix } from './mongo-test-env';

/**
 * Blog posts, categories and tags against the replica set: the list order, the shop filter, the
 * sidebar counts, the unique address and the picture list GC reads.
 *
 *   MONGODB_PORT=27018 MONGODB_DB_NAME=saha_textile_test RUN_DB_IT=1 pnpm --filter @saha-textile/adapters-db-mongo test
 */
describe.runIf(hasMongoEnv())('blog persistence (rs0)', () => {
	const posts = new MongoBlogPostRepository();
	const categories = new MongoBlogCategoryRepository();
	const tags = new MongoBlogTagRepository();
	const prefix = runPrefix('blog');

	const post = (name: string, overrides: Partial<BlogPost> = {}) =>
		BlogPost.parse({
			id: `${prefix}${name}`,
			slug: `${prefix}${name}`.toLowerCase().replace(/_/g, '-'),
			title: { en: `Post ${name}`, bn: `পোস্ট ${name}` },
			status: 'live',
			categoryIds: [`${prefix}cat`],
			...overrides,
		});

	beforeAll(async () => {
		await connectMongo();
		await Promise.all([BlogPostModel.syncIndexes(), BlogCategoryModel.syncIndexes(), BlogTagModel.syncIndexes()]);
	});

	afterAll(async () => {
		const mine = { _id: new RegExp(`^${prefix}`) };
		await Promise.all([
			BlogPostModel.deleteMany(mine).exec(),
			BlogCategoryModel.deleteMany(mine).exec(),
			BlogTagModel.deleteMany(mine).exec(),
		]);
		await disconnectMongo();
	});

	it('lists visible posts sticky first, then newest, and counts them per term', async () => {
		await posts.save(post('old', { publishedAt: '2026-10-01T00:00:00.000Z', tagIds: [`${prefix}tag`] }));
		await posts.save(post('new', { publishedAt: '2026-11-01T00:00:00.000Z' }));
		await posts.save(post('pinned', { publishedAt: '2026-09-01T00:00:00.000Z', sticky: true }));
		await posts.save(post('later', { publishedAt: '2027-01-01T00:00:00.000Z' }));
		await posts.save(post('draft', { status: 'draft', publishedAt: '2026-10-05T00:00:00.000Z' }));

		const now = '2026-11-08T00:00:00.000Z';
		const page = await posts.list({ visibleAt: now, categoryId: `${prefix}cat`, page: 1, pageSize: 10 });
		expect(page.items.map((row) => row.id)).toEqual([`${prefix}pinned`, `${prefix}new`, `${prefix}old`]);
		expect(page.total).toBe(3);

		const byTag = await posts.list({ visibleAt: now, tagId: `${prefix}tag`, page: 1, pageSize: 10 });
		expect(byTag.items.map((row) => row.id)).toEqual([`${prefix}old`]);

		const counts = await posts.countVisibleByTerm(now);
		expect(counts.categories[`${prefix}cat`]).toBe(3);
		expect(counts.tags[`${prefix}tag`]).toBe(1);
	});

	it('round-trips every field and keeps the picture list GC reads', async () => {
		const saved = await posts.save(
			post('full', {
				coverAssetId: `${prefix}cover`,
				shareImageAssetId: `${prefix}share`,
				imageVersions: { [`${prefix}cover`]: 'blog_cover_2x1.crop' },
				excerpt: { en: 'Short', bn: 'ছোট' },
				publishedAt: '2026-11-02T00:00:00.000Z',
			}),
		);
		expect(saved.excerpt).toEqual({ en: 'Short', bn: 'ছোট' });
		expect(saved.imageVersions).toEqual({ [`${prefix}cover`]: 'blog_cover_2x1.crop' });
		expect(saved.publishedAt).toBe('2026-11-02T00:00:00.000Z');
		const raw = await BlogPostModel.findById(`${prefix}full`).lean().exec();
		expect(raw?.assetIds).toEqual([`${prefix}cover`, `${prefix}share`]);
		const owners = MEDIA_OWNER_REGISTRY.filter((entry) => entry.model.modelName === 'BlogPost');
		for (const asset of [`${prefix}cover`, `${prefix}share`]) {
			let references = 0;
			for (const owner of owners)
				references += await owner.model.countDocuments({ [owner.path]: asset } as never).exec();
			expect(references).toBeGreaterThan(0);
		}
		expect(await posts.findBySlug(saved.slug)).toEqual(saved);
	});

	it('finds every word anywhere in the title, summary or article, in any language, in any order', async () => {
		await posts.save(
			post('search', {
				title: { en: 'How to spot a real Banarasi saree', bn: 'আসল বেনারসি শাড়ি চেনার উপায়' },
				excerpt: { en: 'Seven checks at the counter', bn: 'সাতটি পরীক্ষা' },
				content: { en: '<p>Real zari, tested zari, or plastic.</p>', bn: '<p>আসল জরি, টেস্টেড জরি।</p>' },
				status: 'draft',
			}),
		);
		const find = async (search: string, searchLocales: string[] = ['en', 'bn']) =>
			(await posts.list({ search, searchLocales, page: 1, pageSize: 50 })).items
				.map((row) => row.id)
				.filter((id) => id === `${prefix}search`);
		expect(await find('BANAR')).toHaveLength(1);
		expect(await find('banarasi real')).toHaveLength(1);
		expect(await find('zari plastic')).toHaveLength(1);
		expect(await find('counter')).toHaveLength(1);
		expect(await find('বেনারসি')).toHaveLength(1);
		expect(await find('জরি সাতটি')).toHaveLength(1);
		expect(await find('banarasi kanjivaram')).toHaveLength(0);
		expect(await find('বেনারসি', ['en'])).toHaveLength(0);
		expect(await find('a.b(c')).toHaveLength(0);
	});

	it('refuses a second post at the same address', async () => {
		await expect(
			BlogPostModel.create({ _id: `${prefix}dup`, slug: post('full').slug, status: 'draft' }),
		).rejects.toThrow();
	});

	it('detaches a deleted term from every post', async () => {
		await posts.detachTerm('tag', `${prefix}tag`);
		expect((await posts.findById(`${prefix}old`))?.tagIds).toEqual([]);
	});

	it('stores categories in display order and tags by address', async () => {
		await categories.save({
			id: `${prefix}c2`,
			slug: `${prefix}c2`.replace(/_/g, '-'),
			name: { en: 'Care' },
			description: {},
			status: 'draft',
			displayOrder: 2,
		});
		await categories.save({
			id: `${prefix}c1`,
			slug: `${prefix}c1`.replace(/_/g, '-'),
			name: { en: 'Guides', bn: 'নির্দেশিকা' },
			description: {},
			status: 'live',
			displayOrder: 1,
		});
		const mine = (await categories.list()).filter((row) => row.id.startsWith(prefix));
		expect(mine.map((row) => row.id)).toEqual([`${prefix}c1`, `${prefix}c2`]);
		expect(await categories.findManyByIds([`${prefix}c1`])).toHaveLength(1);

		await tags.save({
			id: `${prefix}t`,
			slug: `${prefix}t`.replace(/_/g, '-'),
			name: { en: 'Silk' },
			description: {},
			status: 'draft',
		});
		expect((await tags.findBySlug(`${prefix}t`.replace(/_/g, '-')))?.name).toEqual({ en: 'Silk' });
		await tags.remove(`${prefix}t`);
		expect(await tags.findById(`${prefix}t`)).toBeNull();
	});
});
