import { HttpErrorResponse } from '@angular/common/http';
import { signal, type WritableSignal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, type Params } from '@angular/router';

import { ToastrService } from '@damjantonkli/ngx-toastr';
import { TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { toHTML } from 'ngx-editor';
import { BehaviorSubject, Subject, of, throwError } from 'rxjs';
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
		allThreads: vi.fn((..._args: unknown[]) => of({ threads: [] as unknown[], skipped: [] as unknown[] })),
		modify: vi.fn((..._args: unknown[]) => of({ ok: true })),
		markMessages: vi.fn((..._args: unknown[]) => of({ ok: true })),
		labels: vi.fn((..._args: unknown[]) => of([])),
		send: vi.fn((..._args: unknown[]) =>
			of({ outboxId: 'o1', draftId: 'd1', sendAt: new Date(Date.now() + 10_000).toISOString() }),
		),
		outboxStatus: vi.fn((..._args: unknown[]) =>
			of({ outboxId: 'o1', status: 'sent', draftId: 'd1', threadId: 't1', sentMessageId: 's1' }),
		),
		cancelSend: vi.fn((..._args: unknown[]) => of({ draftId: 'd1' })),
		drafts: vi.fn((..._args: unknown[]) => of({ drafts: [], nextPageToken: null })),
		draft: vi.fn((..._args: unknown[]) => of(gmailDraft())),
		saveDraft: vi.fn((..._args: unknown[]) =>
			of({ draftId: 'd1', version: 'v1', savedAt: '2026-11-19T10:41:00.000Z' }),
		),
		deleteDraft: vi.fn((..._args: unknown[]) => of(undefined)),
		savedReplies: vi.fn((..._args: unknown[]) => of({ shared: [], personal: [], canEditShared: false })),
		createSavedReply: vi.fn((..._args: unknown[]) => of({})),
		updateSavedReply: vi.fn((..._args: unknown[]) => of({})),
		deleteSavedReply: vi.fn((..._args: unknown[]) => of(undefined)),
		attachmentUrl: vi.fn((...args: unknown[]) => args.join('/')),
	};
	const client = {
		invalidateQueries: vi.fn(async (..._args: unknown[]) => undefined),
		fetchQuery: vi.fn(async (options: { queryFn: () => Promise<unknown> }) => options.queryFn()),
	};
	const notifier = { showSuccess: vi.fn(), showError: vi.fn() };
	const undo = new Subject<void>();
	const toastr = { info: vi.fn((..._args: unknown[]) => ({ onAction: undo, toastId: 1 })) };
	const router = { navigate: vi.fn(async (..._args: unknown[]) => true) };
	const modals = { open: vi.fn(), dismissAll: vi.fn() };
	const permissions = signal<string[]>(['mailbox.use']);
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: MailboxGateway, useValue: gateway },
			{ provide: QueryClient, useValue: client },
			{ provide: NotificationService, useValue: notifier },
			{ provide: ToastrService, useValue: toastr },
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
			template:
				'<ng-template #discardModal>d</ng-template><ng-template #runnableModal>r</ng-template><ng-template #repliesModal>s</ng-template>',
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
		toastr,
		undo,
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

