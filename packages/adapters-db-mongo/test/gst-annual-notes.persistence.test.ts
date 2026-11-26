import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { connectMongo, disconnectMongo } from '../src/connection';
import { GstAnnualNoteModel } from '../src/models/bank.model';
import { MongoGstAnnualNoteRepository } from '../src/repositories/gst-draft.repository';

import { hasMongoEnv, insertRaw } from './mongo-test-env';

/**
 * GSTR-9's notes (accounts brief G9), one record per registration and year, saved over the version read:
 *   node scripts/secrets/test-login.mjs run saha_textile_gst_test -- pnpm --filter @saha-textile/adapters-db-mongo exec vitest run test/gst-annual-notes.persistence.test.ts
 */
describe.skipIf(!hasMongoEnv())('GSTR-9 notes (integration, rs0)', () => {
	/** Registrations no other suite uses, so only this file's rows are cleared. */
	const REG = 'reg_gstnote_a';
	const wipe = () => GstAnnualNoteModel.deleteMany({ _id: { $regex: /^reg_gstnote_/ } });
	const repo = new MongoGstAnnualNoteRepository();

	beforeAll(async () => {
		await connectMongo();
		await wipe();
	});
	afterAll(async () => {
		await wipe();
		await disconnectMongo();
	});

	it('keeps a year’s first notes at version 0, then saves over the version read, one higher', async () => {
		expect(await repo.get(REG, '2026-27')).toBeNull();
		expect(await repo.save(REG, '2026-27', { '4': 'Sample sarees' }, null)).toBe(0);
		expect(await repo.get(REG, '2026-27')).toEqual({ notes: { '4': 'Sample sarees' }, version: 0 });
		expect(await repo.save(REG, '2026-27', { '4': 'Sample sarees', '6': 'Bill entered late' }, 0)).toBe(1);
		expect(await repo.get(REG, '2026-27')).toEqual({
			notes: { '4': 'Sample sarees', '6': 'Bill entered late' },
			version: 1,
		});
		// Another year of the same registration is its own record.
		expect(await repo.get(REG, '2025-26')).toBeNull();
	});

	it('refuses a second first save and a version someone saved over, and passes on any other failure', async () => {
		await expect(repo.save(REG, '2026-27', { '5': 'x' }, null)).rejects.toThrow('gst_annual_changed');
		await expect(repo.save(REG, '2026-27', { '5': 'x' }, 0)).rejects.toThrow('gst_annual_changed');
		await expect(repo.save('reg_gstnote_none', '2026-27', { '5': 'x' }, 3)).rejects.toThrow('gst_annual_changed');
		// Notes BSON can't store (a key with a null byte) fail for their own reason.
		const bad = repo.save('reg_gstnote_bad', '2026-27', { 'table\u00004': 'x' }, null);
		await expect(bad).rejects.toThrow();
		await expect(bad).rejects.not.toThrow('gst_annual_changed');
	});

	it('reads a record saved without notes or a version as empty notes at version 0', async () => {
		await insertRaw(GstAnnualNoteModel, { _id: 'reg_gstnote_bare|2026-27', gstRegistrationId: 'reg_gstnote_bare' });
		expect(await repo.get('reg_gstnote_bare', '2026-27')).toEqual({ notes: {}, version: 0 });
	});
});
