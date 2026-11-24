import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { connectMongo, disconnectMongo } from '../src/connection';
import { BlogCategoryModel, BlogPostModel, BlogTagModel } from '../src/models/index';
import {
	MongoBlogCategoryRepository,
	MongoBlogPostRepository,
	MongoBlogTagRepository,
} from '../src/repositories/blog.repository';
import { hasMongoEnv, insertRaw, runPrefix } from './mongo-test-env';

describe.runIf(hasMongoEnv())('blog repositories: the remaining reads and writes (rs0)', () => {
	const P = runPrefix('blogx');
	const posts = new MongoBlogPostRepository();
	const categories = new MongoBlogCategoryRepository();
	const tags = new MongoBlogTagRepository();

	beforeAll(async () => {
		await connectMongo();
	});

	afterAll(async () => {
		const ours = { $regex: `^${P}` };
		await Promise.all([
			BlogPostModel.deleteMany({ _id: ours }),
			BlogCategoryModel.deleteMany({ _id: ours }),
			BlogTagModel.deleteMany({ _id: ours }),
		]);
		await disconnectMongo();
	});

	it('reads an older post row with every optional part missing', async () => {
		await insertRaw(BlogPostModel as never, { _id: `${P}bare`, slug: `${P}bare`, status: 'draft' });
		expect(await posts.findById(`${P}bare`)).toMatchObject({
			title: {},
			excerpt: {},
			content: {},
			imageVersions: {},
			categoryIds: [],
			tagIds: [],
			author: {},
			seoTitle: {},
			seoDescription: {},
			publishedAt: null,
			status: 'draft',
		});
		expect(await posts.findById(`${P}none`)).toBeNull();
		expect(await posts.findBySlug(`${P}none`)).toBeNull();
	});

	it('lists posts by status and ids, searching English when no languages are given', async () => {
		await posts.save({
			id: `${P}post`,
			slug: `${P}post`,
			title: { en: 'Caring for silk' },
			excerpt: {},
			content: {},
			coverAssetId: null,
			shareImageAssetId: null,
			imageVersions: {},
			categoryIds: [`${P}cat`],
			tagIds: [`${P}tag`],
			featured: false,
			sticky: false,
			author: {},
			publishedAt: null,
			seoTitle: {},
			seoDescription: {},
			status: 'draft',
		} as never);
		const list = await posts.list({
			status: 'draft',
			ids: [`${P}post`, `${P}bare`],
			search: 'silk',
			page: 1,
			pageSize: 10,
		} as never);
		expect(list.items.map((row) => row.id)).toEqual([`${P}post`]);
		await posts.detachTerm('tag', `${P}tag`);
		await posts.detachTerm('category', `${P}cat`);
		expect(await posts.findById(`${P}post`)).toMatchObject({ categoryIds: [], tagIds: [] });
		await posts.remove(`${P}post`);
		expect(await posts.findById(`${P}post`)).toBeNull();
	});

	it('reads older terms, lists tags by slug, finds many by id and removes them', async () => {
		await insertRaw(BlogCategoryModel as never, { _id: `${P}cat`, slug: `${P}cat`, status: 'live' });
		expect(await categories.findById(`${P}cat`)).toMatchObject({
			name: {},
			description: {},
			displayOrder: 0,
			status: 'live',
		});
		expect(await categories.findById(`${P}none`)).toBeNull();
		const tag = await tags.save({
			id: `${P}tag`,
			slug: `${P}tag`,
			name: { en: 'Care' },
			description: {},
			status: 'draft',
		} as never);
		expect(tag).not.toHaveProperty('displayOrder');
		expect((await tags.list()).map((row) => row.id)).toContain(`${P}tag`);
		expect(await tags.findManyByIds([])).toEqual([]);
		expect((await tags.findManyByIds([`${P}tag`])).map((row) => row.id)).toEqual([`${P}tag`]);
		expect((await tags.findBySlug(`${P}tag`))?.id).toBe(`${P}tag`);
		await tags.remove(`${P}tag`);
		expect(await tags.findById(`${P}tag`)).toBeNull();
	});
});
