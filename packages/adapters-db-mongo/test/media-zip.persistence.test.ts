import type { MediaZipRecord } from '@saha-textile/core-domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildMongoConfig } from '../src/config';
import { connectMongo, disconnectMongo, getMongoose } from '../src/connection';
import { MediaZipModel } from '../src/models/index';
import { MongoMediaZipRepository } from '../src/repositories/media-zip.repository';
import { hasMongoEnv } from './mongo-test-env';

/**
 * Folder downloads as .zip (media step 5) against the replica set: a cancel wins over the worker's progress, the
 * person sees only their own, and the hourly sweep takes each due .zip once. A database of its own, dropped at the end.
 *
 *   MONGODB_PORT=27018 MONGODB_DB_NAME=saha_textile_test RUN_DB_IT=1 pnpm --filter @saha-textile/adapters-db-mongo test
 */
describe.runIf(hasMongoEnv())('media .zip records (rs0)', () => {
	const zips = new MongoMediaZipRepository();
	const ownDatabase = `${buildMongoConfig().dbName}_media_zips`;
	const dropOwn = async () => {
		const db = getMongoose().connection.db;
		if (db?.databaseName !== ownDatabase) throw new Error(`refusing to drop ${db?.databaseName ?? 'nothing'}`);
		await db.dropDatabase();
	};
	const zip = (id: string, extra: Partial<MediaZipRecord> = {}): MediaZipRecord => ({
		id,
		name: 'Weddings.zip',
		state: 'adding',
		files: { done: 0, total: 3 },
		bytes: { done: 0, total: 300 },
		createdAt: '2026-11-16T10:00:00.000Z',
		readyAt: null,
		expiresAt: null,
		error: null,
		userId: 'adm_1',
		fileIds: ['med_1'],
		folderIds: ['fld_1'],
		storageKey: `zips/${id}.zip`,
		...extra,
	});

	beforeAll(async () => {
		await disconnectMongo();
		await connectMongo({ dbName: ownDatabase, autoIndex: false });
		await dropOwn();
		await MediaZipModel.syncIndexes();
	});

	afterAll(async () => {
		await dropOwn();
		await disconnectMongo();
	});

	it('saves progress while being made; after a cancel the worker’s writes are refused', async () => {
		await zips.create(zip('zip_1'));
		expect(await zips.update('zip_1', { files: { done: 1, total: 3 } })).toMatchObject({
			files: { done: 1, total: 3 },
		});
		await zips.setState('zip_1', 'cancelled');
		expect(await zips.update('zip_1', { state: 'ready' })).toBeNull();
		expect(await zips.find('zip_1')).toMatchObject({
			state: 'cancelled',
			storageKey: 'zips/zip_1.zip',
			folderIds: ['fld_1'],
		});
	});

	it('lists a person’s own .zip files of the day, newest first, and counts the stored bytes of the ready ones', async () => {
		await zips.create(zip('zip_2', { userId: 'adm_2', createdAt: '2026-11-16T11:00:00.000Z' }));
		await zips.create(
			zip('zip_3', {
				createdAt: '2026-11-16T12:00:00.000Z',
				state: 'ready',
				bytes: { done: 500, total: 500 },
				readyAt: '2026-11-16T12:01:00.000Z',
				expiresAt: '2026-11-17T12:01:00.000Z',
			}),
		);
		expect((await zips.listForUser('adm_1', '2026-11-16T00:00:00.000Z')).map((row) => row.id)).toEqual([
			'zip_3',
			'zip_1',
		]);
		expect(await zips.storedBytes()).toBe(500);
	});

	it('sweeps what is due once: a ready .zip past its hours, a cancelled one; never one still within them', async () => {
		const due = await zips.listToSweep('2026-11-17T13:00:00.000Z', 10);
		expect(due.map((row) => row.id).sort()).toEqual(['zip_1', 'zip_3']);
		expect((await zips.listToSweep('2026-11-17T11:00:00.000Z', 10)).map((row) => row.id)).toEqual(['zip_1']);
		for (const row of due) await zips.finishSweep(row.id, row.state === 'ready' ? 'expired' : row.state);
		expect(await zips.listToSweep('2026-11-18T00:00:00.000Z', 10)).toEqual([]);
		expect(await zips.find('zip_3')).toMatchObject({ state: 'expired' });
		expect(await zips.storedBytes()).toBe(0);
	});
});
