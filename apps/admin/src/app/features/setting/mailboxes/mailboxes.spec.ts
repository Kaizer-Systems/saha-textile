import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MailboxGateway } from '@core/mailboxes/mailbox.gateway';
import { NotificationService } from '@data-access/services/notification.service';

import { MailboxesSettings } from './mailboxes';

const query = vi.hoisted(() => ({ data: undefined as unknown as () => unknown, pending: false }));
vi.mock('@core/mailboxes/mailbox.gateway', async (original) => ({
	...(await original<object>()),
	injectMailboxesQuery: () => ({ data: query.data, isPending: () => query.pending }),
}));
const users = vi.hoisted(() => ({ data: undefined as unknown as () => unknown }));
vi.mock('@data-access/queries/admin-users.queries', () => ({
	injectAdminUsersQuery: (params: () => unknown) => {
		params();
		return { data: users.data };
	},
}));

const row = (id: string, status = 'connected', contactTarget = false) => ({
	mailbox: { id, address: `${id}@shop.test`, status, sendAs: [], lastSyncAt: null, connectedAt: null },
	readers: 2,
	senders: 1,
	contactTarget,
});

const setup = (
	overview: unknown = {
		configured: true,
		domain: 'shop.test',
		rows: [row('care', 'connected', true), row('old', 'disconnected')],
	},
	params: Record<string, string> = {},
) => {
	query.data = signal<unknown>(overview);
	users.data = signal<unknown>({
		items: [
			{ id: 'u1', displayName: 'Riya' },
			{ id: 'u2', email: 'arup@shop.test' },
			{ id: 'u3', username: 'packing' },
			{ id: 'u4' },
		],
	});
	const gateway = {
		connect: vi.fn(() => of({ url: 'https://accounts.test/o' })),
		access: vi.fn(() =>
			of([
				{ mailboxId: 'care', adminUserId: 'u1', canSend: true },
				{ mailboxId: 'care', adminUserId: 'u2', canSend: false },
			]),
		),
		saveAccess: vi.fn(() => of([])),
		setContactTarget: vi.fn(() => of({ mailboxId: null })),
		refresh: vi.fn(() => of({})),
		disconnect: vi.fn(() => of({})),
	};
	const client = { invalidateQueries: vi.fn() };
	const notifier = { showSuccess: vi.fn(), showError: vi.fn() };
	const modals = { open: vi.fn() };
	const router = { navigate: vi.fn() };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: MailboxGateway, useValue: gateway },
			{ provide: QueryClient, useValue: client },
			{ provide: NotificationService, useValue: notifier },
			{ provide: NgbModal, useValue: modals },
			{ provide: Router, useValue: router },
			{ provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(params) } } },
			{
				provide: TranslocoService,
				useValue: {
					translate: (key: string, values?: Record<string, string>) =>
						values ? `${key}:${JSON.stringify(values)}` : key,
				},
			},
		],
	});
	TestBed.overrideComponent(MailboxesSettings, { set: { imports: [], template: '' } });
	const page = TestBed.createComponent(MailboxesSettings).componentInstance;
	return { page, gateway, client, notifier, modals, router };
};

afterEach(() => vi.unstubAllGlobals());

