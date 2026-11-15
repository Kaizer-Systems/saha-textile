import { SEEDED_MEDIA_PROFILES } from '@saha-textile/core-domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildMongoConfig } from '../src/config';
import { connectMongo, disconnectMongo, getMongoose } from '../src/connection';
import { addProfileSizes, seedProfilesAndNameVersions } from '../src/migrations/media-versions';
import { MediaAssetModel, MediaProfileModel } from '../src/models/index';
import { MongoMediaProfileRepository } from '../src/repositories/media-profile.repository';
import { MongoMediaAssetRepository } from '../src/repositories/media.repository';
import { hasMongoEnv, insertRaw } from './mongo-test-env';

/**
 * Image profiles and versions against the replica set (media build step 2a): the profiles store, and the
 * release migration that names today's photos' versions without remaking a file. Whole-collection queries, so
 * this file works in a database of its own, dropped at the end.
 *
 *   MONGODB_PORT=27018 MONGODB_DB_NAME=saha_textile_test RUN_DB_IT=1 pnpm --filter @saha-textile/adapters-db-mongo test
 */
describe.runIf(hasMongoEnv())('media profiles and versions persistence (rs0)', () => {
	const profiles = new MongoMediaProfileRepository();
	const assets = new MongoMediaAssetRepository();
	const ownDatabase = `${buildMongoConfig().dbName}_media_profiles`;
	const dropOwn = async () => {
		const db = getMongoose().connection.db;
		if (db?.databaseName !== ownDatabase) throw new Error(`refusing to drop ${db?.databaseName ?? 'nothing'}`);
		await db.dropDatabase();
	};
	const MODIFIED = new Date('2026-11-03T08:00:00.000Z');
	const file = (id: string, role: string, width: number) => ({
		role,
		storageKey: `media/${id}/x-${role}-${width}w-1f3a9c2e.webp`,
		width,
		height: width,
		byteSize: 100,
		format: 'image/webp',
		roleVersion: 1,
	});
	const raw = (id: string, fields: Record<string, unknown>) =>
		insertRaw(MediaAssetModel, {
			_id: id,
			kind: 'image',
			purpose: 'product',
			originalStorageKey: `media/${id}/original.jpg`,
			originalFormat: 'image/jpeg',
			originalByteSize: 1000,
			width: 3000,
			height: 4000,
			slug: id.replace(/_/g, '-'),
			warnings: [],
			processing: { state: 'ready', attempts: 1, error: null, processedAt: new Date('2026-11-02T00:00:00.000Z') },
			status: 'draft',
			deletedAt: null,
			createdAt: new Date('2026-11-01T00:00:00.000Z'),
			updatedAt: MODIFIED,
			...fields,
		});

	beforeAll(async () => {
		await disconnectMongo();
		await connectMongo({ dbName: ownDatabase, autoIndex: false });
		await dropOwn();
		await Promise.all([MediaAssetModel.syncIndexes(), MediaProfileModel.syncIndexes()]);
	});

	afterAll(async () => {
		await dropOwn();
		await disconnectMongo();
	});

	it('inserts missing profiles without overwriting an admin’s edit, and lists built-in first', async () => {
		await expect(profiles.insertMissing(SEEDED_MEDIA_PROFILES)).resolves.toBe(12);
		const product = await profiles.findByKey('product_3x4');
		if (!product) throw new Error('product_3x4 was not inserted');
		await profiles.save({ ...product, name: 'Saree 3:4', version: 2 });
		await expect(profiles.insertMissing(SEEDED_MEDIA_PROFILES)).resolves.toBe(0);
		expect(await profiles.findByKey('product_3x4')).toMatchObject({ name: 'Saree 3:4', version: 2 });
		const list = await profiles.list();
		expect(list).toHaveLength(12);
		const firstOther = list.findIndex((row) => !row.builtIn);
		expect(list.slice(0, firstOther).every((row) => row.builtIn)).toBe(true);
		expect(list.slice(firstOther).every((row) => !row.builtIn)).toBe(true);
		expect(await profiles.findByKey('banner_keep_shape')).toMatchObject({ shape: null, fills: [], builtIn: true });
		await profiles.save({ ...product, name: 'Product 3:4', version: 1 });
	});

	it('names today’s photos’ versions once, without moving a file or the date modified', async () => {
		await raw('med_square', {
			width: 4000,
			height: 4000,
			warnings: ['letterboxed'],
			servesAsPrimary: true,
			derivatives: [file('med_square', 'card', 400), file('med_square', 'share', 1200)],
		});
		await raw('med_banner', {
			purpose: 'banner',
			width: 2721,
			height: 805,
			derivatives: [file('med_banner', 'banner', 1920)],
		});
		await raw('med_review', { purpose: 'review', derivatives: [file('med_review', 'review_full', 1600)] });
		await raw('med_pdf', { kind: 'file', originalFormat: 'application/pdf', derivatives: [] });

		await expect(seedProfilesAndNameVersions(() => new Date('2026-11-16T00:00:00.000Z'))).resolves.toBe(
			'added 0 image profiles; named the versions of 3 photos',
		);

		const square = await assets.findById('med_square');
		expect(square?.versions?.map((version) => version.id)).toEqual(['product_3x4.white']);
		expect(square?.derivatives.map((row) => [row.role, row.versionId, row.storageKey])).toEqual([
			['card', 'product_3x4.white', 'media/med_square/x-card-400w-1f3a9c2e.webp'],
			['share', null, 'media/med_square/x-share-1200w-1f3a9c2e.webp'],
		]);
		expect((await assets.findById('med_banner'))?.versions?.[0]?.id).toBe('banner_keep_shape.as_is');
		expect((await assets.findById('med_review'))?.versions).toEqual([]);
		expect((await assets.findById('med_pdf'))?.versions).toEqual([]);

		const stored = await MediaAssetModel.findById('med_square').lean().exec();
		expect(stored?.updatedAt).toEqual(MODIFIED);

		await expect(seedProfilesAndNameVersions()).resolves.toBe(
			'added 0 image profiles; named the versions of 0 photos',
		);
	});

	it('leaves a photo the worker remade meanwhile to the worker', async () => {
		await raw('med_busy', { derivatives: [file('med_busy', 'card', 400)] });
		const before = await MediaAssetModel.findById('med_busy').lean().exec();
		// The worker remakes it between the read and the write: its files differ from what was read.
		await MediaAssetModel.updateOne(
			{ _id: 'med_busy' },
			{
				$set: {
					derivatives: [{ ...file('med_busy', 'card', 400), versionId: 'product_3x4.as_is' }],
					versions: [
						{
							id: 'product_3x4.as_is',
							profileKey: 'product_3x4',
							profileVersion: 1,
							fill: 'as_is',
							state: 'ready',
							createdAt: '2026-11-16T00:00:00.000Z',
						},
					],
				},
			},
		).exec();
		expect(before?.derivatives).toHaveLength(1);
		await expect(seedProfilesAndNameVersions()).resolves.toMatch(/named the versions of 0 photos/);
		expect((await assets.findById('med_busy'))?.versions).toHaveLength(1);
	});

	it('records a versions run without losing a version asked for meanwhile (step 2b)', async () => {
		const making = (id: string) => {
			const [profileKey, fill] = id.split('.');
			return { id, profileKey, profileVersion: 1, fill, state: 'making', createdAt: '2026-11-16T00:00:00.000Z' };
		};
		await raw('med_run', {
			processing: { state: 'processing', attempts: 1, error: null, processedAt: null },
			derivatives: [],
			versions: [making('square_1x1.crop')],
		});
		// Another admin asks for a second version while the worker is busy.
		await MediaAssetModel.updateOne({ _id: 'med_run' }, { $push: { versions: making('square_1x1.white') } }).exec();
		const stored = await assets.settleVersions({
			assetId: 'med_run',
			set: {
				width: 3000,
				height: 3000,
				dominantColor: '#aa3322',
				thumbHash: 'AAAA',
				warnings: [],
				processing: { state: 'ready', attempts: 1, error: null, processedAt: '2026-11-16T10:00:00.000Z' },
			},
			addDerivatives: [{ ...file('med_run', 'avatar', 96), versionId: 'square_1x1.crop' }],
			versions: [{ ...making('square_1x1.crop'), state: 'ready', error: null } as never],
		});
		expect(stored?.versions?.map((version) => [version.id, version.state])).toEqual([
			['square_1x1.crop', 'ready'],
			['square_1x1.white', 'making'],
		]);
		expect(stored?.derivatives.map((row) => row.versionId)).toEqual(['square_1x1.crop']);
		expect(stored?.processing).toMatchObject({
			state: 'ready',
			attempts: 1,
			processedAt: '2026-11-16T10:00:00.000Z',
		});
		const processing = { state: 'ready' as const, attempts: 0, error: null, processedAt: null };
		expect(
			await assets.settleVersions({ assetId: 'med_none', set: { processing }, addDerivatives: [], versions: [] }),
		).toBeNull();
	});

	it('leaves files of versions and per-photo pictures out of the ladder sweep; only unnamed old files count', async () => {
		await raw('med_old', { derivatives: [{ ...file('med_old', 'thumb', 150), roleVersion: 1 }] });
		await raw('med_named', {
			derivatives: [
				{ ...file('med_named', 'thumb', 150), roleVersion: 1, versionId: 'product_3x4.as_is' },
				{ ...file('med_named', 'share', 1200), roleVersion: 1, versionId: null },
			],
		});
		const thumbs = await assets.listStaleForRole({ role: 'thumb', version: 2, limit: 10 });
		expect(thumbs.map((row) => row.id)).toEqual(['med_old']);
		expect(await assets.listStaleForRole({ role: 'share', version: 2, limit: 10 })).toEqual([]);
		await MediaAssetModel.deleteMany({ _id: { $in: ['med_old', 'med_named', 'med_run'] } }).exec();
	});

	it('deletes only a profile that is not built in, and gives older profiles their sizes once (step 2c)', async () => {
		await profiles.delete('product_3x4');
		expect(await profiles.findByKey('product_3x4')).not.toBeNull();
		await profiles.delete('square_1x1');
		expect(await profiles.findByKey('square_1x1')).toBeNull();
		await profiles.insertMissing(SEEDED_MEDIA_PROFILES.filter((row) => row.key === 'square_1x1'));

		// A profile stored before its sizes were editable.
		await MediaProfileModel.updateOne({ _id: 'hero_21x9' }, { $unset: { widths: 1, quality: 1 } }).exec();
		expect((await profiles.findByKey('hero_21x9'))?.widths).toEqual({
			banner: [480, 768, 1080, 1440, 1920, 2560, 2880],
		});
		await expect(addProfileSizes()).resolves.toBe('gave 1 image profile their sizes');
		const stored = await MediaProfileModel.findById('hero_21x9').lean().exec();
		expect(stored?.widths).toEqual({ banner: [480, 768, 1080, 1440, 1920, 2560, 2880] });
		expect(stored?.quality).toBeNull();
		await expect(addProfileSizes()).resolves.toBe('gave 0 image profiles their sizes');
	});

	it('counts the photos holding a version of each profile, leaving deleted ones out', async () => {
		await raw('med_gone', {
			deletedAt: new Date('2026-11-10T00:00:00.000Z'),
			derivatives: [{ ...file('med_gone', 'card', 400), versionId: 'product_3x4.as_is' }],
			versions: [
				{
					id: 'product_3x4.as_is',
					profileKey: 'product_3x4',
					profileVersion: 1,
					fill: 'as_is',
					state: 'ready',
					createdAt: '2026-11-16T00:00:00.000Z',
				},
			],
		});
		const counts = await profiles.countPhotosByProfile();
		expect(counts).toEqual({ product_3x4: 2, banner_keep_shape: 1 });
	});
});
