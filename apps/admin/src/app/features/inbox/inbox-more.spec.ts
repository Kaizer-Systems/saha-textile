import { HttpErrorResponse } from '@angular/common/http';
import { signal, type WritableSignal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, type Params } from '@angular/router';

import { ToastrService } from '@damjantonkli/ngx-toastr';
import { TranslocoService } from '@jsverse/transloco';
import { NgbModal, NgbOffcanvas } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { BehaviorSubject, Subject, of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MailboxGateway } from '@core/mailboxes/mailbox.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';

import { Inbox } from './inbox';
import { draftKey, gmailDraftKey, keepDraft, newDraft } from './inbox-drafts';
import { bulkReport, labelTree, pageSelection } from './inbox-labels';

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
		bulk: vi.fn((..._args: unknown[]) =>
			of({ done: ['t1'], failed: [] as unknown[], partlyKept: [] as unknown[], truncated: false }),
		),
		binSummary: vi.fn((..._args: unknown[]) => of({ threads: 3, messages: 7 })),
		emptyBin: vi.fn((..._args: unknown[]) => of({ deletedMessages: 7, incomplete: false })),
		createLabel: vi.fn((..._args: unknown[]) => of({})),
		renameLabel: vi.fn((..._args: unknown[]) => of({})),
		deleteLabel: vi.fn((..._args: unknown[]) => of({ ok: true })),
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
	const offcanvas = { open: vi.fn(), dismiss: vi.fn(), hasOpenOffcanvas: vi.fn(() => false) };
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
			{ provide: NgbOffcanvas, useValue: offcanvas },
			{ provide: AuthStore, useValue: { permissions } },
		],
	});
	TestBed.overrideComponent(Inbox, {
		set: {
			imports: [],
			template:
				'<ng-template #discardModal>d</ng-template><ng-template #runnableModal>r</ng-template><ng-template #repliesModal>s</ng-template>' +
				'<ng-template #foreverModal>f</ng-template><ng-template #emptyBinModal>e</ng-template>' +
				'<ng-template #labelModal>l</ng-template><ng-template #labelDeleteModal>x</ng-template>' +
				'<ng-template #railTpl>f</ng-template><div #listBox></div>',
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
		fixture,
		offcanvas,
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

beforeEach(() => {
	sessionStorage.clear();
	localStorage.clear();
});
afterEach(() => vi.restoreAllMocks());

const settle = async () => {
	for (let i = 0; i < 12; i++) await Promise.resolve();
};
/** Each query and the summary answer a refetch with how it went. */
function answerRefetches(isError = false) {
	for (const each of state.queries) each.refetch.mockResolvedValue({ isError });
	state.summaryRefetch?.mockResolvedValue({ isError: false });
}
const keyed = (part: string) => state.queries.find((each) => each.options().queryKey.includes(part)) as Query;
const label = (id: string, name: string, kind = 'label') =>
	({ id, name, kind, threadsUnread: 0, threadsTotal: 0 }) as {
		id: string;
		name: string;
		kind: 'label' | 'category';
		threadsUnread: number;
		threadsTotal: number;
	};

describe('Inbox lists: drafts, all mailboxes, labels and checks (C2, F1, X1)', () => {
	it('reads each list’s state', () => {
		const { page, summary, flush, threadsQuery } = setup({ mailbox: 'care', folder: 'Label_1' });
		summary([box('care')]);
		expect(page.drafts()).toEqual([]);
		keyed('drafts').result.set({ data: { drafts: [{ draftId: 'd1' }] } });
		keyed('all-mailboxes').result.set({ pending: true });
		flush();
		expect(page.drafts()).toEqual([{ draftId: 'd1' }]);
		expect(page.loadingAll()).toBe(true);
		keyed('drafts').result.set({ pending: true });
		expect(page.loadingDrafts()).toBe(true);
		keyed('drafts').result.set({ error: new Error('down') });
		expect(page.draftsFailed()).toBe(true);
		threadsQuery.result.set({ data: { threads: [], estimate: 130 }, error: new Error('down') });
		expect(page.estimate()).toBe(130);
		expect(page.listStale()).toBe(true);
		expect(page.checkedAt()).toBeNull();
		void keyed('labels').options().queryFn();
		keyed('labels').result.set({
			data: [
				label('Label_1', 'Orders/Returns'),
				label('CATEGORY_SOCIAL', 'Social', 'category'),
				label('INBOX', 'Inbox', 'system'),
			],
		});
		flush();
		expect(page.mailboxLabels()).toHaveLength(3);
		expect(page.labelLists().labels).toEqual([
			{ id: 'Label_1', leaf: 'Returns', name: 'Orders/Returns', depth: 1, unread: 0 },
		]);
		expect(page.currentLabel()?.id).toBe('Label_1');
		expect(page.labelLink('Label_2')).toEqual(['/inbox', 'care', 'Label_2']);
		expect(page.rowLabels(row('t1', { labelIds: ['Label_1', 'Label_2', 'INBOX'] }) as never)).toEqual([]);
		keyed('labels').result.set({ data: [label('Label_1', 'Orders'), label('Label_2', 'Urgent')] });
		expect(page.rowLabels(row('t1', { labelIds: ['Label_1', 'Label_2'] }) as never)).toEqual(['Urgent']);
		expect(page.bccProblems()).toEqual([]);
	});

	it('moves a label address that no longer exists to the Inbox, with a note', () => {
		const { page, summary, flush, notifier, router } = setup({ mailbox: 'care', folder: 'Label_9' });
		summary([box('care')]);
		expect(page.currentLabel()).toBeNull();
		keyed('labels').result.set({ data: [label('Label_1', 'Orders')] });
		flush();
		expect(notifier.showError).toHaveBeenCalledWith('inbox_label_gone');
		expect(router.navigate).toHaveBeenCalledWith(['/inbox', 'care', 'inbox'], { replaceUrl: true });
		const plain = setup({ mailbox: 'care', folder: 'inbox' });
		plain.summary([box('care')]);
		expect(plain.page.currentLabel()).toBeNull();
	});

	it('asks every list again on Refresh, once at a time, and says how it went', async () => {
		const { page, summary, notifier, go } = setup({ mailbox: 'care', folder: 'inbox' });
		summary([box('care')]);
		answerRefetches();
		await page.refresh();
		expect(page.announcement()).toBe('inbox_refreshed');
		page.refreshing.set(true);
		await page.refresh();
		page.refreshing.set(false);
		go({ mailbox: 'care', folder: 'inbox', thread: 't1' });
		answerRefetches(true);
		await page.refresh();
		expect(notifier.showError).toHaveBeenCalledWith('inbox_refresh_failed');
		go({ mailbox: 'care', folder: 'drafts' });
		answerRefetches();
		await page.refresh();
		expect(keyed('drafts').refetch).toHaveBeenCalled();
		expect(page.can('organise')).toBe(true);
	});
});

describe('Inbox selection and bulk actions (D7, bulk brief)', () => {
	function listed(folder = 'inbox', extra: Record<string, unknown> = {}) {
		const made = setup({ mailbox: 'care', folder }, extra);
		made.summary([box('care')]);
		made.threadsQuery.result.set({
			data: {
				threads: [row('t1', { unread: true, labelIds: ['Label_1'] }), row('t2', { labelIds: [] })],
				estimate: 40,
			},
		});
		made.flush();
		return made;
	}

	it('ticks the page, then every match, and clears', () => {
		const { page } = listed();
		expect(page.selection()).toBe('none');
		page.toggleAll();
		expect(page.selection()).toBe('all');
		expect(page.selectionHasUnread()).toBe(true);
		expect(page.selectionHasRead()).toBe(true);
		page.toggleAll();
		expect(page.selection()).toBe('none');
		page.selectAllMatching();
		expect(page.allMatching()).toBe(true);
		page.clearSelection();
		expect(page.allMatching()).toBe(false);
		expect(pageSelection(['a', 'b'], new Set(['a']))).toBe('some');
	});

	it('acts on the ticked rows or every match, keeps what failed for Retry, and says what happened', async () => {
		const { page, gateway, notifier, client } = listed('inbox', { q: 'saree' });
		await page.bulk('mark_read');
		expect(gateway.bulk).not.toHaveBeenCalled();
		page.toggleRow('t1', true);
		gateway.bulk.mockReturnValueOnce(
			of({
				done: [],
				failed: [
					{ threadId: 't1', reason: 'gmail_error' },
					{ threadId: 't2', reason: 'not_found' },
				],
				partlyKept: ['t3'],
				truncated: true,
			}),
		);
		await page.bulk('add_label', 'Label_1');
		expect(gateway.bulk).toHaveBeenLastCalledWith('mbx-care', {
			action: 'add_label',
			labelId: 'Label_1',
			threadIds: ['t1'],
		});
		expect(page.bulkNote()?.retry).toEqual(['t1']);
		expect(notifier.showError).toHaveBeenCalledWith('inbox_bulk_truncated');
		expect(notifier.showSuccess).toHaveBeenCalledWith('inbox_bulk_partly_kept');
		expect(client.invalidateQueries).toHaveBeenCalled();
		page.retryBulk();
		await settle();
		expect(gateway.bulk).toHaveBeenLastCalledWith('mbx-care', {
			action: 'add_label',
			labelId: 'Label_1',
			threadIds: ['t1'],
		});
		page.selectAllMatching();
		await page.bulk('archive');
		expect(gateway.bulk).toHaveBeenLastCalledWith('mbx-care', {
			action: 'archive',
			matching: { folder: 'inbox', label: undefined, q: 'saree' },
		});
		expect(page.bulkNote()).toBeNull();
		page.bulkBusy.set(true);
		await page.bulk('archive');
		page.bulkBusy.set(false);
		gateway.bulk.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 409 })));
		await page.bulk('archive', undefined, ['t2']);
		expect(notifier.showError).toHaveBeenCalledWith('inbox_reconnect_needed_for');
		gateway.bulk.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 500 })));
		await page.bulk('archive', undefined, ['t2']);
		expect(notifier.showError).toHaveBeenCalledWith('inbox_refresh_failed');
		page.retryBulk();
		expect(bulkReport({ done: ['a'], failed: [], partlyKept: [], truncated: false } as never).key).toBe(
			'inbox_bulk_done',
		);
		expect(labelTree([label('Label_2', 'Zed'), label('Label_3', 'Alpha')]).labels.map((line) => line.leaf)).toEqual(
			['Alpha', 'Zed'],
		);
	});

	it('goes back from an open conversation that the action moved, but not for a mark', async () => {
		const { page, gateway, router, go } = listed();
		go({ mailbox: 'care', folder: 'inbox', thread: 't1' });
		router.navigate.mockClear();
		await page.bulk('mark_unread', undefined, ['t1']);
		expect(router.navigate).not.toHaveBeenCalled();
		await page.bulk('trash', undefined, ['t1']);
		expect(router.navigate).toHaveBeenCalled();
		gateway.bulk.mockReturnValueOnce(of({ done: ['t9'], failed: [], partlyKept: [], truncated: false }));
		router.navigate.mockClear();
		await page.bulk('trash', undefined, ['t9']);
		expect(router.navigate).not.toHaveBeenCalled();
	});

	it('marks, labels and deletes the selection, asking first in the Bin', async () => {
		const { page, gateway, modals } = listed();
		page.toggleRow('t1', true);
		page.markSelection(true);
		await settle();
		expect(gateway.bulk).toHaveBeenLastCalledWith('mbx-care', expect.objectContaining({ action: 'mark_read' }));
		page.markSelection(false);
		await settle();
		page.toggleRow('t1', true);
		page.labelSelection('Label_1');
		await settle();
		expect(gateway.bulk).toHaveBeenLastCalledWith('mbx-care', expect.objectContaining({ action: 'remove_label' }));
		page.toggleRow('t2', true);
		page.labelSelection('Label_1');
		await settle();
		page.clearSelection();
		page.labelSelection('Label_1');
		page.toggleRow('t1', true);
		page.deleteSelection();
		await settle();
		expect(gateway.bulk).toHaveBeenLastCalledWith('mbx-care', expect.objectContaining({ action: 'trash' }));
		const bin = listed('trash');
		bin.page.toggleRow('t1', true);
		bin.page.deleteSelection();
		expect(bin.modals.open).toHaveBeenCalled();
		expect(modals.open).not.toHaveBeenCalled();
		const binLabel = listed('Label_1');
		binLabel.page.deleteSelection();
	});

	it('counts and deletes for good: the ticked rows, every match, or the open conversation', async () => {
		const { page, gateway, modals, go } = listed('trash');
		expect(page.foreverCount()).toBe(1);
		page.toggleRow('t1', true);
		page.toggleRow('t2', true);
		expect(page.foreverCount()).toBe(2);
		page.selectAllMatching();
		expect(page.foreverCount()).toBe(40);
		page.deleteForeverNow();
		await settle();
		expect(modals.dismissAll).toHaveBeenCalled();
		expect(gateway.bulk).toHaveBeenLastCalledWith(
			'mbx-care',
			expect.objectContaining({ action: 'delete_forever' }),
		);
		page.clearSelection();
		go({ mailbox: 'care', folder: 'trash', thread: 't2' });
		page.deleteForeverNow();
		await settle();
		expect(gateway.bulk).toHaveBeenLastCalledWith('mbx-care', { action: 'delete_forever', threadIds: ['t2'] });
		go({ mailbox: 'care', folder: 'trash' });
		gateway.bulk.mockClear();
		page.deleteForeverNow();
		await settle();
		expect(gateway.bulk).not.toHaveBeenCalled();
		const estimateless = setup({ mailbox: 'care', folder: 'trash' });
		estimateless.summary([box('care')]);
		estimateless.page.toggleRow('x', true);
		estimateless.page.selectAllMatching();
		expect(estimateless.page.foreverCount()).toBe(1);
		page.deleteOpenForever();
		expect(modals.open).toHaveBeenCalled();
	});

	it('stars a row without opening it, when the mailbox allows', async () => {
		const { page, gateway } = listed();
		const event = new Event('click');
		await page.toggleStar(event, row('t1', { starred: true }) as never);
		expect(gateway.modify).toHaveBeenLastCalledWith('mbx-care', 't1', 'unstar');
		await page.toggleStar(event, row('t2') as never);
		expect(gateway.modify).toHaveBeenLastCalledWith('mbx-care', 't2', 'star');
		const reader = setup({ mailbox: 'care', folder: 'inbox' });
		reader.summary([box('care', { rights: ['read'] })]);
		await reader.page.toggleStar(event, row('t1') as never);
		expect(reader.gateway.modify).not.toHaveBeenCalled();
		expect(reader.page.can('organise')).toBe(false);
	});
});

