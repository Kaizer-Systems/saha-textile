import { randomUUID } from 'node:crypto';

import {
	BadRequestException,
	ConflictException,
	ForbiddenException,
	HttpException,
	Inject,
	Injectable,
	NotFoundException,
	PayloadTooLargeException,
	PreconditionFailedException,
} from '@nestjs/common';
import {
	MAX_ALL_MAILBOX_THREADS,
	MAX_BULK_MATCHES,
	MAX_FORWARD_BYTES,
	MAX_SEND_ATTACHMENT_BYTES,
	UNDO_SEND_SECONDS,
	type InboxAllQuery,
	type InboxAllThreads,
	type InboxBinSummary,
	type InboxBulkRequest,
	type InboxBulkResult,
	type InboxDraft,
	type InboxDraftPage,
	type InboxDraftSaved,
	type InboxDraftWrite,
	type InboxOutboxStatus,
	type InboxSendQueued,
	type InboxEmptyBinResult,
	type InboxLabel,
	type InboxLabelWrite,
	type InboxListQuery,
	type InboxMarkMessagesRequest,
	type InboxMessage,
	type InboxMailboxSummary,
	type InboxModifyRequest,
	type InboxSendRequest,
	type InboxThread,
	type InboxThreadPage,
	type Mailbox,
	type MailboxRight,
} from '@saha-textile/contracts';
import {
	type MailboxAccessRepository,
	type MailboxCredentials,
	type MailboxOutboxRepository,
	type OutboxItem,
	type OutgoingMail,
	type MailboxPort,
	type MailboxRepository,
	type MailboxTokenStore,
	ACTION_RIGHT,
	type MailboxFeature,
	deletableForever,
	labelChange,
	mailboxRights,
} from '@saha-textile/core-domain';

import {
	MAILBOX_ACCESS_REPOSITORY,
	MAILBOX_OUTBOX_REPOSITORY,
	MAILBOX_PORT,
	MAILBOX_REPOSITORY,
	MAILBOX_TOKEN_STORE,
} from '../infra/tokens';
import { MESSAGE_SENT, MailboxBookkeeping, needsReconnect, type SentFromAdmin } from './mailbox-support';

/** The audit action for archive, move, spam, star, important, labels and the Bin. */
export const CONVERSATION_CHANGED = 'mailbox.conversation_changed';

/** A row still `sending` this long after it was taken was interrupted; Gmail is asked what happened. */
export const OUTBOX_STALE_MS = 2 * 60 * 1000;

/** A send whose draft vanished and which Sent does not show after this long is called gone. */
export const OUTBOX_GONE_AFTER_MS = 60 * 1000;

/** "Last checked" is written at most this often per mailbox, however many people have it open. */
export const SYNC_WRITE_MS = 5 * 60 * 1000;

/** How the quote above an answered message reads: "On 9 Nov 2026, 23:45, Priya Banerjee wrote:". */
const QUOTE_DATE = new Intl.DateTimeFormat('en-GB', {
	day: 'numeric',
	month: 'short',
	year: 'numeric',
	hour: '2-digit',
	minute: '2-digit',
	timeZone: 'Asia/Kolkata',
});

