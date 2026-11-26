import { HttpErrorResponse } from '@angular/common/http';
import { type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { TranslocoService } from '@jsverse/transloco';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { MailboxGateway } from '@core/mailboxes/mailbox.gateway';
import { NotificationService } from '@data-access/services/notification.service';

import { MailboxSettingsPanel } from './mailbox-settings';
import {
	dayEnd,
	dayStart,
	emptyFilterForm,
	filterActions,
	filterForm,
	filterMatch,
	filterWrite,
	istDay,
} from './mailbox-settings-form';

interface Result {
	data?: unknown;
	pending?: boolean;
	error?: unknown;
}
const state = vi.hoisted(() => ({
	result: null as WritableSignal<Result> | null,
	options: null as (() => { queryKey: unknown[]; queryFn: () => Promise<unknown>; enabled: boolean }) | null,
	refetch: vi.fn(),
}));
vi.mock('@tanstack/angular-query-experimental', async () => {
	const { signal: make } = await import('@angular/core');
	return {
		QueryClient: class {},
		injectQuery: (options: NonNullable<typeof state.options>) => {
			const result = make<Result>({});
			state.result = result;
			state.options = options;
			return {
				data: () => result().data,
				isPending: () => Boolean(result().pending),
				isError: () => Boolean(result().error),
				error: () => result().error ?? null,
				refetch: state.refetch,
			};
		},
	};
});

const filter = (id: string, fields: Record<string, unknown> = {}) => ({
	id,
	criteria: { from: '@courier.in' },
	addLabelIds: ['Label_1'],
	removeLabelIds: ['INBOX'],
	forwardTo: null,
	...fields,
});
const vacation = {
	enabled: false,
	subject: '',
	message: '',
	contactsOnly: false,
	domainOnly: false,
	startTime: null,
	endTime: null,
};
const settings = (fields: Record<string, unknown> = {}) => ({
	filters: [filter('f1'), filter('fwd', { forwardTo: 'accounts@shop.test', addLabelIds: [], removeLabelIds: [] })],
	vacation,
	signature: { address: 'care@shop.test', html: '<p>Team</p>', editable: true },
	...fields,
});

const setup = () => {
	const gateway = {
		mailboxSettings: vi.fn(() => of(settings())),
		addFilter: vi.fn((..._args: unknown[]) => of(filter('f2'))),
		deleteFilter: vi.fn((..._args: unknown[]) => of(undefined)),
		saveVacation: vi.fn((..._args: unknown[]) => of(vacation)),
		saveSignature: vi.fn((..._args: unknown[]) => of({})),
	};
	const notifier = { showSuccess: vi.fn(), showError: vi.fn() };
	const client = { invalidateQueries: vi.fn(async () => undefined) };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: MailboxGateway, useValue: gateway },
			{ provide: QueryClient, useValue: client },
			{ provide: NotificationService, useValue: notifier },
			{ provide: TranslocoService, useValue: { translate: (key: string) => key } },
		],
	});
	TestBed.overrideComponent(MailboxSettingsPanel, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(MailboxSettingsPanel);
	fixture.componentRef.setInput('mailboxId', 'mbx-care');
	fixture.componentRef.setInput('address', 'care@shop.test');
	fixture.componentRef.setInput('labels', [
		{ id: 'Label_1', name: 'Orders', kind: 'label', threadsUnread: 0 },
		{ id: 'CATEGORY_UPDATES', name: 'Updates', kind: 'category', threadsUnread: 0 },
	]);
	const flush = () => {
		TestBed.tick();
		fixture.detectChanges();
	};
	flush();
	const load = (data: unknown = settings()) => {
		state.result?.set({ data });
		flush();
	};
	return { page: fixture.componentInstance, gateway, notifier, client, flush, load, fixture };
};