describe('Inbox Bin and labels (bin and label brief)', () => {
	it('empties the Bin after showing Gmail’s count, and says when part of it stays', async () => {
		const early = setup({ mailbox: 'care', folder: 'trash' });
		await early.page.askEmptyBin();
		await early.page.emptyBinNow();
		expect(early.gateway.binSummary).not.toHaveBeenCalled();
		expect(early.gateway.emptyBin).not.toHaveBeenCalled();
		const { page, gateway, modals, notifier, summary, go, router } = setup({ mailbox: 'care', folder: 'trash' });
		summary([box('care')]);
		await page.askEmptyBin();
		expect(page.binCount()).toEqual({ threads: 3, messages: 7 });
		expect(modals.open).toHaveBeenCalled();
		await page.emptyBinNow();
		expect(notifier.showSuccess).toHaveBeenCalledWith('inbox_bin_emptied');
		go({ mailbox: 'care', folder: 'trash', thread: 't1' });
		router.navigate.mockClear();
		gateway.emptyBin.mockReturnValueOnce(of({ deletedMessages: 2, incomplete: true }));
		await page.emptyBinNow();
		expect(notifier.showError).toHaveBeenCalledWith('inbox_bin_partly_emptied');
		expect(router.navigate).toHaveBeenCalled();
	});

	it('adds, renames and deletes labels', async () => {
		const { page, gateway, modals, notifier, summary, router } = setup({ mailbox: 'care', folder: 'Label_1' });
		await page.saveLabel();
		await page.deleteLabelNow();
		summary([box('care')]);
		page.openLabelEditor(null);
		expect(page.labelEdit()).toEqual({ id: null, name: '' });
		await page.saveLabel();
		expect(gateway.createLabel).not.toHaveBeenCalled();
		page.labelEdit.set({ id: null, name: '  Urgent ' });
		await page.saveLabel();
		expect(gateway.createLabel).toHaveBeenCalledWith('mbx-care', 'Urgent');
		page.openLabelEditor({ id: 'Label_1', name: 'Orders' });
		page.labelEdit.set({ id: 'Label_1', name: 'Orders 2' });
		await page.saveLabel();
		expect(gateway.renameLabel).toHaveBeenCalledWith('mbx-care', 'Label_1', 'Orders 2');
		expect(notifier.showSuccess).toHaveBeenCalledWith('inbox_label_saved');
		page.labelEdit.set(null);
		await page.saveLabel();
		await page.deleteLabelNow();
		expect(gateway.deleteLabel).not.toHaveBeenCalled();
		page.askDeleteLabel({ id: 'Label_2', name: 'Other' });
		await page.deleteLabelNow();
		expect(router.navigate).not.toHaveBeenCalledWith(['/inbox', 'care', 'inbox']);
		page.askDeleteLabel({ id: 'Label_1', name: 'Orders' });
		await page.deleteLabelNow();
		expect(gateway.deleteLabel).toHaveBeenLastCalledWith('mbx-care', 'Label_1');
		expect(router.navigate).toHaveBeenCalledWith(['/inbox', 'care', 'inbox']);
		expect(modals.open).toHaveBeenCalledTimes(4);
	});

	it('shows a very large message as text until asked for the formatted one (E13)', () => {
		const { page } = setup();
		const big = message('m1', { large: true }) as never;
		expect(page.plainFirst(big)).toBe(true);
		page.showFormatted(big);
		expect(page.plainFirst(big)).toBe(false);
		expect(page.plainFirst(message('m2', { large: false }) as never)).toBe(false);
	});
});

