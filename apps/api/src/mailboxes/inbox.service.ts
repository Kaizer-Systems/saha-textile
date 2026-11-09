import {
	BadRequestException,
	ConflictException,
	ForbiddenException,
	Inject,
	Injectable,
	NotFoundException,
	PayloadTooLargeException,
} from '@nestjs/common';
import {
	MAX_SEND_ATTACHMENT_BYTES,
	type InboxListQuery,
	type InboxMailboxSummary,
	type InboxModifyRequest,
	type InboxSendRequest,
	type InboxThread,
	type InboxThreadPage,
	type Mailbox,
} from '@saha-textile/contracts';
import {
	type MailboxAccessRepository,
	type MailboxCredentials,
	type MailboxPort,
	type MailboxRepository,
	type MailboxRight,
	type MailboxTokenStore,
	labelChange,
	mailboxRight,
} from '@saha-textile/core-domain';

import { MAILBOX_ACCESS_REPOSITORY, MAILBOX_PORT, MAILBOX_REPOSITORY, MAILBOX_TOKEN_STORE } from '../infra/tokens';
import { MailboxBookkeeping, needsReconnect } from './mailbox-support';

/** What each inbox action needs: reading actions are open to readers, the rest to senders. */
const ACTION_RIGHT: Readonly<Record<InboxModifyRequest['action'], Exclude<MailboxRight, 'none'>>> = {
	mark_read: 'read',
	mark_unread: 'read',
	archive: 'send',
	move_to_inbox: 'send',
	trash: 'send',
	untrash: 'send',
};

interface Opened {
	mailbox: Mailbox;
	credentials: MailboxCredentials;
}

/**
 * The admin Inbox (`mailbox.use`). Every call first checks this admin user's own access to that
 * mailbox (object-level authorisation): the super admin manages mailboxes but reads one only when
 * given access like anyone else. Mail is read live from Gmail; nothing here stores it.
 */
@Injectable()
export class InboxService {
	constructor(
		@Inject(MAILBOX_PORT) private readonly gmail: MailboxPort,
		@Inject(MAILBOX_REPOSITORY) private readonly mailboxes: MailboxRepository,
		@Inject(MAILBOX_ACCESS_REPOSITORY) private readonly access: MailboxAccessRepository,
		@Inject(MAILBOX_TOKEN_STORE) private readonly tokens: MailboxTokenStore,
		private readonly books: MailboxBookkeeping,
	) {}

	/**
	 * The mailboxes this admin user may open, with unread counts read live. The Inbox asks again
	 * about once a minute while it is open: that is how new mail shows up without Gmail push.
	 */
	async summary(adminUserId: string): Promise<InboxMailboxSummary[]> {
		const rows = await this.access.listForAdminUser(adminUserId);
		const summaries = await Promise.all(
			rows.map(async (row): Promise<InboxMailboxSummary | null> => {
				const mailbox = await this.mailboxes.findById(row.mailboxId);
				if (!mailbox) return null;
				const base = {
					mailboxId: mailbox.id,
					address: mailbox.address,
					canSend: row.canSend,
					sendAs: row.canSend ? mailbox.sendAs : [],
				};
				if (mailbox.status !== 'connected') return { ...base, status: mailbox.status, unread: 0 };
				try {
					const opened = await this.credentials(mailbox);
					const unread = await this.books.guard(mailbox, () => this.gmail.unreadCount(opened.credentials));
					await this.mailboxes.save({ ...mailbox, lastSyncAt: new Date().toISOString() });
					return { ...base, status: 'connected', unread };
				} catch (error) {
					// One unreachable mailbox must not hide the others: it shows 0 and, when Google
					// withdrew access, that it needs reconnecting.
					const status = error instanceof ConflictException ? 'needs_reconnect' : mailbox.status;
					return { ...base, status, unread: 0 };
				}
			}),
		);
		return summaries
			.filter((summary): summary is InboxMailboxSummary => summary !== null)
			.sort((a, b) => a.address.localeCompare(b.address));
	}

	async threads(adminUserId: string, mailboxId: string, query: InboxListQuery): Promise<InboxThreadPage> {
		const { mailbox, credentials } = await this.open(adminUserId, mailboxId, 'read');
		return this.books.guard(mailbox, () =>
			this.gmail.listThreads(credentials, query.folder, query.q, query.pageToken),
		);
	}