describe('MailboxesSettings', () => {
	it('lists mailboxes, the Contact Us mailbox and only connected ones as choices', () => {
		const { page } = setup();
		expect(page.loading()).toBe(false);
		expect(page.configured()).toBe(true);
		expect(page.domain()).toBe('shop.test');
		expect(page.contactTarget()).toBe('care');
		expect(page.contactChoices()).toEqual([
			{ value: '', label: 'mailbox_contact_none' },
			{ value: 'care', label: 'care@shop.test' },
		]);
		expect(page.statusClass(row('a', 'connected') as never)).toBe('badge bg-success');
		expect(page.statusClass(row('a', 'needs_reconnect') as never)).toBe('badge bg-warning text-dark');
		expect(page.statusClass(row('a', 'disconnected') as never)).toBe('badge bg-secondary');
	});

	it('reads as set up and empty while loading', () => {
		const { page } = setup(null);
		expect(page.configured()).toBe(true);
		expect(page.rows()).toEqual([]);
		expect(page.domain()).toBe('');
		expect(page.contactTarget()).toBeNull();
	});

	it('greets a connected mailbox or explains a failed sign-in, then clears the address', () => {
		const connected = setup(null, { connected: 'care@shop.test' });
		expect(connected.notifier.showSuccess).toHaveBeenCalledWith('mailbox_connected:{"address":"care@shop.test"}');
		expect(connected.router.navigate).toHaveBeenCalledWith([], { queryParams: {}, replaceUrl: true });
		expect(setup(null, { error: 'not_on_domain' }).notifier.showError).toHaveBeenCalledWith(
			'mailbox_connect_not_on_domain',
		);
		expect(setup(null, { error: 'weird' }).notifier.showError).toHaveBeenCalledWith('mailbox_connect_failed');
		expect(setup().router.navigate).not.toHaveBeenCalled();
	});

	it("sends the browser to Google's sign-in, and recovers when the API refuses", async () => {
		const { page, gateway } = setup();
		const assign = vi.spyOn(page, 'openGoogle').mockImplementation(() => undefined);
		await page.connect();
		expect(assign).toHaveBeenCalledWith('https://accounts.test/o');
		gateway.connect.mockReturnValueOnce(throwError(() => new Error('503')) as never);
		await page.connect();
		expect(page.busy()).toBe(false);
	});

	it('leaves for the address it is given', () => {
		setup().page.openGoogle('#google-sign-in');
		expect(window.location.hash).toBe('#google-sign-in');
	});

	it('chooses where Contact Us messages go, and does nothing for the same choice', async () => {
		const { page, gateway, client } = setup();
		await page.chooseContact({ value: 'care' } as never);
		expect(gateway.setContactTarget).not.toHaveBeenCalled();
		await page.chooseContact({ value: '' } as never);
		expect(gateway.setContactTarget).toHaveBeenCalledWith(null);
		expect(client.invalidateQueries).toHaveBeenCalled();
	});

	it('refreshes aliases and disconnects after the confirmation', async () => {
		const { page, gateway, notifier } = setup();
		await page.refresh(row('care') as never);
		expect(gateway.refresh).toHaveBeenCalledWith('care');
		await page.disconnect({ data: row('care') });
		expect(gateway.disconnect).toHaveBeenCalledWith('care');
		expect(notifier.showSuccess).toHaveBeenLastCalledWith('mailbox_disconnected:{"address":"care@shop.test"}');
	});

	it('opens Access with every admin user, keeps Send within Read, and saves only readers', async () => {
		const { page, gateway, modals } = setup();
		await page.openAccess(row('care') as never, {} as never);
		expect(modals.open).toHaveBeenCalled();
		expect(page.accessLines().map((line) => [line.name, line.read, line.send])).toEqual([
			['Riya', true, true],
			['arup@shop.test', true, false],
			['packing', false, false],
			['u4', false, false],
		]);
		page.setAccess('u3', 'send', true);
		page.setAccess('u1', 'read', false);
		page.setAccess('u2', 'send', false);
		page.setAccess('u4', 'read', true);
		const modal = { close: vi.fn() };
		await page.saveAccess(modal as never);
		expect(gateway.saveAccess).toHaveBeenCalledWith('care', [
			{ adminUserId: 'u2', canSend: false },
			{ adminUserId: 'u3', canSend: true },
			{ adminUserId: 'u4', canSend: false },
		]);
		expect(modal.close).toHaveBeenCalled();
	});

	it('saves nothing without an open mailbox, and lists nobody before users load', async () => {
		const { page, gateway } = setup();
		await page.saveAccess({ close: vi.fn() } as never);
		expect(gateway.saveAccess).not.toHaveBeenCalled();
		const later = setup();
		(users.data as ReturnType<typeof signal<unknown>>).set(undefined);
		await later.page.openAccess(row('care') as never, {} as never);
		expect(later.page.accessLines()).toEqual([]);
	});
});