/** A Gmail draft as the API answers it. */
function gmailDraft(fields: Record<string, unknown> = {}) {
	return {
		draftId: 'd1',
		version: 'v1',
		threadId: null,
		from: 'care@shop.test',
		to: 'ananya@example.com',
		cc: '',
		bcc: '',
		subject: 'Saree sizes',
		text: 'Dear Ananya,',
		attachments: [],
		date: '2026-11-19T10:40:00.000Z',
		inReplyTo: null,
		quoteMessageId: null,
		forwardAttachmentsFrom: null,
		...fields,
	};
}

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

	it('slides new mail in when nothing would be disturbed, and tints it for a moment (R3)', () => {
		vi.useFakeTimers();
		const { page, summary, threadsQuery, flush } = setup();
		summary([box('care')]);
		threadsQuery.result.set({ data: { threads: [row('t1')], nextPageToken: null } });
		flush();
		threadsQuery.result.set({ data: { threads: [row('t9'), row('t1')], nextPageToken: null } });
		flush();
		expect(page.threads().map((entry) => entry.id)).toEqual(['t9', 't1']);
		expect(page.waiting()).toBe(0);
		expect(page.arrived().has('t9')).toBe(true);
		expect(page.announcement()).toBe('inbox_new_arrived');
		vi.advanceTimersByTime(4000);
		expect(page.arrived().size).toBe(0);
		vi.useRealTimers();
	});

	it('holds the rows shown when new mail arrives while rows are ticked, until Show (T7)', () => {
		const { page, summary, threadsQuery, flush } = setup();
		summary([box('care')]);
		expect(page.threads()).toEqual([]);
		expect(page.waiting()).toBe(0);
		threadsQuery.result.set({ data: { threads: [row('t1'), row('t2')], nextPageToken: null } });
		flush();
		expect(page.threads().map((entry) => entry.id)).toEqual(['t1', 't2']);
		page.toggleRow('t2', true);
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

	it('keeps ticks through a search, and clears them for another folder (D7, accounts brief H)', () => {
		const { page, summary, threadsQuery, flush, go } = setup();
		summary([box('care')]);
		threadsQuery.result.set({ data: { threads: [row('t1'), row('t2')], nextPageToken: null } });
		flush();
		page.toggleRow('t2', true);
		go({ mailbox: 'care', folder: 'inbox' }, { q: 'saree' });
		threadsQuery.result.set({ data: { threads: [row('t5')], nextPageToken: null } });
		flush();
		expect([...page.selected()]).toEqual(['t2']);
		expect(page.selectedRows().map((entry) => entry.id)).toEqual(['t2']);
		go({ mailbox: 'care', folder: 'sent' });
		expect(page.selected().size).toBe(0);
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
		// A reply that arrives while it is open waits behind Show, still unread (R5); once shown it is
		// marked, and the ones already marked are not sent again.
		threadQuery.result.set({ data: unread('m1', 'm2', 'm3', 'm4') });
		flush();
		expect(page.newReplies()).toBe(1);
		expect(page.thread()?.messages.map((entry) => entry.id)).toEqual(['m1', 'm2', 'm3']);
		expect(gateway.markMessages).toHaveBeenCalledTimes(1);
		page.showNewReplies();
		flush();
		expect(page.newReplies()).toBe(0);
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
		expect(router.navigate).toHaveBeenLastCalledWith(
			[],
			expect.objectContaining({ queryParams: { draft: null, d: null } }),
		);
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

	it('sends with ten seconds to undo, forgets the kept text and closes the draft (C4)', async () => {
		const { page, gateway, toastr, router, client } = replying();
		page.editDraft('body', 'Hello');
		await page.send();
		expect(gateway.send).toHaveBeenCalledWith(
			'mbx-care',
			expect.objectContaining({ quoteMessageId: 'm1', threadId: 't1', keepDraftAttachments: false }),
		);
		expect(toastr.info).toHaveBeenCalledWith(
			'inbox_sending_in',
			undefined,
			expect.objectContaining({ payload: { action: 'inbox_undo_send' } }),
		);
		expect(page.announcement()).toBe('inbox_sending_in');
		expect(page.draft()).toBeNull();
		expect(keptDraft(draftKey('mbx-care', 't1', 'reply'), 'reply')).toBeNull();
		expect(router.navigate).toHaveBeenLastCalledWith(
			[],
			expect.objectContaining({ queryParams: { draft: null, d: null } }),
		);
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

	it('asks before discarding written text, and discards an empty draft at once (T6)', async () => {
		const { page, modals, router } = replying();
		page.editDraft('body', 'Half written');
		page.discard();
		expect(modals.open).toHaveBeenCalled();
		await page.discardNow();
		expect(modals.dismissAll).toHaveBeenCalled();
		expect(page.draft()).toBeNull();
		expect(router.navigate).toHaveBeenLastCalledWith(
			[],
			expect.objectContaining({ queryParams: { draft: null, d: null } }),
		);
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

describe('Inbox Gmail drafts and Undo Send (C2, C4)', () => {
	afterEach(() => vi.useRealTimers());

	const replying = () => {
		const tools = setup({ mailbox: 'care', folder: 'inbox', thread: 't1' }, { draft: 'reply' });
		tools.summary([box('care')]);
		tools.threadQuery.result.set({ data: conversation('m1') });
		tools.flush();
		return tools;
	};

	it('saves to Gmail a few seconds after typing stops, then says so', async () => {
		vi.useFakeTimers();
		const { page, gateway } = replying();
		expect(gateway.saveDraft).not.toHaveBeenCalled();
		page.editDraft('body', 'Dear');
		page.editDraft('body', 'Dear Rahul');
		await vi.advanceTimersByTimeAsync(2_999);
		expect(gateway.saveDraft).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		expect(gateway.saveDraft).toHaveBeenCalledTimes(1);
		expect(gateway.saveDraft).toHaveBeenCalledWith(
			'mbx-care',
			null,
			expect.objectContaining({ body: 'Dear Rahul', keepAttachments: false }),
		);
		expect(page.saveState()).toBe('saved');
		expect(page.savedAt()).toBe('2026-11-19T10:41:00.000Z');
		expect(page.draft()).toMatchObject({ gmailDraftId: 'd1', version: 'v1' });
		// The next save updates the same draft, naming the version it saw.
		page.editDraft('body', 'Dear Rahul, yes');
		await vi.advanceTimersByTimeAsync(3_000);
		expect(gateway.saveDraft).toHaveBeenLastCalledWith(
			'mbx-care',
			'd1',
			expect.objectContaining({ version: 'v1' }),
		);
	});

	it('makes no Gmail draft for a reply opened and left untouched, or emptied again', async () => {
		vi.useFakeTimers();
		const { page, gateway } = replying();
		await vi.advanceTimersByTimeAsync(5_000);
		expect(gateway.saveDraft).not.toHaveBeenCalled();
		expect(page.saveState()).toBe('idle');
		page.editDraft('to', '');
		await vi.advanceTimersByTimeAsync(5_000);
		expect(gateway.saveDraft).not.toHaveBeenCalled();
	});

	it('sends saved files once and keeps them in the draft afterwards', async () => {
		vi.useFakeTimers();
		const { page, gateway } = replying();
		page.editDraft('body', 'See the chart');
		page.files.set([new File(['%PDF'], 'chart.pdf', { type: 'application/pdf' })]);
		await page.saveNow();
		expect(page.files()).toEqual([]);
		expect(page.draft()?.savedFiles).toEqual([{ name: 'chart.pdf', size: 4 }]);
		await page.saveNow();
		const body = gateway.saveDraft.mock.calls.at(-1)?.[2] as { attachments: unknown[]; keepAttachments: boolean };
		expect(body.attachments).toEqual([]);
		expect(body.keepAttachments).toBe(true);
	});

	it('offers a choice when someone saved the draft meanwhile, and says when it is offline', async () => {
		const { page, gateway } = replying();
		page.editDraft('body', 'Mine');
		await page.saveNow();
		gateway.saveDraft.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 412 })));
		page.editDraft('body', 'Mine, longer');
		await page.saveNow();
		expect(page.saveState()).toBe('conflict');
		page.keepMine();
		await vi.waitFor(() => expect(page.saveState()).toBe('saved'));
		expect(gateway.saveDraft.mock.calls.at(-1)?.[2]).not.toHaveProperty('version');
		gateway.saveDraft.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 412 })));
		await page.saveNow();
		gateway.draft.mockReturnValueOnce(of(gmailDraft({ text: 'Theirs', version: 'v9', inReplyTo: '<m1@x>' })));
		await page.useTheirs();
		expect(page.draft()).toMatchObject({ body: 'Theirs', version: 'v9', knownIds: ['m1'] });
		gateway.saveDraft.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 0 })));
		await page.saveNow();
		expect(page.saveState()).toBe('offline');
		expect(page.draft()?.body).toBe('Theirs');
	});

	it('sends from the saved draft, and Undo reopens it in Drafts', async () => {
		const { page, gateway, undo, notifier, router } = replying();
		page.editDraft('body', 'Hello');
		await page.saveNow();
		await page.send();
		expect(gateway.send).toHaveBeenCalledWith('mbx-care', expect.objectContaining({ draftId: 'd1' }));
		undo.next();
		await vi.waitFor(() => expect(gateway.cancelSend).toHaveBeenCalledWith('mbx-care', 'o1'));
		await vi.waitFor(() => expect(notifier.showSuccess).toHaveBeenCalledWith('inbox_send_undone'));
		expect(router.navigate).toHaveBeenLastCalledWith(['/inbox', 'care', 'drafts'], {
			queryParams: { draft: 'open', d: 'd1' },
		});
		gateway.cancelSend.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 409 })));
		await page.undoSend('mbx-care', { outboxId: 'o2', draftId: 'd1', sendAt: '' });
		expect(notifier.showError).toHaveBeenCalledWith('inbox_undo_too_late');
	});

	it('says once whether the message went, after the wait', async () => {
		vi.useFakeTimers();
		const { page, gateway, notifier } = replying();
		page.editDraft('body', 'Hello');
		await page.send();
		await vi.advanceTimersByTimeAsync(10_000);
		expect(gateway.outboxStatus).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(3_000);
		expect(notifier.showSuccess).toHaveBeenCalledWith('inbox_sent');

		const again = replying();
		again.gateway.outboxStatus.mockReturnValue(
			of({ outboxId: 'o1', status: 'failed', draftId: 'd1', threadId: null, sentMessageId: null }),
		);
		again.page.editDraft('body', 'Again');
		await again.page.send();
		await vi.advanceTimersByTimeAsync(13_000);
		expect(again.notifier.showError).toHaveBeenCalledWith('inbox_send_failed_drafts');
	});

	it('lists Gmail drafts in Drafts and reopens one in the compose box', async () => {
		const tools = setup({ mailbox: 'care', folder: 'drafts' }, {});
		tools.summary([box('care')]);
		expect(tools.page.draftsView()).toBe(true);
		const draftsQuery = state.queries.find((entry) => entry.options().queryKey.includes('drafts')) as Query;
		expect(draftsQuery.options().enabled).toBe(true);
		expect(tools.threadsQuery.options().enabled).toBe(false);
		await draftsQuery.options().queryFn();
		expect(tools.gateway.drafts).toHaveBeenCalledWith('mbx-care', undefined);
		tools.go({ mailbox: 'care', folder: 'drafts' }, { draft: 'open', d: 'd1' });
		await vi.waitFor(() => expect(tools.page.draft()).toMatchObject({ body: 'Dear Ananya,', gmailDraftId: 'd1' }));
		expect(tools.gateway.draft).toHaveBeenCalledWith('mbx-care', 'd1');
		expect(tools.page.saveState()).toBe('saved');
	});

	it('says when a draft was sent or deleted elsewhere', async () => {
		const tools = setup({ mailbox: 'care', folder: 'drafts' }, {});
		tools.summary([box('care')]);
		tools.gateway.draft.mockReturnValueOnce(throwError(() => notFound));
		tools.go({ mailbox: 'care', folder: 'drafts' }, { draft: 'open', d: 'gone' });
		await vi.waitFor(() => expect(tools.notifier.showError).toHaveBeenCalledWith('inbox_draft_gone'));
		expect(tools.page.draft()).toBeNull();
	});

	it('Discard deletes the Gmail draft, and keeps the text when Gmail refuses', async () => {
		const { page, gateway, notifier } = replying();
		page.editDraft('body', 'Never mind');
		await page.saveNow();
		gateway.deleteDraft.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 502 })));
		await page.discardNow();
		expect(notifier.showError).toHaveBeenCalledWith('inbox_discard_failed');
		expect(page.draft()?.body).toBe('Never mind');
		await page.discardNow();
		expect(gateway.deleteDraft).toHaveBeenLastCalledWith('mbx-care', 'd1');
		expect(page.draft()).toBeNull();
	});
});

