import type {
	ContactMessage,
	InboxFolder,
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
	signatureHtml: string;
	threadId?: string;
	inReplyTo?: string;
	/** The answered message's References header; the reply carries the whole chain on. */
	references?: string;
	/** The answered message, quoted below the reply as mail programs do. */
	quote?: { attribution: string; html: string; text: string };
	attachments: readonly { filename: string; mimeType: string; data: Uint8Array }[];
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
