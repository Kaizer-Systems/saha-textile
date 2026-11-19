import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { ContactMessage, Mailbox, MailboxAccess, MailboxRight } from '@saha-textile/contracts';
import {
	legacyMailboxRights,
	withNeededRights,
	type ContactMessageRepository,
	type MailboxAccessRepository,
	type MailboxOutboxRepository,
	type MailboxRepository,
	type OutboxItem,
	type OutboxStatus,
	type MailboxTokenStore,
	type SavedReplyRepository,
	type StoredSavedReply,
} from '@saha-textile/core-domain';

import {
	ContactMessageModel,
	MailboxAccessModel,
	MailboxModel,
	MailboxOutboxModel,
	SavedReplyModel,
	type ContactMessageDoc,
	type MailboxAccessDoc,
	type MailboxDoc,
	type MailboxOutboxDoc,
	type SavedReplyDoc,
} from '../models/index';

const iso = (value: Date | null | undefined): string | null => (value ? new Date(value).toISOString() : null);
const date = (value: string | null | undefined): Date | null => (value ? new Date(value) : null);

const toMailbox = (doc: MailboxDoc): Mailbox =>
	Mailbox.parse({
		id: doc._id,
		address: doc.address,
		status: doc.status,
		connectedBy: doc.connectedBy,
		connectedAt: iso(doc.connectedAt),
		lastSyncAt: iso(doc.lastSyncAt),
		sendAs: doc.sendAs,
		grantedScopes: doc.grantedScopes ?? [],
		revocation: doc.revocation ?? null,
		createdAt: iso(doc.createdAt),
		updatedAt: iso(doc.updatedAt),
	});

/** Mailboxes, without their tokens (`select: false` keeps `token` out of every read here). */
export class MongoMailboxRepository implements MailboxRepository {
	async list(): Promise<Mailbox[]> {
		const docs = await MailboxModel.find().sort({ address: 1 }).lean<MailboxDoc[]>().exec();
		return docs.map(toMailbox);
	}

	async findById(id: string): Promise<Mailbox | null> {
		const doc = await MailboxModel.findById(id).lean<MailboxDoc>().exec();
		return doc ? toMailbox(doc) : null;
	}

	async findByAddress(address: string): Promise<Mailbox | null> {
		const doc = await MailboxModel.findOne({ address: address.toLowerCase() }).lean<MailboxDoc>().exec();
		return doc ? toMailbox(doc) : null;
	}

	async save(mailbox: Mailbox): Promise<Mailbox> {
		const parsed = Mailbox.parse(mailbox);
		await MailboxModel.updateOne(
			{ _id: parsed.id },
			{
				$set: {
					address: parsed.address.toLowerCase(),
					status: parsed.status,
					connectedBy: parsed.connectedBy,
					connectedAt: date(parsed.connectedAt),
					lastSyncAt: date(parsed.lastSyncAt),
					sendAs: parsed.sendAs,
					grantedScopes: parsed.grantedScopes,
					revocation: parsed.revocation,
				},
			},
			{ upsert: true },
		).exec();
		return (await this.findById(parsed.id)) as Mailbox;
	}
}

const accessId = (mailboxId: string, adminUserId: string): string => `${mailboxId}:${adminUserId}`;
/** Stored rights, or what a row from before rights existed meant; unknown names are dropped. */
export const storedMailboxRights = (doc: Pick<MailboxAccessDoc, 'rights' | 'canSend'>): MailboxRight[] => {
	const known = (doc.rights ?? []).filter((name): name is MailboxRight => MailboxRight.safeParse(name).success);
	return known.length ? withNeededRights(known) : legacyMailboxRights(Boolean(doc.canSend));
};

const toAccess = (doc: MailboxAccessDoc): MailboxAccess =>
	MailboxAccess.parse({ mailboxId: doc.mailboxId, adminUserId: doc.adminUserId, rights: storedMailboxRights(doc) });

export class MongoMailboxAccessRepository implements MailboxAccessRepository {
	async listForMailbox(mailboxId: string): Promise<MailboxAccess[]> {
		const docs = await MailboxAccessModel.find({ mailboxId }).lean<MailboxAccessDoc[]>().exec();
		return docs.map(toAccess);
	}

