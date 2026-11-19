import { HttpErrorResponse } from '@angular/common/http';
import { signal, type WritableSignal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, type Params } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MailboxGateway } from '@core/mailboxes/mailbox.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';

import { Inbox, senderName } from './inbox';
import { draftKey, keepDraft, keptDraft, newDraft } from './inbox-drafts';
import { inboxMatcher } from './inbox.routes';

interface Result {
	data?: unknown;
	pending?: boolean;
	error?: unknown;
}
interface Query {
	options: () => { queryKey: unknown[]; queryFn: () => Promise<unknown>; enabled: boolean; retry?: unknown };
	result: WritableSignal<Result>;
	refetch: ReturnType<typeof vi.fn>;
}
const state = vi.hoisted(() => ({
	queries: [] as Query[],
	summary: null as WritableSignal<Result> | null,
	summaryRefetch: null as ReturnType<typeof vi.fn> | null,
}));
vi.mock('@tanstack/angular-query-experimental', async () => {
	const { signal: make } = await import('@angular/core');
	return {
		QueryClient: class {},
		injectQuery: (options: Query['options']) => {
			const result = make<Result>({});
			const refetch = vi.fn();
			state.queries.push({ options, result, refetch });
			return {
				data: () => result().data,
				isPending: () => Boolean(result().pending),
				isError: () => Boolean(result().error),
				isSuccess: () => result().data !== undefined && !result().error,
				dataUpdatedAt: () => 0,
				error: () => result().error ?? null,
				refetch,
			};
		},
	};
});
vi.mock('@core/mailboxes/mailbox.gateway', async (original) => {
	const { signal: make } = await import('@angular/core');
	return {
		...(await original<object>()),
		injectInboxSummaryQuery: () => {
			const result = make<Result>({});
			state.summary = result;
			state.summaryRefetch = vi.fn();
			return {
				data: () => result().data,
				isPending: () => Boolean(result().pending),
				isError: () => Boolean(result().error),
				refetch: state.summaryRefetch,
			};
		},
	};
});

const box = (id: string, fields: Record<string, unknown> = {}) => ({
	mailboxId: `mbx-${id}`,
	address: `${id}@shop.test`,
	status: 'connected',
	canSend: true,
	unread: 0,
	sendAs: [
		{ address: `${id}@shop.test`, displayName: '', signature: '<b>Team</b>', isPrimary: true },
		{ address: `help-${id}@shop.test`, displayName: '', signature: '', isPrimary: false },
	],
	...fields,
});
const row = (id: string, fields: Record<string, unknown> = {}) => ({
	id,
	from: 'Rahul <rahul@example.com>',
	subject: 'Order',
	snippet: '',
	to: 'care@shop.test',
	date: '2026-11-09T10:00:00.000Z',
	unread: false,
	messageCount: 1,
	participants: ['Rahul'],
	fromContactForm: false,
	lastReplyBy: null,
	...fields,
});
const message = (id: string, fields: Record<string, unknown> = {}) => ({
	id,
	from: 'Rahul <rahul@example.com>',
	to: 'help-care@shop.test',
	cc: '',
	replyTo: '',
	subject: 'Order',
	date: '2026-11-09T10:00:00.000Z',
	html: `<p>${id}</p>`,
	quoteHtml: '<blockquote>older</blockquote>',
	text: 'Hi',
	hasRemoteImages: true,
	attachments: [{ id: 'a1', filename: 'bill.pdf', mimeType: 'application/pdf', size: 10 }],
	messageId: `<${id}@example.com>`,
	references: '',
	unread: false,
	contactForm: null,
	sentBy: null,
	...fields,
});
const conversation = (...ids: string[]) => ({
	id: 't1',
	subject: 'Order',
	unread: false,
	messages: ids.map((id) => message(id)),
});

let fixture: ComponentFixture<Inbox>;
let params: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
let query: BehaviorSubject<ReturnType<typeof convertToParamMap>>;

