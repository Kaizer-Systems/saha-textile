import { TestBed } from '@angular/core/testing';

import { TranslocoService } from '@jsverse/transloco';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { MailboxGateway } from '@core/mailboxes/mailbox.gateway';
import { NotificationService } from '@data-access/services/notification.service';

import { Inbox, senderName } from './inbox';

interface Options {
	queryKey: unknown[];
	queryFn: () => Promise<unknown>;
	enabled: boolean;
	refetchInterval?: number;
}
const state = vi.hoisted(() => ({
	options: [] as Array<() => Options>,
	results: [] as Array<{ data: unknown; pending: boolean; error: boolean }>,
	summary: undefined as unknown,
	summaryPending: false,
}));
vi.mock('@tanstack/angular-query-experimental', () => ({
	QueryClient: class {},
	injectQuery: (options: () => Options) => {
		const index = state.options.push(options) - 1;
		return {
			data: () => state.results[index]?.data,
			isPending: () => Boolean(state.results[index]?.pending),
			isError: () => Boolean(state.results[index]?.error),
		};
	},
}));
vi.mock('@core/mailboxes/mailbox.gateway', async (original) => ({
	...(await original<object>()),
	injectInboxSummaryQuery: () => ({ data: () => state.summary, isPending: () => state.summaryPending }),
}));

const box = (id: string, fields: Record<string, unknown> = {}) => ({
	mailboxId: id,
	address: `${id}@shop.test`,
	status: 'connected',
	canSend: true,
	unread: 0,
	sendAs: [
		{ address: `${id}@shop.test`, displayName: '', signature: '', isPrimary: true },
		{ address: `help-${id}@shop.test`, displayName: '', signature: '', isPrimary: false },
	],
	...fields,
});
const row = (id: string, unread = false) => ({
	id,
	from: 'Rahul <rahul@example.com>',
	subject: 'Order',
	snippet: '',
	to: 'care@shop.test',
	date: '2026-11-09T10:00:00.000Z',
	unread,
	messageCount: 1,
});
const message = (id: string, html = '<p>Hi</p>') => ({
	id,
	from: 'Rahul <rahul@example.com>',
	to: 'help-care@shop.test',
	cc: '',
	replyTo: '',
	subject: 'Order',
	date: '2026-11-09T10:00:00.000Z',
	html,
	text: 'Hi',
	hasRemoteImages: true,
	attachments: [],
	messageId: '<a@example.com>',
});

const setup = (
	summary: unknown = [box('care', { unread: 2 }), box('orders')],
	threads: (typeof state.results)[number] = {
		data: { threads: [row('t1', true)], nextPageToken: 'p2' },
		pending: false,
		error: false,
	},
) => {
	state.options = [];
	state.results = [
		threads,
		{
			data: { id: 't1', subject: 'Order', unread: false, messages: [message('m1')] },
			pending: false,
			error: false,
		},
	];
	state.summary = summary;
	const gateway = {
		threads: vi.fn((..._args: unknown[]) => of({ threads: [], nextPageToken: null })),
		thread: vi.fn((..._args: unknown[]) => of({})),
		modify: vi.fn((..._args: unknown[]) => of({ ok: true })),
		send: vi.fn((..._args: unknown[]) => of({ id: 's1', threadId: 't1' })),
		attachmentUrl: vi.fn((...args: unknown[]) => args.join('/')),
	};
	const client = { invalidateQueries: vi.fn() };
	const notifier = { showSuccess: vi.fn(), showError: vi.fn() };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: MailboxGateway, useValue: gateway },
			{ provide: QueryClient, useValue: client },
			{ provide: NotificationService, useValue: notifier },
			{ provide: TranslocoService, useValue: { translate: (key: string) => key } },
		],
	});
	TestBed.overrideComponent(Inbox, { set: { imports: [], template: '' } });
	const page = TestBed.createComponent(Inbox).componentInstance;
	const threadsOptions = () => state.options[0]?.() as Options;
	const threadOptions = () => state.options[1]?.() as Options;
	return { page, gateway, client, notifier, threadsOptions, threadOptions };
};

describe('senderName', () => {
	it('shows the display name, else the address', () => {
		expect(senderName('"Ananya Das" <ananya@example.com>')).toBe('Ananya Das');
		expect(senderName('<rahul@example.com>')).toBe('rahul@example.com');
		expect(senderName('mitali@example.com')).toBe('mitali@example.com');
	});
});