	async listForAdminUser(adminUserId: string): Promise<MailboxAccess[]> {
		const docs = await MailboxAccessModel.find({ adminUserId }).lean<MailboxAccessDoc[]>().exec();
		return docs.map(toAccess);
	}

	async version(mailboxId: string): Promise<number> {
		const doc = await MailboxModel.findById(mailboxId).select('accessVersion').lean<MailboxDoc>().exec();
		return doc?.accessVersion ?? 0;
	}

	/**
	 * The version bump is the lock: only one of two saves made from the same version moves it, and
	 * the loser writes nothing. A crash after the bump leaves the old list under a new version,
	 * which the next editor simply reloads.
	 */
	async replaceForMailbox(
		mailboxId: string,
		entries: readonly MailboxAccess[],
		expectedVersion: number,
	): Promise<number | null> {
		const current =
			expectedVersion === 0
				? { $or: [{ accessVersion: 0 }, { accessVersion: { $exists: false } }] }
				: { accessVersion: expectedVersion };
		const bumped = await MailboxModel.updateOne(
			{ _id: mailboxId, ...current },
			{ $set: { accessVersion: expectedVersion + 1 } },
		).exec();
		if (bumped.modifiedCount !== 1) return null;
		const keep = entries.map((entry) => accessId(mailboxId, entry.adminUserId));
		await MailboxAccessModel.deleteMany({ mailboxId, _id: { $nin: keep } }).exec();
		if (entries.length) {
			await MailboxAccessModel.bulkWrite(
				entries.map((entry) => {
					const rights = withNeededRights(entry.rights);
					return {
						updateOne: {
							filter: { _id: accessId(mailboxId, entry.adminUserId) },
							update: {
								$set: {
									mailboxId,
									adminUserId: entry.adminUserId,
									rights,
									canSend: rights.includes('send'),
								},
							},
							upsert: true,
						},
					};
				}),
			);
		}
		return expectedVersion + 1;
	}
}

/** AES-256-GCM: a fresh 12-byte IV per write, and the tag checked on every read. */
const ALGORITHM = 'aes-256-gcm';

/**
 * Refresh tokens, encrypted with `MAILBOX_TOKEN_KEY` (32 bytes, server settings only). A row
 * whose tag fails (wrong key, edited by hand) reads as no token, so the mailbox shows as needing
 * reconnection instead of the API failing.
 */
export class MongoMailboxTokenStore implements MailboxTokenStore {
	private readonly key: Buffer;

	constructor(key: Uint8Array) {
		if (key.length !== 32) throw new Error('MAILBOX_TOKEN_KEY must be 32 bytes');
		this.key = Buffer.from(key);
	}

	async put(mailboxId: string, refreshToken: string): Promise<void> {
		const iv = randomBytes(12);
		const cipher = createCipheriv(ALGORITHM, this.key, iv);
		const data = Buffer.concat([cipher.update(refreshToken, 'utf8'), cipher.final()]);
		const token = {
			iv: iv.toString('base64'),
			tag: cipher.getAuthTag().toString('base64'),
			data: data.toString('base64'),
		};
		await MailboxModel.updateOne({ _id: mailboxId }, { $set: { token } }).exec();
	}

	async get(mailboxId: string): Promise<string | null> {
		const doc = await MailboxModel.findById(mailboxId).select('+token').lean<MailboxDoc>().exec();
		const token = doc?.token;
		if (!token) return null;
		try {
			const decipher = createDecipheriv(ALGORITHM, this.key, Buffer.from(token.iv, 'base64'));
			decipher.setAuthTag(Buffer.from(token.tag, 'base64'));
			return Buffer.concat([decipher.update(Buffer.from(token.data, 'base64')), decipher.final()]).toString(
				'utf8',
			);
		} catch {
			return null;
		}
	}

	async remove(mailboxId: string): Promise<void> {
		await MailboxModel.updateOne({ _id: mailboxId }, { $set: { token: null } }).exec();
	}
}

