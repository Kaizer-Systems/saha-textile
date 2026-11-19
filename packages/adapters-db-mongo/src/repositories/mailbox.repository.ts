import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { ContactMessage, Mailbox, MailboxAccess, MailboxRight } from '@saha-textile/contracts';
import {
	legacyMailboxRights,
	withNeededRights,
	type ContactMessageRepository,
	type MailboxAccessRepository,
	type MailboxRepository,
	type MailboxTokenStore,
} from '@saha-textile/core-domain';

import {
	ContactMessageModel,
	MailboxAccessModel,
	MailboxModel,
	type ContactMessageDoc,
	type MailboxAccessDoc,
	type MailboxDoc,
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