describe('Inbox saved replies (C3)', () => {
	const reply = (id: string, fields: Record<string, unknown> = {}) => ({
		id,
		scope: 'personal',
		title: `Title ${id}`,
		body: `Text ${id}`,
		updatedAt: '2026-11-19T10:00:00.000Z',
		editable: true,
		...fields,
	});
	const composing = () => {
		const tools = setup({ mailbox: 'care', folder: 'inbox' }, { draft: 'new' });
		tools.summary([box('care')]);
		const query = state.queries.find((entry) => entry.options().queryKey.includes('saved-replies')) as Query;
		return { ...tools, query };
	};

	it('reads them only while writing, for people who may send', async () => {
		const { query, gateway, page, go } = composing();
		expect(query.options().enabled).toBe(true);
		await query.options().queryFn();
		expect(gateway.savedReplies).toHaveBeenCalledWith('mbx-care');
		expect(page.savedReplies()).toEqual({ shared: [], personal: [], canEditShared: false });
		go({ mailbox: 'care', folder: 'inbox' }, {});
		expect(query.options().enabled).toBe(false);
	});

	it('inserts a saved reply at the cursor in the formatting editor, ready to change', () => {
		const { page } = composing();
		const editor = page.editor();
		expect(editor).not.toBeNull();
		editor?.commands.insertText('Dear Ananya, ').exec();
		page.insertSavedReply(reply('r1', { body: 'It ships today.' }) as never);
		expect(page.draft()?.body).toBe('Dear Ananya, It ships today.');
		expect(page.draft()?.html).toBe('<p>Dear Ananya, It ships today.</p>');
	});

	it('inserts at the cursor in the plain box when no editor runs', () => {
		vi.useFakeTimers();
		const { page } = composing();
		(page as unknown as { stopEditor: () => void }).stopEditor();
		const box = document.createElement('textarea');
		box.id = 'inbox_body';
		document.body.append(box);
		page.editDraft('body', 'Dear Ananya,  Thanks');
		box.value = 'Dear Ananya,  Thanks';
		box.focus();
		box.setSelectionRange(13, 13);
		page.insertSavedReply(reply('r1', { body: 'It ships today.' }) as never);
		expect(page.draft()?.body).toBe('Dear Ananya, It ships today. Thanks');
		box.value = page.draft()?.body ?? '';
		vi.runAllTimers();
		expect(box.selectionStart).toBe(28);
		box.blur();
		page.insertSavedReply(reply('r2', { body: '!' }) as never);
		expect(page.draft()?.body).toBe('Dear Ananya, It ships today. Thanks!');
		box.remove();
		vi.useRealTimers();
	});

	it('adds, changes and deletes saved replies in the popup', async () => {
		const { page, gateway, modals, query } = composing();
		page.manageReplies();
		expect(modals.open).toHaveBeenCalled();
		page.openReplyEditor(null);
		expect(page.replyEdit()).toEqual({ id: null, scope: 'personal', title: '', body: '' });
		await page.saveReply();
		expect(gateway.createSavedReply).not.toHaveBeenCalled();
		page.editReply('title', 'Delivery');
		page.editReply('body', ' Three days. ');
		page.editReply('scope', 'shared');
		await page.saveReply();
		expect(gateway.createSavedReply).toHaveBeenCalledWith('mbx-care', {
			title: 'Delivery',
			body: 'Three days.',
			scope: 'shared',
		});
		expect(page.replyEdit()).toBeNull();
		expect(page.announcement()).toBe('inbox_reply_saved');
		expect(query.refetch).toHaveBeenCalled();

		page.openReplyEditor(reply('r1') as never);
		page.editReply('title', 'Renamed');
		await page.saveReply();
		expect(gateway.updateSavedReply).toHaveBeenCalledWith('mbx-care', 'r1', { title: 'Renamed', body: 'Text r1' });

		page.replyToDelete.set(reply('r1') as never);
		await page.deleteReply(reply('r1') as never);
		expect(gateway.deleteSavedReply).toHaveBeenCalledWith('mbx-care', 'r1');
		expect(page.replyToDelete()).toBeNull();
		expect(page.announcement()).toBe('inbox_reply_deleted');
	});

	it('says when a reply could not be saved or deleted, and keeps what was typed', async () => {
		const { page, gateway } = composing();
		page.openReplyEditor(null);
		page.editReply('title', 'A');
		page.editReply('body', 'B');
		gateway.createSavedReply.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 409 })));
		await page.saveReply();
		expect(page.replyProblem()).toBe('inbox_reply_too_many');
		expect(page.replyEdit()?.title).toBe('A');
		gateway.createSavedReply.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 500 })));
		await page.saveReply();
		expect(page.replyProblem()).toBe('inbox_reply_failed');
		gateway.deleteSavedReply.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 500 })));
		page.replyToDelete.set(reply('r1') as never);
		await page.deleteReply(reply('r1') as never);
		expect(page.replyToDelete()?.id).toBe('r1');
		gateway.deleteSavedReply.mockReturnValueOnce(throwError(() => notFound));
		await page.deleteReply(reply('r1') as never);
		expect(page.replyToDelete()).toBeNull();
	});
});

