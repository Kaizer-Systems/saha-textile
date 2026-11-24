import { GstReturnDraft } from '@saha-textile/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { connectMongo, disconnectMongo } from '../src/connection';
import { GstReturnDraftModel } from '../src/models/bank.model';
import { MongoGstReturnDraftRepository } from '../src/repositories/gst-draft.repository';

import { hasMongoEnv } from './mongo-test-env';

/**
 * GST return drafts (accounts brief G4), one per registration, return and month, saved over the version read:
 *   node scripts/secrets/test-login.mjs run saha_textile_gst_test -- pnpm --filter @saha-textile/adapters-db-mongo exec vitest run test/gst-drafts.persistence.test.ts
 */
describe.skipIf(!hasMongoEnv())('GST return drafts (integration, rs0)', () => {
	const at = '2026-11-28T06:00:00.000Z';
	/** Registrations no other suite uses, so only this file's rows are cleared. */
	const REG = 'reg_gstdraft_a';
	const OTHER = 'reg_gstdraft_b';
	const wipe = () => GstReturnDraftModel.deleteMany({ gstRegistrationId: { $in: [REG, OTHER] } });
	const repo = new MongoGstReturnDraftRepository();

	const draft = (id: string, over: Partial<GstReturnDraft> = {}): GstReturnDraft =>
		GstReturnDraft.parse({
			id,
			gstRegistrationId: REG,
			gstin: '19AABCG1234A1Z5',
			returnType: 'GSTR-1',
			month: '2026-11',
			status: 'prepared',
			summary: [{ table: '7', records: 1, taxable: 1000, tax: 50 }],
			problems: [],
			portal: { gstin: '19AABCG1234A1Z5', fp: '112026' },
			preparedBy: 'adm_1',
			preparedAt: at,
			...over,
		});

	beforeAll(async () => {
		await connectMongo();
		await GstReturnDraftModel.syncIndexes();
		await wipe();
	});
	afterAll(async () => {
		await wipe();
		await disconnectMongo();
	});

	it('creates a draft at version 0, opens it by id or by its registration, return and month', async () => {
		const created = await repo.save(draft('gsr_d1', { version: 5 }), null);
		expect(created.version).toBe(0);
		expect(await repo.get('gsr_d1')).toEqual({ ...draft('gsr_d1'), version: 0 });
		expect((await repo.find(REG, 'GSTR-1', '2026-11'))?.id).toBe('gsr_d1');
		expect(await repo.find(REG, 'GSTR-3B', '2026-11')).toBeNull();
		expect(await repo.get('gsr_nowhere')).toBeNull();
	});

	it('refuses a second draft for the same return and month, and passes on any other failure to create', async () => {
		await expect(repo.save(draft('gsr_d1b'), null)).rejects.toThrow('gst_draft_exists');
		await expect(repo.save(draft('gsr_d1', { month: '2026-09' }), null)).rejects.toThrow('gst_draft_exists');
		const noId = repo.save({ ...draft('gsr_x', { month: '2026-08' }), id: undefined as never }, null);
		await expect(noId).rejects.toThrow();
		await expect(noId).rejects.not.toThrow('gst_draft_exists');
	});

	it('saves over the version read, one higher, and refuses a version someone saved over', async () => {
		const checked = await repo.save(
			{ ...draft('gsr_d1'), status: 'checked', checkedBy: 'adm_2', checkedAt: at },
			0,
		);
		expect(checked.version).toBe(1);
		expect(await repo.get('gsr_d1')).toMatchObject({ status: 'checked', checkedBy: 'adm_2', version: 1 });
		await expect(repo.save({ ...draft('gsr_d1'), status: 'approved' }, 0)).rejects.toThrow('gst_draft_changed');
		await expect(repo.save(draft('gsr_never'), 0)).rejects.toThrow('gst_draft_changed');
		expect((await repo.get('gsr_d1'))?.status).toBe('checked');
	});

	it('lists a registration’s drafts, newest month first and GSTR-1 before GSTR-3B', async () => {
		await repo.save(draft('gsr_d2', { month: '2026-10' }), null);
		await repo.save(draft('gsr_d3', { returnType: 'GSTR-3B' }), null);
		await repo.save(draft('gsr_d4', { gstRegistrationId: OTHER }), null);
		expect((await repo.listForRegistration(REG)).map((d) => [d.id, d.month, d.returnType])).toEqual([
			['gsr_d1', '2026-11', 'GSTR-1'],
			['gsr_d3', '2026-11', 'GSTR-3B'],
			['gsr_d2', '2026-10', 'GSTR-1'],
		]);
		expect((await repo.listForRegistration(OTHER)).map((d) => d.id)).toEqual(['gsr_d4']);
		expect(await repo.listForRegistration('reg_gstdraft_none')).toEqual([]);
	});
});
