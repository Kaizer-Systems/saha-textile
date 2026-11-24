import { RecurringEntry } from '@saha-textile/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { connectMongo, disconnectMongo } from '../src/connection';
import { RecurringEntryModel } from '../src/models/bank.model';
import { MongoRecurringEntryRepository } from '../src/repositories/fixed-asset.repository';

import { hasMongoEnv } from './mongo-test-env';

/**
 * Rent and recurring entries (accounts brief R5), saved over the version read:
 *   node scripts/secrets/test-login.mjs run saha_textile_assets_test -- pnpm --filter @saha-textile/adapters-db-mongo exec vitest run test/recurring-entries.persistence.test.ts
 */
describe.skipIf(!hasMongoEnv())('recurring entries (integration, rs0)', () => {
	const at = '2026-11-28T06:00:00.000Z';
	/** Ids no other suite uses, so only this file's rows are cleared and listed. */
	const wipe = () => RecurringEntryModel.deleteMany({ _id: { $regex: /^rec_dbtest_/ } });
	const repo = new MongoRecurringEntryRepository();
	const mine = async () => (await repo.list()).filter((e) => e.id.startsWith('rec_dbtest_'));

	const entry = (id: string, over: Partial<RecurringEntry> = {}): RecurringEntry =>
		RecurringEntry.parse({
			id: `rec_dbtest_${id}`,
			what: `Entry ${id}`,
			lines: [{ ledgerId: 'led_rent', locationId: 'loc_bar' }],
			startOn: '2026-11-01',
			nextOn: '2026-12-05',
			createdBy: 'adm_acc',
			createdAt: at,
			updatedAt: at,
			version: 0,
			...over,
		});

	beforeAll(async () => {
		await connectMongo();
		await wipe();
	});
	afterAll(async () => {
		await wipe();
		await disconnectMongo();
	});

	it('keeps entries and lists them by next day, then by what', async () => {
		await repo.insert(entry('b', { what: 'Shop rent' }));
		await repo.insert(entry('a', { what: 'Electricity', nextOn: '2026-11-30' }));
		await repo.insert(entry('c', { what: 'Godown rent' }));
		expect((await mine()).map((e) => [e.nextOn, e.what])).toEqual([
			['2026-11-30', 'Electricity'],
			['2026-12-05', 'Godown rent'],
			['2026-12-05', 'Shop rent'],
		]);
		expect(await repo.get('rec_dbtest_b')).toEqual(entry('b', { what: 'Shop rent' }));
		expect(await repo.get('rec_dbtest_gone')).toBeNull();
	});

	it('saves over the version read, one higher, and refuses a version someone saved over', async () => {
		const made = await repo.save(
			entry('b', { what: 'Shop rent', lastMadeOn: '2026-12-05', nextOn: '2027-01-05' }),
			0,
		);
		expect(made.version).toBe(1);
		expect(await repo.get('rec_dbtest_b')).toMatchObject({
			lastMadeOn: '2026-12-05',
			nextOn: '2027-01-05',
			version: 1,
		});
		await expect(repo.save(entry('b'), 0)).rejects.toThrow('recurring_entry_changed');
		await expect(repo.save(entry('never'), 0)).rejects.toThrow('recurring_entry_changed');
	});

	it('removes an entry, saying whether there was one', async () => {
		expect(await repo.remove('rec_dbtest_c')).toBe(true);
		expect(await repo.remove('rec_dbtest_c')).toBe(false);
		expect((await mine()).map((e) => e.id)).toEqual(['rec_dbtest_a', 'rec_dbtest_b']);
	});
});