describe('Inbox', () => {
	it('opens the first mailbox, lists the others with unread counts, and its aliases as From choices', () => {
		const { page } = setup();
		expect(page.loadingMailboxes()).toBe(false);
		expect(page.mailbox()?.mailboxId).toBe('care');
		expect(page.connected()).toBe(true);
		expect(page.canSend()).toBe(true);
		expect(page.mailboxChoices()).toEqual([
			{ value: 'care', label: 'care@shop.test (2)' },
			{ value: 'orders', label: 'orders@shop.test' },
		]);
		expect(page.fromChoices()).toEqual([
			{ value: 'care@shop.test', label: 'care@shop.test' },
			{ value: 'help-care@shop.test', label: 'help-care@shop.test (inbox_alias)' },
		]);
	});

	it('has nothing to show before the mailboxes arrive, or with none given', () => {
		const { page, threadsOptions, threadOptions } = setup(null);
		expect(page.mailbox()).toBeNull();
		expect(page.connected()).toBe(false);
		expect(page.canSend()).toBe(false);
		expect(page.fromChoices()).toEqual([]);
		expect(threadsOptions().enabled).toBe(false);
		expect(threadOptions().enabled).toBe(false);
	});

	it('asks for the folder, search and page it shows, every minute, only from a working mailbox', async () => {
		const { page, gateway, threadsOptions } = setup();
		expect(threadsOptions()).toMatchObject({ enabled: true, refetchInterval: 60_000 });
		expect(threadsOptions().queryKey).toEqual(['inbox', 'care', 'threads', 'inbox', '', '']);
		await threadsOptions().queryFn();
		expect(gateway.threads).toHaveBeenLastCalledWith('care', 'inbox', undefined, undefined);
		page.searchText.set('  from:rahul ');
		page.search();
		page.chooseFolder('all');
		page.older();
		await threadsOptions().queryFn();
		expect(gateway.threads).toHaveBeenLastCalledWith('care', 'all', 'from:rahul', 'p2');
		expect(page.firstPage()).toBe(false);
		page.newer();
		expect(page.firstPage()).toBe(true);
	});

	it('shows a loader, then says when Gmail does not answer, with no older page to step to', () => {
		const { page } = setup(undefined, { data: undefined, pending: true, error: true });
		expect(page.threads()).toEqual([]);
		expect(page.nextPage()).toBeNull();
		page.older();
		expect(page.firstPage()).toBe(true);
		expect(page.loadingThreads()).toBe(true);
		expect(page.gmailDown()).toBe(true);
	});

	it('does not read a mailbox that needs reconnecting, and switches mailboxes only to a new one', () => {
		const { page, threadsOptions } = setup([
			box('care'),
			box('orders', { status: 'needs_reconnect', canSend: true }),
		]);
		page.chooseMailbox({ value: 'care' } as never);
		page.chooseMailbox({ value: ['x'] } as never);
		expect(page.mailbox()?.mailboxId).toBe('care');
		page.chooseMailbox({ value: 'orders' } as never);
		expect(page.mailbox()?.mailboxId).toBe('orders');
		expect(page.connected()).toBe(false);
		expect(page.canSend()).toBe(false);
		expect(page.loadingThreads()).toBe(false);
		expect(threadsOptions().enabled).toBe(false);
	});

	it('opens a conversation and marks it read, the way Gmail does', async () => {
		const { page, gateway, client, threadOptions } = setup();
		expect(page.thread()).toBeNull();
		expect(page.reading()).toBe(false);
		await page.open(row('t1', true));
		expect(gateway.modify).toHaveBeenCalledWith('care', 't1', 'mark_read');
		expect(client.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['inbox'] });
		expect(page.reading()).toBe(true);
		expect(page.thread()?.id).toBe('t1');
		expect(threadOptions()).toMatchObject({ enabled: true, queryKey: ['inbox', 'care', 'thread', 't1'] });
		await threadOptions().queryFn();
		expect(gateway.thread).toHaveBeenCalledWith('care', 't1');
		gateway.modify.mockClear();
		await page.open(row('t2'));
		expect(gateway.modify).not.toHaveBeenCalled();
		state.results[1] = { data: undefined, pending: true, error: false };
		expect(page.loadingThread()).toBe(true);
		expect(page.thread()).toBeNull();
		page.back();
		expect(page.loadingThread()).toBe(false);
	});

	it('marks nothing read without a mailbox', async () => {
		const { page, gateway } = setup([]);
		await page.open(row('t1', true));
		expect(gateway.modify).not.toHaveBeenCalled();
	});

	it('archives, trashes or marks unread, closing the conversation when it leaves the folder', async () => {
		const { page, gateway, notifier } = setup();
		await page.act('archive');
		expect(gateway.modify).not.toHaveBeenCalled();
		await page.open(row('t1'));
		await page.act('mark_read');
		expect(page.openId()).toBe('t1');
		await page.act('archive');
		expect(gateway.modify).toHaveBeenLastCalledWith('care', 't1', 'archive');
		expect(notifier.showSuccess).toHaveBeenLastCalledWith('inbox_archived');
		expect(page.openId()).toBeNull();
	});

	it('keeps pictures off until asked for, per message', async () => {
		const { page } = setup();
		expect(page.frames().size).toBe(0);
		await page.open(row('t1'));
		const first = page.frames().get('m1');
		expect(first).toBeTruthy();
		expect(page.picturesShown(message('m1') as never)).toBe(false);
		page.showPictures(message('m1') as never);
		expect(page.picturesShown(message('m1') as never)).toBe(true);
		expect(page.frames().get('m1')).not.toBe(first);
	});

	it('grows a frame to its content, and leaves an unreadable one alone', () => {
		const { page } = setup();
		const frame = document.createElement('iframe');
		document.body.append(frame);
		Object.defineProperty(frame.contentDocument?.body, 'offsetHeight', { value: 300 });
		page.fitFrame({ target: frame } as never);
		expect(frame.style.height).toBe('300px');
		const blank = { contentDocument: null, style: { height: '' } };
		page.fitFrame({ target: blank } as never);
		expect(blank.style.height).toBe('');
		frame.remove();
	});

	it('writes sizes and attachment addresses', () => {
		const { page, gateway } = setup();
		expect(page.size(820)).toBe('820 B');
		expect(page.size(14 * 1024)).toBe('14 KB');
		expect(page.size(2.3 * 1024 * 1024)).toBe('2.3 MB');
		page.attachmentUrl(message('m1') as never, { id: 'a1', filename: 'bill.pdf', mimeType: '', size: 1 });
		expect(gateway.attachmentUrl).toHaveBeenCalledWith('care', 'm1', 'a1', 'bill.pdf');
		setup([]).page.attachmentUrl(message('m1') as never, { id: 'a1', filename: 'x', mimeType: '', size: 1 });
	});

	it('starts a new message from the main address, or a reply from the thread', async () => {
		const { page } = setup();
		page.startDraft('reply');
		expect(page.draft()).toBeNull();
		page.compose();
		expect(page.draft()).toMatchObject({ mode: 'new', from: 'care@shop.test', to: '' });
		await page.open(row('t1'));
		page.startDraft('reply');
		expect(page.draft()).toMatchObject({ mode: 'reply', from: 'help-care@shop.test', to: 'rahul@example.com' });
		const empty = setup([]);
		empty.page.compose();
		expect(empty.page.draft()).toBeNull();
	});

	it('edits the draft, its From address and its files, and discards it', () => {
		const { page } = setup();
		page.editDraft('to', 'x@example.com');
		page.chooseFrom({ value: 'help-care@shop.test' } as never);
		expect(page.draft()).toBeNull();
		page.compose();
		page.editDraft('to', 'ria@example.com');
		page.chooseFrom({ value: 'help-care@shop.test' } as never);
		page.chooseFrom({ value: '' } as never);
		page.chooseFrom({ value: ['x'] } as never);
		expect(page.draft()).toMatchObject({ to: 'ria@example.com', from: 'help-care@shop.test' });
		const file = new File(['x'], 'x.txt');
		page.pickFiles({ target: { files: [file] } } as never);
		expect(page.files()).toEqual([file]);
		page.pickFiles({ target: { files: null } } as never);
		expect(page.files()).toEqual([]);
		page.discard();
		expect(page.draft()).toBeNull();
	});

	it('sends a finished draft once, and explains what is missing', async () => {
		const { page, gateway, notifier, client } = setup();
		await page.send();
		expect(gateway.send).not.toHaveBeenCalled();
		page.compose();
		await page.send();
		expect(notifier.showError).toHaveBeenCalledWith('inbox_need_recipient');
		page.editDraft('to', 'ria@example.com');
		page.editDraft('subject', 'Hello');
		page.editDraft('body', 'Hi');
		page.sending.set(true);
		await page.send();
		expect(gateway.send).not.toHaveBeenCalled();
		page.sending.set(false);
		await page.send();
		expect(gateway.send).toHaveBeenCalledWith('care', expect.objectContaining({ to: ['ria@example.com'] }));
		expect(notifier.showSuccess).toHaveBeenCalledWith('inbox_sent');
		expect(page.draft()).toBeNull();
		expect(client.invalidateQueries).toHaveBeenCalled();
	});

	it('keeps the draft when sending fails', async () => {
		const { page, gateway } = setup();
		gateway.send.mockReturnValueOnce(throwError(() => new Error('502')) as never);
		page.compose();
		page.editDraft('to', 'ria@example.com');
		page.editDraft('subject', 'Hello');
		await expect(page.send()).rejects.toThrow('502');
		expect(page.sending()).toBe(false);
		expect(page.draft()).not.toBeNull();
	});

	it('says while the mailboxes load', () => {
		state.summaryPending = true;
		expect(setup(null).page.loadingMailboxes()).toBe(true);
		state.summaryPending = false;
	});
});
