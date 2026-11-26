import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

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

const setup = () => {
	const data = signal<unknown>(table);
	state.data = data;
	const cache: unknown[] = [];
	state.setQueryData = (_key, value) => cache.push(value);
	const gateway = { settings: vi.fn(() => of(table)), change: vi.fn(() => of(table)) };
	const modalRef = { result: new Promise(() => undefined), close: vi.fn(), dismiss: vi.fn() };
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
		set: { imports: [], template: '<ng-template #confirmChannelModal></ng-template>' },
	});
	const fixture = TestBed.createComponent(CommunicationsSettings);
	fixture.detectChanges();
	return { page: fixture.componentInstance, gateway, modal, modalRef, notifier, cache };
};

const use = (key: string) => table.items.find((row) => row.key === key) as never;
const toggle = (checked: boolean) => {
	const input = document.createElement('input');
	input.type = 'checkbox';
	input.checked = checked;
	return { event: { target: input } as unknown as Event, input };
};
const flush = () => new Promise((resolve) => setTimeout(resolve));

afterEach(() => vi.restoreAllMocks());

describe('CommunicationsSettings', () => {
	it('shows the groups and messages the API serves', () => {
		const { page } = setup();
		expect(page.channels()).toEqual(['email', 'sms', 'whatsapp']);
		expect(page.groups()).toEqual(['account', 'orders']);
		expect(page.usesIn('account').map((row) => row.key)).toEqual(['password_reset', 'email_verification']);
	});

	it('switches a plain cell at once and stores the answer', async () => {
		const { page, gateway, modal, cache } = setup();
		const { event, input } = toggle(false);
		page.onToggle(use('order_shipped'), 'sms', event);
		expect(input.checked).toBe(true);
		expect(gateway.change).toHaveBeenCalledWith({ use: 'order_shipped', channel: 'sms', on: false });
		expect(modal.open).not.toHaveBeenCalled();
		await flush();
		expect(cache).toEqual([table]);
	});

	it('names a refused change, such as the last phone channel of a code row', async () => {
		const { page, gateway, notifier } = setup();
		gateway.change.mockReturnValueOnce(throwError(() => refusal(400, 'phone_channel_required')));
		page.onToggle(use('order_shipped'), 'sms', toggle(false).event);
		await flush();
		expect(notifier.showError).toHaveBeenCalledWith('comm_error_phone_channel_required');
		gateway.change.mockReturnValueOnce(throwError(() => new Error('network')));
		page.onToggle(use('order_shipped'), 'sms', toggle(false).event);
		await flush();
		expect(notifier.showError).toHaveBeenLastCalledWith('comm_error_not_saved');
	});

	it('asks for the password before a yellow cell turns on', async () => {
		const { page, gateway, modal, modalRef } = setup();
		const { event, input } = toggle(true);
		page.onToggle(use('password_reset'), 'sms', event);
		expect(input.checked).toBe(false);
		expect(modal.open).toHaveBeenCalledOnce();
		expect(gateway.change).not.toHaveBeenCalled();

		page.confirm();
		expect(page.error()).toBe('password_is_required');

		page.passwordForm.setValue({ password: 'wrong' });
		gateway.change.mockReturnValueOnce(throwError(() => refusal(403)));
		page.confirm();
		await flush();
		expect(page.error()).toBe('comm_error_invalid_password');
		expect(modalRef.close).not.toHaveBeenCalled();
		expect(page.saving()).toBe(false);

		page.passwordForm.setValue({ password: 'right' });
		page.confirm();
		await flush();
		expect(gateway.change).toHaveBeenLastCalledWith({
			use: 'password_reset',
			channel: 'sms',
			on: true,
			currentPassword: 'right',
		});
		expect(modalRef.close).toHaveBeenCalled();
	});

	it('turns a yellow cell off without the password, and cancels cleanly', () => {
		const { page, gateway, modal, modalRef } = setup();
		const on = { ...table.items[0], cells: { ...table.items[0]!.cells, sms: cell(true, 'warning') } };
		page.onToggle(on as never, 'sms', toggle(false).event);
		expect(modal.open).not.toHaveBeenCalled();
		expect(gateway.change).toHaveBeenCalledWith({ use: 'password_reset', channel: 'sms', on: false });
		page.onToggle(use('password_reset'), 'whatsapp', toggle(true).event);
		page.cancel();
		expect(modalRef.dismiss).toHaveBeenCalled();
	});

	it('maps a refusal of a red cell, should one ever be sent', async () => {
		const { page, gateway, notifier } = setup();
		gateway.change.mockReturnValueOnce(throwError(() => refusal(400, 'locked')));
		page.onToggle(use('email_verification'), 'email', toggle(false).event);
		await flush();
		expect(notifier.showError).toHaveBeenCalledWith('comm_error_locked');
	});
});