const nameOf = (from: string): string =>
	from
		.replace(/<[^>]*>/, '')
		.replace(/"/g, '')
		.trim() || from.replace(/[<>]/g, '').trim();

export const attribution = (message: InboxMessage): string =>
	`On ${QUOTE_DATE.format(new Date(message.date))}, ${nameOf(message.from)} wrote:`;

/** The oldest of some dates, for asking the audit trail about everything since then. */
const oldest = (dates: readonly string[]): string | null =>
	dates.reduce<string | null>((first, date) => (first === null || date < first ? date : first), null);

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
		@Inject(MAILBOX_OUTBOX_REPOSITORY) private readonly outbox: MailboxOutboxRepository,
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
				const rights = [...mailboxRights([row], adminUserId, mailbox.id)];
				const canSend = rights.includes('send');
				const base = {
					mailboxId: mailbox.id,
					address: mailbox.address,
					rights,
					canSend,
					sendAs: canSend ? mailbox.sendAs : [],
				};
				if (mailbox.status !== 'connected') return { ...base, status: mailbox.status, unread: null };
				try {
					const opened = await this.credentials(mailbox);
					const unread = await this.books.guard(mailbox, () => this.gmail.unreadCount(opened.credentials));
					const now = Date.now();
					const last = mailbox.lastSyncAt ? Date.parse(mailbox.lastSyncAt) : 0;
					if (now - last >= SYNC_WRITE_MS) {
						await this.mailboxes.save({ ...mailbox, lastSyncAt: new Date(now).toISOString() });
					}
					return { ...base, status: 'connected', unread };
				} catch (error) {
					// One unreachable mailbox must not hide the others: its count is unknown (not 0) and,
					// when Google withdrew access, it says it needs reconnecting.
					const status = error instanceof ConflictException ? 'needs_reconnect' : mailbox.status;
					return { ...base, status, unread: null };
				}
			}),
		);
		return summaries
			.filter((summary): summary is InboxMailboxSummary => summary !== null)
			.sort((a, b) => a.address.localeCompare(b.address));
	}

	/** One page of a folder, each line naming the admin user who sent its newest reply from here. */
	/**
	 * All mailboxes (F1): the first page of one folder from every mailbox this person may read,
	 * merged newest first. Each mailbox goes through the same access check as opening it alone;
	 * one that cannot be read is reported, and the others still show.
	 */
	async allThreads(adminUserId: string, query: InboxAllQuery): Promise<InboxAllThreads> {
		const rows = await this.access.listForAdminUser(adminUserId);
		const readable = rows.filter((row) => mailboxRights([row], adminUserId, row.mailboxId).has('read'));
		const results = await Promise.all(
			readable.map(async (row) => {
				const mailbox = await this.mailboxes.findById(row.mailboxId);
				if (!mailbox) return null;
				try {
					const page = await this.threads(adminUserId, mailbox.id, { folder: query.folder });
					return { ok: true as const, mailbox, threads: page.threads };
				} catch (error) {
					const reason: 'reconnect' | 'gmail_error' =
						error instanceof ConflictException ? 'reconnect' : 'gmail_error';
					return { ok: false as const, mailbox, reason };
				}
			}),
		);
		const threads: InboxAllThreads['threads'] = [];
		const skipped: InboxAllThreads['skipped'] = [];
		for (const result of results) {
			if (!result) continue;
			if (!result.ok) {
				skipped.push({ mailboxId: result.mailbox.id, address: result.mailbox.address, reason: result.reason });
				continue;
			}
			for (const thread of result.threads) {
				threads.push({ ...thread, mailboxId: result.mailbox.id, mailboxAddress: result.mailbox.address });
			}
		}
		threads.sort((a, b) => b.date.localeCompare(a.date));
		return { threads: threads.slice(0, MAX_ALL_MAILBOX_THREADS), skipped };
	}

	async threads(adminUserId: string, mailboxId: string, query: InboxListQuery): Promise<InboxThreadPage> {
		const { mailbox, credentials } = await this.open(adminUserId, mailboxId, 'read');
		const page = await this.books.guard(mailbox, () =>
			this.gmail.listThreads(credentials, query.folder, query.q, query.pageToken, query.label),
		);
		const since = oldest(page.threads.map((thread) => thread.date));
		if (!since) return page;
		const sent = await this.sentSince(mailboxId, since);
		return {
			...page,
			threads: page.threads.map((thread) => ({
				...thread,
				lastReplyBy: sent.find((entry) => entry.threadId === thread.id)?.sentBy ?? null,
			})),
		};
	}

	/** A whole conversation; messages sent from the admin name the admin user who sent them. */
	async thread(adminUserId: string, mailboxId: string, threadId: string): Promise<InboxThread> {
		const { mailbox, credentials } = await this.open(adminUserId, mailboxId, 'read');
		return this.namedThread(mailbox, credentials, threadId);
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

	/**
	 * Sends from the mailbox's own address or one of its verified aliases, with that address's
	 * signature. A reply carries the conversation's whole References chain and, when asked, quotes
	 * the answered message as Gmail itself reads it (never text from the browser). A forward can
	 * carry the original attachments, copied from Gmail on the server.
	 */
	/**
	 * Checks rights, the From address, sizes and (for a send) the C5 reply check, and builds the
	 * message. A draft is saved as the writer's own text only: the signature, the quote and a
	 * forward's files are added when it is sent, so a reopened draft holds just what was typed.
	 */
	private async prepare(
		adminUserId: string,
		mailboxId: string,
		request: InboxSendRequest,
		purpose: 'send' | 'draft' = 'send',
	): Promise<Opened & { from: Mailbox['sendAs'][number]; outgoing: OutgoingMail }> {
		const { mailbox, credentials } = await this.open(adminUserId, mailboxId, 'send');
		const from = mailbox.sendAs.find((entry) => entry.address === request.from.toLowerCase());
		if (!from) throw new BadRequestException({ code: 'from_not_allowed' });
		const attachments: { filename: string; mimeType: string; data: Uint8Array }[] = request.attachments.map(
			(file) => ({
				filename: file.filename,
				mimeType: file.mimeType,
				data: new Uint8Array(Buffer.from(file.data, 'base64')),
			}),
		);
		const uploaded = attachments.reduce((sum, file) => sum + file.data.length, 0);
		if (uploaded > MAX_SEND_ATTACHMENT_BYTES) throw new PayloadTooLargeException({ code: 'attachments_too_large' });

		const conversation = request.threadId
			? await this.books.guard(mailbox, () => this.gmail.getThread(credentials, request.threadId ?? ''))
			: null;
		if (request.threadId && !conversation) throw new NotFoundException('Conversation not found');
		// Someone replied after the writer last looked (C5): checked here at the moment of sending,
		// not only in the browser, so two people cannot both answer without knowing.
		if (purpose === 'send' && conversation && request.knownMessageIds && !request.sendAnyway) {
			const seen = new Set(request.knownMessageIds);
			if (conversation.messages.some((message) => !seen.has(message.id))) {
				throw new PreconditionFailedException({ code: 'conversation_moved_on' });
			}
		}
		const answered = conversation?.messages.find((message) => message.messageId === request.inReplyTo);
		const quoted = conversation?.messages.find((message) => message.id === request.quoteMessageId);

		if (purpose === 'send' && request.forwardAttachmentsFrom) {
			const source = request.forwardAttachmentsFrom;
			const original = await this.books.guard(mailbox, () => this.gmail.getThread(credentials, source.threadId));
			const message = original?.messages.find((entry) => entry.id === source.messageId);
			if (!message) throw new NotFoundException('Message not found');
			for (const file of message.attachments) {
				const copy = await this.books.guard(mailbox, () =>
					this.gmail.getAttachment(credentials, message.id, file.id),
				);
				if (!copy) throw new NotFoundException('Attachment not found');
				attachments.push({ filename: file.filename, mimeType: file.mimeType, data: copy.data });
			}
			const total = attachments.reduce((sum, file) => sum + file.data.length, 0);
			if (total > MAX_FORWARD_BYTES) throw new PayloadTooLargeException({ code: 'attachments_too_large' });
		}

		const outgoing: OutgoingMail = {
			from: from.address,
			fromName: from.displayName,
			to: request.to,
			cc: request.cc,
			bcc: request.bcc,
			subject: request.subject,
			text: request.body,
			html: request.html,
			signatureHtml: purpose === 'send' ? from.signature : '',
			threadId: request.threadId,
			inReplyTo: request.inReplyTo,
			references: answered?.references,
			quote:
				purpose === 'send' && quoted
					? { attribution: attribution(quoted), html: quoted.html + quoted.quoteHtml, text: quoted.text }
					: undefined,
			attachments,
			draftHints:
				purpose === 'draft'
					? { quoteMessageId: request.quoteMessageId, forwardFrom: request.forwardAttachmentsFrom }
					: undefined,
		};
		return { mailbox, credentials, from, outgoing };
	}

	/**
	 * Sends at once, for callers that need Gmail's answer straight away (purchase orders). The
	 * Inbox uses `queueSend`, which waits for Undo.
	 */
	async send(
		adminUserId: string,
		mailboxId: string,
		request: InboxSendRequest,
	): Promise<{ id: string; threadId: string }> {
		const { mailbox, credentials, from, outgoing } = await this.prepare(adminUserId, mailboxId, request);
		let sent: { id: string; threadId: string };
		try {
			sent = await this.books.guard(mailbox, () => this.gmail.send(credentials, outgoing));
		} catch (error) {
			await this.forgetRemovedAlias(mailbox, credentials, from.address, error);
			throw error;
		}
		await this.recordSent(adminUserId, mailboxId, from.address, request, sent);
		return sent;
	}

	/**
	 * Undo Send (C4, owner: 10 seconds). The finished message is saved as a Gmail draft (the one it
	 * was written in, when there is one) and an outbox row says when to send it. The dispatcher
	 * sends it then; Undo before that leaves it in Drafts. Nothing is sent from here.
	 */
	async queueSend(adminUserId: string, mailboxId: string, request: InboxSendRequest): Promise<InboxSendQueued> {
		if (request.draftId && (await this.outbox.findActiveForDraft(mailboxId, request.draftId))) {
			throw new ConflictException({ code: 'already_sending' });
		}
		const { mailbox, credentials, from, outgoing } = await this.prepare(adminUserId, mailboxId, request);
		const messageId = `outbox-${randomUUID()}@${from.address.split('@')[1] ?? 'mail.invalid'}`;
		const mail: OutgoingMail = { ...outgoing, messageId };
		const draftId = request.draftId;
		let draft: { draftId: string; threadId: string | null };
		try {
			draft = await this.books.guard(mailbox, async () => {
				if (draftId) {
					const updated = await this.gmail.updateDraft(
						credentials,
						draftId,
						mail,
						request.keepDraftAttachments,
					);
					if (updated) return updated;
					// Deleted or sent elsewhere: its saved files went with it, so never send without them.
					if (request.keepDraftAttachments) throw new NotFoundException({ code: 'draft_gone' });
				}
				return this.gmail.createDraft(credentials, mail);
			});
		} catch (error) {
			await this.forgetRemovedAlias(mailbox, credentials, from.address, error);
			throw error;
		}
		const now = new Date();
		const item = await this.outbox.create({
			id: `obx_${randomUUID()}`,
			mailboxId,
			draftId: draft.draftId,
			adminUserId,
			messageId,
			sendAt: new Date(now.getTime() + UNDO_SEND_SECONDS * 1000).toISOString(),
			status: 'queued',
			attempts: 0,
			createdAt: now.toISOString(),
			claimedAt: null,
			sentMessageId: null,
			threadId: draft.threadId,
			meta: {
				from: from.address,
				recipients: request.to.length + request.cc.length + request.bcc.length,
				reply: Boolean(request.threadId),
			},
		});
		return { outboxId: item.id, draftId: item.draftId, sendAt: item.sendAt };
	}

	/** Undo: stops a queued message; it stays in Drafts. 409 once it is on its way. Writer only. */
	async cancelSend(adminUserId: string, mailboxId: string, outboxId: string): Promise<{ draftId: string }> {
		await this.ownOutboxItem(adminUserId, mailboxId, outboxId);
		const cancelled = await this.outbox.cancel(outboxId);
		if (!cancelled) throw new ConflictException({ code: 'already_sent' });
		await this.books.record(adminUserId, 'mailbox.send_undone', mailboxId, { outboxId });
		return { draftId: cancelled.draftId };
	}

	/** What became of a queued message, for the "Sent" or "Not sent" note after the countdown. */
	async outboxStatus(adminUserId: string, mailboxId: string, outboxId: string): Promise<InboxOutboxStatus> {
		const item = await this.ownOutboxItem(adminUserId, mailboxId, outboxId);
		return {
			outboxId: item.id,
			status: item.status,
			draftId: item.draftId,
			threadId: item.threadId,
			sentMessageId: item.sentMessageId,
		};
	}

	/** A queued message is seen and undone only by the person who sent it, while they may still send. */
	private async ownOutboxItem(adminUserId: string, mailboxId: string, outboxId: string): Promise<OutboxItem> {
		await this.requireRight(adminUserId, mailboxId, 'send');
		const item = await this.outbox.findById(outboxId);
		if (!item || item.mailboxId !== mailboxId || item.adminUserId !== adminUserId) {
			throw new NotFoundException('Message not found');
		}
		return item;
	}

	/**
	 * Sends what is due (every couple of seconds, from the dispatcher). Each row is claimed
	 * atomically first, so it is sent once even with several API instances. A result that may have
	 * been lost is never sent again blindly: Gmail is asked first whether it went.
	 */
	async dispatchDue(now = new Date()): Promise<number> {
		let sent = 0;
		for (const item of await this.outbox.claimDue(now.toISOString(), 20)) {
			if (await this.deliver(item)) sent += 1;
		}
		// A sender that stopped part way (the API restarted): what happened is looked up, not guessed.
		for (const item of await this.outbox.listByStatus('sending', 50)) {
			const claimed = Date.parse(item.claimedAt ?? item.sendAt);
			if (now.getTime() - claimed > OUTBOX_STALE_MS) await this.outbox.setStatus(item.id, 'uncertain');
		}
		for (const item of await this.outbox.listByStatus('uncertain', 20)) await this.reconcile(item, now);
		return sent;
	}

	private async deliver(item: OutboxItem): Promise<boolean> {
		let opened: Opened;
		try {
			// Rights are read again at the moment of sending: someone removed meanwhile sends nothing.
			await this.requireRight(item.adminUserId, item.mailboxId, 'send');
			opened = await this.credentialsFor(item.mailboxId);
		} catch {
			await this.outbox.setStatus(item.id, 'failed');
			return false;
		}
		try {
			const result = await this.books.guard(opened.mailbox, () =>
				this.gmail.sendDraft(opened.credentials, item.draftId),
			);
			if (!result) {
				// The draft is gone: sent already, or deleted in Gmail. Looked up on the next round.
				await this.outbox.setStatus(item.id, 'uncertain');
				return false;
			}
			await this.outbox.markSent(item.id, result);
			await this.recordQueuedSent(item, result);
			return true;
		} catch (error) {
			const status = error instanceof HttpException ? error.getStatus() : 502;
			// Busy: Gmail refused before sending, so trying again is safe (three times at most).
			if (status === 429) await this.outbox.setStatus(item.id, item.attempts >= 2 ? 'failed' : 'queued', 1);
			// No answer: it may have gone. Checked in Sent before anything is tried again.
			else if (status >= 500) await this.outbox.setStatus(item.id, 'uncertain', 1);
			else await this.outbox.setStatus(item.id, 'failed', 1);
			return false;
		}
	}

	/**
	 * An uncertain send: found in Sent means it went. A draft still there means Gmail never sent
	 * it, so it is queued again (three tries in all). Neither, for a minute, means it is gone.
	 */
	private async reconcile(item: OutboxItem, now: Date): Promise<void> {
		try {
			const { mailbox, credentials } = await this.credentialsFor(item.mailboxId);
			const found = await this.books.guard(mailbox, () =>
				this.gmail.findByMessageId(credentials, item.messageId),
			);
			if (found) {
				await this.outbox.markSent(item.id, found);
				await this.recordQueuedSent(item, found);
				return;
			}
			const draft = await this.books.guard(mailbox, () => this.gmail.getDraft(credentials, item.draftId));
			if (draft) {
				await this.outbox.setStatus(item.id, item.attempts >= 3 ? 'failed' : 'queued');
				return;
			}
			// Gmail's search can lag a few seconds behind a send, so "gone" waits a minute.
			if (now.getTime() - Date.parse(item.claimedAt ?? item.sendAt) > OUTBOX_GONE_AFTER_MS) {
				await this.outbox.setStatus(item.id, 'gone');
			}
		} catch {
			// Gmail is not answering: it stays uncertain and is looked at again on the next round.
		}
	}

	private async credentialsFor(mailboxId: string): Promise<Opened> {
		const mailbox = await this.mailboxes.findById(mailboxId);
		if (!mailbox) throw new NotFoundException('Mailbox not found');
		if (mailbox.status !== 'connected') throw needsReconnect(mailbox.address);
		return this.credentials(mailbox);
	}

	private recordQueuedSent(item: OutboxItem, sent: { id: string; threadId: string }): Promise<void> {
		return this.books.record(item.adminUserId, MESSAGE_SENT, item.mailboxId, {
			...item.meta,
			gmailMessageId: sent.id,
			threadId: sent.threadId,
			undoable: true,
		});
	}

	private recordSent(
		adminUserId: string,
		mailboxId: string,
		from: string,
		request: InboxSendRequest,
		sent: { id: string; threadId: string },
	): Promise<void> {
		return this.books.record(adminUserId, MESSAGE_SENT, mailboxId, {
			from,
			recipients: request.to.length + request.cc.length + request.bcc.length,
			reply: Boolean(request.threadId),
			gmailMessageId: sent.id,
			threadId: sent.threadId,
		});
	}

	// ── Drafts (C2): kept in Gmail, so they follow the mailbox to any device and to Gmail itself ──

	/** The mailbox's drafts, newest first, a page at a time. */
	async listDrafts(adminUserId: string, mailboxId: string, pageToken?: string): Promise<InboxDraftPage> {
		const { mailbox, credentials } = await this.open(adminUserId, mailboxId, 'send');
		return this.books.guard(mailbox, () => this.gmail.listDrafts(credentials, pageToken));
	}

	async getDraft(adminUserId: string, mailboxId: string, draftId: string): Promise<InboxDraft> {
		const { mailbox, credentials } = await this.open(adminUserId, mailboxId, 'send');
		const draft = await this.books.guard(mailbox, () => this.gmail.getDraft(credentials, draftId));
		if (!draft) throw new NotFoundException('Draft not found');
		return draft;
	}

	/**
	 * Saves the compose box to Gmail: a new draft, or an update of `draftId`. An update names the
	 * version the writer last saw; when someone saved since, 412 `draft_changed` lets them choose.
	 */
	async saveDraft(
		adminUserId: string,
		mailboxId: string,
		draftId: string | null,
		write: InboxDraftWrite,
	): Promise<InboxDraftSaved> {
		if (draftId && (await this.outbox.findActiveForDraft(mailboxId, draftId))) {
			throw new ConflictException({ code: 'already_sending' });
		}
		const request: InboxSendRequest = {
			...write,
			knownMessageIds: undefined,
			sendAnyway: true,
			draftId: undefined,
			keepDraftAttachments: false,
		};
		const { mailbox, credentials, outgoing } = await this.prepare(adminUserId, mailboxId, request, 'draft');
		const saved = await this.books.guard(mailbox, async () => {
			if (!draftId) return this.gmail.createDraft(credentials, outgoing);
			const current = await this.gmail.getDraft(credentials, draftId);
			if (!current) throw new NotFoundException({ code: 'draft_gone' });
			if (write.version && current.version !== write.version) {
				throw new PreconditionFailedException({ code: 'draft_changed' });
			}
			const updated = await this.gmail.updateDraft(credentials, draftId, outgoing, write.keepAttachments);
			if (!updated) throw new NotFoundException({ code: 'draft_gone' });
			return updated;
		});
		return { draftId: saved.draftId, version: saved.version, savedAt: new Date().toISOString() };
	}

	/** Discard: deletes the Gmail draft. A draft on its way out (Undo running) is left alone. */
	async deleteDraft(adminUserId: string, mailboxId: string, draftId: string): Promise<void> {
		if (await this.outbox.findActiveForDraft(mailboxId, draftId)) {
			throw new ConflictException({ code: 'already_sending' });
		}
		const { mailbox, credentials } = await this.open(adminUserId, mailboxId, 'send');
		await this.books.guard(mailbox, () => this.gmail.deleteDraft(credentials, draftId));
		await this.books.record(adminUserId, 'mailbox.draft_deleted', mailboxId, { draftId });
	}

	async modify(adminUserId: string, mailboxId: string, threadId: string, request: InboxModifyRequest): Promise<void> {
		const { mailbox, credentials } = await this.open(adminUserId, mailboxId, ACTION_RIGHT[request.action]);
		await this.books.guard(mailbox, () => this.change(credentials, threadId, request.action, request.labelId));
		if (!['mark_read', 'mark_unread'].includes(request.action)) {
			await this.books.record(adminUserId, CONVERSATION_CHANGED, mailboxId, {
				action: request.action,
				threads: 1,
				labelId: request.labelId ?? null,
			});
		}
	}

	/**
	 * Marks exactly these messages read or unread (R6): opening a conversation marks only the
	 * messages shown, never a reply that arrived afterwards and has not been seen.
	 */
	async markMessages(adminUserId: string, mailboxId: string, request: InboxMarkMessagesRequest): Promise<void> {
		const { mailbox, credentials } = await this.open(adminUserId, mailboxId, 'read');
		await this.books.guard(mailbox, () =>
			this.gmail.modifyMessages(
				credentials,
				request.messageIds,
				request.read ? { add: [], remove: ['UNREAD'] } : { add: ['UNREAD'], remove: [] },
			),
		);
	}

	/** The mailbox's own labels and the categories it uses, read live from Gmail. */
	async labels(adminUserId: string, mailboxId: string): Promise<InboxLabel[]> {
		const { mailbox, credentials } = await this.open(adminUserId, mailboxId, 'read');
		return this.books.guard(mailbox, () => this.gmail.listLabels(credentials));
	}

	async createLabel(adminUserId: string, mailboxId: string, write: InboxLabelWrite): Promise<InboxLabel> {
		const { mailbox, credentials } = await this.open(adminUserId, mailboxId, 'labels');
		const label = await this.books.guard(mailbox, () => this.gmail.createLabel(credentials, write.name));
		await this.books.record(adminUserId, 'mailbox.label_created', mailboxId, { labelId: label.id });
		return label;
	}

	async renameLabel(
		adminUserId: string,
		mailboxId: string,
		labelId: string,
		write: InboxLabelWrite,
	): Promise<InboxLabel> {
		const { mailbox, credentials } = await this.open(adminUserId, mailboxId, 'labels');
		const label = await this.books.guard(mailbox, () => this.gmail.renameLabel(credentials, labelId, write.name));
		if (!label) throw new NotFoundException('Label not found');
		await this.books.record(adminUserId, 'mailbox.label_renamed', mailboxId, { labelId });
		return label;
	}

	/** Deletes the label only: every conversation it was on keeps its mail and other labels. */
	async deleteLabel(adminUserId: string, mailboxId: string, labelId: string): Promise<void> {
		const { mailbox, credentials } = await this.open(adminUserId, mailboxId, 'labels');
		await this.books.guard(mailbox, () => this.gmail.deleteLabel(credentials, labelId));
		await this.books.record(adminUserId, 'mailbox.label_deleted', mailboxId, { labelId });
	}

	/**
	 * One action on the chosen conversations, or on every conversation that matches, each reported
	 * as done or failed. Deleting for good touches only what Gmail says is in the Bin at that moment,
	 * whatever the request names: a conversation partly in the Bin keeps its other messages.
	 */
	async bulk(adminUserId: string, mailboxId: string, request: InboxBulkRequest): Promise<InboxBulkResult> {
		const forever = request.action === 'delete_forever';
		const { mailbox, credentials } = await this.open(
			adminUserId,
			mailboxId,
			forever
				? 'delete_forever'
				: ACTION_RIGHT[request.action as Exclude<typeof request.action, 'delete_forever'>],
		);
		if (forever) this.requireFeature(mailbox, 'delete_forever');
		const { ids, truncated } = request.threadIds
			? { ids: request.threadIds, truncated: false }
			: await this.matchingIds(mailbox, credentials, request.matching ?? { folder: 'inbox' });
		const result: InboxBulkResult = { done: [], failed: [], partlyKept: [], truncated };
		await Promise.all(
			ids.map(async (threadId) => {
				try {
					await this.books.guard(mailbox, async () => {
						if (!forever) {
							await this.change(
								credentials,
								threadId,
								request.action as Exclude<typeof request.action, 'delete_forever'>,
								request.labelId,
							);
							result.done.push(threadId);
							return;
						}
						const messages = await this.gmail.threadMessageLabels(credentials, threadId);
						if (!messages) {
							result.failed.push({ threadId, reason: 'gone' });
							return;
						}
						const target = deletableForever(messages);
						if (!target.messageIds.length) {
							result.failed.push({ threadId, reason: 'not_in_bin' });
							return;
						}
						if (target.whole) await this.gmail.deleteThreadForever(credentials, threadId);
						else {
							await this.gmail.deleteMessagesForever(credentials, target.messageIds);
							result.partlyKept.push(threadId);
						}
						result.done.push(threadId);
					});
				} catch (error) {
					// A mailbox that lost its access stops the whole request; anything else fails one line.
					if (error instanceof ConflictException) throw error;
					result.failed.push({ threadId, reason: 'gmail_error' });
				}
			}),
		);
		await this.books.record(adminUserId, forever ? 'mailbox.deleted_forever' : CONVERSATION_CHANGED, mailboxId, {
			action: request.action,
			threads: ids.length,
			done: result.done.length,
			failed: result.failed.length,
			partlyKept: result.partlyKept.length,
			labelId: request.labelId ?? null,
			matching: Boolean(request.matching),
		});
		return result;
	}

	/** What Empty Bin would delete, counted by Gmail now, for the confirmation. */
	async binSummary(adminUserId: string, mailboxId: string): Promise<InboxBinSummary> {
		const { mailbox, credentials } = await this.open(adminUserId, mailboxId, 'delete_forever');
		return this.books.guard(mailbox, () => this.gmail.binCount(credentials));
	}

	/**
	 * Deletes everything in the Bin for good, a page of message ids at a time. When Gmail stops
	 * answering part way, what was deleted stays deleted and the answer says it is incomplete.
	 */
	async emptyBin(adminUserId: string, mailboxId: string): Promise<InboxEmptyBinResult> {
		const { mailbox, credentials } = await this.open(adminUserId, mailboxId, 'delete_forever');
		this.requireFeature(mailbox, 'delete_forever');
		let deletedMessages = 0;
		let incomplete = false;
		try {
			for (;;) {
				// Always the first page: what was just deleted is no longer listed.
				const page = await this.books.guard(mailbox, () =>
					this.gmail.listBinMessageIds(credentials, undefined),
				);
				if (!page.ids.length) break;
				await this.books.guard(mailbox, () => this.gmail.deleteMessagesForever(credentials, page.ids));
				deletedMessages += page.ids.length;
			}
		} catch (error) {
			if (error instanceof ConflictException) throw error;
			incomplete = true;
		}
		await this.books.record(adminUserId, 'mailbox.bin_emptied', mailboxId, { deletedMessages, incomplete });
		return { deletedMessages, incomplete };
	}

	private change(
		credentials: MailboxCredentials,
		threadId: string,
		action: Exclude<InboxBulkRequest['action'], 'delete_forever'>,
		labelId: string | undefined,
	): Promise<void> {
		return action === 'trash' || action === 'untrash'
			? this.gmail.trashThread(credentials, threadId, action === 'untrash')
			: this.gmail.modifyThread(credentials, threadId, labelChange(action, labelId));
	}

	/** Conversation ids matching a folder, label and search, read now, up to the safety limit. */
	private async matchingIds(
		mailbox: Mailbox,
		credentials: MailboxCredentials,
		matching: NonNullable<InboxBulkRequest['matching']>,
	): Promise<{ ids: string[]; truncated: boolean }> {
		const ids: string[] = [];
		let pageToken: string | undefined;
		do {
			const page = await this.books.guard(mailbox, () =>
				this.gmail.listThreadIds(
					credentials,
					{ folder: matching.folder, label: matching.label, query: matching.q },
					pageToken,
				),
			);
			ids.push(...page.ids);
			pageToken = page.nextPageToken ?? undefined;
		} while (pageToken && ids.length < MAX_BULK_MATCHES);
		return { ids: ids.slice(0, MAX_BULK_MATCHES), truncated: Boolean(pageToken) || ids.length > MAX_BULK_MATCHES };
	}

	/** A feature Google has not been given permission for answers 409 with what to reconnect for. */
	private requireFeature(mailbox: Mailbox, feature: MailboxFeature): void {
		if (this.gmail.featuresMissing(mailbox.grantedScopes).includes(feature)) {
			throw new ConflictException({ code: 'mailbox_reconnect_for_feature', feature });
		}
	}

	private async namedThread(
		mailbox: Mailbox,
		credentials: MailboxCredentials,
		threadId: string,
	): Promise<InboxThread> {
		const thread = await this.books.guard(mailbox, () => this.gmail.getThread(credentials, threadId));
		if (!thread) throw new NotFoundException('Conversation not found');
		const since = oldest(thread.messages.map((message) => message.date));
		if (!since) return thread;
		const sent = await this.sentSince(mailbox.id, since);
		return {
			...thread,
			messages: thread.messages.map((message) => ({
				...message,
				sentBy: sent.find((entry) => entry.gmailMessageId === message.id)?.sentBy ?? null,
			})),
		};
	}

	/** Sends since a little before `since`: Gmail's date and our audit time differ by seconds. */
	private sentSince(mailboxId: string, since: string): Promise<SentFromAdmin[]> {
		return this.books.sentFromAdmin(mailboxId, new Date(Date.parse(since) - 60_000).toISOString());
	}

	/**
	 * Gmail refused a send. When the From address was an alias that has since been removed in
	 * Gmail, the mailbox's list is read again so the admin stops offering it.
	 */
	private async forgetRemovedAlias(
		mailbox: Mailbox,
		credentials: MailboxCredentials,
		address: string,
		error: unknown,
	): Promise<void> {
		if (!(error instanceof HttpException) || error.getStatus() !== 502) return;
		const sendAs = await this.gmail.listSendAs(credentials).catch(() => null);
		if (!sendAs || sendAs.some((entry) => entry.address === address)) return;
		await this.mailboxes.save({ ...mailbox, sendAs });
		throw new BadRequestException({ code: 'from_not_allowed' });
	}

	/**
	 * The access check, then the mailbox's credentials. No access at all answers 404, so a
	 * mailbox's existence is not revealed; access without the needed right answers 403. Rights are
	 * read fresh on every call, so a removed right stops working on the next request.
	 */
	private async open(adminUserId: string, mailboxId: string, need: MailboxRight): Promise<Opened> {
		await this.requireRight(adminUserId, mailboxId, need);
		const mailbox = await this.mailboxes.findById(mailboxId);
		if (!mailbox) throw new NotFoundException('Mailbox not found');
		if (mailbox.status !== 'connected') throw needsReconnect(mailbox.address);
		return this.credentials(mailbox);
	}

	/** The access check alone, for calls that do not need Gmail (Undo, a queued message's state). */
	private async requireRight(adminUserId: string, mailboxId: string, need: MailboxRight): Promise<void> {
		const rights = mailboxRights(await this.access.listForAdminUser(adminUserId), adminUserId, mailboxId);
		if (!rights.size) throw new NotFoundException('Mailbox not found');
		if (!rights.has(need)) throw new ForbiddenException({ code: 'mailbox_right_missing', right: need });
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