const toContactMessage = (doc: ContactMessageDoc): ContactMessage =>
	ContactMessage.parse({
		id: doc._id,
		name: doc.name,
		email: doc.email,
		phone: doc.phone,
		subject: doc.subject,
		message: doc.message,
		locale: doc.locale,
		status: doc.status,
		ipHash: doc.ipHash,
		contentHash: doc.contentHash,
		mailboxId: doc.mailboxId,
		gmailMessageId: doc.gmailMessageId,
		attempts: doc.attempts,
		lastError: doc.lastError,
		createdAt: iso(doc.createdAt),
		deliveredAt: iso(doc.deliveredAt),
	});

export class MongoContactMessageRepository implements ContactMessageRepository {
	async save(message: ContactMessage): Promise<ContactMessage> {
		const { id, createdAt, deliveredAt, ...rest } = ContactMessage.parse(message);
		await ContactMessageModel.updateOne(
			{ _id: id },
			{ $set: { ...rest, createdAt: new Date(createdAt), deliveredAt: date(deliveredAt) } },
			{ upsert: true },
		).exec();
		return (await this.findById(id)) as ContactMessage;
	}

	async findById(id: string): Promise<ContactMessage | null> {
		const doc = await ContactMessageModel.findById(id).lean<ContactMessageDoc>().exec();
		return doc ? toContactMessage(doc) : null;
	}

	async findRecentByHash(contentHash: string, since: string): Promise<ContactMessage | null> {
		const doc = await ContactMessageModel.findOne({ contentHash, createdAt: { $gte: new Date(since) } })
			.lean<ContactMessageDoc>()
			.exec();
		return doc ? toContactMessage(doc) : null;
	}

	async listPending(limit: number): Promise<ContactMessage[]> {
		const docs = await ContactMessageModel.find({ status: { $in: ['queued', 'failed'] } })
			.sort({ createdAt: 1 })
			.limit(limit)
			.lean<ContactMessageDoc[]>()
			.exec();
		return docs.map(toContactMessage);
	}
}

const toOutbox = (doc: MailboxOutboxDoc): OutboxItem => ({
	id: doc._id,
	mailboxId: doc.mailboxId,
	draftId: doc.draftId,
	adminUserId: doc.adminUserId,
	messageId: doc.messageId,
	sendAt: new Date(doc.sendAt).toISOString(),
	status: doc.status as OutboxStatus,
	attempts: doc.attempts ?? 0,
	createdAt: new Date(doc.createdAt).toISOString(),
	claimedAt: doc.claimedAt ? new Date(doc.claimedAt).toISOString() : null,
	sentMessageId: doc.sentMessageId ?? null,
	threadId: doc.threadId ?? null,
	meta: doc.meta,
});

/** Undo Send rows. Each status change is one `findOneAndUpdate` guarded by the current status. */
export class MongoMailboxOutboxRepository implements MailboxOutboxRepository {
	async create(item: OutboxItem): Promise<OutboxItem> {
		await MailboxOutboxModel.create({
			_id: item.id,
			mailboxId: item.mailboxId,
			draftId: item.draftId,
			adminUserId: item.adminUserId,
			messageId: item.messageId,
			sendAt: new Date(item.sendAt),
			status: item.status,
			attempts: item.attempts,
			sentMessageId: item.sentMessageId,
			threadId: item.threadId,
			meta: item.meta,
			createdAt: new Date(item.createdAt),
			claimedAt: item.claimedAt ? new Date(item.claimedAt) : null,
		});
		return item;
	}

	async findById(id: string): Promise<OutboxItem | null> {
		const doc = await MailboxOutboxModel.findById(id).lean<MailboxOutboxDoc>().exec();
		return doc ? toOutbox(doc) : null;
	}

	async claimDue(now: string, limit: number): Promise<OutboxItem[]> {
		const claimed: OutboxItem[] = [];
		for (let index = 0; index < limit; index += 1) {
			const doc = await MailboxOutboxModel.findOneAndUpdate(
				{ status: 'queued', sendAt: { $lte: new Date(now) } },
				{ $set: { status: 'sending', claimedAt: new Date(now) } },
				{ new: true, sort: { sendAt: 1 } },
			)
				.lean<MailboxOutboxDoc>()
				.exec();
			if (!doc) break;
			claimed.push(toOutbox(doc));
		}
		return claimed;
	}

