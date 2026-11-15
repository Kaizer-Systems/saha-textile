import { MediaAsset, MediaFolder } from '@saha-textile/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildMongoConfig } from '../src/config';
import { connectMongo, disconnectMongo, getMongoose } from '../src/connection';
import { MediaFolderModel, MediaShareLinkModel, StorageReservationModel } from '../src/models/index';
import {
	MongoMediaFavouriteRepository,
	MongoMediaFolderRepository,
	MongoShareLinkRepository,
	MongoStorageLedgerRepository,
} from '../src/repositories/media-library.repository';
import { MongoMediaAssetRepository } from '../src/repositories/media.repository';
import { hasMongoEnv } from './mongo-test-env';

/**
 * The Media page's records against the replica set (media build step 1): folders and their
 * paths, stars, share links, storage reservations, and the browse queries on stored files.
 * Whole-collection queries, so this file works in a database of its own, dropped at the end.
 *
 *   MONGODB_PORT=27018 MONGODB_DB_NAME=saha_textile_test RUN_DB_IT=1 pnpm --filter @saha-textile/adapters-db-mongo test
 */
describe.runIf(hasMongoEnv())('media library persistence (rs0)', () => {
	const folders = new MongoMediaFolderRepository();
	const stars = new MongoMediaFavouriteRepository();
	const links = new MongoShareLinkRepository();
	const ledger = new MongoStorageLedgerRepository();
	const assets = new MongoMediaAssetRepository();
	const ownDatabase = `${buildMongoConfig().dbName}_media_library`;
	const dropOwn = async () => {
		const db = getMongoose().connection.db;
		if (db?.databaseName !== ownDatabase) throw new Error(`refusing to drop ${db?.databaseName ?? 'nothing'}`);
		await db.dropDatabase();
	};
	const NOW = '2026-11-15T10:00:00.000Z';

	const folder = (id: string, name: string, parent: MediaFolder | null = null) =>
		MediaFolder.parse({
			id,
			name,
			parentId: parent?.id ?? null,
			ancestors: parent ? [...parent.ancestors, parent.id] : [],
		});
	const file = (id: string, overrides: Record<string, unknown> = {}) =>
		MediaAsset.parse({
			id,
			kind: 'image',
			originalFormat: 'image/jpeg',
			originalByteSize: 1000,
			slug: id.replace(/_/g, '-'),
			originalStorageKey: `media/${id}/original.jpg`,
			derivatives: [
				{
					role: 'card',
					roleVersion: 1,
					width: 400,
					height: 533,
					format: 'image/webp',
					storageKey: `media/${id}/card.webp`,
					byteSize: 200,
				},
			],
			...overrides,
		});

	beforeAll(async () => {
		await disconnectMongo();
		// A fresh database: build only the indexes this file uses, not every model's (see connectMongo).
		await connectMongo({ dbName: ownDatabase, autoIndex: false });
		await dropOwn();
		await Promise.all([
			MediaFolderModel.syncIndexes(),
			StorageReservationModel.syncIndexes(),
			MediaShareLinkModel.syncIndexes(),
		]);
	});

	afterAll(async () => {
		await dropOwn();
		await disconnectMongo();
	});

	it('keeps the folder tree: children by name, a subtree, and paths rewritten on a move', async () => {
		const photos = await folders.save(folder('fld_photos', 'Product photos'));
		const banarasi = await folders.save(folder('fld_banarasi', 'Banarasi', photos));
		const bridal = await folders.save(folder('fld_bridal', 'Bridal 2027', banarasi));
		await folders.save(folder('fld_docs', 'documents'));
		expect((await folders.listChildren(null, { trashed: false })).map((row) => row.name)).toEqual([
			'documents',
			'Product photos',
		]);
		expect((await folders.listSubtree(photos.id)).map((row) => row.id).sort()).toEqual(
			['fld_banarasi', 'fld_bridal', 'fld_photos'].sort(),
		);

		// Banarasi moves under Documents: Bridal 2027 keeps its place below it.
		await folders.move(banarasi.id, 'fld_docs', ['fld_docs']);
		expect((await folders.findById(banarasi.id))?.ancestors).toEqual(['fld_docs']);
		expect((await folders.findById(bridal.id))?.ancestors).toEqual(['fld_docs', 'fld_banarasi']);

		await folders.setTrashed([bridal.id], NOW, new Map([[bridal.id, banarasi.id]]));
		expect((await folders.listTrashed()).map((row) => [row.id, row.trashedFrom])).toEqual([
			['fld_bridal', 'fld_banarasi'],
		]);
		expect((await folders.listAll()).map((row) => row.id)).not.toContain('fld_bridal');
		await folders.setTrashed([bridal.id], null, new Map());
		expect((await folders.findById(bridal.id))?.trashedAt).toBeNull();
	});

	it('browses files: one folder, a subtree search, a category, sorts, and Trash', async () => {
		await assets.create(
			file('med_red', {
				folderId: 'fld_banarasi',
				displayName: 'Red Banarasi front.jpg',
				sha256: 'a'.repeat(64),
			}),
		);
		await assets.create(
			file('med_blue', { folderId: 'fld_bridal', displayName: 'blue tant.jpg', originalByteSize: 9000 }),
		);
		await assets.create(
			file('med_pdf', {
				kind: 'file',
				originalFormat: 'application/pdf',
				derivatives: [],
				folderId: null,
				displayName: 'Banarasi catalogue.pdf',
			}),
		);
		const page = (filter: object) =>
			assets.browse({ trashed: false, sort: 'name', direction: 'asc', page: 1, pageSize: 20, ...filter });

		expect((await page({ folderId: 'fld_banarasi' })).items.map((row) => row.id)).toEqual(['med_red']);
		expect((await page({ folderId: null })).items.map((row) => row.id)).toEqual(['med_pdf']);
		expect((await page({ search: 'banarasi' })).items.map((row) => row.id)).toEqual(['med_pdf', 'med_red']);
		expect(
			(await page({ search: 'banarasi', withinFolders: ['fld_banarasi', 'fld_bridal'] })).items.map(
				(row) => row.id,
			),
		).toEqual(['med_red']);
		expect((await page({ category: 'documents' })).items.map((row) => row.id)).toEqual(['med_pdf']);
		expect((await page({ sort: 'size', direction: 'desc' })).items[0]?.id).toBe('med_blue');
		expect(await assets.findById('med_red')).toMatchObject({
			folderId: 'fld_banarasi',
			displayName: 'Red Banarasi front.jpg',
		});

		expect((await assets.findBySha256(['a'.repeat(64)])).map((row) => row.id)).toEqual(['med_red']);
		expect(await assets.namesIn('fld_banarasi')).toEqual(['Red Banarasi front.jpg']);

		await assets.moveTo(['med_blue'], 'fld_banarasi');
		await assets.rename('med_blue', 'blue tant (1).jpg');
		expect((await page({ folderId: 'fld_banarasi' })).items.map((row) => row.displayName)).toEqual([
			'blue tant (1).jpg',
			'Red Banarasi front.jpg',
		]);

		await assets.setTrashed(['med_blue'], NOW, new Map([['med_blue', 'fld_banarasi']]));
		expect((await page({ folderId: 'fld_banarasi' })).items.map((row) => row.id)).toEqual(['med_red']);
		expect(
			(await assets.browse({ trashed: true, sort: 'name', direction: 'asc', page: 1, pageSize: 20 })).items[0],
		).toMatchObject({
			id: 'med_blue',
			trashedFrom: 'fld_banarasi',
		});
		expect((await assets.listTrashedBefore('2026-12-31T00:00:00.000Z', 10)).map((row) => row.id)).toEqual([
			'med_blue',
		]);
		expect(await assets.findBySha256(['b'.repeat(64)])).toEqual([]);

		// Filters (A11): several categories, states, the uploaded size, and files left out.
		expect((await page({ categories: ['documents', 'videos'] })).items.map((row) => row.id)).toEqual(['med_pdf']);
		expect((await page({ categories: ['documents'], category: 'images' })).items).toEqual([]);
		expect((await page({ minBytes: 5000 })).items.map((row) => row.id)).toEqual([]);
		expect((await page({ maxBytes: 5000 })).items.map((row) => row.id).sort()).toEqual(['med_pdf', 'med_red']);
		expect((await page({ excludeIds: ['med_red'] })).items.map((row) => row.id)).toEqual(['med_pdf']);
		expect(
			(await page({ ids: ['med_red', 'med_pdf'], excludeIds: ['med_red'] })).items.map((row) => row.id),
		).toEqual(['med_pdf']);
		expect((await page({ states: ['failed'] })).items).toEqual([]);
		expect(await assets.referencedIds()).toEqual([]);

		expect(await assets.usage()).toEqual({ originals: 1000, versions: 200, files: 1000, trash: 9200 });
		await assets.setTrashed(['med_blue'], null, new Map(), new Map([['med_blue', null]]));
		expect(await assets.findById('med_blue')).toMatchObject({ folderId: null, trashedAt: null });

		expect(await assets.totalsByFolder(['fld_banarasi'])).toEqual([
			{ folderId: 'fld_banarasi', files: 1, bytes: 1200 },
		]);
		await folders.recount(['fld_banarasi']);
		expect(await folders.findById('fld_banarasi')).toMatchObject({ files: 1, bytes: 1200 });
		expect(await folders.findById('fld_docs')).toMatchObject({ files: 1, bytes: 1200 });
	});

	it('keeps each admin’s stars and everyone’s together', async () => {
		await stars.set('adm_1', { type: 'file', id: 'med_red' }, true);
		await stars.set('adm_1', { type: 'file', id: 'med_red' }, true);
		await stars.set('adm_2', { type: 'folder', id: 'fld_docs' }, true);
		expect(await stars.listForUser('adm_1')).toEqual([{ type: 'file', id: 'med_red' }]);
		expect((await stars.listAll()).length).toBe(2);
		await stars.set('adm_1', { type: 'file', id: 'med_red' }, false);
		expect(await stars.listForUser('adm_1')).toEqual([]);
		await stars.removeTargets('folder', ['fld_docs']);
		expect(await stars.listAll()).toEqual([]);
	});

	it('stores share links by their code’s hash, counts opens, and stops them for Trash', async () => {
		const made = await links.create({
			id: 'shl_1',
			assetId: 'med_pdf',
			codeHash: 'c'.repeat(64),
			codeEnd: 'mX9v',
			who: 'anyone',
			expiresAt: null,
			passwordHash: 'argon-hash',
			stoppedAt: null,
			stoppedBecause: null,
			opens: 0,
			lastOpenedAt: null,
			createdBy: 'adm_1',
			createdAt: NOW,
		});
		expect(made).toMatchObject({ id: 'shl_1', passwordHash: 'argon-hash', codeEnd: 'mX9v' });
		expect((await links.findByCodeHash('c'.repeat(64)))?.id).toBe('shl_1');
		await links.countOpen('shl_1', NOW);
		await links.countOpen('shl_1', NOW);
		expect(await links.findById('shl_1')).toMatchObject({ opens: 2, lastOpenedAt: NOW });
		await links.save({ ...made, expiresAt: '2027-01-01T00:00:00.000Z' });
		expect((await links.listForAsset('med_pdf'))[0]?.expiresAt).toBe('2027-01-01T00:00:00.000Z');
		expect(await links.stopForAssets(['med_pdf'], NOW)).toBe(1);
		expect(await links.findById('shl_1')).toMatchObject({ stoppedAt: NOW, stoppedBecause: 'trash' });
		expect(await links.stopForAssets(['med_pdf'], NOW)).toBe(0);
		expect(await links.removeForAssets(['med_pdf'])).toBe(1);
		expect(await links.listForAsset('med_pdf')).toEqual([]);
		expect(await links.removeForAssets([])).toBe(0);
	});

	it('holds storage for running work until it is released or expires', async () => {
		const soon = new Date(Date.now() + 60_000).toISOString();
		const gone = new Date(Date.now() - 60_000).toISOString();
		await ledger.reserve({ id: 'res_1', userId: 'adm_1', bytes: 500, expiresAt: soon });
		await ledger.reserve({ id: 'res_2', userId: 'adm_2', bytes: 300, expiresAt: soon });
		await ledger.reserve({ id: 'res_old', userId: 'adm_2', bytes: 9999, expiresAt: gone });
		const now = new Date().toISOString();
		expect(await ledger.reservedBytes(now)).toBe(800);
		expect(await ledger.reservedBytes(now, 'res_1')).toBe(300);
		expect(await ledger.findReservation('res_1')).toMatchObject({ userId: 'adm_1', bytes: 500 });
		await ledger.release('res_1');
		expect(await ledger.reservedBytes(now)).toBe(300);
		expect(await ledger.findReservation('res_1')).toBeNull();
	});
});