const setup = (url: Params = { mailbox: 'care', folder: 'inbox' }, queryParams: Params = {}) => {
	state.queries = [];
	params = new BehaviorSubject(convertToParamMap(url));
	query = new BehaviorSubject(convertToParamMap(queryParams));
	const gateway = {
		thread: vi.fn((..._args: unknown[]) => of(conversation('m1'))),
		threads: vi.fn((..._args: unknown[]) => of({ threads: [], nextPageToken: null })),
		modify: vi.fn((..._args: unknown[]) => of({ ok: true })),
		markMessages: vi.fn((..._args: unknown[]) => of({ ok: true })),
		labels: vi.fn((..._args: unknown[]) => of([])),
		send: vi.fn((..._args: unknown[]) => of({ id: 's1', threadId: 't1' })),
		attachmentUrl: vi.fn((...args: unknown[]) => args.join('/')),
	};
	const client = {
		invalidateQueries: vi.fn(async (..._args: unknown[]) => undefined),
		fetchQuery: vi.fn(async (options: { queryFn: () => Promise<unknown> }) => options.queryFn()),
	};
	const notifier = { showSuccess: vi.fn(), showError: vi.fn() };
	const router = { navigate: vi.fn(async (..._args: unknown[]) => true) };
	const modals = { open: vi.fn(), dismissAll: vi.fn() };
	const permissions = signal<string[]>(['mailbox.use']);
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: MailboxGateway, useValue: gateway },
			{ provide: QueryClient, useValue: client },
			{ provide: NotificationService, useValue: notifier },
			{ provide: TranslocoService, useValue: { translate: (key: string) => key } },
			{ provide: Router, useValue: router },
			{ provide: ActivatedRoute, useValue: { paramMap: params, queryParamMap: query } },
			{ provide: NgbModal, useValue: modals },
			{ provide: AuthStore, useValue: { permissions } },
		],
	});
	TestBed.overrideComponent(Inbox, {
		set: {
			imports: [],
			template: '<ng-template #discardModal>d</ng-template><ng-template #runnableModal>r</ng-template>',
		},
	});
	fixture = TestBed.createComponent(Inbox);
	const page = fixture.componentInstance;
	const keyed = (part: string) => state.queries.find((query) => query.options().queryKey.includes(part)) as Query;
	const threadsQuery = keyed('threads');
	const threadQuery = keyed('thread');
	const flush = () => {
		TestBed.tick();
		fixture.detectChanges();
	};
	const go = (next: Params, nextQuery: Params = {}) => {
		params.next(convertToParamMap(next));
		query.next(convertToParamMap(nextQuery));
		flush();
	};
	const summary = (data: unknown, extra: Result = {}) => {
		state.summary?.set({ data, ...extra });
		flush();
	};
	return {
		page,
		gateway,
		client,
		notifier,
		router,
		modals,
		permissions,
		threadsQuery,
		threadQuery,
		flush,
		go,
		summary,
	};
};

const notFound = new HttpErrorResponse({ status: 404 });

beforeEach(() => {
	sessionStorage.clear();
	localStorage.clear();
});
afterEach(() => vi.restoreAllMocks());

describe('senderName', () => {
	it('shows the display name, else the address', () => {
		expect(senderName('"Ananya Das" <ananya@example.com>')).toBe('Ananya Das');
		expect(senderName('<rahul@example.com>')).toBe('rahul@example.com');
	});
});

describe('inboxMatcher', () => {
	const segments = (...paths: string[]) => paths.map((path) => ({ path, parameters: {} })) as never;
	it('reads mailbox, folder and conversation from the address, and nothing deeper (T5)', () => {
		expect(inboxMatcher(segments())?.posParams).toEqual({});
		const match = inboxMatcher(segments('wecare', 'sent', 't1'));
		expect(Object.keys(match?.posParams ?? {})).toEqual(['mailbox', 'folder', 'thread']);
		expect(inboxMatcher(segments('a', 'b', 'c', 'd'))).toBeNull();
	});
});