	async cancel(id: string): Promise<OutboxItem | null> {
		const doc = await MailboxOutboxModel.findOneAndUpdate(
			{ _id: id, status: 'queued' },
			{ $set: { status: 'cancelled' } },
			{ new: true },
		)
			.lean<MailboxOutboxDoc>()
			.exec();
		return doc ? toOutbox(doc) : null;
	}

	async markSent(id: string, sent: { id: string; threadId: string }): Promise<void> {
		await MailboxOutboxModel.updateOne(
			{ _id: id },
			{ $set: { status: 'sent', sentMessageId: sent.id, threadId: sent.threadId } },
		).exec();
	}

	async setStatus(id: string, status: Exclude<OutboxStatus, 'sent'>, attemptsDelta = 0): Promise<void> {
		await MailboxOutboxModel.updateOne({ _id: id }, { $set: { status }, $inc: { attempts: attemptsDelta } }).exec();
	}

	async findActiveForDraft(mailboxId: string, draftId: string): Promise<OutboxItem | null> {
		const doc = await MailboxOutboxModel.findOne({ mailboxId, draftId, status: { $in: ['queued', 'sending'] } })
			.lean<MailboxOutboxDoc>()
			.exec();
		return doc ? toOutbox(doc) : null;
	}

	async listByStatus(status: OutboxStatus, limit: number): Promise<OutboxItem[]> {
		const docs = await MailboxOutboxModel.find({ status })
			.sort({ sendAt: 1 })
			.limit(limit)
			.lean<MailboxOutboxDoc[]>()
			.exec();
		return docs.map(toOutbox);
	}
}

const toSavedReply = (doc: SavedReplyDoc): StoredSavedReply => ({
	id: doc._id,
	scope: doc.scope === 'personal' ? 'personal' : 'shared',
	mailboxId: doc.mailboxId ?? null,
	ownerAdminUserId: doc.ownerAdminUserId ?? null,
	title: doc.title,
	body: doc.body,
	createdBy: doc.createdBy,
	updatedBy: doc.updatedBy,
	createdAt: new Date(doc.createdAt).toISOString(),
	updatedAt: new Date(doc.updatedAt).toISOString(),
});

/** Saved replies (C3), listed by title. */
export class MongoSavedReplyRepository implements SavedReplyRepository {
	async listShared(mailboxId: string): Promise<StoredSavedReply[]> {
		const docs = await SavedReplyModel.find({ mailboxId, scope: 'shared' })
			.sort({ title: 1 })
			.lean<SavedReplyDoc[]>()
			.exec();
		return docs.map(toSavedReply);
	}

	async listPersonal(adminUserId: string): Promise<StoredSavedReply[]> {
		const docs = await SavedReplyModel.find({ ownerAdminUserId: adminUserId, scope: 'personal' })
			.sort({ title: 1 })
			.lean<SavedReplyDoc[]>()
			.exec();
		return docs.map(toSavedReply);
	}

	async findById(id: string): Promise<StoredSavedReply | null> {
		const doc = await SavedReplyModel.findById(id).lean<SavedReplyDoc>().exec();
		return doc ? toSavedReply(doc) : null;
	}

	async create(reply: StoredSavedReply): Promise<StoredSavedReply> {
		await SavedReplyModel.create({
			_id: reply.id,
			scope: reply.scope,
			mailboxId: reply.mailboxId,
			ownerAdminUserId: reply.ownerAdminUserId,
			title: reply.title,
			body: reply.body,
			createdBy: reply.createdBy,
			updatedBy: reply.updatedBy,
			createdAt: new Date(reply.createdAt),
			updatedAt: new Date(reply.updatedAt),
		});
		return reply;
	}

	async update(
		id: string,
		change: Pick<StoredSavedReply, 'title' | 'body' | 'updatedBy' | 'updatedAt'>,
	): Promise<StoredSavedReply | null> {
		const doc = await SavedReplyModel.findOneAndUpdate(
			{ _id: id },
			{ $set: { ...change, updatedAt: new Date(change.updatedAt) } },
			{ new: true },
		)
			.lean<SavedReplyDoc>()
			.exec();
		return doc ? toSavedReply(doc) : null;
	}

	async delete(id: string): Promise<boolean> {
		const result = await SavedReplyModel.deleteOne({ _id: id }).exec();
		return result.deletedCount > 0;
	}
}
