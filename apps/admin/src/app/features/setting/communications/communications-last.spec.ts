import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { AdminCommunicationsGateway } from '@core/admin-communications/admin-communications.gateway';
import { NotificationService } from '@data-access/services/notification.service';

import { CommunicationsSettings } from './communications';

const state = vi.hoisted(() => ({
	data: undefined as unknown as () => unknown,
	setQueryData: (() => undefined) as (key: unknown, value: unknown) => void,
}));

interface MutateHandlers {
	onSuccess?: (value: unknown) => void;
	onError?: (error: unknown) => void;
	onSettled?: () => void;
}
vi.mock('@tanstack/angular-query-experimental', async (original) => ({
	...(await original<object>()),
	injectQueryClient: () => ({ setQueryData: (key: unknown, value: unknown) => state.setQueryData(key, value) }),
	injectMutation: (
		build: () => { mutationFn: (vars: unknown) => Promise<unknown>; onSuccess?: (value: unknown) => void },
	) => {
		const options = build();
		return {
			mutate: (vars: unknown, handlers: MutateHandlers = {}) =>
				void options.mutationFn(vars).then(
					(value) => {
						options.onSuccess?.(value);
						handlers.onSuccess?.(value);
						handlers.onSettled?.();
					},
					(error: unknown) => {
						handlers.onError?.(error);
						handlers.onSettled?.();
					},
				),
		};
	},
}));
vi.mock('@data-access/queries/admin-communications.queries', () => ({
	COMMUNICATIONS_QUERY_KEY: ['admin-communications'],
	injectCommunicationSettingsQuery: () => ({ data: state.data }),
}));

const cell = (on: boolean, risk = 'none', locked = false) => ({
	available: true,
	on,
	recommended: on,
	risk,
	locked,
	updatedAt: null,
});
const table = {
	channels: ['email', 'sms', 'whatsapp'],
	groups: ['account', 'orders'],
	items: [
		{
			key: 'password_reset',
			group: 'account',
			cells: { email: cell(true), sms: cell(false, 'warning'), whatsapp: cell(false, 'warning') },
		},
		{
			key: 'email_verification',
			group: 'account',
			cells: { email: cell(true), sms: cell(false, 'danger', true), whatsapp: cell(false, 'danger', true) },
		},
		{ key: 'order_shipped', group: 'orders', cells: { email: cell(true), sms: cell(true), whatsapp: cell(true) } },
	],
};

const refusal = (status: number, code?: string) =>
	new HttpErrorResponse({ status, error: code ? { error: { issues: [{ path: ['request'], code }] } } : {} });

const setup = (options: { data?: unknown; template?: string; result?: Promise<unknown> } = {}) => {
	const data = signal<unknown>('data' in options ? options.data : table);
	state.data = data;
	state.setQueryData = () => undefined;
	const gateway = { settings: vi.fn(() => of(table)), change: vi.fn(() => of(table)) };
	const modalRef = { result: options.result ?? new Promise(() => undefined), close: vi.fn(), dismiss: vi.fn() };
	const modal = { open: vi.fn(() => modalRef) };
	const notifier = { showError: vi.fn(), showSuccess: vi.fn() };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: AdminCommunicationsGateway, useValue: gateway },
			{ provide: NgbModal, useValue: modal },
			{ provide: NotificationService, useValue: notifier },
			{ provide: TranslocoService, useValue: { translate: (key: string) => key } },
		],
	});
	TestBed.overrideComponent(CommunicationsSettings, {
		set: { imports: [], template: options.template ?? '<ng-template #confirmChannelModal></ng-template>' },
	});
	const fixture = TestBed.createComponent(CommunicationsSettings);
	fixture.detectChanges();
	return { page: fixture.componentInstance, gateway, modal, modalRef, notifier };
};

const use = (key: string) => table.items.find((row) => row.key === key) as never;
const toggle = (checked: boolean) => {
	const input = document.createElement('input');
	input.type = 'checkbox';
	input.checked = checked;
	return { event: { target: input } as unknown as Event, input };
};
const flush = () => new Promise((resolve) => setTimeout(resolve));

describe('CommunicationsSettings: the last cases', () => {
	it('shows nothing before the table arrives', () => {
		const { page } = setup({ data: undefined });
		expect(page.channels()).toEqual([]);
		expect(page.groups()).toEqual([]);
		expect(page.usesIn('account')).toEqual([]);
	});

	it('ignores a change from something that is not a switch, and a yellow cell before the popup is drawn', () => {
		const { page, gateway, modal } = setup({ template: '' });
		page.onToggle(use('order_shipped'), 'sms', { target: document.createElement('div') } as unknown as Event);
		expect(gateway.change).not.toHaveBeenCalled();
		page.onToggle(use('password_reset'), 'sms', toggle(true).event);
		expect(modal.open).not.toHaveBeenCalled();
		expect(page.pending()).toBeNull();
		page.confirm();
		expect(gateway.change).not.toHaveBeenCalled();
	});

	it('forgets the cell once the popup closes', async () => {
		const { page } = setup({ result: Promise.resolve('closed') });
		page.onToggle(use('password_reset'), 'sms', toggle(true).event);
		expect(page.pending()).not.toBeNull();
		await flush();
		expect(page.pending()).toBeNull();
	});

	it('a refusal it has no words for is "not saved"', async () => {
		const { page, gateway, notifier } = setup();
		gateway.change.mockReturnValueOnce(throwError(() => refusal(400, 'something_new')));
		page.onToggle(use('order_shipped'), 'sms', toggle(false).event);
		await flush();
		expect(notifier.showError).toHaveBeenCalledWith('comm_error_not_saved');
	});
});