describe('filter form helpers (G1)', () => {
	it('turns the form into Gmail labels to add and take away, and back again', () => {
		const form = {
			...emptyFilterForm(),
			from: ' @courier.in ',
			hasAttachment: true,
			skipInbox: true,
			markRead: true,
			star: true,
			important: true,
			neverImportant: true,
			neverSpam: true,
			bin: true,
			labelId: 'Label_1',
		};
		const write = filterWrite(form);
		expect(write).toEqual({
			criteria: { from: '@courier.in', hasAttachment: true },
			addLabelIds: ['STARRED', 'IMPORTANT', 'TRASH', 'Label_1'],
			removeLabelIds: ['INBOX', 'UNREAD', 'IMPORTANT', 'SPAM'],
		});
		const back = filterForm({ id: 'f1', ...write!, forwardTo: null } as never);
		expect(back).toMatchObject({ replaces: 'f1', from: '@courier.in', star: true, bin: true, labelId: 'Label_1' });
		expect(filterWrite(back)).toMatchObject({ replaces: 'f1' });
	});

	it('refuses a filter that matches nothing or does nothing', () => {
		expect(filterWrite(emptyFilterForm())).toBeNull();
		expect(filterWrite({ ...emptyFilterForm(), from: 'a' })).toBeNull();
		expect(filterWrite({ ...emptyFilterForm(), star: true })).toBeNull();
		expect(filterWrite({ ...emptyFilterForm(), to: 'b', subject: 's', query: 'q', markRead: true })).toEqual({
			criteria: { to: 'b', subject: 's', query: 'q' },
			addLabelIds: [],
			removeLabelIds: ['UNREAD'],
		});
	});

	it('says what a filter matches and does', () => {
		const all = filter('f', {
			criteria: { from: 'a', to: 'b', subject: 'c', query: 'd', hasAttachment: true },
			addLabelIds: ['STARRED', 'IMPORTANT', 'TRASH', 'Label_1', 'Label_gone'],
			removeLabelIds: ['INBOX', 'UNREAD', 'IMPORTANT', 'SPAM'],
			forwardTo: 'x@shop.test',
		});
		expect(filterMatch(all as never)).toBe('from:a to:b subject:c d has:attachment');
		const names = new Map([['Label_1', 'Orders']]);
		expect(filterActions(all as never, (id) => names.get(id) ?? null).map((action) => action.key)).toEqual([
			'inbox_filter_skip_inbox',
			'inbox_filter_mark_read',
			'inbox_filter_never_important',
			'inbox_filter_never_spam',
			'inbox_filter_star',
			'inbox_filter_important',
			'inbox_filter_bin',
			'inbox_filter_apply_label',
			'inbox_filter_apply_label',
			'inbox_filter_forwards',
		]);
		expect(filterActions(all as never, (id) => names.get(id) ?? null)[7]?.params).toEqual({ name: 'Orders' });
		expect(filterActions(all as never, () => null)[8]?.params).toEqual({ name: 'Label_gone' });
	});

	it('reads and writes days in India time', () => {
		expect(dayStart('2026-10-20')).toBe('2026-10-19T18:30:00.000Z');
		expect(dayEnd('2026-10-25')).toBe('2026-10-25T18:29:59.000Z');
		expect(dayStart('')).toBeNull();
		expect(dayEnd('')).toBeNull();
		expect(istDay('2026-10-19T18:30:00.000Z')).toBe('2026-10-20');
		expect(istDay(null)).toBe('');
	});
});

describe('MailboxSettingsPanel (G1)', () => {
	it('reads the settings for its mailbox and says why when it cannot', async () => {
		const { page, gateway, flush } = setup();
		expect(state.options?.().queryKey).toEqual(['inbox', 'mbx-care', 'settings']);
		await state.options?.().queryFn();
		expect(gateway.mailboxSettings).toHaveBeenCalledWith('mbx-care');
		state.result?.set({ pending: true });
		flush();
		expect(page.loading()).toBe(true);
		for (const [status, key] of [
			[409, 'inbox_settings_reconnect'],
			[403, 'inbox_settings_no_right'],
			[502, 'inbox_gmail_unavailable'],
		] as const) {
			state.result?.set({ error: new HttpErrorResponse({ status }) });
			flush();
			expect(page.failure()).toBe(key);
		}
		expect(page.userLabels().map((label) => label.id)).toEqual(['Label_1']);
		expect(page.domain()).toBe('shop.test');
	});

	it('adds, changes and deletes filters, never forwarding ones', async () => {
		const { page, gateway, notifier, client, load } = setup();
		load();
		page.startFilter(null);
		await page.saveFilter();
		expect(page.problem()).toBe('inbox_filter_need');
		page.editFilter('from', '@courier.in');
		page.editFilter('skipInbox', true);
		await page.saveFilter();
		expect(gateway.addFilter).toHaveBeenCalledWith('mbx-care', {
			criteria: { from: '@courier.in' },
			addLabelIds: [],
			removeLabelIds: ['INBOX'],
		});
		expect(page.filterEdit()).toBeNull();
		expect(notifier.showSuccess).toHaveBeenCalledWith('inbox_settings_saved');
		expect(client.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['inbox'] });

		page.startFilter(filter('f1') as never);
		gateway.addFilter.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 404 })));
		await page.saveFilter();
		expect(page.problem()).toBe('inbox_filter_gone');
		expect(state.refetch).toHaveBeenCalled();
		expect(page.filterEdit()?.replaces).toBe('f1');

		page.filterToDelete.set(filter('f1') as never);
		await page.deleteFilter(filter('f1') as never);
		expect(gateway.deleteFilter).toHaveBeenCalledWith('mbx-care', 'f1');
		expect(page.filterToDelete()).toBeNull();
		gateway.deleteFilter.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 403 })));
		await page.deleteFilter(filter('fwd') as never);
		expect(page.problem()).toBe('inbox_filter_forwarding');
		expect(page.actionsOf(filter('f1') as never)[1]?.params).toEqual({ name: 'Orders' });
	});

	it('checks the vacation reply before saving it', async () => {
		const { page, gateway, load } = setup();
		load();
		expect(page.vacation()).toEqual(vacation);
		page.editVacation('enabled', true);
		await page.saveVacation();
		expect(page.problem()).toBe('inbox_vacation_need_message');
		page.editVacation('message', 'Closed for Puja');
		page.setDay('startTime', '2026-10-25');
		page.setDay('endTime', '2026-10-20');
		await page.saveVacation();
		expect(page.problem()).toBe('inbox_vacation_end_before_start');
		page.setDay('endTime', '2026-10-28');
		await page.saveVacation();
		expect(gateway.saveVacation).toHaveBeenCalledWith(
			'mbx-care',
			expect.objectContaining({ enabled: true, startTime: '2026-10-24T18:30:00.000Z' }),
		);
		gateway.saveVacation.mockReturnValueOnce(throwError(() => new Error('offline')));
		await page.saveVacation();
		expect(page.problem()).toBe('inbox_settings_failed');
	});

	it('edits the signature in the editor, and only shows one with pictures', async () => {
		const { page, gateway, load } = setup();
		load();
		const editor = page.editor();
		expect(editor).not.toBeNull();
		editor?.commands.insertText(', Saha Textile').exec();
		await page.saveSignature();
		expect(gateway.saveSignature).toHaveBeenCalledWith('mbx-care', '<p>Team, Saha Textile</p>');
		expect(page.signaturePreview()).toBeNull();
		load(settings({ signature: { address: 'care@shop.test', html: '<img src="x.png">', editable: false } }));
		expect(page.editor()).toBeNull();
		expect(page.signaturePreview()).not.toBeNull();
		const frame = document.createElement('iframe');
		document.body.append(frame);
		frame.contentDocument?.body.append(Object.assign(document.createElement('div'), { textContent: 'x' }));
		page.fitFrame({ target: frame } as never);
		frame.remove();
	});

	it('does one change at a time', async () => {
		const { page, gateway, load } = setup();
		load();
		page.busy.set(true);
		await page.saveSignature();
		expect(gateway.saveSignature).not.toHaveBeenCalled();
	});
});