describe('Inbox mailboxes', () => {
	it('lists each mailbox with its state, and its aliases as From choices (U1)', () => {
		const { page, summary } = setup();
		expect(page.loadingMailboxes()).toBe(false);
		summary([
			box('care', { unread: 2 }),
			box('accounts', { canSend: false, sendAs: [] }),
			box('orders', { status: 'needs_reconnect' }),
		]);
		expect(page.mailbox()?.mailboxId).toBe('mbx-care');
		expect(page.mailboxChoices().map((choice) => choice.data)).toEqual([
			{ unread: 2, state: 'inbox_state_send', aliases: 1, broken: false },
			{ unread: 0, state: 'inbox_state_read', aliases: 0, broken: false },
			{ unread: 0, state: 'inbox_state_reconnect', aliases: 1, broken: true },
		]);
		expect(page.fromChoices()).toEqual([
			{ value: 'care@shop.test', label: 'care@shop.test' },
			{ value: 'help-care@shop.test', label: 'help-care@shop.test (inbox_alias)' },
		]);
		expect(page.managesMailboxes()).toBe(false);
	});

	it('opens the mailbox and folder used last, or the first, and says when a link names one not given', () => {
		const { page, router, summary, go } = setup({});
		localStorage.setItem('inbox.last', JSON.stringify({ mailbox: 'orders', folder: 'sent' }));
		summary([box('care'), box('orders')]);
		expect(router.navigate).toHaveBeenLastCalledWith(['/inbox', 'orders', 'sent'], { replaceUrl: true });
		go({ mailbox: 'orders', folder: 'sent' });
		expect(JSON.parse(localStorage.getItem('inbox.last') ?? '')).toEqual({ mailbox: 'orders', folder: 'sent' });

		go({ mailbox: 'director', folder: 'inbox' });
		expect(page.noAccess()).toBe('director');
		expect(router.navigate).toHaveBeenLastCalledWith(['/inbox', 'care', 'inbox'], { replaceUrl: true });

		go({ mailbox: 'care', folder: 'inbox' });
		expect(page.noAccess()).toBe('director');
		go({ mailbox: 'care', folder: 'sent' });
		expect(page.noAccess()).toBeNull();

		page.chooseMailbox({ value: 'mbx-orders' } as never);
		expect(router.navigate).toHaveBeenLastCalledWith(['/inbox', 'orders', 'inbox']);
		router.navigate.mockClear();
		page.chooseMailbox({ value: 'mbx-gone' } as never);
		expect(router.navigate).not.toHaveBeenCalled();
	});

	it('falls back to the first mailbox when the remembered one is gone or unreadable', () => {
		const { router, summary } = setup({});
		localStorage.setItem('inbox.last', JSON.stringify({ mailbox: 'gone', folder: 'odd' }));
		summary([box('care')]);
		expect(router.navigate).toHaveBeenLastCalledWith(['/inbox', 'care', 'inbox'], { replaceUrl: true });
		const second = setup({});
		localStorage.setItem('inbox.last', '{');
		second.summary([box('care')]);
		expect(second.router.navigate).toHaveBeenLastCalledWith(['/inbox', 'care', 'inbox'], { replaceUrl: true });
		const third = setup({});
		localStorage.setItem('inbox.last', JSON.stringify({ mailbox: 'care', folder: 'odd' }));
		third.summary([box('care')]);
		expect(third.router.navigate).toHaveBeenLastCalledWith(['/inbox', 'care', 'inbox'], { replaceUrl: true });
	});

	it('survives a blocked browser store', () => {
		vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
			throw new Error('blocked');
		});
		const { page, summary } = setup();
		expect(() => summary([box('care')])).not.toThrow();
		expect(page.mailbox()?.address).toBe('care@shop.test');
	});

	it('offers Try again when the mailboxes cannot be read, and Open in Gmail to those who manage them', () => {
		const { page, summary, permissions } = setup();
		summary(undefined, { error: new Error('down') });
		expect(page.summaryFailed()).toBe(true);
		page.reloadMailboxes();
		expect(state.summaryRefetch).toHaveBeenCalled();
		permissions.set(['mailbox.use', 'mailbox.manage']);
		expect(page.managesMailboxes()).toBe(true);
	});

	it('shows nothing to open without mailboxes, and reads nothing from a broken one', () => {
		const { page, summary, threadsQuery } = setup();
		summary([]);
		expect(page.mailbox()).toBeNull();
		summary([box('care', { status: 'needs_reconnect' })]);
		expect(page.connected()).toBe(false);
		expect(threadsQuery.options().enabled).toBe(false);
		expect(page.readOnly()).toBe(false);
	});
});

