import { PROCESSED_PHOTO_TYPES, SEEDED_MEDIA_PROFILES } from '@saha-textile/core-domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildMongoConfig } from '../src/config';
import { connectMongo, disconnectMongo, getMongoose } from '../src/connection';
import {
	addCardWidth600,
	addProfileSizes,
	addSwatchV2Width360,
	seedProfilesAndNameVersions,
	widenProfileTypes,
} from '../src/migrations/media-versions';
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
		format: 'image/webp' as const,
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

	it('keeps the words check measurement on one version only (Page Builder SG-1)', async () => {
		const version = (id: string) => ({
			id,
			profileKey: 'banner_keep_shape',
			profileVersion: 1,
			fill: 'as_is',
			state: 'ready',
			createdAt: '2026-11-02T00:00:00.000Z',
		});
		await raw('med_words', { versions: [version('ver_a'), version('ver_b')] });
		const spots = Array.from({ length: 9 }, () => ({ hist: [0.25, 0.25, 0.25, 0.25] }));
		await assets.setWordSpots('med_words', 'ver_b', spots);
		const found = await assets.findById('med_words');
		expect(found?.versions?.find((v) => v.id === 'ver_b')?.wordSpots).toEqual(spots);
		expect(found?.versions?.find((v) => v.id === 'ver_a')?.wordSpots).toBeUndefined();
		// A version that isn't there changes nothing.
		await assets.setWordSpots('med_words', 'ver_none', spots);
		expect((await assets.findById('med_words'))?.versions).toHaveLength(2);
		// Out of the way of the counts the next tests make.
		await MediaAssetModel.deleteOne({ _id: 'med_words' }).exec();
	});

	it('inserts missing profiles without overwriting an admin’s edit, and lists built-in first', async () => {
		// The twelve approved profiles and Swatch cut 1:1 (brief P11, 21 Nov 2026).
		await expect(profiles.insertMissing(SEEDED_MEDIA_PROFILES)).resolves.toBe(13);
		const product = await profiles.findByKey('product_3x4');
		if (!product) throw new Error('product_3x4 was not inserted');
		await profiles.save({ ...product, name: 'Saree 3:4', version: 2 });
		await expect(profiles.insertMissing(SEEDED_MEDIA_PROFILES)).resolves.toBe(0);
		expect(await profiles.findByKey('product_3x4')).toMatchObject({ name: 'Saree 3:4', version: 2 });
		const list = await profiles.list();
		expect(list).toHaveLength(13);
		const firstOther = list.findIndex((row) => !row.builtIn);
		expect(list.slice(0, firstOther).every((row) => row.builtIn)).toBe(true);
		expect(list.slice(firstOther).every((row) => !row.builtIn)).toBe(true);
		expect(await profiles.findByKey('banner_keep_shape')).toMatchObject({ shape: null, fills: [], builtIn: true });
		await profiles.save({ ...product, name: 'Product 3:4', version: 1 });
	});

	it('migration 0004: built-in profiles still on JPEG and PNG take every photo type; an admin’s list stays (step 5)', async () => {
		const seeded = ['image/jpeg', 'image/png'];
		const product = await profiles.findByKey('product_3x4');
		const hero = await profiles.findByKey('hero_21x9');
		if (!product || !hero) throw new Error('profiles missing');
		await profiles.save({ ...product, accepts: seeded, version: 3 });
		await profiles.save({ ...hero, accepts: ['image/jpeg'] });
		await profiles.save({ ...product, key: 'own_4x5', name: 'Own 4:5', builtIn: false, accepts: seeded });
		expect(await widenProfileTypes()).toMatch(/^let \d+ built-in image profiles? take/);
		expect(await profiles.findByKey('product_3x4')).toMatchObject({
			accepts: [...PROCESSED_PHOTO_TYPES],
			version: 3,
		});
		expect(await profiles.findByKey('hero_21x9')).toMatchObject({ accepts: ['image/jpeg'] });
		expect(await profiles.findByKey('own_4x5')).toMatchObject({ accepts: seeded });
		expect(await widenProfileTypes()).toBe('let 0 built-in image profiles take every photo type the worker reads');
		await profiles.save({ ...product, version: 1 });
		await profiles.save(hero);
		await profiles.delete('own_4x5');
	});

	it('migration 0006: built-in profiles on the seeded card sizes gain 600 px and a new version; others stay', async () => {
		const before = [200, 400, 700, 960];
		const product = await profiles.findByKey('product_3x4');
		const category = await profiles.findByKey('category_3x4');
		if (!product || !category) throw new Error('profiles missing');
		await profiles.save({ ...product, widths: { ...product.widths, card: before }, version: 2 });
		await profiles.save({ ...category, widths: { ...category.widths, card: [200, 500] }, version: 1 });
		await profiles.save({
			...product,
			key: 'own_card',
			name: 'Own card',
			builtIn: false,
			widths: { ...product.widths, card: before },
		});
		expect(await addCardWidth600()).toMatch(/^gave \d+ built-in image profiles? a 600 px product-card size$/);
		const after = await profiles.findByKey('product_3x4');
		expect(after?.widths['card']).toEqual([200, 400, 600, 700, 960]);
		// A new version, so "Bring older versions up to date" adds the 600 px files to photos made before.
		expect(after?.version).toBe(3);
		// An admin's own sizes, and a profile an admin made, stay as they are.
		expect((await profiles.findByKey('category_3x4'))?.widths['card']).toEqual([200, 500]);
		expect((await profiles.findByKey('own_card'))?.widths['card']).toEqual(before);
		expect(await addCardWidth600()).toBe('gave 0 built-in image profiles a 600 px product-card size');
		await profiles.save({ ...product, version: 1 });
		await profiles.save(category);
		await profiles.delete('own_card');
	});

	it('migration 0012: built-in profiles on the seeded Image V2 swatch sizes gain 360 px and a new version', async () => {
		const before = [120, 240];
		const product = await profiles.findByKey('product_3x4');
		if (!product) throw new Error('profile missing');
		await profiles.save({ ...product, widths: { ...product.widths, swatch_image_v2: before }, version: 2 });
		await profiles.save({
			...product,
			key: 'own_swatch',
			name: 'Own swatch',
			builtIn: false,
			widths: { ...product.widths, swatch_image_v2: before },
		});
		expect(await addSwatchV2Width360()).toMatch(
			/^gave \d+ built-in image profiles? a 360 px Image V2 swatch size$/,
		);
		const after = await profiles.findByKey('product_3x4');
		expect(after?.widths['swatch_image_v2']).toEqual([120, 240, 360]);
		expect(after?.version).toBe(3);
		expect((await profiles.findByKey('own_swatch'))?.widths['swatch_image_v2']).toEqual(before);
		expect(await addSwatchV2Width360()).toBe('gave 0 built-in image profiles a 360 px Image V2 swatch size');
		await profiles.save({ ...product, version: 1 });
		await profiles.delete('own_swatch');
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

	it('adds versions once even when two admins ask at the same moment; retries a failed one; removes one (step 3a)', async () => {
		const version = (id: string, state = 'ready') => {
			const [profileKey = '', fill = 'as_is'] = id.split('.');
			return {
				id,
				profileKey,
				profileVersion: 1,
				fill: fill as 'as_is',
				state: state as 'ready',
				error: state === 'failed' ? 'render_failed' : null,
				createdAt: '2026-11-16T00:00:00.000Z',
			};
		};
		await raw('med_add', {
			derivatives: [
				{ ...file('med_add', 'card', 200), versionId: 'product_3x4.white' },
				{ ...file('med_add', 'card', 400), versionId: 'product_3x4.blur' },
			],
			versions: [version('product_3x4.white'), version('product_3x4.blur'), version('hero_21x9.crop', 'failed')],
		});
		const crop = { ...version('product_3x4.crop'), state: 'making' as const };
		// Two admins add the same version at once: exactly one write lands.
		const [first, second] = await Promise.all([
			assets.addVersions({ assetId: 'med_add', add: [crop], retry: [] }),
			assets.addVersions({ assetId: 'med_add', add: [crop], retry: [] }),
		]);
		expect([first, second].filter(Boolean)).toHaveLength(1);
		// A failed version asked again goes back to making, beside a new one, in one write.
		const again = { ...version('hero_21x9.crop'), state: 'making' as const };
		const blurNew = { ...version('hero_21x9.blur'), state: 'making' as const };
		const stored = await assets.addVersions({ assetId: 'med_add', add: [blurNew], retry: [again] });
		expect(stored?.versions?.map((row) => `${row.id}:${row.state}`)).toEqual([
			'product_3x4.white:ready',
			'product_3x4.blur:ready',
			'hero_21x9.crop:making',
			'product_3x4.crop:making',
			'hero_21x9.blur:making',
		]);
		// Retrying one that is no longer failed changes nothing.
		expect(await assets.addVersions({ assetId: 'med_add', add: [], retry: [again] })).toBeNull();
		// Removing takes the version and only its files; one still being made stays.
		const before = await assets.removeVersion('med_add', 'product_3x4.blur');
		expect(before?.derivatives).toHaveLength(2);
		const after = await assets.findById('med_add');
		expect(after?.versions?.map((row) => row.id)).not.toContain('product_3x4.blur');
		expect(after?.derivatives.map((row) => row.versionId)).toEqual(['product_3x4.white']);
		expect(await assets.removeVersion('med_add', 'product_3x4.crop')).toBeNull();
		expect(await assets.removeVersion('med_add', 'square_1x1.white')).toBeNull();
		// Out of the way of the per-profile photo count below.
		await MediaAssetModel.deleteOne({ _id: 'med_add' }).exec();
	});

	it('runs one Replace at a time, swaps in one write, keeps the old files and sweeps them (step 3b)', async () => {
		const version = (id: string, state = 'ready') => {
			const [profileKey = '', fill = 'as_is'] = id.split('.');
			return {
				id,
				profileKey,
				profileVersion: 1,
				fill,
				state,
				error: null,
				createdAt: '2026-11-16T00:00:00.000Z',
			};
		};
		const replacement = (key: string) => ({
			key,
			contentType: 'image/jpeg',
			byteSize: 2000,
			width: 3000,
			height: 4000,
			sha256: null,
			phase: 'uploading' as const,
			reason: 'replace' as const,
			made: 0,
			total: 0,
			error: null,
			startedAt: '2026-11-16T10:00:00.000Z',
			by: 'adm_1',
		});
		await raw('med_rep', {
			derivatives: [{ ...file('med_rep', 'card', 400), versionId: 'product_3x4.as_is' }],
			versions: [version('product_3x4.as_is')],
		});
		await raw('med_busy_rep', { derivatives: [], versions: [version('product_3x4.white', 'making')] });
		// Not while versions are being made.
		expect(await assets.startReplace('med_busy_rep', replacement('media/med_busy_rep/original-1.jpg'))).toBeNull();
		const started = await assets.startReplace('med_rep', replacement('media/med_rep/original-1.jpg'));
		expect(started?.replacing).toMatchObject({ phase: 'uploading', key: 'media/med_rep/original-1.jpg' });
		// One at a time; and no versions are added meanwhile.
		expect(await assets.startReplace('med_rep', replacement('media/med_rep/original-2.jpg'))).toBeNull();
		const crop = { ...version('product_3x4.crop', 'making'), fill: 'crop' as const, state: 'making' as const };
		expect(await assets.addVersions({ assetId: 'med_rep', add: [crop as never], retry: [] })).toBeNull();
		// uploading → queued → making, each only from the phase before.
		expect(await assets.moveReplace('med_rep', ['queued'], { phase: 'making' })).toBeNull();
		expect((await assets.moveReplace('med_rep', ['uploading'], { phase: 'queued' }))?.replacing?.phase).toBe(
			'queued',
		);
		const making = await assets.moveReplace('med_rep', ['queued'], { phase: 'making', made: 0, total: 9 });
		expect(making?.replacing).toMatchObject({ phase: 'making', total: 9 });
		const swapped = await assets.finishReplace({
			assetId: 'med_rep',
			set: {
				originalStorageKey: 'media/med_rep/original-1.jpg',
				originalFormat: 'image/jpeg',
				originalByteSize: 2000,
				width: 3000,
				height: 4000,
			},
			derivatives: [
				{ ...file('med_rep', 'card', 400), storageKey: 'new-card.webp', versionId: 'product_3x4.as_is' },
			],
			versions: [version('product_3x4.as_is') as never],
			keptFiles: [
				{
					keys: ['old-card.webp', 'media/med_rep/original.jpg'],
					bytes: 100,
					deleteAfter: '2026-11-23T10:00:00.000Z',
					reason: 'replace',
				},
			],
		});
		expect(swapped?.replacing).toBeNull();
		expect(swapped?.originalStorageKey).toBe('media/med_rep/original-1.jpg');
		expect(swapped?.derivatives.map((row) => row.storageKey)).toEqual(['new-card.webp']);
		expect(swapped?.keptFiles?.[0]?.keys).toEqual(['old-card.webp', 'media/med_rep/original.jpg']);
		// Swapping again, with no Replace running, changes nothing.
		expect(
			await assets.finishReplace({
				assetId: 'med_rep',
				set: {
					originalStorageKey: 'x',
					originalFormat: 'image/jpeg',
					originalByteSize: 1,
					width: 1,
					height: 1,
				},
				derivatives: [],
				versions: [],
				keptFiles: [],
			}),
		).toBeNull();
		// The sweep finds it only once its 7 days are over, then forgets it.
		expect(await assets.listKeptDue('2026-11-20T00:00:00.000Z', 10)).toEqual([]);
		expect((await assets.listKeptDue('2026-11-24T00:00:00.000Z', 10)).map((row) => row.id)).toEqual(['med_rep']);
		await assets.dropKept('med_rep', '2026-11-24T00:00:00.000Z');
		expect((await assets.findById('med_rep'))?.keptFiles).toEqual([]);
		await MediaAssetModel.deleteMany({ _id: { $in: ['med_rep', 'med_busy_rep'] } }).exec();
	});

	it('keeps a swatch cut’s photo and square, and finds a photo’s cuts (brief P11)', async () => {
		const region = { x: 0.2, y: 0.5, width: 0.25, height: 0.1875 };
		await raw('med_cut_photo', {});
		await raw('med_cut_a', { cutFrom: { assetId: 'med_cut_photo', region } });
		await raw('med_cut_b', { cutFrom: { assetId: 'med_cut_photo', region: { ...region, x: 0.4 } } });
		await raw('med_cut_gone', { cutFrom: { assetId: 'med_cut_photo', region }, deletedAt: new Date() });
		await raw('med_cut_bin', { cutFrom: { assetId: 'med_cut_photo', region }, trashedAt: new Date() });
		expect((await assets.findById('med_cut_a'))?.cutFrom).toEqual({ assetId: 'med_cut_photo', region });
		expect((await assets.findById('med_cut_photo'))?.cutFrom).toBeNull();
		expect((await assets.findCutsOf('med_cut_photo')).map((row) => row.id)).toEqual(['med_cut_a', 'med_cut_b']);
		expect(await assets.findCutsOf('med_cut_a')).toEqual([]);
		await MediaAssetModel.deleteMany({ _id: { $regex: '^med_cut_' } }).exec();
	});

	it('keeps a focal point on the photo, clears it, and runs a focal remake on the same original (step 3c)', async () => {
		await raw('med_focal', {
			derivatives: [{ ...file('med_focal', 'card', 400), versionId: 'product_3x4.crop' }],
			versions: [
				{
					id: 'product_3x4.crop',
					profileKey: 'product_3x4',
					profileVersion: 1,
					fill: 'crop',
					state: 'ready',
					error: null,
					createdAt: '2026-11-16T00:00:00.000Z',
				},
			],
		});
		// A photo saved before step 3c has no focal point: the crop keeps the middle.
		expect((await assets.findById('med_focal'))?.focal).toBeNull();
		await assets.setFocal('med_focal', { x: 0.25, y: 0.8 });
		expect((await assets.findById('med_focal'))?.focal).toEqual({ x: 0.25, y: 0.8 });
		// A focal remake is a Replace on the photo's own original, marked as such.
		const original = (await assets.findById('med_focal'))?.originalStorageKey ?? '';
		const started = await assets.startReplace('med_focal', {
			key: original,
			contentType: 'image/jpeg',
			byteSize: 2000,
			width: 3000,
			height: 4000,
			sha256: null,
			phase: 'queued',
			reason: 'focal',
			made: 0,
			total: 0,
			error: null,
			startedAt: '2026-11-16T10:00:00.000Z',
			by: 'adm_1',
		});
		expect(started?.replacing).toMatchObject({ reason: 'focal', phase: 'queued', key: original });
		// Reset to centre.
		await assets.setFocal('med_focal', null);
		expect((await assets.findById('med_focal'))?.focal).toBeNull();
		await MediaAssetModel.deleteMany({ _id: 'med_focal' }).exec();
	});

	it('finds photos holding versions made with a profile’s earlier settings, and counts runs bringing them up to date (step 3e)', async () => {
		try {
			const made = (id: string, profileVersion: number, state = 'ready') => ({
				id,
				profileKey: id.split('.')[0],
				profileVersion,
				fill: id.split('.')[1],
				state,
				error: null,
				createdAt: '2026-11-16T00:00:00.000Z',
			});
			await raw('med_old1', { versions: [made('zz_refresh_3x4.white', 1)] });
			await raw('med_old2', { versions: [made('zz_refresh_3x4.white', 1), made('zz_other_2x1.as_is', 1)] });
			await raw('med_new', { versions: [made('zz_refresh_3x4.white', 2)] });
			await raw('med_trash', {
				versions: [made('zz_refresh_3x4.white', 1)],
				trashedAt: new Date('2026-11-15T00:00:00Z'),
			});
			await raw('med_making', { versions: [made('zz_refresh_3x4.white', 1, 'making')] });
			const first = await assets.listWithOlderVersions({
				profileKey: 'zz_refresh_3x4',
				version: 2,
				after: null,
				limit: 1,
			});
			expect(first.map((row) => row.id)).toEqual(['med_old1']);
			const rest = await assets.listWithOlderVersions({
				profileKey: 'zz_refresh_3x4',
				version: 2,
				after: 'med_old1',
				limit: 10,
			});
			expect(rest.map((row) => row.id)).toEqual(['med_old2']);
			expect(
				await assets.listWithOlderVersions({
					profileKey: 'zz_refresh_3x4',
					version: 1,
					after: null,
					limit: 10,
				}),
			).toEqual([]);
			const original = (await assets.findById('med_old1'))?.originalStorageKey ?? '';
			await assets.startReplace('med_old1', {
				key: original,
				contentType: 'image/jpeg',
				byteSize: 2000,
				width: 3000,
				height: 4000,
				sha256: null,
				phase: 'queued',
				reason: 'refresh',
				profileKey: 'zz_refresh_3x4',
				made: 0,
				total: 0,
				error: null,
				startedAt: '2026-11-16T10:00:00.000Z',
				by: 'adm_1',
			});
			expect(await assets.refreshCounts('zz_refresh_3x4', 2)).toEqual({ older: 2, running: 1, failed: 0 });
			await assets.moveReplace('med_old1', ['queued'], { phase: 'failed', error: 'render_failed' });
			expect(await assets.refreshCounts('zz_refresh_3x4', 2)).toEqual({ older: 2, running: 0, failed: 1 });
		} finally {
			await MediaAssetModel.deleteMany({
				_id: { $in: ['med_old1', 'med_old2', 'med_new', 'med_trash', 'med_making'] },
			}).exec();
		}
	});

	it('the picker filter: images only, with or without a ready version of a profile (step 4a)', async () => {
		const made = (id: string, state = 'ready') => ({
			id,
			profileKey: id.split('.')[0],
			profileVersion: 1,
			fill: id.split('.')[1],
			state,
			error: null,
			createdAt: '2026-11-16T00:00:00.000Z',
		});
		const folderId = 'fld_picker_it';
		try {
			await raw('med_pk_fits', { folderId, versions: [made('product_3x4.white')] });
			await raw('med_pk_making', { folderId, versions: [made('product_3x4.white', 'making')] });
			await raw('med_pk_other', { folderId, versions: [made('hero_21x9.crop')] });
			await raw('med_pk_pdf', { folderId, kind: 'file', versions: [] });
			const ids = async (more: Record<string, unknown>) =>
				(
					await assets.browse({
						folderId,
						trashed: false,
						sort: 'name',
						direction: 'asc',
						page: 1,
						pageSize: 50,
						...more,
					})
				).items
					.map((row) => row.id)
					.sort();
			expect(await ids({ kinds: ['image'], withVersionOf: 'product_3x4' })).toEqual(['med_pk_fits']);
			expect(await ids({ kinds: ['image'], withoutVersionOf: 'product_3x4' })).toEqual([
				'med_pk_making',
				'med_pk_other',
			]);
			expect(await ids({ kinds: ['file', 'video'] })).toEqual(['med_pk_pdf']);
		} finally {
			await MediaAssetModel.deleteMany({ folderId }).exec();
		}
	});

	it('carries a new web file name with its Replace and puts it on the photo at the swap (step 3d)', async () => {
		await raw('med_name', { derivatives: [], versions: [] });
		const original = (await assets.findById('med_name'))?.originalStorageKey ?? '';
		const started = await assets.startReplace('med_name', {
			key: original,
			contentType: 'image/jpeg',
			byteSize: 2000,
			width: 3000,
			height: 4000,
			sha256: null,
			phase: 'queued',
			reason: 'rename',
			slug: 'red-banarasi-front',
			made: 0,
			total: 0,
			error: null,
			startedAt: '2026-11-16T10:00:00.000Z',
			by: 'adm_1',
		});
		expect(started?.replacing).toMatchObject({ reason: 'rename', slug: 'red-banarasi-front' });
		await assets.moveReplace('med_name', ['queued'], { phase: 'making' });
		const swapped = await assets.finishReplace({
			assetId: 'med_name',
			set: {
				originalStorageKey: original,
				originalFormat: 'image/jpeg',
				originalByteSize: 2000,
				width: 3000,
				height: 4000,
				slug: 'red-banarasi-front',
			},
			derivatives: [],
			versions: [],
			keptFiles: [],
		});
		expect(swapped?.slug).toBe('red-banarasi-front');
		expect(swapped?.replacing).toBeNull();
		await MediaAssetModel.deleteMany({ _id: 'med_name' }).exec();
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