	async thread(adminUserId: string, mailboxId: string, threadId: string): Promise<InboxThread> {
		const { mailbox, credentials } = await this.open(adminUserId, mailboxId, 'read');
		const thread = await this.books.guard(mailbox, () => this.gmail.getThread(credentials, threadId));
		if (!thread) throw new NotFoundException('Conversation not found');
		return thread;
	}

	async attachment(
		adminUserId: string,
		mailboxId: string,
		messageId: string,
		attachmentId: string,
	): Promise<Uint8Array> {
		const { mailbox, credentials } = await this.open(adminUserId, mailboxId, 'read');
		const file = await this.books.guard(mailbox, () =>
			this.gmail.getAttachment(credentials, messageId, attachmentId),
		);
		if (!file) throw new NotFoundException('Attachment not found');
		return file.data;
	}

	/** Sends from the mailbox's own address or one of its verified aliases, with that address's signature. */
	async send(
		adminUserId: string,
		mailboxId: string,
		request: InboxSendRequest,
	): Promise<{ id: string; threadId: string }> {
		const { mailbox, credentials } = await this.open(adminUserId, mailboxId, 'send');
		const from = mailbox.sendAs.find((entry) => entry.address === request.from.toLowerCase());
		if (!from) throw new BadRequestException({ code: 'from_not_allowed' });
		const attachments = request.attachments.map((file) => ({
			filename: file.filename,
			mimeType: file.mimeType,
			data: new Uint8Array(Buffer.from(file.data, 'base64')),
		}));
		const total = attachments.reduce((sum, file) => sum + file.data.length, 0);
		if (total > MAX_SEND_ATTACHMENT_BYTES) throw new PayloadTooLargeException({ code: 'attachments_too_large' });
		const sent = await this.books.guard(mailbox, () =>
			this.gmail.send(credentials, {
				from: from.address,
				fromName: from.displayName,
				to: request.to,
				cc: request.cc,
				subject: request.subject,
				text: request.body,
				signatureHtml: from.signature,
				threadId: request.threadId,
				inReplyTo: request.inReplyTo,
				attachments,
			}),
		);
		await this.books.record(adminUserId, 'mailbox.message_sent', mailboxId, {
			from: from.address,
			recipients: request.to.length + request.cc.length,
			reply: Boolean(request.threadId),
		});
		return sent;
	}

	async modify(adminUserId: string, mailboxId: string, threadId: string, request: InboxModifyRequest): Promise<void> {
		const { mailbox, credentials } = await this.open(adminUserId, mailboxId, ACTION_RIGHT[request.action]);
		await this.books.guard(mailbox, () =>
			request.action === 'trash' || request.action === 'untrash'
				? this.gmail.trashThread(credentials, threadId, request.action === 'untrash')
				: this.gmail.modifyThread(credentials, threadId, labelChange(request.action)),
		);
	}

	/**
	 * The access check, then the mailbox's credentials. No access at all answers 404, so a
	 * mailbox's existence is not revealed; read-only access answers 403 for sending.
	 */
	private async open(adminUserId: string, mailboxId: string, need: 'read' | 'send'): Promise<Opened> {
		const right = mailboxRight(await this.access.listForAdminUser(adminUserId), adminUserId, mailboxId);
		if (right === 'none') throw new NotFoundException('Mailbox not found');
		if (need === 'send' && right !== 'send') throw new ForbiddenException({ code: 'read_only_mailbox' });
		const mailbox = await this.mailboxes.findById(mailboxId);
		if (!mailbox) throw new NotFoundException('Mailbox not found');
		if (mailbox.status !== 'connected') throw needsReconnect(mailbox.address);
		return this.credentials(mailbox);
	}

	private async credentials(mailbox: Mailbox): Promise<Opened> {
		const refreshToken = await this.tokens.get(mailbox.id);
		if (!refreshToken) {
			await this.mailboxes.save({ ...mailbox, status: 'needs_reconnect' });
			throw needsReconnect(mailbox.address);
		}
		return { mailbox, credentials: { address: mailbox.address, refreshToken } };
	}
}