describe('Inbox list', () => {
	it('reads the folder, search and page in the address, every minute (T5, U11)', async () => {
		const { page, summary, threadsQuery, gateway, go } = setup(
			{ mailbox: 'care', folder: 'all' },
			{ q: 'from:rahul' },
		);
		summary([box('care')]);
		const options = threadsQuery.options();
		expect(options.queryKey).toEqual(['inbox', 'mbx-care', 'threads', 'all', '', 'from:rahul', '']);
		expect(options.enabled).toBe(true);
		await options.queryFn();
		expect(gateway.threads).toHaveBeenCalledWith('mbx-care', 'all', 'from:rahul', undefined, undefined);
		expect(page.searchText()).toBe('from:rahul');
		expect(page.listQuery()).toEqual({ q: 'from:rahul' });
		go({ mailbox: 'care', folder: 'nonsense' });
		expect(page.folder()).toBe('inbox');
		expect(page.listQuery()).toBeNull();
		await threadsQuery.options().queryFn();
		expect(gateway.threads).toHaveBeenLastCalledWith('mbx-care', 'inbox', undefined, undefined, undefined);
	});

	it('searches All mail and clears back to the Inbox', () => {
		const { page, summary, router } = setup();
		summary([box('care')]);
		page.searchText.set('  has:attachment ');
		page.search();
		expect(router.navigate).toHaveBeenLastCalledWith(['/inbox', 'care', 'all'], {
			queryParams: { q: 'has:attachment' },
		});
		page.searchText.set('   ');
		page.search();
		expect(router.navigate).toHaveBeenLastCalledWith(['/inbox', 'care', 'inbox']);
		expect(page.searchText()).toBe('');
	});

	it('holds the rows shown when new mail arrives, until Show (T7)', () => {
		const { page, summary, threadsQuery, flush } = setup();
		summary([box('care')]);
		expect(page.threads()).toEqual([]);
		expect(page.waiting()).toBe(0);
		threadsQuery.result.set({ data: { threads: [row('t1'), row('t2')], nextPageToken: null } });
		flush();
		expect(page.threads().map((entry) => entry.id)).toEqual(['t1', 't2']);
		threadsQuery.result.set({
			data: { threads: [row('t9'), row('t1', { unread: true }), row('t2')], nextPageToken: null },
		});
		flush();
		expect(page.threads().map((entry) => entry.id)).toEqual(['t1', 't2']);
		expect(page.threads()[0]?.unread).toBe(true);
		expect(page.waiting()).toBe(1);
		page.showWaiting();
		expect(page.threads().map((entry) => entry.id)).toEqual(['t9', 't1', 't2']);
		expect(page.waiting()).toBe(0);
		threadsQuery.result.set({ data: { threads: [row('t1')], nextPageToken: null } });
		flush();
		expect(page.threads().map((entry) => entry.id)).toEqual(['t1']);
	});

	it('steps to older and newer pages', () => {
		const { page, summary, threadsQuery, flush } = setup();
		summary([box('care')]);
		page.older();
		expect(page.firstPage()).toBe(true);
		threadsQuery.result.set({ data: { threads: [row('t1')], nextPageToken: 'p2' } });
		flush();
		expect(page.nextPage()).toBe('p2');
		page.older();
		expect(page.firstPage()).toBe(false);
		expect(threadsQuery.options().queryKey.at(-1)).toBe('p2');
		page.newer();
		expect(page.firstPage()).toBe(true);
	});

	it('says when Gmail does not answer, with Try again, and re-reads the mailboxes on a 404 (T3)', () => {
		const { page, summary, threadsQuery, client, flush } = setup();
		summary([box('care')]);
		threadsQuery.result.set({ pending: true });
		flush();
		expect(page.loadingThreads()).toBe(true);
		threadsQuery.result.set({ error: new HttpErrorResponse({ status: 502 }) });
		flush();
		expect(page.listFailed()).toBe(true);
		page.retryList();
		expect(threadsQuery.refetch).toHaveBeenCalled();
		expect(client.invalidateQueries).not.toHaveBeenCalled();
		threadsQuery.result.set({ error: notFound });
		flush();
		expect(client.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['inbox'], exact: true });
	});
});