describe('MailboxSettingsPanel: a filter from the Inbox search, and every quiet path', () => {
	it('opens the Filters tab with a filter started from the Inbox’s search options (redesign R3)', () => {
		const { page, fixture, flush } = setup();
		page.tab.set('vacation');
		page.problem.set('inbox_filter_need');
		fixture.componentRef.setInput('prefill', { from: 'rahul', query: 'parcel', hasAttachment: true });
		flush();
		expect(page.tab()).toBe('filters');
		expect(page.problem()).toBeNull();
		expect(page.filterEdit()).toEqual({
			...emptyFilterForm(),
			from: 'rahul',
			query: 'parcel',
			hasAttachment: true,
		});
		fixture.componentRef.setInput('prefill', null);
		flush();
		expect(page.filterEdit()?.from).toBe('rahul');
	});

	it('reads nothing before the settings arrive, and keeps settings that arrived even after a failed re-read', async () => {
		const { page, fixture, flush } = setup();
		expect(page.vacation()).toBeNull();
		page.editVacation('subject', 'Away');
		expect(page.vacation()).toBeNull();
		await page.saveVacation();
		page.editFilter('from', 'x');
		expect(page.filterEdit()).toBeNull();
		await page.saveFilter();
		expect(page.problem()).toBe('inbox_filter_need');
		state.result?.set({ data: settings(), error: new HttpErrorResponse({ status: 502 }) });
		flush();
		expect(page.failure()).toBeNull();
		fixture.componentRef.setInput('address', 'care');
		flush();
		expect(page.domain()).toBe('');
	});

	it('names a label it does not know as unknown, opens an empty signature, and leaves an unreadable frame alone', () => {
		const { page, load } = setup();
		load(settings({ signature: { address: 'care@shop.test', html: '', editable: true } }));
		expect(page.editor()).not.toBeNull();
		expect(page.actionsOf(filter('f9', { addLabelIds: ['Label_9'], removeLabelIds: [] }) as never)).toEqual(
			filterActions(filter('f9', { addLabelIds: ['Label_9'], removeLabelIds: [] }) as never, () => null),
		);
		const frame = document.createElement('iframe');
		page.fitFrame({ target: frame } as unknown as Event);
		expect(frame.style.height).toBe('');
		const sized = { contentDocument: { body: { offsetHeight: 120 } }, style: { height: '' } };
		page.fitFrame({ target: sized } as unknown as Event);
		expect(sized.style.height).toBe('120px');
	});
});
