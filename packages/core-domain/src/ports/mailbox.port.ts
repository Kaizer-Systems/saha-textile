import type {
	ContactMessage,
	InboxFolder,
	InboxDraft,
	InboxDraftPage,
	InboxLabel,
	InboxThread,
	InboxThreadPage,
	Mailbox,
	MailboxAccess,
	MailboxSendAs,
} from '@saha-textile/contracts';

/** A mailbox the API may act on: its address and a way to get a fresh access token. */
export interface MailboxCredentials {
	address: string;
	refreshToken: string;
}

/** What a sign-in returns once Google has said yes. */
export interface MailboxGrant {
	address: string;
	refreshToken: string;
	/** The permissions the provider granted, in its own names. */
	scopes: string[];
}

/** Optional features a mailbox needs an extra provider permission for. */
export type MailboxFeature = 'delete_forever' | 'settings';

/** A message ready to send: raw RFC 822, built by the adapter from the admin's form. */
export interface OutgoingMail {
	from: string;
	/** The send-as address's display name in Gmail; the bare address when absent. */
	fromName?: string;
	to: readonly string[];
	cc: readonly string[];
	/** Hidden copies; Gmail delivers them and leaves the header out of what others receive. */
	bcc?: readonly string[];
	subject: string;
	text: string;
	/** The writer's formatting (C1), as the compose box sent it; the adapter cleans it before use. */
	html?: string;
	signatureHtml: string;
	threadId?: string;
	inReplyTo?: string;
	/** The answered message's References header; the reply carries the whole chain on. */
	references?: string;
	/** The answered message, quoted below the reply as mail programs do. */
	quote?: { attribution: string; html: string; text: string };
	attachments: readonly { filename: string; mimeType: string; data: Uint8Array }[];
	/** Our own Message-ID, so a send whose result was lost can be found again in Sent. */
	messageId?: string;
	/**
	 * Only on a saved draft: what the compose box had chosen, so the draft reopens the same way.
	 * The signature, the quote and forwarded files are added when it is sent, not stored in it.
	 */
	draftHints?: { quoteMessageId?: string; forwardFrom?: { threadId: string; messageId: string } };
}

/** A saved Gmail draft: its id, its current version (message id) and conversation. */
export interface DraftRef {
	draftId: string;
	version: string;
	threadId: string | null;
}

/** A message placed straight into a mailbox, never sent over the internet. */
export interface ImportedMail {
	fromName: string;
	fromAddress: string;
	to: string;
	replyTo: string;
	subject: string;
	text: string;
}

/** Why a mailbox call failed, in words the API can act on. */
export class MailboxAccessRevoked extends Error {
	constructor(address: string) {
		super(`Google no longer allows access to ${address}`);
		this.name = 'MailboxAccessRevoked';
	}
}

/**
 * The one door to a mail service (`MailboxPort`). Gmail is the only engine (owner, 2026-11-08), but
 * nothing above this interface knows it: a Microsoft 365 adapter would be a new class and one DI
 * binding.
 */
