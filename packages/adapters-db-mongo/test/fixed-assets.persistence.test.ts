import { FixedAsset } from '@saha-textile/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { connectMongo, disconnectMongo } from '../src/connection';
import { FixedAssetModel } from '../src/models/bank.model';
import { MongoFixedAssetRepository } from '../src/repositories/fixed-asset.repository';
import { MongoTransactionManager } from '../src/transaction-manager';

import { hasMongoEnv } from './mongo-test-env';

/**
 * The fixed asset register (accounts brief R1–R4), one asset per tag, saved over the version read:
 *   node scripts/secrets/test-login.mjs run saha_textile_assets_test -- pnpm --filter @saha-textile/adapters-db-mongo exec vitest run test/fixed-assets.persistence.test.ts
 */
describe.skipIf(!hasMongoEnv())('fixed assets (integration, rs0)', () => {
	const at = '2026-12-01T06:00:00.000Z';
	/** Ids and tags no other suite uses, so only this file's rows are cleared and listed. */
	const wipe = () => FixedAssetModel.deleteMany({ _id: { $regex: /^fa_dbtest_/ } });
	const repo = new MongoFixedAssetRepository();
	const tx = new MongoTransactionManager();
	const mine = async () => (await repo.list()).filter((a) => a.id.startsWith('fa_dbtest_'));

	const asset = (id: string, tag: string, over: Partial<FixedAsset> = {}): FixedAsset =>
		FixedAsset.parse({
			id: `fa_dbtest_${id}`,
			tag,
			name: `Asset ${id}`,
			categoryKey: 'furniture',
			locationId: 'loc_bar',
			costINR: 60_000,
			putToUseOn: '2026-04-10',
			lifeMonths: 120,
			residualINR: 0,
			taxRatePct: 10,
			status: 'active',
			assetLedgerId: 'led_furniture',
			createdBy: 'adm_acc',
			createdAt: at,
			updatedAt: at,
			version: 0,
			...over,
		});

	beforeAll(async () => {
		await connectMongo();
		await FixedAssetModel.syncIndexes();
		await wipe();
	});
	afterAll(async () => {
		await wipe();
		await disconnectMongo();
	});

	it('keeps assets one per tag, in a transaction or not, counts them and lists them by tag', async () => {
		const before = await repo.count();
		await repo.insert(asset('b', 'FA-DBTEST-0002'));
		await tx.withTransaction((context) => repo.insert(asset('a', 'FA-DBTEST-0001'), context));
		expect(await repo.count()).toBe(before + 2);
		expect((await mine()).map((a) => a.tag)).toEqual(['FA-DBTEST-0001', 'FA-DBTEST-0002']);
		expect(await repo.get('fa_dbtest_a')).toEqual(asset('a', 'FA-DBTEST-0001'));
		expect(await repo.get('fa_dbtest_gone')).toBeNull();
		await expect(repo.insert(asset('c', 'FA-DBTEST-0001'))).rejects.toThrow('fixed_asset_tag_taken');
		const noId = repo.insert({ ...asset('x', 'FA-DBTEST-0099'), id: undefined as never });
		await expect(noId).rejects.toThrow();
		await expect(noId).rejects.not.toThrow('fixed_asset_tag_taken');
	});

	it('saves over the version read, one higher, in a transaction or not, and refuses a version someone saved over', async () => {
		const saved = await repo.save(
			asset('a', 'FA-DBTEST-0001', { accumulatedPaise: 50_000, depreciatedThrough: '2026-04' }),
			0,
		);
		expect(saved.version).toBe(1);
		await tx.withTransaction((context) =>
			repo.save(
				asset('a', 'FA-DBTEST-0001', { accumulatedPaise: 100_000, depreciatedThrough: '2026-05' }),
				1,
				context,
			),
		);
		expect(await repo.get('fa_dbtest_a')).toMatchObject({
			accumulatedPaise: 100_000,
			depreciatedThrough: '2026-05',
			version: 2,
		});
		await expect(repo.save(asset('a', 'FA-DBTEST-0001'), 1)).rejects.toThrow('fixed_asset_changed');
		await expect(repo.save(asset('never', 'FA-DBTEST-0098'), 0)).rejects.toThrow('fixed_asset_changed');
	});
});