describe('Inbox redesign: rail, drawer, search options, switcher and list (24 Nov brief)', () => {
	afterEach(() => vi.useRealTimers());

	it('collapses the folders to icons and back, keeps the choice, and opens the icons by pointing or Tab (R2)', async () => {
		vi.useFakeTimers();
		const { page } = setup();
		page.rail.set('open');
		page.peek();
		await vi.advanceTimersByTimeAsync(200);
		expect(page.railPeek()).toBe(false);
		page.toggleRail();
		expect(page.rail()).toBe('icons');
		expect(localStorage.getItem('inbox.rail')).toBe('icons');
		page.peek();
		await vi.advanceTimersByTimeAsync(149);
		expect(page.railPeek()).toBe(false);
		await vi.advanceTimersByTimeAsync(1);
		expect(page.railPeek()).toBe(true);
		page.closePeek();
		await vi.advanceTimersByTimeAsync(299);
		expect(page.railPeek()).toBe(true);
		await vi.advanceTimersByTimeAsync(1);
		expect(page.railPeek()).toBe(false);

		const rail = document.createElement('nav');
		const inside = document.createElement('a');
		rail.append(inside);
		const focus = (related: Element | null) =>
			({ currentTarget: rail, relatedTarget: related }) as unknown as FocusEvent;
		page.railFocus(focus(null), true);
		expect(page.railPeek()).toBe(true);
		page.railFocus(focus(inside), false);
		expect(page.railPeek()).toBe(true);
		page.railFocus(focus(document.createElement('a')), false);
		expect(page.railPeek()).toBe(false);
		page.toggleRail();
		expect(page.rail()).toBe('open');
		expect(localStorage.getItem('inbox.rail')).toBe('open');
		page.railFocus(focus(null), true);
		expect(page.railPeek()).toBe(false);
	});

	it('opens the folders in a drawer on a phone, and closes it when one is chosen (R8)', () => {
		const { page, offcanvas } = setup();
		page.openFolders();
		expect(offcanvas.open).toHaveBeenCalledWith(expect.anything(), {
			position: 'start',
			panelClass: 'inbox-drawer',
		});
		page.railPeek.set(true);
		page.folderChosen();
		expect(page.railPeek()).toBe(false);
		expect(offcanvas.dismiss).not.toHaveBeenCalled();
		offcanvas.hasOpenOffcanvas.mockReturnValue(true);
		page.folderChosen();
		expect(offcanvas.dismiss).toHaveBeenCalledTimes(1);
	});

	it('reads the search into the options, searches with them, and starts a filter from them (R3)', () => {
		const { page, router, summary, go } = setup(
			{ mailbox: 'care', folder: 'inbox' },
			{ q: 'from:rahul has:attachment' },
		);
		summary([box('care')]);
		page.searchOptionsOpened(false);
		expect(page.searchFields().from).toBe('');
		page.searchOptionsOpened(true);
		expect(page.searchFields()).toMatchObject({ from: 'rahul', hasAttachment: true });
		page.setSearchField('subject', 'invoice');
		page.searchWithOptions();
		expect(router.navigate).toHaveBeenLastCalledWith(['/inbox', 'care', 'all'], {
			queryParams: { q: 'from:rahul subject:invoice has:attachment' },
		});
		page.createFilter();
		expect(page.filterPrefill()).toEqual({
			from: 'rahul',
			to: '',
			subject: 'invoice',
			query: '',
			hasAttachment: true,
		});
		expect(router.navigate).toHaveBeenLastCalledWith(['/inbox', 'care', 'settings']);
		go({ mailbox: 'care', folder: 'settings' });
		expect(page.filterPrefill()).not.toBeNull();
		go({ mailbox: 'care', folder: 'inbox' });
		expect(page.filterPrefill()).toBeNull();
		expect(page.withinOptions).toContain('1w');
		expect(page.searchPlaces).toContain('trash');
	});

	it('switches mailbox from the title row, and names each one’s state (R1, U1)', () => {
		const { page, router, summary } = setup();
		summary([box('care'), box('sales', { canSend: false }), box('old', { status: 'needs_reconnect' })]);
		const calls = router.navigate.mock.calls.length;
		page.switchTo('mbx-care');
		page.switchTo('mbx-none');
		expect(router.navigate.mock.calls.length).toBe(calls);
		page.switchTo('mbx-sales');
		expect(router.navigate).toHaveBeenLastCalledWith(['/inbox', 'sales', 'inbox']);
		const [care, sales, old] = page.mailboxes();
		expect(page.mailboxState(care)).toBe('inbox_state_send');
		expect(page.mailboxState(sales)).toBe('inbox_state_read');
		expect(page.mailboxState(old)).toBe('inbox_state_reconnect');
	});

	it('keeps the last rows, faded, while another folder loads, and says where the page sits (R4, R5)', () => {
		const { page, summary, threadsQuery, flush, go } = setup();
		summary([box('care')]);
		threadsQuery.result.set({ pending: true });
		flush();
		expect(page.switching()).toBe(false);
		expect(page.shownRows()).toEqual([]);
		expect(page.range()).toBeNull();
		threadsQuery.result.set({ data: { threads: [row('t1'), row('t2')], nextPageToken: 'p2', estimate: 30 } });
		flush();
		expect(page.shownRows().map((each) => each.id)).toEqual(['t1', 't2']);
		expect(page.range()).toEqual({ start: 1, end: 2, total: 30 });
		page.older();
		threadsQuery.result.set({ data: { threads: [row('t3')], nextPageToken: null, estimate: 30 } });
		flush();
		expect(page.range()).toEqual({ start: 3, end: 3, total: 30 });
		expect(page.shownRows().map((each) => each.id)).toEqual(['t3']);
		go({ mailbox: 'care', folder: 'sent' });
		threadsQuery.result.set({ pending: true });
		flush();
		expect(page.switching()).toBe(true);
		expect(page.shown()).toEqual({ rows: [row('t3')], sent: false });
		threadsQuery.result.set({ data: { threads: [row('s1')], nextPageToken: null } });
		flush();
		expect(page.shown().sent).toBe(true);
		expect(page.switching()).toBe(false);
		expect(page.range()).toEqual({ start: 1, end: 1, total: null });
	});

	it('shows a partly failed bulk action in the status line only while there is something to retry', () => {
		const { page } = setup();
		expect(page.retryNote()).toBeNull();
		page.bulkNote.set({ key: 'inbox_bulk_done', params: {}, retry: [] });
		expect(page.retryNote()).toBeNull();
		page.bulkNote.set({ key: 'inbox_bulk_failed', params: { count: 1 }, retry: ['t1'] });
		expect(page.retryNote()?.retry).toEqual(['t1']);
	});

	it('lets new mail slide in only when the list’s own box sits at the top (R6)', () => {
		const { page, summary, threadsQuery, flush, fixture } = setup();
		summary([box('care')]);
		threadsQuery.result.set({ data: { threads: [row('t1')], nextPageToken: null } });
		flush();
		const listBox = fixture.nativeElement.querySelector('div') as HTMLElement;
		Object.defineProperty(listBox, 'scrollHeight', { configurable: true, value: 900 });
		Object.defineProperty(listBox, 'clientHeight', { configurable: true, value: 500 });
		Object.defineProperty(listBox, 'scrollTop', { configurable: true, value: 300 });
		threadsQuery.result.set({ data: { threads: [row('t0'), row('t1')], nextPageToken: null } });
		flush();
		expect(page.waiting()).toBe(1);
		Object.defineProperty(listBox, 'scrollTop', { configurable: true, value: 0 });
		threadsQuery.result.set({ data: { threads: [row('t-1'), row('t0'), row('t1')], nextPageToken: null } });
		flush();
		expect(page.waiting()).toBe(0);
		expect(page.arrived().size).toBeGreaterThan(0);
	});
});