export interface MailboxPort {
	/** Google's sign-in address for connecting a mailbox; `state` comes back on the callback. */
	signInUrl(state: string): string;
	/** Exchanges the callback code; refuses an address outside the shop's Workspace domain. */
	completeSignIn(code: string): Promise<MailboxGrant>;
	/**
	 * Withdraws the grant at Google, so the token stops working everywhere. Throws when Google did
	 * not confirm it, so the caller can say so and try again.
	 */
	revoke(credentials: MailboxCredentials): Promise<void>;
	/** Features a mailbox with these granted permissions cannot use until it is connected again. */
	featuresMissing(grantedScopes: readonly string[]): MailboxFeature[];
	/** One page of a folder, or of a label or category when `label` is given. */
	listThreads(
		credentials: MailboxCredentials,
		folder: InboxFolder,
		query: string | undefined,
		pageToken: string | undefined,
		label?: string,
	): Promise<InboxThreadPage>;
	/** Conversation ids only, a page at a time, for acting on "every conversation that matches". */
	listThreadIds(
		credentials: MailboxCredentials,
		place: { folder: InboxFolder; label?: string; query?: string },
		pageToken: string | undefined,
	): Promise<{ ids: string[]; nextPageToken: string | null }>;
	/** The labels people see in the mailbox's own list, and categories the mailbox uses. */
	listLabels(credentials: MailboxCredentials): Promise<InboxLabel[]>;
	createLabel(credentials: MailboxCredentials, name: string): Promise<InboxLabel>;
	renameLabel(credentials: MailboxCredentials, labelId: string, name: string): Promise<InboxLabel | null>;
	/** Removes the label from every message and deletes it; the mail itself stays. */
	deleteLabel(credentials: MailboxCredentials, labelId: string): Promise<void>;
	/** Conversations and messages in the Bin, counted by Gmail now. */
	binCount(credentials: MailboxCredentials): Promise<{ threads: number; messages: number }>;
	/** Each message of a conversation with its labels, or null when the conversation is gone. */
	threadMessageLabels(
		credentials: MailboxCredentials,
		threadId: string,
	): Promise<{ id: string; labelIds: string[] }[] | null>;
	/** Changes labels on exactly these messages, nothing else in their conversations. */
	modifyMessages(
		credentials: MailboxCredentials,
		messageIds: readonly string[],
		change: { add: readonly string[]; remove: readonly string[] },
	): Promise<void>;
	/** Deletes a whole conversation for good; the caller has checked it is all in the Bin. */
	deleteThreadForever(credentials: MailboxCredentials, threadId: string): Promise<void>;
	/** Deletes these messages for good (at most 1,000); the caller has checked they are in the Bin. */
	deleteMessagesForever(credentials: MailboxCredentials, messageIds: readonly string[]): Promise<void>;
	/** Saves a new draft in Gmail. */
	createDraft(credentials: MailboxCredentials, mail: OutgoingMail): Promise<DraftRef>;
	/** Replaces a draft's content; `keepAttachments` carries its current files over. Null when gone. */
	updateDraft(
		credentials: MailboxCredentials,
		draftId: string,
		mail: OutgoingMail,
		keepAttachments: boolean,
	): Promise<DraftRef | null>;
	getDraft(credentials: MailboxCredentials, draftId: string): Promise<InboxDraft | null>;
	listDrafts(credentials: MailboxCredentials, pageToken: string | undefined): Promise<InboxDraftPage>;
	deleteDraft(credentials: MailboxCredentials, draftId: string): Promise<void>;
	/** Sends a draft (Gmail removes it on success). Null when the draft no longer exists. */
	sendDraft(credentials: MailboxCredentials, draftId: string): Promise<{ id: string; threadId: string } | null>;
	/** A sent message found by the Message-ID we gave it, for reconciling an uncertain send. */
	findByMessageId(
		credentials: MailboxCredentials,
		messageId: string,
	): Promise<{ id: string; threadId: string } | null>;
	/** Message ids in the Bin, a page at a time, for Empty Bin. */
	listBinMessageIds(
		credentials: MailboxCredentials,
		pageToken: string | undefined,
	): Promise<{ ids: string[]; nextPageToken: string | null }>;
	getThread(credentials: MailboxCredentials, threadId: string): Promise<InboxThread | null>;
	getAttachment(
		credentials: MailboxCredentials,
		messageId: string,
		attachmentId: string,
	): Promise<{ data: Uint8Array } | null>;
	send(credentials: MailboxCredentials, mail: OutgoingMail): Promise<{ id: string; threadId: string }>;
	modifyThread(
		credentials: MailboxCredentials,
		threadId: string,
		change: { add: readonly string[]; remove: readonly string[] },
	): Promise<void>;
	trashThread(credentials: MailboxCredentials, threadId: string, restore: boolean): Promise<void>;
	/** Places a message in the Inbox, unread, with Gmail's normal scanning but never marked spam. */
	importMessage(credentials: MailboxCredentials, mail: ImportedMail): Promise<{ id: string }>;
	unreadCount(credentials: MailboxCredentials): Promise<number>;
	listSendAs(credentials: MailboxCredentials): Promise<MailboxSendAs[]>;
}

/** Mailboxes (`mailboxes`). The refresh token is not here: see `MailboxTokenStore`. */
export interface MailboxRepository {
	list(): Promise<Mailbox[]>;
	findById(id: string): Promise<Mailbox | null>;
	findByAddress(address: string): Promise<Mailbox | null>;
	save(mailbox: Mailbox): Promise<Mailbox>;
}

