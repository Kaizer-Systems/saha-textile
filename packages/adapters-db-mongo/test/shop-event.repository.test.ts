import { ShopEvent } from '@saha-textile/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { connectMongo, disconnectMongo } from '../src/connection';
import { ShopEventModel } from '../src/models/index';
import { MongoShopEventRepository } from '../src/repositories/index';
import { hasMongoEnv, insertRaw, runPrefix } from './mongo-test-env';

const P = runPrefix('evt');
const repo = new MongoShopEventRepository();

const event = (id: string, patch: Partial<ShopEvent> = {}): ShopEvent =>
	ShopEvent.parse({
		id: `${P}${id}`,
		type: 'sale',
		name: `${P} ${id}`,
		title: { en: `Sale ${id}` },
		startsAt: '2027-09-20T04:30:00.000Z',
		endsAt: '2027-09-27T18:29:00.000Z',
		...patch,
	});

describe.skipIf(!hasMongoEnv())('shop event repository (integration, rs0)', () => {
	beforeAll(async () => {
		await connectMongo();
		await ShopEventModel.syncIndexes();
	});

	afterAll(async () => {
		await ShopEventModel.deleteMany({ _id: { $regex: `^${P}` } });
		await disconnectMongo();
	});

	it('saves and reads an event with its pictures and side', async () => {
		const saved = await repo.save(
			event('a', {
				popupAssetIds: ['m1', 'm2'],
				imageVersions: { m1: 'phone_banner_4x5.as_is' },
				popupImageSide: 'left',
			}),
		);
		expect(saved).toMatchObject({
			popupAssetIds: ['m1', 'm2'],
			imageVersions: { m1: 'phone_banner_4x5.as_is' },
			popupImageSide: 'left',
			status: 'draft',
		});
		expect(await repo.findById(`${P}a`)).toMatchObject({ name: `${P} a`, startsAt: '2027-09-20T04:30:00.000Z' });
		expect(await repo.findById(`${P}missing`)).toBeNull();
	});

	it('reads the single picture of before 2026-11-10 as the list, and moves it on the next save', async () => {
		await insertRaw(ShopEventModel, {
			_id: `${P}old`,
			type: 'launch',
			name: `${P} old`,
			status: 'draft',
			popupAssetId: 'm_old',
		});
		const old = await repo.findById(`${P}old`);
		expect(old).toMatchObject({ popupAssetIds: ['m_old'], popupImageSide: 'right', title: {}, launch: {} });
		await repo.save(old as ShopEvent);
		const raw = await ShopEventModel.findById(`${P}old`).lean().exec();
		expect(raw?.popupAssetIds).toEqual(['m_old']);
		expect(raw && 'popupAssetId' in raw).toBe(false);
		await insertRaw(ShopEventModel, { _id: `${P}bare`, type: 'sale', name: `${P} bare`, status: 'draft' });
		expect((await repo.findById(`${P}bare`))?.popupAssetIds).toEqual([]);
	});

	it('lists by type, state and words, sorted as asked', async () => {
		await repo.save(event('b', { name: `${P} Beta`, startsAt: '2027-10-01T00:00:00.000Z', status: 'scheduled' }));
		await repo.save(event('c', { name: `${P} Gamma`, type: 'launch', endsAt: null, status: 'live' }));
		const mine = { search: P, page: 1, pageSize: 50 };
		expect((await repo.list({ ...mine, type: 'launch' })).items.map((row) => row.id)).toContain(`${P}c`);
		expect((await repo.list({ ...mine, status: 'scheduled' })).items.map((row) => row.id)).toEqual([`${P}b`]);
		expect((await repo.list({ ...mine, search: `${P} Gam` })).total).toBe(1);
		const byName = await repo.list({ ...mine, sort: 'name', direction: 'asc' });
		const names = byName.items.map((row) => row.name);
		expect(names).toEqual([...names].sort());
		const newest = await repo.list({ ...mine });
		expect(newest.items[0]?.id).toBe(`${P}b`);
		expect((await repo.list({ ...mine, sort: 'startsAt', direction: 'desc' })).items[0]?.id).toBe(`${P}b`);
		const published = (await repo.listPublished()).map((row) => row.id);
		expect(published).toEqual(expect.arrayContaining([`${P}b`, `${P}c`]));
		expect(published).not.toContain(`${P}a`);
	});

	it('moves an event on only from the expected state, and deletes', async () => {
		expect(await repo.transition(`${P}a`, 'scheduled', { status: 'live' })).toBeNull();
		const moved = await repo.transition(`${P}a`, 'draft', {
			status: 'scheduled',
			publishedAt: '2027-09-01T00:00:00.000Z',
		});
		expect(moved).toMatchObject({ status: 'scheduled', publishedAt: '2027-09-01T00:00:00.000Z' });
		await repo.remove(`${P}a`);
		expect(await repo.findById(`${P}a`)).toBeNull();
	});

	it('finds an event by its preview link until the link expires', async () => {
		await repo.save(event('p'));
		await repo.setPreview(`${P}p`, `${P}hash`, '2027-01-01T00:30:00.000Z');
		expect((await repo.findByPreview(`${P}hash`, '2027-01-01T00:00:00.000Z'))?.id).toBe(`${P}p`);
		expect(await repo.findByPreview(`${P}hash`, '2027-01-01T01:00:00.000Z')).toBeNull();
		expect(await repo.findByPreview(`${P}other`, '2027-01-01T00:00:00.000Z')).toBeNull();
	});
});
