import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PurchasingGateway } from '@core/purchasing/purchasing.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';

import { OrderList, toOrderRow, type OrderTableRow } from './order-list';
import { OrderSend } from './order-send';

import type { PurchaseOrder } from '@saha-textile/contracts';

const h = vi.hoisted(() => ({
	page: undefined as unknown,
	query: null as null | (() => unknown),
	mailboxes: undefined as unknown,
	brand: undefined as unknown,
	saved: [] as string[],
}));
vi.mock('@core/purchasing/purchasing.gateway', async (original) => ({
	...(await original<typeof import('@core/purchasing/purchasing.gateway')>()),
	injectOrdersQuery: (query: () => unknown) => {
		h.query = query;
		return { data: () => h.page };
	},
}));
vi.mock('@core/mailboxes/mailbox.gateway', async (original) => ({
	...(await original<typeof import('@core/mailboxes/mailbox.gateway')>()),
	injectInboxSummaryQuery: () => ({ data: () => h.mailboxes }),
}));
vi.mock('@core/brand/brand.gateway', async (original) => ({
	...(await original<typeof import('@core/brand/brand.gateway')>()),
	injectBrandQuery: () => ({ data: () => h.brand }),
}));
vi.mock('@core/purchasing/purchasing-format', async (original) => ({
	...(await original<typeof import('@core/purchasing/purchasing-format')>()),
	saveBlob: (name: string) => void h.saved.push(name),
}));

const t = (key: string, params?: Record<string, unknown>) => (params ? `${key}:${JSON.stringify(params)}` : key);
const transloco = { translate: t, getActiveLang: () => 'en', getTranslation: () => ({}) };

const order = (over: Partial<PurchaseOrder> = {}): PurchaseOrder =>
	({
		id: 'po_3',
		number: 'PO/26-27/000003',
		status: 'draft',
		supplierName: 'Shantipur Tant Ghar',
		expectedBy: '2026-11-12',
		sentAt: null,
		createdAt: '2026-11-01T05:00:00.000Z',
		late: false,
		orderedValueINR: 42000,
		lines: [{ quantity: 10, receivedQuantity: 0, soldBy: 'piece' }],
		...over,
	}) as PurchaseOrder;

afterEach(() => {
	h.page = undefined;
	h.mailboxes = undefined;
	h.brand = undefined;
	h.saved = [];
});

