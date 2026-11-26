import { ConflictException, NotFoundException, PreconditionFailedException } from '@nestjs/common';
import type { Mailbox, MailboxAccess } from '@saha-textile/contracts';
import type { MailboxPort, OutboxItem } from '@saha-textile/core-domain';
import { describe, expect, it, type Mock, vi } from 'vitest';

import { InboxService, attribution } from '../src/mailboxes/inbox.service';
import { MailboxBookkeeping } from '../src/mailboxes/mailbox-support';

const care: Mailbox = {
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
const boxes: Record<string, Mailbox> = { care, old: { ...care, id: 'old', status: 'needs_reconnect' } };
const ALL = ['read', 'send', 'organise', 'bin', 'labels', 'delete_forever'];

const item = (id: string, over: Partial<OutboxItem> = {}): OutboxItem =>
	({
		id,
		mailboxId: 'care',
		draftId: `d_${id}`,
		adminUserId: 'boss',
		messageId: `outbox-${id}@shop.test`,
		sendAt: '2026-11-24T09:00:00.000Z',
		status: 'sending',
		attempts: 0,
		createdAt: '2026-11-24T08:59:50.000Z',
		claimedAt: null,
		sentMessageId: null,
		threadId: null,
		meta: {},
		...over,
	}) as OutboxItem;

function setup(outbox: Record<string, unknown> = {}, mailboxIds: string[] = ['care', 'old', 'gone']) {
	const rows = mailboxIds.map(
		(mailboxId) => ({ mailboxId, adminUserId: 'boss', rights: ALL }) as unknown as MailboxAccess,
	);
	const audit: Array<{ action: string }> = [];
	const mailboxes = {
		findById: async (id: string) => boxes[id] ?? null,
		save: async (box: Mailbox) => box,
	};
	const gmail = {
		featuresMissing: vi.fn(() => [] as string[]),
		listThreads: vi.fn(async () => ({ threads: [], nextPageToken: null })),
		getThread: vi.fn(async () => null),
		send: vi.fn(async () => ({ id: 'm9', threadId: 't1' })),
		getDraft: vi.fn(async () => null),
		updateDraft: vi.fn(async () => null),
		listLabels: vi.fn(async () => [{ id: 'Label_1', name: 'Orders' }]),
		createLabel: vi.fn(async () => ({ id: 'Label_2', name: 'Returns' })),
		deleteLabel: vi.fn(async () => undefined),
		binCount: vi.fn(async () => ({ threads: 2, messages: 3 })),
		modifyThread: vi.fn(async () => undefined),
		listBinMessageIds: vi.fn(async () => ({ ids: [] })),
		sendDraft: vi.fn(async () => null),
		findByMessageId: vi.fn(async () => null),
	} as Record<string, Mock>;
	const books = new MailboxBookkeeping(
		mailboxes as never,
		{ append: async (entry: { action: string }) => void audit.push(entry) } as never,
		{ findById: async () => null } as never,
	);
	const inbox = new InboxService(
		gmail as unknown as MailboxPort,
		mailboxes as never,
		{ listForMailbox: async () => rows, listForAdminUser: async () => rows } as never,
		{ get: async () => 'refresh-token' } as never,
		books,
		outbox as never,
	);
	return { inbox, gmail, audit };
}

const message = (id: string) => ({ id, messageId: `<${id}@mail>`, date: '2026-11-24T08:00:00.000Z', from: 'a@b.test' });
const reply = {
	from: 'care@shop.test',
	to: ['priya@example.test'],
	cc: [],
	bcc: [],
	subject: 'Re: Your order',
	body: 'Thank you',
	threadId: 't1',
	sendAnyway: false,
	keepDraftAttachments: false,
	attachments: [],
};

describe('the inbox: the last cases', () => {
	it('names the writer by the address itself when the From line is only an address in brackets', () => {
		expect(attribution({ from: '<priya@example.test>', date: '2026-11-09T18:15:00.000Z' } as never)).toBe(
			'On 9 Nov 2026, 23:45, priya@example.test wrote:',
		);
	});

	it('leaves out of All mailboxes a mailbox removed since access was given', async () => {
		const { inbox } = setup({}, ['care', 'gone']);
		expect(await inbox.allThreads('boss', { folder: 'inbox' } as never)).toEqual({ threads: [], skipped: [] });
	});

	it('refuses to send into a conversation someone answered meanwhile, and sends when every message was seen', async () => {
		const { inbox, gmail } = setup();
		gmail.getThread!.mockResolvedValue({ id: 't1', messages: [message('m1'), message('m2')] });
		await expect(inbox.send('boss', 'care', { ...reply, knownMessageIds: ['m1'] } as never)).rejects.toBeInstanceOf(
			PreconditionFailedException,
		);
		expect(await inbox.send('boss', 'care', { ...reply, knownMessageIds: ['m1', 'm2'] } as never)).toEqual({
			id: 'm9',
			threadId: 't1',
		});
	});

	it('answers "draft gone" when Gmail lost the draft while it was being saved', async () => {
		const { inbox, gmail } = setup({ findActiveForDraft: async () => null });
		gmail.getDraft!.mockResolvedValue({ draftId: 'd1', version: 'v1' });
		await expect(
			inbox.saveDraft('boss', 'care', 'd1', {
				...reply,
				threadId: undefined,
				version: 'v1',
				keepAttachments: false,
			} as never),
		).rejects.toMatchObject({ response: { code: 'draft_gone' } });
	});

	it('lists, adds and deletes labels, and counts the Bin', async () => {
		const { inbox, audit } = setup();
		expect(await inbox.labels('boss', 'care')).toEqual([{ id: 'Label_1', name: 'Orders' }]);
		expect(await inbox.createLabel('boss', 'care', { name: 'Returns' } as never)).toEqual({
			id: 'Label_2',
			name: 'Returns',
		});
		await inbox.deleteLabel('boss', 'care', 'Label_2');
		expect(await inbox.binSummary('boss', 'care')).toEqual({ threads: 2, messages: 3 });
		expect(audit.map((entry) => entry.action)).toEqual(['mailbox.label_created', 'mailbox.label_deleted']);
	});

	it('stops a whole bulk change or Empty Bin when the mailbox loses its access, and asks to reconnect for a missing feature', async () => {
		const { inbox, gmail } = setup();
		gmail.modifyThread!.mockRejectedValue(new ConflictException({ code: 'mailbox_needs_reconnect' }));
		await expect(
			inbox.bulk('boss', 'care', { action: 'archive', threadIds: ['t1'] } as never),
		).rejects.toBeInstanceOf(ConflictException);
		gmail.listBinMessageIds!.mockRejectedValue(new ConflictException({ code: 'mailbox_needs_reconnect' }));
		await expect(inbox.emptyBin('boss', 'care')).rejects.toBeInstanceOf(ConflictException);
		gmail.featuresMissing!.mockReturnValue(['delete_forever']);
		await expect(inbox.emptyBin('boss', 'care')).rejects.toMatchObject({
			response: { code: 'mailbox_reconnect_for_feature', feature: 'delete_forever' },
		});
	});
});

describe('the Undo Send rounds: the last cases', () => {
	it('fails a message whose mailbox is gone or needs reconnecting, and sorts what Gmail answers', async () => {
		const statuses: unknown[][] = [];
		const due = [
			item('gone', { mailboxId: 'gone' }),
			item('old', { mailboxId: 'old' }),
			item('busy', { attempts: 2 }),
			item('refused'),
			item('lost'),
		];
		const { inbox, gmail } = setup({
			claimDue: async () => due,
			listByStatus: async () => [],
			setStatus: async (...args: unknown[]) => void statuses.push(args),
			markSent: async () => {
				throw new Error('database down');
			},
		});
		gmail.sendDraft!.mockImplementation(async (_credentials: unknown, draftId: string) => {
			if (draftId === 'd_busy') throw Object.assign(new Error('rate'), { status: 429 });
			if (draftId === 'd_refused') throw new NotFoundException('no such draft');
			return { id: 'm1', threadId: 't1' };
		});
		expect(await inbox.dispatchDue(new Date('2026-11-24T09:00:05.000Z'))).toBe(0);
		expect(statuses).toEqual([
			['gone', 'failed'],
			['old', 'failed'],
			['busy', 'failed', 1],
			['refused', 'failed', 1],
			['lost', 'uncertain', 1],
		]);
	});

	it('times a stopped send and a lost message from when it was due when it was never claimed', async () => {
		const statuses: unknown[][] = [];
		const { inbox } = setup({
			claimDue: async () => [],
			listByStatus: async (status: string) =>
				status === 'sending'
					? [item('stuck')]
					: [item('vanished', { status: 'uncertain' }), item('away', { mailboxId: 'gone' })],
			setStatus: async (...args: unknown[]) => void statuses.push(args),
		});
		await inbox.dispatchDue(new Date('2026-11-24T10:00:00.000Z'));
		expect(statuses).toEqual([
			['stuck', 'uncertain'],
			['vanished', 'gone'],
		]);
	});
});