describe('Inbox formatting (C1)', () => {
	afterEach(() => vi.useRealTimers());

	it('opens a draft in the editor without saving it, then saves and sends what is typed with its formatting', async () => {
		vi.useFakeTimers();
		const tools = setup({ mailbox: 'care', folder: 'inbox', thread: 't1' }, { draft: 'reply' });
		tools.summary([box('care')]);
		tools.threadQuery.result.set({ data: conversation('m1') });
		tools.flush();
		const editor = tools.page.editor();
		expect(editor).not.toBeNull();
		await vi.advanceTimersByTimeAsync(5_000);
		expect(tools.gateway.saveDraft).not.toHaveBeenCalled();
		editor?.commands.toggleBold().insertText('Thanks').exec();
		expect(tools.page.draft()).toMatchObject({ body: 'Thanks', html: '<p><strong>Thanks</strong></p>' });
		await vi.advanceTimersByTimeAsync(3_000);
		expect(tools.gateway.saveDraft).toHaveBeenCalledWith(
			'mbx-care',
			null,
			expect.objectContaining({ html: '<p><strong>Thanks</strong></p>', body: 'Thanks' }),
		);
		vi.useRealTimers();
		await tools.page.send();
		expect(tools.gateway.send).toHaveBeenCalledWith(
			'mbx-care',
			expect.objectContaining({ html: '<p><strong>Thanks</strong></p>', body: 'Thanks' }),
		);
		expect(tools.page.editor()).toBeNull();
	});

	it('reopens a forward with its text as paragraphs', () => {
		const tools = setup({ mailbox: 'care', folder: 'inbox', thread: 't1' }, { draft: 'forward' });
		tools.summary([box('care')]);
		tools.threadQuery.result.set({ data: conversation('m1') });
		tools.flush();
		const html = toHTML(tools.page.editor()?.view.state.doc.toJSON() ?? {});
		expect(html).toContain('---------- Forwarded message ----------');
		expect(html.startsWith('<p></p>')).toBe(true);
	});
});