describe('Inbox: every remaining path, before and around the redesign', () => {
	afterEach(() => vi.useRealTimers());

	/** The private parts the tests steer directly: which draft is open, and the list's own box. */
	const inner = (page: Inbox) => page as unknown as { draftId: WritableSignal<string | null> };
	const replying = () => {
		const tools = setup({ mailbox: 'care', folder: 'inbox', thread: 't1' }, { draft: 'reply' });
		tools.summary([box('care')]);
		tools.threadQuery.result.set({ data: conversation('m1') });
		tools.flush();
		return tools;
	};
	const error = (status: number) => throwError(() => new HttpErrorResponse({ status }));

	it('reads safely before any mailbox has arrived', async () => {
		const { page, gateway } = setup();
		expect(page.can('read')).toBe(false);
		expect(page.fromChoices()).toEqual([]);
		expect(page.listLink()).toEqual(['/inbox', '', 'inbox']);
		expect(page.allLink()).toEqual(['/inbox', '', 'all-mailboxes']);
		expect(page.draftsLink()).toEqual(['/inbox', '', 'drafts']);
		expect(page.settingsLink()).toEqual(['/inbox', '', 'settings']);
		expect(page.labelLink('Label_1')).toEqual(['/inbox', '', 'Label_1']);
		expect(page.mailboxLabels()).toEqual([]);
		expect(page.answered()).toBeNull();
		expect(page.newReplies()).toBe(0);
		expect(page.frames().size).toBe(0);
		expect(page.isFolded(message('m1') as never)).toBe(true);
		expect(page.toProblems()).toEqual([]);
		expect(page.ccProblems()).toEqual([]);
		page.attachmentUrl(message('m1') as never, { id: 'a1', filename: 'bill.pdf', mimeType: 'x', size: 1 });
		expect(gateway.attachmentUrl).toHaveBeenLastCalledWith('', 'm1', 'a1', 'bill.pdf');
		page.showNewReplies();
		page.showWaiting();
		page.review();
		expect(page.allOpen()).toBe(true);
		page.insertSavedReply({ id: 'r1', title: 'Hi', body: 'Hello', scope: 'personal' } as never);
		expect(page.draft()).toBeNull();
		page.editReply('title', 'x');
		expect(page.replyEdit()).toBeNull();
		await page.saveReply();
		await page.deleteReply({ id: 'r1' } as never);
		expect(gateway.deleteSavedReply).not.toHaveBeenCalled();
		await page.useTheirs();
		expect(gateway.draft).not.toHaveBeenCalled();
		await page.askEmptyBin();
		expect(gateway.binSummary).not.toHaveBeenCalled();
	});

	it('reads the Drafts folder’s next page, and a reading pane opened by a draft alone', () => {
		const { page, summary, flush } = setup({ mailbox: 'care', folder: 'drafts' }, { draft: 'new' });
		summary([box('care')]);
		expect(page.nextPage()).toBeNull();
		keyed('drafts').result.set({ data: { drafts: [], nextPageToken: 'n2' } });
		flush();
		expect(page.nextPage()).toBe('n2');
		expect(page.reading()).toBe(true);
	});

	it('forgets a tick on a row it never saw, and counts no waiting mail once the list is gone', () => {
		const { page, summary, threadsQuery, flush } = setup();
		summary([box('care')]);
		threadsQuery.result.set({ data: { threads: [row('t1')], nextPageToken: null } });
		flush();
		page.toggleRow('ghost', true);
		expect(page.selectedRows()).toEqual([]);
		page.toggleRow('ghost', false);
		expect(page.selected().size).toBe(0);
		threadsQuery.result.set({});
		flush();
		expect(page.waiting()).toBe(0);
	});

	it('reuses a message’s frame when only another message changes, and finds no new replies in a read conversation', () => {
		const { page, summary, threadQuery, flush } = setup({ mailbox: 'care', folder: 'inbox', thread: 't1' });
		summary([box('care')]);
		threadQuery.result.set({ data: conversation('m1', 'm2') });
		flush();
		const before = page.frames().get('m2|false|false');
		page.showPictures(message('m1') as never);
		expect(page.frames().get('m2|false|false')).toBe(before);
		page.showNewReplies();
		expect(page.announcement()).toBe('inbox_new_replies_shown');
	});

	it('waits for the mailboxes before marking an opened conversation read', () => {
		const { gateway, threadQuery, flush } = setup({ mailbox: 'care', folder: 'inbox', thread: 't1' });
		threadQuery.result.set({ data: conversation('m1') });
		flush();
		expect(gateway.markMessages).not.toHaveBeenCalled();
	});

	it('forgets a failed read mark so the next look tries again', async () => {
		const { gateway, summary, threadQuery, flush, client } = setup({
			mailbox: 'care',
			folder: 'inbox',
			thread: 't1',
		});
		gateway.markMessages.mockReturnValue(error(502));
		summary([box('care')]);
		threadQuery.result.set({ data: { ...conversation('m1'), messages: [message('m1', { unread: true })] } });
		flush();
		await settle();
		expect(gateway.markMessages).toHaveBeenCalledTimes(1);
		expect(client.invalidateQueries).not.toHaveBeenCalled();
	});

	it('marks an open conversation unread before its messages have arrived', async () => {
		const { page, gateway, summary } = setup({ mailbox: 'care', folder: 'inbox', thread: 't1' });
		summary([box('care')]);
		await page.act('mark_unread');
		expect(gateway.modify).toHaveBeenCalledWith('mbx-care', 't1', 'mark_unread', undefined);
	});

	it('shows no signature for a From address the mailbox does not have', () => {
		const { page } = replying();
		page.draft.update((draft) => (draft ? { ...draft, from: 'nobody@shop.test' } : draft));
		expect(page.signature()).toBeNull();
	});

	it('keeps typing in a draft that has no kept copy', () => {
		const { page, summary } = setup();
		summary([box('care')]);
		page.draft.set(newDraft('care@shop.test'));
		page.editDraft('body', 'Hello');
		expect(page.draft()?.body).toBe('Hello');
		expect(sessionStorage.length).toBe(0);
	});

	it('takes Gmail’s version even when the draft closed or moved on meanwhile, and says when Gmail refuses', async () => {
		const { page, gateway } = replying();
		page.draft.update((draft) => (draft ? { ...draft, gmailDraftId: 'g1' } : draft));
		const answer = new Subject<ReturnType<typeof gmailDraft>>();
		gateway.draft.mockReturnValueOnce(answer);
		const taking = page.useTheirs();
		page.draft.update((draft) => (draft ? { ...draft, gmailDraftId: undefined } : draft));
		page.draft.set(null);
		inner(page).draftId.set(null);
		answer.next(gmailDraft());
		answer.complete();
		await taking;
		expect(page.draft()?.knownIds).toEqual([]);
		expect(page.saveState()).toBe('saved');
		page.draft.update((draft) => (draft ? { ...draft, gmailDraftId: 'g1' } : draft));
		gateway.draft.mockReturnValueOnce(error(502));
		await page.useTheirs();
		expect(page.saveState()).toBe('failed');
	});

	it('discards a draft Gmail already deleted', async () => {
		const { page, gateway, notifier } = replying();
		page.draft.update((draft) => (draft ? { ...draft, gmailDraftId: 'g1' } : draft));
		gateway.deleteDraft.mockReturnValueOnce(error(404));
		await page.discardNow();
		expect(notifier.showError).not.toHaveBeenCalled();
		expect(page.draft()).toBeNull();
	});

	it('sends what was kept even when the draft closed while Gmail was read', async () => {
		const { page, gateway, client } = replying();
		page.editDraft('body', 'Hello');
		client.fetchQuery.mockImplementationOnce(async () => {
			page.draft.set(null);
			inner(page).draftId.set(null);
			return conversation('m1');
		});
		await page.send();
		expect(gateway.send).toHaveBeenCalledWith('mbx-care', expect.objectContaining({ body: 'Hello' }));
	});

	it('names who answered when the API refuses a send for a newer reply, or says so without a name (C5)', async () => {
		const { page, gateway } = replying();
		page.editDraft('body', 'Hello');
		gateway.send.mockReturnValueOnce(error(412));
		gateway.thread
			.mockReturnValueOnce(of(conversation('m1')))
			.mockReturnValueOnce(
				of({ ...conversation('m1'), messages: [message('m1'), message('m2', { sentBy: 'Arup' })] }),
			);
		await page.send();
		expect(page.collision()?.name).toBe('Arup');
		page.collision.set(null);
		gateway.send.mockReturnValueOnce(error(412));
		gateway.thread
			.mockReturnValueOnce(of(conversation('m1')))
			.mockReturnValueOnce(of({ ...conversation('m1'), messages: [message('m1'), message('m3')] }));
		await page.send();
		expect(page.collision()?.name).toBe('Rahul');
		page.collision.set(null);
		gateway.send.mockReturnValueOnce(error(412));
		gateway.thread.mockReturnValueOnce(of(conversation('m1'))).mockReturnValueOnce(error(502));
		await page.send();
		expect(page.collision()).toEqual({ name: '', minutes: 0 });
	});

	it('says a draft is already on its way, and why a new message was refused', async () => {
		const { page, gateway } = replying();
		page.editDraft('body', 'Hello');
		page.draft.update((draft) => (draft ? { ...draft, gmailDraftId: 'g1' } : draft));
		gateway.send.mockReturnValueOnce(error(409));
		await page.send();
		expect(page.sendProblem()).toBe('inbox_already_sending');
		page.draft.update((draft) => (draft ? { ...draft, gmailDraftId: undefined } : draft));
		gateway.send.mockReturnValueOnce(error(409));
		await page.send();
		expect(page.sendProblem()).toBe('inbox_send_reconnect');
		const fresh = setup({ mailbox: 'care', folder: 'inbox' }, { draft: 'new' });
		fresh.summary([box('care')]);
		fresh.page.editDraft('to', 'ananya@example.com');
		fresh.page.editDraft('subject', 'Hi');
		fresh.page.editDraft('body', 'Hello');
		fresh.gateway.send.mockReturnValueOnce(error(412));
		await fresh.page.send();
		expect(fresh.page.sendProblem()).toBe('inbox_not_sent');
	});

	it('saves one at a time, and saves again what changed during a save', async () => {
		vi.useFakeTimers();
		const { page, gateway } = replying();
		page.editDraft('body', 'Hello');
		const answer = new Subject<{ draftId: string; version: string; savedAt: string }>();
		gateway.saveDraft.mockReturnValueOnce(answer);
		const first = page.saveNow();
		await vi.advanceTimersByTimeAsync(0);
		const second = page.saveNow();
		answer.next({ draftId: 'd1', version: 'v1', savedAt: '2026-11-19T10:41:00.000Z' });
		answer.complete();
		await first;
		await second;
		await vi.advanceTimersByTimeAsync(3_000);
		expect(gateway.saveDraft).toHaveBeenCalledTimes(2);
	});

	it('saves nothing without a mailbox, a draft, its key, the Send right, or while sending', async () => {
		const bare = setup();
		bare.page.draft.set({ ...newDraft('care@shop.test'), body: 'Hi' });
		await bare.page.saveNow();
		const reader = setup();
		reader.summary([box('care', { canSend: false })]);
		await reader.page.saveNow();
		reader.page.draft.set({ ...newDraft('care@shop.test'), body: 'Hi' });
		await reader.page.saveNow();
		inner(reader.page).draftId.set('k');
		await reader.page.saveNow();
		const { page, gateway } = replying();
		page.editDraft('body', 'Hi');
		page.sending.set(true);
		await page.saveNow();
		expect(bare.gateway.saveDraft).not.toHaveBeenCalled();
		expect(reader.gateway.saveDraft).not.toHaveBeenCalled();
		expect(gateway.saveDraft).not.toHaveBeenCalled();
	});

	it('teaches the kept copy its Gmail draft when the person moved on during a save', async () => {
		for (const kept of [true, false]) {
			const { page, gateway } = replying();
			page.editDraft('body', 'Hello');
			const key = draftKey('mbx-care', 't1', 'reply');
			if (!kept) sessionStorage.removeItem(key);
			const answer = new Subject<{ draftId: string; version: string; savedAt: string }>();
			gateway.saveDraft.mockReturnValueOnce(answer);
			const saving = page.saveNow();
			await settle();
			inner(page).draftId.set('elsewhere');
			answer.next({ draftId: 'g9', version: 'v9', savedAt: '2026-11-19T10:41:00.000Z' });
			answer.complete();
			await saving;
			expect(JSON.parse(sessionStorage.getItem(key) ?? '{}').gmailDraftId).toBe('g9');
			sessionStorage.clear();
		}
	});

	it('says what became of a save: moved on, gone from Gmail, offline, or failed', async () => {
		const { page, gateway } = replying();
		page.editDraft('body', 'Hello');
		const answer = new Subject<never>();
		gateway.saveDraft.mockReturnValueOnce(answer);
		const saving = page.saveNow();
		await settle();
		inner(page).draftId.set('elsewhere');
		answer.error(new HttpErrorResponse({ status: 500 }));
		await saving;
		expect(page.saveState()).toBe('saving');
		inner(page).draftId.set(draftKey('mbx-care', 't1', 'reply'));
		page.draft.update((draft) => (draft ? { ...draft, gmailDraftId: 'g1', version: 'v1' } : draft));
		gateway.saveDraft.mockReturnValueOnce(error(404));
		await page.saveNow();
		expect(page.saveState()).toBe('failed');
		expect(page.draft()?.gmailDraftId).toBeUndefined();
		gateway.saveDraft.mockReturnValueOnce(error(0));
		await page.saveNow();
		expect(page.saveState()).toBe('offline');
		vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
		gateway.saveDraft.mockReturnValueOnce(error(500));
		await page.saveNow();
		expect(page.saveState()).toBe('offline');
		vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
		gateway.saveDraft.mockReturnValueOnce(error(500));
		await page.saveNow();
		expect(page.saveState()).toBe('failed');
	});

	it('undoes a send even after the mailbox list went, and says when Undo came too late', async () => {
		const { page, gateway, router, notifier } = setup();
		const queued = { outboxId: 'o1', draftId: 'd1', sendAt: new Date().toISOString() };
		await page.undoSend('mbx-care', queued);
		expect(router.navigate).toHaveBeenLastCalledWith(['/inbox', '', 'drafts'], {
			queryParams: { draft: 'open', d: 'd1' },
		});
		gateway.cancelSend.mockReturnValueOnce(error(409));
		await page.undoSend('mbx-care', queued);
		expect(notifier.showError).toHaveBeenLastCalledWith('inbox_undo_too_late');
		gateway.cancelSend.mockReturnValueOnce(error(500));
		await page.undoSend('mbx-care', queued);
		expect(notifier.showError).toHaveBeenLastCalledWith('inbox_undo_failed');
	});

	it('keeps asking while a send is queued or unreadable, and stops for Undo, an unknown answer or a closed page', async () => {
		vi.useFakeTimers();
		const sendNow = async (statuses: (string | Error)[], after?: (page: Inbox) => void) => {
			const tools = replying();
			tools.page.editDraft('body', 'Hello');
			for (const status of statuses) {
				if (status instanceof Error) tools.gateway.outboxStatus.mockReturnValueOnce(throwError(() => status));
				else tools.gateway.outboxStatus.mockReturnValueOnce(of({ outboxId: 'o1', status }) as never);
			}
			await tools.page.send();
			after?.(tools.page);
			await vi.advanceTimersByTimeAsync(20_000);
			return tools;
		};
		const queued = await sendNow([new Error('down'), 'queued', 'weird']);
		expect(queued.gateway.outboxStatus).toHaveBeenCalledTimes(3);
		expect(queued.notifier.showSuccess).not.toHaveBeenCalledWith('inbox_sent');
		const undone = await sendNow([], (page) => void page.undoSend('mbx-care', { outboxId: 'o1' } as never));
		expect(undone.gateway.outboxStatus).not.toHaveBeenCalled();
		const failed = await sendNow(['failed']);
		expect(failed.notifier.showError).toHaveBeenCalledWith('inbox_send_failed_drafts');
		const tools = replying();
		tools.page.editDraft('body', 'Hello');
		await tools.page.send();
		tools.fixture.destroy();
		await vi.advanceTimersByTimeAsync(20_000);
		expect(tools.gateway.outboxStatus).not.toHaveBeenCalled();
	});

	it('reopens a Gmail draft only once, from the kept copy when there is one, and leaves one closed meanwhile', async () => {
		const reader = setup({ mailbox: 'care', folder: 'drafts' }, { draft: 'open', d: 'g1' });
		reader.summary([box('care', { canSend: false })]);
		expect(reader.gateway.draft).not.toHaveBeenCalled();

		keepDraft(gmailDraftKey('mbx-care', 'g2'), { ...newDraft('care@shop.test'), body: 'Kept words' });
		const kept = setup({ mailbox: 'care', folder: 'drafts' }, { draft: 'open', d: 'g2' });
		kept.summary([box('care')]);
		expect(kept.page.draft()?.body).toBe('Kept words');
		kept.summary([box('care', { unread: 3 })]);
		expect(kept.gateway.draft).not.toHaveBeenCalled();

		const late = setup({ mailbox: 'care', folder: 'drafts' }, { draft: 'open', d: 'g3' });
		const answer = new Subject<ReturnType<typeof gmailDraft>>();
		late.gateway.draft.mockReturnValueOnce(answer);
		late.summary([box('care')]);
		inner(late.page).draftId.set('elsewhere');
		answer.next(gmailDraft());
		answer.complete();
		await settle();
		expect(late.page.draft()).toBeNull();

		const gone = setup({ mailbox: 'care', folder: 'drafts' }, { draft: 'open', d: 'g4' });
		const refused = new Subject<never>();
		gone.gateway.draft.mockReturnValueOnce(refused);
		gone.summary([box('care')]);
		inner(gone.page).draftId.set('elsewhere');
		refused.error(new HttpErrorResponse({ status: 404 }));
		await settle();
		expect(gone.notifier.showError).not.toHaveBeenCalled();

		const down = setup({ mailbox: 'care', folder: 'drafts' }, { draft: 'open', d: 'g5' });
		down.gateway.draft.mockReturnValueOnce(error(502));
		down.summary([box('care')]);
		await settle();
		expect(down.notifier.showError).toHaveBeenCalledWith('inbox_gmail_unavailable');
	});

	it('takes no editor answer that repeats the draft’s own words', () => {
		const { page } = replying();
		const editor = page.editor();
		editor?.setContent('<p>Same words</p>');
		const html = page.draft()?.html;
		expect(html).toBe('<p>Same words</p>');
		const body = page.draft()?.body;
		page.draft.update((draft) => (draft ? { ...draft, body: 'kept as typed' } : draft));
		const view = editor?.view;
		view?.dispatch(view.state.tr.setMeta('FORCE_EMIT', true));
		expect(page.draft()?.html).toBe(html);
		expect(page.draft()?.body).toBe('kept as typed');
		expect(body).toBe('Same words');
	});

	it('opens the mailbox used last only when the kept note makes sense', () => {
		for (const note of ['{"mailbox":1,"folder":"inbox"}', '"inbox"', 'null', null]) {
			if (note === null) localStorage.removeItem('inbox.last');
			else localStorage.setItem('inbox.last', note);
			const { page, summary } = setup({});
			summary([box('care'), box('sales')]);
			expect(page.mailbox()?.address).toBe('care@shop.test');
		}
	});
});
