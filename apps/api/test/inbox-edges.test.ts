import { NotFoundException } from '@nestjs/common';
import type { Mailbox, MailboxAccess } from '@saha-textile/contracts';
import type { MailboxPort } from '@saha-textile/core-domain';
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

import { InboxService } from '../src/mailboxes/inbox.service';
import { MailboxBookkeeping } from '../src/mailboxes/mailbox-support';

const mailbox: Mailbox = {
	id: 'care',
	address: 'care@shop.test',
	status: 'connected',
	connectedBy: 'admin',
	connectedAt: '2026-11-09T10:00:00.000Z',
	lastSyncAt: null,
	sendAs: [{ address: 'care@shop.test', displayName: 'Care', signature: '', isPrimary: true }],
	grantedScopes: [],
	revocation: null,
};

function setup() {
	const rows: MailboxAccess[] = [
		{
			mailboxId: 'care',
			adminUserId: 'boss',
			rights: ['read', 'send', 'organise', 'bin', 'labels', 'delete_forever'],
		} as never,
	];
	const audit: Array<{ action: string; metadata?: Record<string, unknown> }> = [];
	const mailboxes = {
		findById: async (id: string) => (id === 'care' ? mailbox : null),
		save: async (box: Mailbox) => box,
	};
	const gmail = {
		featuresMissing: vi.fn(() => []),
		modifyMessages: vi.fn(async () => undefined),
		modifyThread: vi.fn(async () => undefined),
		trashThread: vi.fn(async () => undefined),
		renameLabel: vi.fn(async () => null),
		threadMessageLabels: vi.fn(async () => null),
		deleteThreadForever: vi.fn(async () => undefined),
		deleteMessagesForever: vi.fn(async () => undefined),
		listThreadIds: vi.fn(async () => ({ ids: [], nextPageToken: null })),
		listBinMessageIds: vi.fn(async () => ({ ids: [] })),
	} as Record<string, Mock>;
	const books = new MailboxBookkeeping(
		mailboxes as never,
		{
			append: async (entry: { action: string; metadata?: Record<string, unknown> }) => void audit.push(entry),
		} as never,
		{ findById: async () => null } as never,
	);
	const inbox = new InboxService(
		gmail as unknown as MailboxPort,
		mailboxes as never,
		{ listForMailbox: async () => rows, listForAdminUser: async () => rows } as never,
		{ get: async () => 'refresh-token' } as never,
		books,
		{} as never,
	);
	return { inbox, gmail, audit };
}

describe('inbox: marking, labels and single changes', () => {
	let s: ReturnType<typeof setup>;
	beforeEach(() => {
		s = setup();
	});

	it('marks exactly the messages shown read, or unread', async () => {
		await s.inbox.markMessages('boss', 'care', { messageIds: ['m1'], read: true } as never);
		await s.inbox.markMessages('boss', 'care', { messageIds: ['m1'], read: false } as never);
		expect(s.gmail.modifyMessages!.mock.calls.map((call: unknown[]) => call[2])).toEqual([
			{ add: [], remove: ['UNREAD'] },
			{ add: ['UNREAD'], remove: [] },
		]);
	});

	it('answers a label Gmail no longer has, and records a rename it made', async () => {
		await expect(s.inbox.renameLabel('boss', 'care', 'Label_1', { name: 'X' } as never)).rejects.toBeInstanceOf(
			NotFoundException,
		);
		s.gmail.renameLabel!.mockResolvedValueOnce({ id: 'Label_1', name: 'X' } as never);
		expect(await s.inbox.renameLabel('boss', 'care', 'Label_1', { name: 'X' } as never)).toEqual({
			id: 'Label_1',
			name: 'X',
		});
	});

	it('records a change to one conversation, but not a mark as read', async () => {
		await s.inbox.modify('boss', 'care', 't1', { action: 'mark_read' } as never);
		await s.inbox.modify('boss', 'care', 't1', { action: 'trash' } as never);
		expect(s.gmail.trashThread).toHaveBeenCalled();
		expect(s.audit.map((entry) => entry.metadata?.['action'])).toEqual(['trash']);
	});
});

describe('inbox: actions on many conversations', () => {
	let s: ReturnType<typeof setup>;
	beforeEach(() => {
		s = setup();
	});

	it('deletes for good only what is in the Bin: whole, part, gone, not there, or failing', async () => {
		s.gmail.threadMessageLabels!.mockImplementation(async (_credentials: unknown, threadId: string) => {
			if (threadId === 'gone') return null;
			if (threadId === 'kept') return [{ id: 'm1', labelIds: ['INBOX'] }];
			if (threadId === 'whole') return [{ id: 'm1', labelIds: ['TRASH'] }];
			if (threadId === 'broken') throw new Error('gmail down');
			return [
				{ id: 'm1', labelIds: ['TRASH'] },
				{ id: 'm2', labelIds: ['INBOX'] },
			];
		});
		const result = await s.inbox.bulk('boss', 'care', {
			action: 'delete_forever',
			threadIds: ['gone', 'kept', 'whole', 'part', 'broken'],
		} as never);
		expect(result.done.sort()).toEqual(['part', 'whole']);
		expect(result.partlyKept).toEqual(['part']);
		expect(result.failed.map((row) => [row.threadId, row.reason]).sort()).toEqual([
			['broken', 'gmail_error'],
			['gone', 'gone'],
			['kept', 'not_in_bin'],
		]);
		expect(s.gmail.deleteThreadForever).toHaveBeenCalledWith(expect.anything(), 'whole');
		expect(s.audit.at(-1)?.action).toBe('mailbox.deleted_forever');
	});

	it('acts on every conversation in the inbox when none are named, page after page, with a label', async () => {
		s.gmail
			.listThreadIds!.mockResolvedValueOnce({ ids: ['t1'], nextPageToken: 'p2' } as never)
			.mockResolvedValueOnce({ ids: ['t2'], nextPageToken: null } as never);
		const result = await s.inbox.bulk('boss', 'care', { action: 'add_label', labelId: 'Label_1' } as never);
		expect(result).toMatchObject({ done: ['t1', 't2'], truncated: false });
		expect(s.gmail.listThreadIds!.mock.calls[0]?.[1]).toMatchObject({ folder: 'inbox' });
		expect(s.audit.at(-1)?.metadata).toMatchObject({ labelId: 'Label_1', matching: false });
	});

	it('empties the Bin a page at a time, and says when Gmail stopped part way', async () => {
		s.gmail
			.listBinMessageIds!.mockResolvedValueOnce({ ids: ['m1', 'm2'] } as never)
			.mockResolvedValueOnce({ ids: [] } as never);
		expect(await s.inbox.emptyBin('boss', 'care')).toEqual({ deletedMessages: 2, incomplete: false });
		s.gmail
			.listBinMessageIds!.mockResolvedValueOnce({ ids: ['m3'] } as never)
			.mockRejectedValueOnce(new Error('gmail down'));
		expect(await s.inbox.emptyBin('boss', 'care')).toEqual({ deletedMessages: 1, incomplete: true });
	});
});
