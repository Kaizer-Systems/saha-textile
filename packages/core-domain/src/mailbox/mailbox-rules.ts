import type { InboxFolder, MailboxAccess } from '@saha-textile/contracts';

/** What an admin user may do in one mailbox: nothing, read, or read and send. */
export type MailboxRight = 'none' | 'read' | 'send';

/**
 * The per-mailbox check every inbox call makes (object-level authorisation): the super admin
 * manages mailboxes but reads one only when given access like anyone else.
 */
export function mailboxRight(access: readonly MailboxAccess[], adminUserId: string, mailboxId: string): MailboxRight {
	const row = access.find((entry) => entry.adminUserId === adminUserId && entry.mailboxId === mailboxId);
	if (!row) return 'none';
	return row.canSend ? 'send' : 'read';
}

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