/** Who may open which mailbox (`mailboxAccess`). */
export interface MailboxAccessRepository {
	listForMailbox(mailboxId: string): Promise<MailboxAccess[]>;
	listForAdminUser(adminUserId: string): Promise<MailboxAccess[]>;
	/** How many times the mailbox's list was saved; 0 before the first save. */
	version(mailboxId: string): Promise<number>;
	/**
	 * Replaces the whole list for one mailbox, only if it is still at `expectedVersion`. Returns the
	 * new version, or null when someone else saved first (nothing is written then).
	 */
	replaceForMailbox(
		mailboxId: string,
		entries: readonly MailboxAccess[],
		expectedVersion: number,
	): Promise<number | null>;
}

/**
 * Refresh tokens, encrypted at rest with a key held only in server settings. The plain token
 * exists only in memory for the length of one call.
 */
export interface MailboxTokenStore {
	put(mailboxId: string, refreshToken: string): Promise<void>;
	get(mailboxId: string): Promise<string | null>;
	remove(mailboxId: string): Promise<void>;
}

/** Contact Us messages (`contactMessages`), deleted by the database 12 months after arrival. */
export interface ContactMessageRepository {
	save(message: ContactMessage): Promise<ContactMessage>;
	findById(id: string): Promise<ContactMessage | null>;
	/** A message with the same content hash since `since`, to skip a repeat. */
	findRecentByHash(contentHash: string, since: string): Promise<ContactMessage | null>;
	/** Queued or failed messages due another delivery attempt, oldest first. */
	listPending(limit: number): Promise<ContactMessage[]>;
}

/** A saved reply as stored (C3): shared ones carry a mailbox, personal ones an owner. */
export interface StoredSavedReply {
	id: string;
	scope: 'shared' | 'personal';
	mailboxId: string | null;
	ownerAdminUserId: string | null;
	title: string;
	body: string;
	createdBy: string;
	updatedBy: string;
	createdAt: string;
	updatedAt: string;
}

/** Saved replies (`savedReplies`). Content typed by staff; never mail content. */
export interface SavedReplyRepository {
	listShared(mailboxId: string): Promise<StoredSavedReply[]>;
	listPersonal(adminUserId: string): Promise<StoredSavedReply[]>;
	findById(id: string): Promise<StoredSavedReply | null>;
	create(reply: StoredSavedReply): Promise<StoredSavedReply>;
	update(
		id: string,
		change: Pick<StoredSavedReply, 'title' | 'body' | 'updatedBy' | 'updatedAt'>,
	): Promise<StoredSavedReply | null>;
	delete(id: string): Promise<boolean>;
}

/** Where a message waiting for Undo Send stands (C4). */
export type OutboxStatus = 'queued' | 'sending' | 'sent' | 'cancelled' | 'uncertain' | 'failed' | 'gone';

/** A message waiting in Gmail's drafts until `sendAt`, so Undo can stop it. No message content here. */
export interface OutboxItem {
	id: string;
	mailboxId: string;
	draftId: string;
	adminUserId: string;
	/** The Message-ID we gave the message, for finding it in Sent when a result was lost. */
	messageId: string;
	sendAt: string;
	status: OutboxStatus;
	attempts: number;
	createdAt: string;
	/** When a sender last took it to send; a row left `sending` long after this was interrupted. */
	claimedAt: string | null;
	sentMessageId: string | null;
	threadId: string | null;
	/** For the audit row once sent: counts and the From address, never addresses typed in mail. */
	meta: { from: string; recipients: number; reply: boolean };
}

/**
 * Messages waiting for Undo Send (`mailboxOutbox`). Every change of status is one atomic step, so
 * two API instances never send the same message twice and Undo never races a send.
 */
export interface MailboxOutboxRepository {
	create(item: OutboxItem): Promise<OutboxItem>;
	findById(id: string): Promise<OutboxItem | null>;
	/** Moves up to `limit` due rows from queued to sending, one at a time, and returns them. */
	claimDue(now: string, limit: number): Promise<OutboxItem[]>;
	/** queued → cancelled; null when it already left the queue. */
	cancel(id: string): Promise<OutboxItem | null>;
	markSent(id: string, sent: { id: string; threadId: string }): Promise<void>;
	setStatus(id: string, status: Exclude<OutboxStatus, 'sent'>, attemptsDelta?: number): Promise<void>;
	listByStatus(status: OutboxStatus, limit: number): Promise<OutboxItem[]>;
	/** A row of this draft still waiting or being sent, so one draft is never queued twice. */
	findActiveForDraft(mailboxId: string, draftId: string): Promise<OutboxItem | null>;
}
