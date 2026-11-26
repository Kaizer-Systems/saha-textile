import { MediaAsset } from '@saha-textile/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { connectMongo, disconnectMongo } from '../src/connection';
import { BlogPostModel, CategoryModel, ContentBlockModel, MediaAssetModel, PaymentModel } from '../src/models/index';
import { MongoMediaAssetRepository } from '../src/repositories/media.repository';
import { hasMongoEnv, insertRaw, runPrefix } from './mongo-test-env';

describe.runIf(hasMongoEnv())('media assets: the remaining reads and writes (rs0)', () => {
	const P = runPrefix('mediax');
	const M = (key: string) => `med_${P}${key}`;
	const assets = new MongoMediaAssetRepository();
	const file = (key: string, overrides: Record<string, unknown> = {}) =>
		MediaAsset.parse({
			id: M(key),
			kind: 'image',
			originalFormat: 'image/jpeg',
			originalByteSize: 1000,
			slug: `${P}${key}`.replace(/_/g, '-'),
			originalStorageKey: `media/${M(key)}/original.jpg`,
			folderId: `${P}folder`,
			derivatives: [],
			...overrides,
		});

	beforeAll(async () => {
		await connectMongo();
	});

	afterAll(async () => {
		const ours = { $regex: `^(med_)?${P}` };
		await Promise.all([
			MediaAssetModel.deleteMany({ _id: ours }),
			BlogPostModel.deleteMany({ _id: ours }),
			CategoryModel.deleteMany({ _id: ours }),
			ContentBlockModel.deleteMany({ _id: ours }),
			PaymentModel.deleteMany({ _id: ours }),
		]);
		await disconnectMongo();
	});

	it('finds swatch cuts made before a moment, and reads a photo back when there is nothing to add', async () => {
		await assets.create(file('photo'));
		await assets.create(
			file('cut', { cutFrom: { assetId: M('photo'), region: { x: 0, y: 0, width: 0.5, height: 0.5 } } }),
		);
		// createdAt is immutable through the model (timestamps), so the date is back-dated on the raw collection.
		await MediaAssetModel.collection.updateOne({ _id: M('cut') } as never, {
			$set: { createdAt: new Date('2000-06-01T00:00:00Z') },
		});
		expect((await assets.findCutsMadeBefore(new Date('2001-01-01T00:00:00Z'))).map((row) => row.id)).toContain(
			M('cut'),
		);
		expect((await assets.addVersions({ assetId: M('photo'), add: [], retry: [] } as never))?.id).toBe(M('photo'));
	});

	it('clears a Replace in progress', async () => {
		await assets.create(
			file('replacing', {
				replacing: {
					key: 'media/x/original-2.jpg',
					contentType: 'image/jpeg',
					byteSize: 1,
					width: 1,
					height: 1,
					sha256: null,
					phase: 'queued',
					reason: 'replace',
					made: 0,
					total: 0,
					error: null,
					startedAt: '2026-11-20T00:00:00.000Z',
					by: null,
				},
			}),
		);
		expect((await assets.moveReplace(M('replacing'), ['queued'], null))?.replacing).toBeNull();
	});

	it('browses with excluded ids, one-sided dates and newest first', async () => {
		const browse = (over: Record<string, unknown>) =>
			assets.browse({ folderId: `${P}folder`, trashed: false, page: 1, pageSize: 50, ...over } as never);
		expect((await browse({ excludeIds: [M('photo')] })).items.map((row) => row.id)).not.toContain(M('photo'));
		expect((await browse({ createdSince: '2001-01-01T00:00:00.000Z' })).items.map((row) => row.id)).not.toContain(
			M('cut'),
		);
		expect((await browse({ createdBefore: '2001-01-01T00:00:00.000Z' })).items.map((row) => row.id)).toEqual([
			M('cut'),
		]);
		expect((await browse({ sort: 'created', direction: 'desc' })).items.at(-1)?.id).toBe(M('cut'));
	});

	it('finds nothing by no hashes, names unnamed files by slug, and trashes and restores into a folder', async () => {
		expect(await assets.findBySha256([])).toEqual([]);
		// The fixture's slug turns underscores into hyphens.
		expect(await assets.namesIn(`${P}folder`)).toEqual(expect.arrayContaining([`${P}photo`.replace(/_/g, '-')]));
		await assets.setTrashed([M('photo')], '2026-11-20T00:00:00.000Z', new Map());
		expect(await MediaAssetModel.findById(M('photo')).lean<{ trashedFrom: string | null }>().exec()).toMatchObject({
			trashedFrom: null,
		});
		await assets.setTrashed([M('photo'), M('cut')], null, new Map(), new Map([[M('photo'), null]]));
		const restored = await MediaAssetModel.findById(M('photo'))
			.lean<{ folderId: string | null; trashedAt: Date | null }>()
			.exec();
		expect(restored).toMatchObject({ folderId: null, trashedAt: null });
		await assets.setTrashed([M('cut')], null, new Map(), new Map([[M('cut'), `${P}other`]]));
		expect((await assets.listInFolders([`${P}other`])).map((row) => row.id)).toEqual([M('cut')]);
	});

	it('lists only media ids among stored references', async () => {
		await insertRaw(ContentBlockModel as never, {
			_id: `${P}odd_block`,
			key: `${P}odd`,
			assetIds: ['not_media', 5],
		});
		const ids = await assets.referencedIds();
		expect(ids.every((id) => id.startsWith('med_'))).toBe(true);
		expect(ids).not.toContain('not_media');
	});

	it('names every place a photo is used, by title, name, key, slug or id, each place once', async () => {
		expect(await assets.whereUsed([])).toEqual(new Map());
		await insertRaw(BlogPostModel as never, {
			_id: `${P}post_a`,
			slug: `${P}a`,
			title: { en: 'Silk care' },
			assetIds: [M('used'), M('other')],
		});
		await insertRaw(BlogPostModel as never, {
			_id: `${P}post_b`,
			slug: `${P}b`,
			title: { en: 'Silk care' },
			assetIds: [M('used')],
		});
		await insertRaw(BlogPostModel as never, { _id: `${P}post_c`, slug: `${P}c-slug`, coverAssetId: M('used') });
		await insertRaw(CategoryModel as never, {
			_id: `${P}cat`,
			slug: `${P}cat`,
			name: { en: 'Sarees' },
			media: { iconAssetId: M('used') },
		});
		await insertRaw(ContentBlockModel as never, { _id: `${P}block`, key: `${P}hero`, assetIds: [M('used')] });
		await insertRaw(PaymentModel as never, { _id: `${P}pay`, proofMediaId: M('used') });
		const labels = (await assets.whereUsed([M('used')])).get(M('used')) ?? [];
		expect(labels).toEqual(
			expect.arrayContaining([
				'blog post picture · Silk care',
				`blog cover · ${P}c-slug`,
				'category icon · Sarees',
				`banner or content block · ${P}hero`,
				`payment proof · ${P}pay`,
			]),
		);
		expect(labels.filter((label) => label === 'blog post picture · Silk care')).toHaveLength(1);
		expect((await assets.whereUsed([M('used')])).has(M('other'))).toBe(false);
	});
});
