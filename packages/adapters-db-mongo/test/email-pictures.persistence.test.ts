import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { connectMongo, disconnectMongo } from '../src/connection';
import { EmailPictureModel } from '../src/models/index';
import { MongoEmailPictureRepository } from '../src/repositories/index';

import type { EmailPicture } from '@saha-textile/contracts';

/** Email pictures kept for Clean up (media step 3f; Media brief R6-1, A50, A51). */
describe.runIf(process.env.RUN_DB_IT === '1')('email pictures (test database)', () => {
	const pictures = new MongoEmailPictureRepository();
	const picture = (key: string, lastSentAt: string | null, bytes = 20_000): EmailPicture => ({
		key,
		assetId: 'med_gone',
		photoName: 'Red Banarasi.jpg',
		width: 300,
		bytes,
		why: 'deleted',
		goneAt: '2026-11-16T10:00:00.000Z',
		goneBy: 'adm_1',
		sentCount: lastSentAt ? 4 : 0,
		lastSentAt,
	});
	const KEYS = ['email/med_gone/a-150w-1.jpg', 'email/med_gone/a-300w-2.jpg', 'email/med_gone/b-300w-3.jpg'];

	beforeAll(async () => {
		await connectMongo({ autoIndex: false });
		await EmailPictureModel.syncIndexes();
		await EmailPictureModel.deleteMany({ _id: { $in: KEYS } }).exec();
	});
	afterAll(async () => {
		await EmailPictureModel.deleteMany({ _id: { $in: KEYS } }).exec();
		await disconnectMongo();
	});

	it('keeps each picture once, filters by when it was last sent, counts and removes', async () => {
		const now = new Date('2026-11-16T10:00:00.000Z');
		await pictures.keep([
			picture(KEYS[0] as string, null, 10_000),
			picture(KEYS[1] as string, '2023-06-01T00:00:00.000Z'),
			picture(KEYS[2] as string, '2026-01-01T00:00:00.000Z'),
		]);
		// Recorded again (a second delete or swap): the first record stays as it was.
		await pictures.keep([{ ...picture(KEYS[0] as string, null), photoName: 'Changed' }]);
		expect((await pictures.findByKeys([KEYS[0] as string]))[0]?.photoName).toBe('Red Banarasi.jpg');

		const mine = (rows: EmailPicture[]) => rows.map((row) => row.key).filter((key) => KEYS.includes(key));
		expect(mine(await pictures.list({ sent: 'all', now, after: null, limit: 1000 }))).toEqual(KEYS);
		expect(mine(await pictures.list({ sent: 'never', now, after: null, limit: 1000 }))).toEqual([KEYS[0]]);
		expect(mine(await pictures.list({ sent: 'over_2y', now, after: null, limit: 1000 }))).toEqual([KEYS[1]]);
		expect(mine(await pictures.list({ sent: 'over_1y', now, after: null, limit: 1000 }))).toEqual([KEYS[1]]);
		expect(await pictures.count({ sent: 'over_2y', now })).toBeGreaterThanOrEqual(1);
		const totals = await pictures.totals();
		expect(totals.count).toBeGreaterThanOrEqual(3);
		expect(totals.bytes).toBeGreaterThanOrEqual(50_000);

		await pictures.remove([KEYS[0] as string, KEYS[1] as string]);
		expect((await pictures.findByKeys(KEYS)).map((row) => row.key)).toEqual([KEYS[2]]);
	});
});