describe('Purchases › Purchase orders: the list (po01), last cases', () => {
	function list(options: { permissions?: string[]; gateway?: object } = {}) {
		const router = { navigate: vi.fn() };
		const notifier = { showError: vi.fn(), showSuccess: vi.fn() };
		const gateway = {
			copyOrder: vi.fn(() => of({ id: 'po_9', number: 'PO/26-27/000009' })),
			orderPdf: vi.fn(() => of(new Blob(['%PDF']))),
			...options.gateway,
		};
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				{ provide: Router, useValue: router },
				{ provide: PurchasingGateway, useValue: gateway },
				{ provide: NotificationService, useValue: notifier },
				{ provide: TranslocoService, useValue: transloco },
				{
					provide: AuthStore,
					useValue: { permissions: signal(options.permissions ?? ['purchase_order.create']) },
				},
			],
		});
		TestBed.overrideComponent(OrderList, { set: { imports: [], template: '' } });
		const fixture = TestBed.createComponent(OrderList);
		fixture.detectChanges();
		return { page: fixture.componentInstance, router, notifier, gateway };
	}
	const row = (status: string) =>
		({ id: 'po_3', status, number: '<h6 class="mb-0">PO/26-27/000003</h6>' }) as OrderTableRow;

	it('an order not yet sent is dated by when it was made, with no late badge', () => {
		const drawn = toOrderRow(order(), '2026-11-15', t, (key, n) => `${key}:${n}`);
		expect(drawn.expectedBy).not.toContain('badge');
		expect(drawn.orderedOn).toEqual(expect.any(String));
	});

	it('an empty list, then each order drawn; filters go back to page one and keep the table’s search', () => {
		const empty = list();
		expect([empty.page.counts(), empty.page.tableConfig().data, empty.page.tableConfig().total]).toEqual([
			{},
			[],
			0,
		]);
		h.page = { items: [order({ late: true, status: 'sent' })], total: 1, counts: { all: 1 } };
		const { page } = list();
		expect([page.counts(), page.tableConfig().data[0]?.id, page.tableConfig().total]).toEqual([
			{ all: 1 },
			'po_3',
			1,
		]);
		page.onTableChange({ page: 2, search: 'tant' });
		expect(h.query?.()).toMatchObject({ filter: 'all', page: 2, q: 'tant' });
		page.onTableChange();
		const table = { tableData: { page: 5 } as Record<string, unknown> };
		Object.defineProperty(page, 'table', { value: () => table });
		page.setFilter('late');
		expect([table.tableData['page'], page.filter()]).toEqual([1, 'late']);
		Object.defineProperty(page, 'table', { value: () => undefined });
		page.setFilter('sent');
		expect(h.query?.()).toMatchObject({ filter: 'sent', page: 1 });
	});

	it('opens a draft in the form for an editor, and every other order on its page', () => {
		const editor = list();
		editor.page.open(row('draft'));
		editor.page.open(row('sent'));
		const reader = list({ permissions: [] });
		reader.page.open(row('draft'));
		expect(
			[...editor.router.navigate.mock.calls, ...reader.router.navigate.mock.calls].map((call) => call[0]),
		).toEqual([
			['/purchase-orders', 'po_3', 'edit'],
			['/purchase-orders', 'po_3'],
			['/purchase-orders', 'po_3'],
		]);
	});

	it('row actions: view, copy as a new draft, the PDF, and why either could not be done', async () => {
		const { page, router, notifier, gateway } = list();
		page.onAction({ actionToPerform: 'view', data: undefined } as never);
		page.onAction({ actionToPerform: 'view', data: row('sent') } as never);
		page.onAction({ actionToPerform: 'other', data: row('sent') } as never);
		page.onAction({ actionToPerform: 'copy', data: row('sent') } as never);
		page.onAction({ actionToPerform: 'pdf', data: row('sent') } as never);
		await vi.waitFor(() => expect(h.saved).toEqual(['PO-26-27-000003.pdf']));
		expect(notifier.showSuccess).toHaveBeenCalledWith('po_copied:{"number":"PO/26-27/000009"}');
		expect(router.navigate.mock.calls.map((call) => call[0])).toEqual([
			['/purchase-orders', 'po_3'],
			['/purchase-orders', 'po_9', 'edit'],
		]);
		gateway.copyOrder.mockReturnValueOnce(throwError(() => new Error('down')));
		gateway.orderPdf.mockReturnValueOnce(throwError(() => new Error('down')));
		await page.copy(row('sent'));
		await page.pdf(row('sent'));
		expect(notifier.showError).toHaveBeenCalledTimes(2);
	});
});

