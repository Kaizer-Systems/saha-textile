import type { InboxFolder, InboxModifyRequest, MailboxAccess, MailboxRight } from '@saha-textile/contracts';

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

/** The right each conversation action needs. */
export const ACTION_RIGHT: Readonly<Record<InboxModifyRequest['action'], MailboxRight>> = {
	mark_read: 'read',
	mark_unread: 'read',
	archive: 'organise',
	move_to_inbox: 'organise',
	spam: 'organise',
	not_spam: 'organise',
	trash: 'bin',
	untrash: 'bin',
};

/** Gmail's label for each admin folder. */
export const FOLDER_LABELS: Readonly<Record<InboxFolder, string | null>> = {
	inbox: 'INBOX',
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

/** Label changes for each inbox action. */
export function labelChange(action: 'mark_read' | 'mark_unread' | 'archive' | 'move_to_inbox' | 'spam' | 'not_spam'): {
	add: string[];
	remove: string[];
} {
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
	}
}

/** Reply subject: "Re: " once, however many times a thread was answered. */
export function replySubject(subject: string): string {
	return /^re:/i.test(subject.trim()) ? subject.trim() : `Re: ${subject.trim()}`;
}
