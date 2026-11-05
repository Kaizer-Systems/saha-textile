import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildMongoConfig } from '../src/config';
import { connectMongo, disconnectMongo } from '../src/connection';
import { SeoRedirectModel } from '../src/models/index';
import { MongoSeoRedirectRepository } from '../src/repositories/seo-redirect.repository';

/**
 * Redirect rows against the replica set: the unique source path, a collapsed
 * chain, and a rejected loop. A fake cannot prove the index.
 *
 *   RUN_DB_IT=1 pnpm --filter @saha-textile/adapters-db-mongo test
 */
function hasMongoEnv(): boolean {
	if (process.env.RUN_DB_IT !== '1') return false;
	try {
		buildMongoConfig();
		return true;
	} catch {
		return false;
	}
}

describe.runIf(hasMongoEnv())('seo redirect persistence (rs0)', () => {
	const repo = new MongoSeoRedirectRepository();
	const stamp = randomUUID();
	const path = (name: string) => `/e2e-redirect/${stamp}/${name}`;

	beforeAll(async () => {
		await connectMongo();
		await SeoRedirectModel.syncIndexes();
	});

	afterAll(async () => {
		await SeoRedirectModel.deleteMany({ sourcePath: new RegExp(stamp) }).exec();
		await disconnectMongo();
	});

	it('refuses a second row with the same source path', async () => {
		const sourcePath = path('dup');
		await SeoRedirectModel.create({ _id: randomUUID(), sourcePath, statusCode: 410, reason: 'manual' });
		await expect(
			SeoRedirectModel.create({ _id: randomUUID(), sourcePath, statusCode: 410, reason: 'manual' }),
		).rejects.toThrow();
	});

	it('stores a chain as one hop', async () => {
		await repo.save({
			id: randomUUID(),
			sourcePath: path('b'),
			statusCode: 301,
			targetPath: path('c'),
			reason: 'slug_change',
		});
		const saved = await repo.save({
			id: randomUUID(),
			sourcePath: path('a'),
			statusCode: 301,
			targetPath: path('b'),
			reason: 'slug_change',
		});
		expect(saved.targetPath).toBe(path('c'));
		expect((await repo.findBySource(path('a')))?.targetPath).toBe(path('c'));
	});

	it('rejects a loop and leaves the collection unchanged', async () => {
		const before = await repo.findBySource(path('a'));
		await expect(
			repo.save({
				id: randomUUID(),
				sourcePath: path('c'),
				statusCode: 301,
				targetPath: path('a'),
				reason: 'slug_change',
			}),
		).rejects.toThrow('redirect loop');
		expect(await repo.findBySource(path('c'))).toBeNull();
		expect(await repo.findBySource(path('a'))).toEqual(before);
	});

	it('reads a 410 back with no target', async () => {
		const saved = await repo.save({
			id: randomUUID(),
			sourcePath: path('gone'),
			statusCode: 410,
			reason: 'product_archived',
		});
		expect(saved.statusCode).toBe(410);
		expect(saved.targetPath).toBeUndefined();
		const loaded = await repo.findBySource(path('gone'));
		expect(loaded?.statusCode).toBe(410);
		expect(loaded?.targetPath).toBeUndefined();
	});
});