describe('Send to the supplier (po03), last cases', () => {
	function send(gateway: object = {}) {
		const close = vi.fn();
		const calls = {
			orderPdf: vi.fn(() => of(new Blob(['%PDF']))),
			sendOrder: vi.fn((_id: string, _body: unknown) => of(order({ status: 'sent' }))),
			...gateway,
		};
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				{ provide: NgbActiveModal, useValue: { close, dismiss: vi.fn() } },
				{ provide: PurchasingGateway, useValue: calls },
				{ provide: TranslocoService, useValue: transloco },
			],
		});
		TestBed.overrideComponent(OrderSend, { set: { imports: [], template: '' } });
		return { popup: TestBed.createComponent(OrderSend).componentInstance, close, calls };
	}

	it('with no mailbox and no shop name: plain words, no sender, and a PDF named for no order yet', async () => {
		const { popup, calls } = send();
		expect(popup.senders()).toEqual([]);
		expect(popup.fileName()).toBe('order.pdf');
		await popup.send();
		expect(calls.sendOrder).not.toHaveBeenCalled();
		popup.start(order(), null);
		expect([popup.to(), popup.from()]).toEqual(['', '']);
		expect(popup.subject()).toMatch(/^po_email_subject_plain/);
		expect(popup.message()).toMatch(/^po_email_body_plain/);
		popup.ensureFrom();
		expect(popup.canSend()).toBe(false);
	});

	it('lists connected senders and their aliases, picks the first even when the list arrives late', () => {
		h.brand = { shopName: '  Saha Textile ' };
		h.mailboxes = [
			{ mailboxId: 'mb_1', address: 'orders@x.test', canSend: true, status: 'connected', sendAs: [] },
			{
				mailboxId: 'mb_2',
				address: 'care@x.test',
				canSend: true,
				status: 'connected',
				sendAs: [
					{ address: 'care@x.test', displayName: 'Customer care', isPrimary: true, signature: '' },
					{ address: 'alias@x.test', displayName: '', isPrimary: false, signature: '' },
				],
			},
			{ mailboxId: 'mb_3', address: 'off@x.test', canSend: false, status: 'connected', sendAs: [] },
			{ mailboxId: 'mb_4', address: 'gone@x.test', canSend: true, status: 'needs_reconnect', sendAs: [] },
		];
		const { popup } = send();
		expect(popup.senders().map((sender) => sender.label)).toEqual([
			'orders@x.test',
			'Customer care <care@x.test>',
			'alias@x.test',
		]);
		popup.start(order(), 'a@x.test; b@x.test');
		expect(popup.from()).toBe('mb_1|orders@x.test');
		expect(popup.subject()).toMatch(/^po_email_subject:/);
		popup.from.set('');
		popup.ensureFrom();
		expect(popup.from()).toBe('mb_1|orders@x.test');
		popup.ensureFrom();
		popup.to.set('a@x.test, not-an-address');
		expect(popup.badRecipients()).toEqual(['not-an-address']);
		expect(popup.canSend()).toBe(false);
		popup.busy.set(true);
		expect(popup.canSend()).toBe(false);
	});

	it('sends by email from the chosen mailbox, or downloads the PDF and marks it sent', async () => {
		h.mailboxes = [{ mailboxId: 'mb_1', address: 'orders@x.test', canSend: true, status: 'connected', sendAs: [] }];
		const { popup, calls, close } = send();
		popup.start(
			order({
				number: 'PO/1',
				lines: [{ quantity: 1200, receivedQuantity: 0, soldBy: 'metre' }] as never,
			}),
			'a@x.test',
		);
		popup.subject.set(' Order PO/1 ');
		popup.message.set(' Please send ');
		await popup.send();
		expect(calls.sendOrder).toHaveBeenCalledWith('po_3', {
			via: 'email',
			mailboxId: 'mb_1',
			from: 'orders@x.test',
			to: ['a@x.test'],
			subject: 'Order PO/1',
			message: 'Please send',
		});
		popup.via.set('pdf');
		expect(popup.canSend()).toBe(true);
		await popup.send();
		expect(h.saved).toEqual(['PO-1.pdf']);
		expect(calls.sendOrder).toHaveBeenLastCalledWith('po_3', { via: 'pdf', to: [], subject: '', message: '' });
		expect(close).toHaveBeenCalledTimes(2);
	});

	it('shows why sending was refused, field by field', async () => {
		const refusal = {
			error: {
				issues: [
					{ code: 'bad_to', message: 'Not an address', path: ['request', 'to'] },
					{ code: 'x', message: 'Other' },
				],
			},
		};
		h.mailboxes = [{ mailboxId: 'mb_1', address: 'orders@x.test', canSend: true, status: 'connected', sendAs: [] }];
		const { popup } = send({ sendOrder: vi.fn(() => throwError(() => refusal)) });
		popup.start(order(), 'a@x.test');
		await popup.send();
		expect([popup.fieldErrors(), popup.error(), popup.busy()]).toEqual([
			{ to: 'Not an address' },
			'Not an address',
			false,
		]);
	});
});
