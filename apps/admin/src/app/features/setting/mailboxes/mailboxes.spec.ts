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

const row = (id: string, status = 'connected', contactTarget = false) => ({
	mailbox: { id, address: `${id}@shop.test`, status, sendAs: [], lastSyncAt: null, connectedAt: null },
	readers: 2,
	senders: 1,
	contactTarget,
	needsReconnectFor: [] as string[],
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
	const person = (adminUserId: string, name: string) => ({ adminUserId, name, email: '', active: true });
	const gateway = {
		connect: vi.fn(() => of({ url: 'https://accounts.test/o' })),
		access: vi.fn(() =>
			of({
				version: 4,
				entries: [
					{ ...person('u1', 'Riya'), rights: ['read', 'send', 'organise', 'bin'] },
					{ ...person('u2', 'arup@shop.test'), rights: ['read'] },
				],
			}),
		),
		people: vi.fn(() =>
			of({ items: [person('u2', 'arup@shop.test'), person('u3', 'packing')], total: 2, page: 1, pageSize: 20 }),
		),
		withdrawAgain: vi.fn(() => of({ revocation: 'done' })),
		saveAccess: vi.fn(() => of({ version: 5, entries: [] })),
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

	it('opens Access with the server list, adds needed rights, and saves from the version read', async () => {
		const { page, gateway, modals } = setup();
		await page.openAccess(row('care') as never, {} as never);
		expect(modals.open).toHaveBeenCalled();
		expect(page.accessLines().map((line) => [line.name, line.rights.join('+')])).toEqual([
			['Riya', 'read+send+organise+bin'],
			['arup@shop.test', 'read'],
		]);
		page.addPerson({ adminUserId: 'u3', name: 'packing', email: '', active: true });
		page.addPerson({ adminUserId: 'u3', name: 'packing', email: '', active: true });
		page.setRight('u3', 'delete_forever', true);
		page.setRight('u1', 'bin', false);
		page.setRight('u2', 'read', false);
		const modal = { close: vi.fn() };
		await page.saveAccess(modal as never);
		expect(gateway.saveAccess).toHaveBeenCalledWith('care', 4, [
			{ adminUserId: 'u1', rights: ['read', 'send', 'organise'] },
			{ adminUserId: 'u3', rights: ['read', 'bin', 'delete_forever'] },
		]);
		expect(modal.close).toHaveBeenCalled();
	});

	it('keeps Save off until the list loads, and keeps edits when someone saved first', async () => {
		const { page, gateway } = setup();
		await page.saveAccess({ close: vi.fn() } as never);
		expect(gateway.saveAccess).not.toHaveBeenCalled();
		gateway.access.mockReturnValueOnce(throwError(() => ({ status: 500 })) as never);
		await page.openAccess(row('care') as never, {} as never);
		expect(page.accessState()).toBe('failed');
		expect(page.canSaveAccess()).toBe(false);
		await page.openAccess(row('care') as never, {} as never);
		page.removePerson('u2');
		gateway.saveAccess.mockReturnValueOnce(throwError(() => ({ status: 409 })) as never);
		const modal = { close: vi.fn() };
		await page.saveAccess(modal as never);
		expect(modal.close).not.toHaveBeenCalled();
		expect(page.accessTheirs()?.entries).toHaveLength(2);
		expect(page.accessLines()).toHaveLength(1);
		page.showTheirs();
		expect(page.accessLines()).toHaveLength(2);
	});
});