describe('Inbox conversation', () => {
	it('opens from the address, marks it read once, folds older messages and moves focus (E2, T12)', async () => {
		vi.useFakeTimers();
		const { page, summary, threadQuery, gateway, client, flush } = setup({
			mailbox: 'care',
			folder: 'inbox',
			thread: 't1',
		});
		summary([box('care')]);
		const options = threadQuery.options();
		expect(options.queryKey).toEqual(['inbox', 'mbx-care', 'thread', 't1']);
		await options.queryFn();
		expect(gateway.thread).toHaveBeenCalledWith('mbx-care', 't1');
		const retry = options.retry as (count: number, error: unknown) => boolean;
		expect(retry(0, notFound)).toBe(false);
		expect(retry(0, new Error('x'))).toBe(true);
		expect(retry(1, new Error('x'))).toBe(false);

		const subject = document.createElement('h4');
		subject.id = 'inbox_subject';
		subject.tabIndex = -1;
		document.body.append(subject);
		const unread = (...ids: string[]) => {
			const base = conversation(...ids);
			return { ...base, unread: true, messages: base.messages.map((entry) => ({ ...entry, unread: true })) };
		};
		threadQuery.result.set({ data: unread('m1', 'm2', 'm3') });
		flush();
		vi.runAllTimers();
		expect(document.activeElement).toBe(subject);
		subject.remove();
		// Exactly the messages shown are marked, never the conversation as a whole (R6).
		await vi.waitFor(() => expect(gateway.markMessages).toHaveBeenCalledWith('mbx-care', ['m1', 'm2', 'm3'], true));
		expect(gateway.modify).not.toHaveBeenCalled();
		expect(client.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['inbox'] });
		threadQuery.result.set({ data: unread('m1', 'm2', 'm3') });
		flush();
		expect(gateway.markMessages).toHaveBeenCalledTimes(1);
		// A reply that arrives later is marked when it shows; the ones already marked are not sent again.
		threadQuery.result.set({ data: unread('m1', 'm2', 'm3', 'm4') });
		flush();
		await vi.waitFor(() => expect(gateway.markMessages).toHaveBeenLastCalledWith('mbx-care', ['m4'], true));
		// Marked unread on purpose, then opened again: read again, as in Gmail.
		await page.act('mark_unread');
		threadQuery.result.set({ data: unread('m1', 'm2', 'm3', 'm4') });
		flush();
		await vi.waitFor(() =>
			expect(gateway.markMessages).toHaveBeenLastCalledWith('mbx-care', ['m1', 'm2', 'm3', 'm4'], true),
		);

		threadQuery.result.set({ data: conversation('m1', 'm2', 'm3', 'm4') });
		flush();
		const all = (page.thread()?.messages ?? []) as ReturnType<typeof message>[];
		const [first] = all;
		const last = all.at(-1);
		expect(page.isFolded(first as never)).toBe(true);
		expect(page.isFolded(last as never)).toBe(false);
		page.unfold(first as never);
		expect(page.isFolded(first as never)).toBe(false);
		vi.useRealTimers();
	});

	it('returns focus to the row when the conversation closes', () => {
		vi.useFakeTimers();
		const { summary, threadQuery, flush, go } = setup({ mailbox: 'care', folder: 'inbox', thread: 't1' });
		summary([box('care')]);
		threadQuery.result.set({ data: conversation('m1') });
		flush();
		const link = document.createElement('a');
		link.id = 'inbox_row_t1';
		link.href = '#';
		document.body.append(link);
		go({ mailbox: 'care', folder: 'inbox' });
		vi.runAllTimers();
		expect(document.activeElement).toBe(link);
		link.remove();
		vi.useRealTimers();
	});

	it('unfolds quoted text and pictures per message, in the frame (E1)', () => {
		const { page, summary, threadQuery, flush } = setup({ mailbox: 'care', folder: 'inbox', thread: 't1' });
		summary([box('care')]);
		threadQuery.result.set({ data: conversation('m1') });
		flush();
		const first = page.thread()?.messages[0] as never;
		const frame = () => JSON.stringify(page.frames().get('m1'));
		expect(frame()).not.toContain('older');
		page.toggleQuote(first);
		expect(page.quoteShown(first)).toBe(true);
		expect(frame()).toContain('older');
		page.toggleQuote(first);
		expect(page.quoteShown(first)).toBe(false);
		expect(page.picturesShown(first)).toBe(false);
		page.showPictures(first);
		expect(page.picturesShown(first)).toBe(true);
		expect(page.gmailLink()).toBe('https://mail.google.com/mail/?authuser=care%40shop.test#all/t1');
	});

	it('says when a conversation was moved or deleted, or Gmail did not answer', () => {
		const { page, summary, threadQuery, flush } = setup({ mailbox: 'care', folder: 'inbox', thread: 't1' });
		summary([box('care')]);
		expect(page.gmailLink()).toBe('');
		threadQuery.result.set({ pending: true });
		flush();
		expect(page.loadingThread()).toBe(true);
		threadQuery.result.set({ error: notFound });
		flush();
		expect(page.threadGone()).toBe(true);
		threadQuery.result.set({ error: new HttpErrorResponse({ status: 502 }) });
		flush();
		expect(page.threadFailed()).toBe(true);
		page.retryThread();
		expect(threadQuery.refetch).toHaveBeenCalled();
	});

	it('archives, reports spam and marks unread, closing what leaves the folder (E12)', async () => {
		const { page, summary, gateway, notifier, router, go } = setup({
			mailbox: 'care',
			folder: 'inbox',
			thread: 't1',
		});
		summary([box('care')]);
		await page.act('spam');
		expect(gateway.modify).toHaveBeenLastCalledWith('mbx-care', 't1', 'spam', undefined);
		expect(notifier.showSuccess).toHaveBeenLastCalledWith('inbox_reported_spam');
		expect(page.announcement()).toBe('inbox_reported_spam');
		expect(router.navigate).toHaveBeenLastCalledWith(['/inbox', 'care', 'inbox'], { queryParams: null });
		router.navigate.mockClear();
		await page.act('mark_read');
		expect(router.navigate).not.toHaveBeenCalled();
		go({ mailbox: 'care', folder: 'inbox' });
		gateway.modify.mockClear();
		await page.act('archive');
		expect(gateway.modify).not.toHaveBeenCalled();
	});

	it('warns before downloading a file that can run programs (T10)', () => {
		const { page, summary, modals } = setup();
		summary([box('care')]);
		const open = vi.spyOn(window, 'open').mockReturnValue(null);
		const event = { preventDefault: vi.fn() } as unknown as Event;
		const msg = message('m1') as never;
		page.download(event, msg, { id: 'a1', filename: 'bill.pdf', mimeType: 'application/pdf', size: 1 });
		expect(event.preventDefault).not.toHaveBeenCalled();
		page.download(event, msg, { id: 'a2', filename: 'tool.exe', mimeType: 'application/octet-stream', size: 1 });
		expect(event.preventDefault).toHaveBeenCalled();
		expect(page.runnableName()).toBe('tool.exe');
		expect(modals.open).toHaveBeenCalled();
		page.downloadAnyway();
		expect(modals.dismissAll).toHaveBeenCalled();
		expect(open).toHaveBeenCalledWith('mbx-care/m1/a2/tool.exe', '_blank', 'noopener');
		expect(page.attachmentUrl(msg, { id: 'a1', filename: 'b.pdf', mimeType: '', size: 1 })).toBe(
			'mbx-care/m1/a1/b.pdf',
		);
		expect([page.size(820), page.size(14_336), page.size(2_411_725)]).toEqual(['820 B', '14 KB', '2.3 MB']);
	});

	it('keeps a frame fitted to its content, and leaves one it cannot read alone (T8)', () => {
		const observe = vi.fn();
		const disconnect = vi.fn();
		let fit: () => void = () => undefined;
		vi.stubGlobal(
			'ResizeObserver',
			class {
				constructor(callback: () => void) {
					fit = callback;
				}
				observe = observe;
				disconnect = disconnect;
			},
		);
		const { page } = setup();
		const body = { offsetHeight: 120 };
		const frame = { contentDocument: { body }, style: { height: '' } };
		page.fitFrame({ target: frame } as unknown as Event);
		expect(frame.style.height).toBe('120px');
		body.offsetHeight = 300;
		fit();
		expect(frame.style.height).toBe('300px');
		body.offsetHeight = 0;
		fit();
		expect(frame.style.height).toBe('300px');
		page.fitFrame({ target: { contentDocument: null, style: {} } } as unknown as Event);
		expect(observe).toHaveBeenCalledTimes(1);
		fixture.destroy();
		expect(disconnect).toHaveBeenCalled();
		vi.unstubAllGlobals();
		const plain = setup();
		const other = { contentDocument: { body: { offsetHeight: 50 } }, style: { height: '' } };
		plain.page.fitFrame({ target: other } as unknown as Event);
		expect(other.style.height).toBe('50px');
	});

	it('navigates back, to a new message and into a reply', () => {
		const { page, summary, router } = setup({ mailbox: 'care', folder: 'inbox', thread: 't1' }, { q: 'x' });
		summary([box('care')]);
		page.back();
		expect(router.navigate).toHaveBeenLastCalledWith(['/inbox', 'care', 'inbox'], { queryParams: { q: 'x' } });
		page.compose();
		expect(router.navigate).toHaveBeenLastCalledWith(['/inbox', 'care', 'inbox'], {
			queryParams: { q: 'x', draft: 'new' },
		});
		page.startDraft('reply');
		expect(router.navigate).toHaveBeenLastCalledWith(
			[],
			expect.objectContaining({ queryParams: { draft: 'reply' } }),
		);
		page.closeDraft();
		expect(router.navigate).toHaveBeenLastCalledWith([], expect.objectContaining({ queryParams: { draft: null } }));
	});
});

