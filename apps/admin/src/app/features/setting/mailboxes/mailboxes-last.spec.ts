import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { Subject, of, throwError } from 'rxjs';
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

describe('MailboxesSettings: the last cases', () => {
	it('marks a mailbox whose access Google did not withdraw', () => {
		const { page } = setup();
		const failed = {
			...row('a', 'disconnected'),
			mailbox: { ...row('a', 'disconnected').mailbox, revocation: 'failed' },
		};
		expect(page.statusClass(failed as never)).toBe('badge bg-danger');
	});

	it('searches people after a pause, pages from 1 up, and says when the newest search fails', async () => {
		vi.useFakeTimers();
		try {
			const { page, gateway } = setup();
			await page.openAccess(row('care') as never, {} as never);
			expect(page.isListed('u1')).toBe(true);
			expect(page.isListed('u9')).toBe(false);
			const before = gateway.people.mock.calls.length;
			page.searchPeople('ar');
			page.searchPeople('aru');
			await vi.advanceTimersByTimeAsync(250);
			expect(gateway.people).toHaveBeenCalledTimes(before + 1);
			expect(gateway.people).toHaveBeenLastCalledWith('aru', 1);
			page.pagePeople(1);
			expect(gateway.people).toHaveBeenLastCalledWith('aru', 2);
			page.pagePeople(-1);
			page.pagePeople(-1);
			expect(gateway.people).toHaveBeenLastCalledWith('aru', 1);
			gateway.people.mockReturnValueOnce(throwError(() => new Error('down')) as never);
			await page.findPeople();
			expect(page.peopleFailed()).toBe(true);
		} finally {
			vi.useRealTimers();
		}
	});

	it('an older search answering or failing after a newer one leaves the newer answer', async () => {
		const { page, gateway } = setup();
		const slow = new Subject<unknown>();
		gateway.people.mockReturnValueOnce(slow as never);
		const old = page.findPeople();
		await page.findPeople();
		slow.next({ items: [], total: 0, page: 1, pageSize: 20 });
		slow.complete();
		await old;
		expect(page.people()?.total).toBe(2);
		const failing = new Subject<unknown>();
		gateway.people.mockReturnValueOnce(failing as never);
		const older = page.findPeople();
		await page.findPeople();
		failing.error(new Error('late'));
		await older;
		expect(page.peopleFailed()).toBe(false);
	});

	it('shows nobody else’s list when there is none, and says when the list cannot be read after a clash', async () => {
		const { page, gateway, notifier } = setup();
		page.showTheirs();
		expect(page.accessLines()).toEqual([]);
		await page.openAccess(row('care') as never, {} as never);
		gateway.saveAccess.mockReturnValueOnce(throwError(() => ({ status: 409 })) as never);
		gateway.access.mockReturnValueOnce(throwError(() => ({ status: 500 })) as never);
		await page.saveAccess({ close: vi.fn() } as never);
		expect(page.accessState()).toBe('failed');
		await page.openAccess(row('care') as never, {} as never);
		gateway.saveAccess.mockReturnValueOnce(throwError(() => ({ status: 500 })) as never);
		await page.saveAccess({ close: vi.fn() } as never);
		expect(notifier.showError).toHaveBeenCalledWith('mailbox_access_not_saved');
	});

	it('withdraws access again, and says when Google still did not confirm', async () => {
		const { page, gateway, notifier, client } = setup();
		await page.withdrawAgain(row('old', 'disconnected') as never);
		expect(gateway.withdrawAgain).toHaveBeenCalledWith('old');
		expect(notifier.showSuccess).toHaveBeenCalledWith('mailbox_withdrawn');
		gateway.withdrawAgain.mockReturnValueOnce(of({ revocation: 'failed' }) as never);
		await page.withdrawAgain(row('old', 'disconnected') as never);
		expect(notifier.showError).toHaveBeenCalledWith('mailbox_withdraw_failed');
		expect(client.invalidateQueries).toHaveBeenCalled();
	});

	it('names what reconnecting turns on', () => {
		const { page } = setup();
		const needs = { ...row('a'), needsReconnectFor: ['delete_forever', 'settings'] };
		expect(page.reconnectFor(needs as never)).toBe('mailbox_right_delete_forever, mailbox_right_settings');
	});
});
