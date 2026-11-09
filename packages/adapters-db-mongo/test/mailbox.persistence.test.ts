import { ContactMessage, Mailbox } from '@saha-textile/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { connectMongo, disconnectMongo } from '../src/connection';
import {
	CONTACT_MESSAGE_RETENTION_SECONDS,
	ContactMessageModel,
	MailboxAccessModel,
	MailboxModel,
} from '../src/models/index';
import {
	MongoContactMessageRepository,
	MongoMailboxAccessRepository,
	MongoMailboxRepository,
	MongoMailboxTokenStore,
} from '../src/repositories/mailbox.repository';
import { hasMongoEnv, runPrefix } from './mongo-test-env';

describe('MongoMailboxTokenStore key', () => {
	it('refuses a key that is not 32 bytes', () => {
		expect(() => new MongoMailboxTokenStore(new Uint8Array(16))).toThrow('32 bytes');
	});
});

/**
 * Mailboxes, access lists, encrypted tokens and Contact Us messages against the replica set.
 *
 *   MONGODB_PORT=27018 MONGODB_DB_NAME=saha_textile_test RUN_DB_IT=1 pnpm --filter @saha-textile/adapters-db-mongo test
 */
describe.runIf(hasMongoEnv())('mailbox persistence (rs0)', () => {
	const mailboxes = new MongoMailboxRepository();
	const access = new MongoMailboxAccessRepository();
	const messages = new MongoContactMessageRepository();
	const key = new Uint8Array(32).fill(7);
	const tokens = new MongoMailboxTokenStore(key);
	const prefix = runPrefix('mbx');

	const mailbox = (name: string) =>
		Mailbox.parse({
			id: `${prefix}${name}`,
			address: `${prefix}${name}@Shop.test`,
			status: 'connected',
			connectedBy: 'admin_1',
			connectedAt: '2026-11-09T10:00:00.000Z',
			sendAs: [{ address: `${prefix}${name}@shop.test`, displayName: 'Care', isPrimary: true }],
		});

	beforeAll(async () => {
		await connectMongo();
		await Promise.all([
			MailboxModel.syncIndexes(),
			MailboxAccessModel.syncIndexes(),
			ContactMessageModel.syncIndexes(),
		]);
	});

	afterAll(async () => {
		await MailboxModel.deleteMany({ _id: { $regex: `^${prefix}` } });
		await MailboxAccessModel.deleteMany({ mailboxId: { $regex: `^${prefix}` } });
		await ContactMessageModel.deleteMany({ _id: { $regex: `^${prefix}` } });
		await disconnectMongo();
	});

	it('saves a mailbox with its address in lower case, and finds it by id or address', async () => {
		const saved = await mailboxes.save(mailbox('care'));
		expect(saved.address).toBe(`${prefix}care@shop.test`);
		expect(saved.connectedAt).toBe('2026-11-09T10:00:00.000Z');
		expect(saved.lastSyncAt).toBeNull();
		expect(saved.sendAs).toEqual([
			{ address: `${prefix}care@shop.test`, displayName: 'Care', signature: '', isPrimary: true },
		]);
		expect((await mailboxes.findByAddress(`${prefix}CARE@shop.test`))?.id).toBe(saved.id);
		expect(await mailboxes.findById(`${prefix}none`)).toBeNull();
		expect(await mailboxes.findByAddress('none@shop.test')).toBeNull();
		await mailboxes.save({ ...saved, status: 'needs_reconnect', lastSyncAt: '2026-11-09T11:00:00.000Z' });
		const mine = (await mailboxes.list()).filter((row) => row.id.startsWith(prefix));
		expect(mine.map((row) => row.status)).toEqual(['needs_reconnect']);
	});

	it('keeps the refresh token encrypted, out of ordinary reads, and readable with the key only', async () => {
		await mailboxes.save(mailbox('tokens'));
		const id = `${prefix}tokens`;
		expect(await tokens.get(id)).toBeNull();
		await tokens.put(id, '1//refresh-token');
		const raw = await MailboxModel.findById(id).select('+token').lean().exec();
		expect(JSON.stringify(raw)).not.toContain('refresh-token');
		expect(JSON.stringify(await MailboxModel.findById(id).lean().exec())).not.toContain('"token"');
		expect(await tokens.get(id)).toBe('1//refresh-token');
		// Another key, or a hand-edited row, reads as no token: the mailbox needs reconnecting.
		expect(await new MongoMailboxTokenStore(new Uint8Array(32).fill(8)).get(id)).toBeNull();
		await tokens.remove(id);
		expect(await tokens.get(id)).toBeNull();
		expect(await tokens.get(`${prefix}missing`)).toBeNull();
	});

	it("replaces a mailbox's access list as a whole", async () => {
		const id = `${prefix}access`;
		await access.replaceForMailbox(id, [
			{ mailboxId: id, adminUserId: 'u1', canSend: true },
			{ mailboxId: id, adminUserId: 'u2', canSend: false },
		]);
		await access.replaceForMailbox(id, [
			{ mailboxId: id, adminUserId: 'u2', canSend: true },
			{ mailboxId: id, adminUserId: 'u3', canSend: false },
		]);
		const rows = await access.listForMailbox(id);
		expect(rows.map((row) => `${row.adminUserId}:${row.canSend}`).sort()).toEqual(['u2:true', 'u3:false']);
		expect((await access.listForAdminUser('u3')).some((row) => row.mailboxId === id)).toBe(true);
		await access.replaceForMailbox(id, []);
		expect(await access.listForMailbox(id)).toEqual([]);
	});

	it('stores Contact Us messages, finds a recent repeat and lists those still to deliver', async () => {
		const message = (name: string, createdAt: string, status: ContactMessage['status']) =>
			ContactMessage.parse({
				id: `${prefix}${name}`,
				name: 'Rina',
				email: 'rina@x.test',
				phone: null,
				subject: 'Blouse',
				message: 'Hello there',
				locale: 'bn',
				status,
				ipHash: 'h1',
				contentHash: `${prefix}hash-${name}`,
				createdAt,
			});
		const queued = await messages.save(message('q', '2026-11-09T09:00:00.000Z', 'queued'));
		expect(queued.deliveredAt).toBeNull();
		await messages.save(message('f', '2026-11-09T09:30:00.000Z', 'failed'));
		const delivered = await messages.save({
			...message('d', '2026-11-09T08:00:00.000Z', 'delivered'),
			deliveredAt: '2026-11-09T08:01:00.000Z',
			gmailMessageId: 'g1',
		});
		expect(delivered.deliveredAt).toBe('2026-11-09T08:01:00.000Z');
		expect(await messages.findById(`${prefix}none`)).toBeNull();
		expect((await messages.findRecentByHash(`${prefix}hash-q`, '2026-11-09T00:00:00.000Z'))?.id).toBe(queued.id);
		expect(await messages.findRecentByHash(`${prefix}hash-q`, '2026-11-09T10:00:00.000Z')).toBeNull();
		const pending = (await messages.listPending(500)).filter((row) => row.id.startsWith(prefix));
		expect(pending.map((row) => row.id)).toEqual([`${prefix}q`, `${prefix}f`]);
	});

	it('lets the database delete a message twelve months after it arrived', async () => {
		const indexes = await ContactMessageModel.collection.indexes();
		const ttl = indexes.find((index) => index.expireAfterSeconds !== undefined);
		expect(ttl?.key).toEqual({ createdAt: 1 });
		expect(ttl?.expireAfterSeconds).toBe(CONTACT_MESSAGE_RETENTION_SECONDS);
	});
});