describe('Inbox mailbox settings (G1)', () => {
	it('shows the settings screen instead of conversations, for its own address', () => {
		const tools = setup({ mailbox: 'care', folder: 'settings' }, {});
		tools.summary([box('care')]);
		expect(tools.page.settingsView()).toBe(true);
		expect(tools.threadsQuery.options().enabled).toBe(false);
		expect(tools.page.settingsLink()).toEqual(['/inbox', 'care', 'settings']);
		expect(tools.page.draftsLink()).toEqual(['/inbox', 'care', 'drafts']);
	});
});

describe('Inbox all mailboxes (F1)', () => {
	it('lists every mailbox together, opening each row in its own mailbox', async () => {
		const tools = setup({ mailbox: 'care', folder: 'all-mailboxes' }, {});
		tools.summary([box('care'), box('orders')]);
		expect(tools.page.allView()).toBe(true);
		expect(tools.threadsQuery.options().enabled).toBe(false);
		const all = state.queries.find((entry) => entry.options().queryKey.includes('all-mailboxes')) as Query;
		expect(all.options().enabled).toBe(true);
		tools.gateway.allThreads = vi.fn(() => of({ threads: [], skipped: [] }));
		await all.options().queryFn();
		expect(tools.gateway.allThreads).toHaveBeenCalled();
		expect(tools.page.allThreads()).toEqual({ threads: [], skipped: [] });
		expect(tools.page.allLink()).toEqual(['/inbox', 'care', 'all-mailboxes']);
		expect(tools.page.allRowLink({ mailboxAddress: 'orders@shop.test', id: 't9' })).toEqual([
			'/inbox',
			'orders',
			'inbox',
			't9',
		]);
		all.result.set({ error: new HttpErrorResponse({ status: 502 }) });
		tools.flush();
		expect(tools.page.allFailed()).toBe(true);
	});
});
