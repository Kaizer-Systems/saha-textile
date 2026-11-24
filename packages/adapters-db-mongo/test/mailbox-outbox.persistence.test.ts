import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { connectMongo, disconnectMongo } from '../src/connection';
import { MailboxModel, MailboxOutboxModel, SavedReplyModel } from '../src/models/index';
import {
	MongoMailboxAccessRepository,
	MongoMailboxOutboxRepository,
	MongoMailboxRepository,
	MongoMailboxTokenStore,
	MongoSavedReplyRepository,
} from '../src/repositories/mailbox.repository';
import { hasMongoEnv, insertRaw, runPrefix } from './mongo-test-env';

/**
 * Undo Send rows, saved replies, an older mailbox row and a token under the wrong key, against the replica set.
 *
 *   MONGODB_DB_NAME=saha_textile_test RUN_DB_IT=1 pnpm --filter @saha-textile/adapters-db-mongo test
 */
describe.runIf(hasMongoEnv())('mailbox outbox, saved replies and tokens (rs0)', () => {
	const P = runPrefix('mbo');
	const outbox = new MongoMailboxOutboxRepository();
	const replies = new MongoSavedReplyRepository();
	const at = '2001-01-01T00:00:00.000Z';

	beforeAll(async () => {
		await connectMongo();
	});

	afterAll(async () => {
		const ours = { $regex: `^${P}` };
		await MailboxOutboxModel.deleteMany({ _id: ours });
		await SavedReplyModel.deleteMany({ _id: ours });
		await MailboxModel.deleteMany({ _id: ours });
		await disconnectMongo();
	});

	it('queues, claims, cancels, marks sent and lists Undo Send rows', async () => {
		const item = (key: string, over: Record<string, unknown> = {}) =>
			({
				id: `${P}${key}`,
				mailboxId: `${P}box`,
				draftId: `${P}draft_${key}`,
				adminUserId: `${P}staff`,
				messageId: `<${key}@shop.test>`,
				sendAt: at,
				status: 'queued',
				attempts: 0,
				createdAt: at,
				claimedAt: null,
				sentMessageId: null,
				threadId: null,
				meta: {},
				...over,
			}) as never;
		await outbox.create(item('due'));
		await outbox.create(item('later', { sendAt: '2099-01-01T00:00:00.000Z', claimedAt: at }));
		await insertRaw(MailboxOutboxModel as never, {
			_id: `${P}bare`,
			mailboxId: `${P}box`,
			draftId: 'd',
			status: 'failed',
			sendAt: new Date(at),
			createdAt: new Date(at),
		});
		expect((await outbox.findById(`${P}later`))?.claimedAt).toBe(at);
		expect(await outbox.findById(`${P}none`)).toBeNull();
		expect(await outbox.findById(`${P}bare`)).toMatchObject({
			attempts: 0,
			claimedAt: null,
			sentMessageId: null,
			threadId: null,
		});
		const claimed = await outbox.claimDue('2001-01-01T00:00:01.000Z', 5);
		expect(claimed.map((row) => row.id)).toEqual([`${P}due`]);
		expect((await outbox.findActiveForDraft(`${P}box`, `${P}draft_due`))?.status).toBe('sending');
		expect(await outbox.findActiveForDraft(`${P}box`, `${P}draft_none`)).toBeNull();
		await outbox.markSent(`${P}due`, { id: 'gm_1', threadId: 'th_1' });
		expect(await outbox.findById(`${P}due`)).toMatchObject({
			status: 'sent',
			sentMessageId: 'gm_1',
			threadId: 'th_1',
		});
		expect((await outbox.cancel(`${P}later`))?.status).toBe('cancelled');
		expect(await outbox.cancel(`${P}later`)).toBeNull();
		await outbox.setStatus(`${P}later`, 'failed');
		await outbox.setStatus(`${P}later`, 'queued', 1);
		expect((await outbox.findById(`${P}later`))?.attempts).toBe(1);
		expect((await outbox.listByStatus('failed', 1000)).map((row) => row.id)).toContain(`${P}bare`);
	});

	it('creates, lists, updates and deletes shared and personal saved replies', async () => {
		const reply = (key: string, scope: 'shared' | 'personal') =>
			({
				id: `${P}${key}`,
				scope,
				mailboxId: scope === 'shared' ? `${P}box` : null,
				ownerAdminUserId: scope === 'personal' ? `${P}staff` : null,
				title: `Title ${key}`,
				body: 'Thank you for writing to us.',
				createdBy: `${P}staff`,
				updatedBy: `${P}staff`,
				createdAt: at,
				updatedAt: at,
			}) as never;
		await replies.create(reply('shared', 'shared'));
		await replies.create(reply('mine', 'personal'));
		await insertRaw(SavedReplyModel as never, {
			_id: `${P}bare`,
			title: 'Bare',
			body: 'b',
			createdAt: new Date(at),
			updatedAt: new Date(at),
		});
		expect((await replies.listShared(`${P}box`)).map((row) => row.id)).toEqual([`${P}shared`]);
		expect((await replies.listPersonal(`${P}staff`)).map((row) => row.id)).toEqual([`${P}mine`]);
		expect(await replies.findById(`${P}bare`)).toMatchObject({
			scope: 'shared',
			mailboxId: null,
			ownerAdminUserId: null,
		});
		expect(await replies.findById(`${P}none`)).toBeNull();
		expect(
			(await replies.update(`${P}mine`, { title: 'Renamed', body: 'x', updatedBy: `${P}staff`, updatedAt: at }))
				?.title,
		).toBe('Renamed');
		expect(
			await replies.update(`${P}none`, { title: 'x', body: 'x', updatedBy: null, updatedAt: at } as never),
		).toBeNull();
		expect(await replies.delete(`${P}mine`)).toBe(true);
		expect(await replies.delete(`${P}mine`)).toBe(false);
	});

	it('reads an older mailbox row without scopes, a missing mailbox’s access version, and a token no key opens', async () => {
		await insertRaw(MailboxModel as never, {
			_id: `${P}old`,
			address: `${P}old@shop.test`,
			status: 'connected',
			connectedBy: 'admin_1',
			connectedAt: new Date(at),
			sendAs: [{ address: `${P}old@shop.test`, displayName: 'Care', signature: '', isPrimary: true }],
		});
		expect((await new MongoMailboxRepository().findById(`${P}old`))?.grantedScopes).toEqual([]);
		expect(await new MongoMailboxAccessRepository().version(`${P}none`)).toBe(0);
		await new MongoMailboxTokenStore(new Uint8Array(32).fill(1)).put(`${P}old`, 'refresh-token');
		const withOtherKeys = new MongoMailboxTokenStore(new Uint8Array(32).fill(2), new Uint8Array(32).fill(3));
		expect(await withOtherKeys.get(`${P}old`)).toBeNull();
	});
});
