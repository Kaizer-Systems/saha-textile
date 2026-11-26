import type { InboxAction, InboxFolder, MailboxAccess, MailboxRight } from '@saha-textile/contracts';

/** The fixed order rights are listed and stored in. */
const ORDER: readonly MailboxRight[] = ['read', 'send', 'organise', 'bin', 'delete_forever', 'labels', 'settings'];

/** What each right cannot work without: everything needs Read, Delete forever needs Bin. */
const NEEDS: Readonly<Record<MailboxRight, readonly MailboxRight[]>> = {
	read: [],
	send: ['read'],
	organise: ['read'],
	bin: ['read'],
	delete_forever: ['bin', 'read'],
	labels: ['read'],
	settings: ['read'],
};

/** The rights with everything they need added, once each, in the fixed order. */
export function withNeededRights(rights: readonly MailboxRight[]): MailboxRight[] {
	const all = new Set<MailboxRight>();
	const add = (right: MailboxRight) => {
		if (all.has(right)) return;
		all.add(right);
		NEEDS[right].forEach(add);
	};
	rights.forEach(add);
	return ORDER.filter((right) => all.has(right));
}

/**
 * The rights a stored access row from before 2026-11-19 meant (owner log § admin Inbox upgrade):
 * Read stays Read; Read-and-send allowed writing, archiving and the Bin, so it keeps exactly those.
 * Nobody gets Delete forever, Labels or Settings without a super admin ticking them.
 */
export function legacyMailboxRights(canSend: boolean): MailboxRight[] {
	return canSend ? ['read', 'send', 'organise', 'bin'] : ['read'];
}

/**
 * The per-mailbox check every inbox call makes (object-level authorisation). An empty set means no
 * access at all. The super admin manages mailboxes but reads one only when given access like
 * anyone else.
 */
export function mailboxRights(
	access: readonly MailboxAccess[],
	adminUserId: string,
	mailboxId: string,
): ReadonlySet<MailboxRight> {
	const row = access.find((entry) => entry.adminUserId === adminUserId && entry.mailboxId === mailboxId);
	return new Set(row ? withNeededRights(row.rights) : []);
}

/** The right each conversation action needs. Deleting for good is separate: `delete_forever`. */
export const ACTION_RIGHT: Readonly<Record<InboxAction, MailboxRight>> = {
	mark_read: 'read',
	mark_unread: 'read',
	archive: 'organise',
	move_to_inbox: 'organise',
	spam: 'organise',
	not_spam: 'organise',
	star: 'organise',
	unstar: 'organise',
	important: 'organise',
	not_important: 'organise',
	add_label: 'organise',
	remove_label: 'organise',
	trash: 'bin',
	untrash: 'bin',
};

/** Gmail's label for each admin folder. */
export const FOLDER_LABELS: Readonly<Record<InboxFolder, string | null>> = {
	inbox: 'INBOX',
	starred: 'STARRED',
	important: 'IMPORTANT',
	sent: 'SENT',
	all: null,
	spam: 'SPAM',
	trash: 'TRASH',
};

/** Whether an address belongs to the shop's Workspace domain. */
export function onDomain(address: string, domain: string): boolean {
	const at = address.lastIndexOf('@');
	return at > 0 && address.slice(at + 1).toLowerCase() === domain.toLowerCase();
}

/**
 * Label changes for each inbox action. Only the label named changes: a conversation keeps every
 * other label it carries. `labelId` is needed for adding or removing a label.
 */
export function labelChange(
	action: Exclude<InboxAction, 'trash' | 'untrash'>,
	labelId?: string,
): { add: string[]; remove: string[] } {
	switch (action) {
		case 'mark_read':
			return { add: [], remove: ['UNREAD'] };
		case 'mark_unread':
			return { add: ['UNREAD'], remove: [] };
		case 'archive':
			return { add: [], remove: ['INBOX'] };
		case 'move_to_inbox':
			return { add: ['INBOX'], remove: [] };
		// Gmail's own spam label, so its filter learns from the team.
		case 'spam':
			return { add: ['SPAM'], remove: ['INBOX'] };
		case 'not_spam':
			return { add: ['INBOX'], remove: ['SPAM'] };
		case 'star':
			return { add: ['STARRED'], remove: [] };
		case 'unstar':
			return { add: [], remove: ['STARRED'] };
		case 'important':
			return { add: ['IMPORTANT'], remove: [] };
		case 'not_important':
			return { add: [], remove: ['IMPORTANT'] };
		case 'add_label':
			return { add: labelId ? [labelId] : [], remove: [] };
		case 'remove_label':
			return { add: [], remove: labelId ? [labelId] : [] };
	}
}

/**
 * Which messages of a conversation may be deleted for good: only those already in the Bin. A
 * conversation entirely in the Bin is deleted whole; one only partly there keeps its other messages.
 */
export function deletableForever(messages: readonly { id: string; labelIds: readonly string[] }[]): {
	whole: boolean;
	messageIds: string[];
} {
	const binned = messages.filter((message) => message.labelIds.includes('TRASH')).map((message) => message.id);
	return { whole: binned.length > 0 && binned.length === messages.length, messageIds: binned };
}

/** Reply subject: "Re: " once, however many times a thread was answered. */
export function replySubject(subject: string): string {
	return /^re:/i.test(subject.trim()) ? subject.trim() : `Re: ${subject.trim()}`;
}