describe('Inbox drafts', () => {
	const replying = () => {
		const tools = setup({ mailbox: 'care', folder: 'inbox', thread: 't1' }, { draft: 'reply' });
		tools.summary([box('care')]);
		tools.threadQuery.result.set({ data: conversation('m1') });
		tools.flush();
		return tools;
	};

	it('starts a reply that quotes the answered message, and keeps its text in this tab (E3, T6)', () => {
		const { page, threadQuery, flush } = replying();
		expect(page.draft()).toMatchObject({
			mode: 'reply',
			to: 'rahul@example.com',
			quoteMessageId: 'm1',
			knownIds: ['m1'],
		});
		page.editDraft('body', 'Typed');
		threadQuery.result.set({ data: conversation('m1') });
		flush();
		expect(page.draft()?.body).toBe('Typed');
		expect(page.answered()?.id).toBe('m1');
		expect(page.reading()).toBe(true);
		page.editDraft('body', 'Thanks');
		page.chooseFrom({ value: 'help-care@shop.test' } as never);
		page.chooseFrom({ value: null } as never);
		page.setIncludeQuote(false);
		page.setIncludeAttachments(true);
		expect(keptDraft(draftKey('mbx-care', 't1', 'reply'), 'reply')).toMatchObject({
			body: 'Thanks',
			from: 'help-care@shop.test',
			includeQuote: false,
			includeAttachments: true,
		});
		expect(page.signature()).toBeNull();
		page.chooseFrom({ value: 'care@shop.test' } as never);
		expect(page.signature()).not.toBeNull();
	});

	it('brings kept text back, and starts a new message from the main address', () => {
		const key = draftKey('mbx-care', 't1', 'reply');
		keepDraft(key, {
			...newDraft('care@shop.test'),
			mode: 'reply',
			body: 'Kept',
			threadId: 't1',
			knownIds: ['m1'],
		});
		const { page } = replying();
		expect(page.draft()?.body).toBe('Kept');
		const fresh = setup({ mailbox: 'care', folder: 'inbox' }, { draft: 'new' });
		fresh.summary([box('care')]);
		expect(fresh.page.draft()).toMatchObject({ mode: 'new', from: 'care@shop.test' });
		fresh.go({ mailbox: 'care', folder: 'inbox' }, {});
		expect(fresh.page.draft()).toBeNull();
	});

	it('writes no draft for a reader, or before the conversation arrives', () => {
		const reader = setup({ mailbox: 'care', folder: 'inbox' }, { draft: 'new' });
		reader.summary([box('care', { canSend: false })]);
		expect(reader.page.draft()).toBeNull();
		expect(reader.page.readOnly()).toBe(true);
		const early = setup({ mailbox: 'care', folder: 'inbox', thread: 't1' }, { draft: 'reply' });
		early.summary([box('care')]);
		expect(early.page.draft()).toBeNull();
		early.page.editDraft('body', 'x');
		expect(early.page.draft()).toBeNull();
	});

	it('checks addresses while typing and refuses to send what is unfinished (T9)', async () => {
		const { page, gateway } = replying();
		page.editDraft('to', 'rahul@example.com, nope');
		expect(page.toProblems()).toEqual(['nope']);
		page.editDraft('cc', 'x');
		expect(page.ccProblems()).toEqual(['x']);
		await page.send();
		expect(page.sendProblem()).toBe('inbox_check_addresses');
		expect(gateway.send).not.toHaveBeenCalled();
		page.pickFiles({ target: { files: [new File(['a'], 'a.txt')] } } as unknown as Event);
		expect(page.files()).toHaveLength(1);
		page.pickFiles({ target: { files: null } } as unknown as Event);
		expect(page.files()).toEqual([]);
	});

	it('stops when someone answered after the reply was started, then reviews or sends anyway (E9)', async () => {
		const { page, gateway, client } = replying();
		page.editDraft('body', 'Hello');
		gateway.thread.mockReturnValue(
			of({
				...conversation('m1'),
				messages: [message('m1'), message('m2', { sentBy: 'Arup', date: new Date().toISOString() })],
			}),
		);
		await page.send();
		expect(client.fetchQuery).toHaveBeenCalled();
		expect(page.collision()).toEqual({ name: 'Arup', minutes: 0 });
		expect(gateway.send).not.toHaveBeenCalled();
		page.review();
		expect(page.collision()).toBeNull();
		expect(page.allOpen()).toBe(true);
		expect(page.draft()?.knownIds).toEqual(['m1']);
		await page.send();
		expect(page.collision()?.name).toBe('Arup');
		page.sendAnyway();
		await vi.waitFor(() => expect(gateway.send).toHaveBeenCalled());
	});

	it('names a sender without a staff name by their own name in a collision', async () => {
		const { page, gateway } = replying();
		gateway.thread.mockReturnValue(of({ ...conversation('m1'), messages: [message('m1'), message('m2')] }));
		await page.send();
		expect(page.collision()?.name).toBe('Rahul');
	});

	it('sends, says so, forgets the kept text and closes the draft', async () => {
		const { page, gateway, notifier, router, client } = replying();
		page.editDraft('body', 'Hello');
		await page.send();
		expect(gateway.send).toHaveBeenCalledWith(
			'mbx-care',
			expect.objectContaining({ quoteMessageId: 'm1', threadId: 't1' }),
		);
		expect(notifier.showSuccess).toHaveBeenCalledWith('inbox_sent');
		expect(page.announcement()).toBe('inbox_sent');
		expect(page.draft()).toBeNull();
		expect(keptDraft(draftKey('mbx-care', 't1', 'reply'), 'reply')).toBeNull();
		expect(router.navigate).toHaveBeenLastCalledWith([], expect.objectContaining({ queryParams: { draft: null } }));
		expect(client.invalidateQueries).toHaveBeenCalled();
		page.sending.set(true);
		await page.send();
		expect(gateway.send).toHaveBeenCalledTimes(1);
	});

	it('keeps the text and says why a send failed', async () => {
		const { page, gateway, client } = replying();
		page.editDraft('body', 'Hello');
		gateway.send.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 400 })));
		await page.send();
		expect(page.sendProblem()).toBe('inbox_from_rejected');
		expect(client.invalidateQueries).toHaveBeenCalled();
		expect(page.draft()?.body).toBe('Hello');
		gateway.send.mockReturnValueOnce(throwError(() => new Error('offline')));
		await page.send();
		expect(page.sendProblem()).toBe('inbox_not_sent');
		gateway.send.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 413 })));
		await page.send();
		expect(page.sendProblem()).toBe('inbox_files_too_big');
	});

	it('sends a new message without reading a conversation first', async () => {
		const { page, summary, client, gateway } = setup({ mailbox: 'care', folder: 'inbox' }, { draft: 'new' });
		summary([box('care')]);
		page.editDraft('to', 'a@x.test');
		page.editDraft('subject', 'Hello');
		await page.send();
		expect(client.fetchQuery).not.toHaveBeenCalled();
		expect(gateway.send).toHaveBeenCalled();
	});

	it('asks before discarding written text, and discards an empty draft at once (T6)', () => {
		const { page, modals, router } = replying();
		page.editDraft('body', 'Half written');
		page.discard();
		expect(modals.open).toHaveBeenCalled();
		page.discardNow();
		expect(modals.dismissAll).toHaveBeenCalled();
		expect(page.draft()).toBeNull();
		expect(router.navigate).toHaveBeenLastCalledWith([], expect.objectContaining({ queryParams: { draft: null } }));
		modals.open.mockClear();
		page.discard();
		expect(modals.open).not.toHaveBeenCalled();
	});

	it('asks the browser before closing a tab with unsent text', () => {
		const { page } = replying();
		const event = { preventDefault: vi.fn() } as unknown as BeforeUnloadEvent;
		page.warnBeforeLeaving(event);
		expect(event.preventDefault).not.toHaveBeenCalled();
		page.editDraft('body', 'x');
		page.warnBeforeLeaving(event);
		expect(event.preventDefault).toHaveBeenCalled();
	});
});
