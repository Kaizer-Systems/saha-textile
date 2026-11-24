import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PurchasingGateway } from '@core/purchasing/purchasing.gateway';
import { NotificationService } from '@data-access/services/notification.service';

import { OrderView, orderStep } from './order-view';

const current = signal<unknown>(undefined);
const h = vi.hoisted(() => ({
	queries: [] as Array<() => { queryKey: unknown[]; queryFn: () => unknown; enabled: boolean }>,
	saved: [] as string[],
	done: true,
}));
vi.mock('@tanstack/angular-query-experimental', async (original) => ({
	...(await original<typeof import('@tanstack/angular-query-experimental')>()),
	injectQuery: (options: () => { queryKey: unknown[]; queryFn: () => unknown; enabled: boolean }) => {
		h.queries.push(options);
		return { data: () => (options().queryKey[1] === 'one' ? current() : undefined) };
	},
}));
vi.mock('@core/purchasing/purchasing-format', async (original) => ({
	...(await original<typeof import('@core/purchasing/purchasing-format')>()),
	saveBlob: (name: string) => void h.saved.push(name),
}));
vi.mock('../shared/popups', () => ({
	askReason: async (_modals: unknown, ask: { act: (reason: string) => Promise<unknown> }) => {
		await ask.act('Supplier stopped weaving it');
		return h.done;
	},
}));

const t = (key: string, params?: Record<string, unknown>) => (params ? `${key}:${JSON.stringify(params)}` : key);

const line = (quantity: number, receivedQuantity: number, receivedOn: unknown[] = [], soldBy = 'piece') => ({
	quantity,
	receivedQuantity,
	soldBy,
	receivedOn,
});
const order = (over: Record<string, unknown> = {}) => ({
	id: 'po_3',
	number: 'PO/26-27/000003',
	supplierId: 'sup_1',
	status: 'part_received',
	expectedBy: '2026-11-01',
	sentAt: '2026-10-20T05:00:00.000Z',
	late: true,
	lines: [
		line(10, 6, [
			{ entryId: 'pe_1', number: 'PE/1' },
			{ entryId: 'pe_2', number: null },
		]),
		line(1200, 0, [{ entryId: 'pe_1', number: 'PE/1' }], 'metre'),
	],
	...over,
});

function view(options: { id?: string | null; results?: unknown[]; gateway?: object } = {}) {
	const results = [...(options.results ?? [])];
	const instance = { start: vi.fn() };
	const modals = {
		open: vi.fn(() => {
			const next = results.shift();
			const result = next ? Promise.resolve(next) : Promise.reject(new Error('closed'));
			result.catch(() => undefined);
			return { componentInstance: instance, result };
		}),
	};
	const gateway = {
		order: vi.fn(() => of(order())),
		orderActivity: vi.fn(() => of([])),
		supplier: vi.fn(() => of({ email: 'orders@tant.test' })),
		orderPdf: vi.fn(() => of(new Blob(['%PDF']))),
		closeOrder: vi.fn(() => of({})),
		cancelOrder: vi.fn(() => of({})),
		copyOrder: vi.fn(() => of({ id: 'po_9', number: 'PO/26-27/000009' })),
		...options.gateway,
	};
	const router = { navigate: vi.fn() };
	const notifier = { showError: vi.fn(), showSuccess: vi.fn() };
	const queries = { invalidateQueries: vi.fn(async () => undefined) };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{
				provide: ActivatedRoute,
				useValue: {
					snapshot: { paramMap: convertToParamMap(options.id === null ? {} : { id: options.id ?? 'po_3' }) },
				},
			},
			{ provide: Router, useValue: router },
			{ provide: PurchasingGateway, useValue: gateway },
			{ provide: NgbModal, useValue: modals },
			{ provide: NotificationService, useValue: notifier },
			{ provide: TranslocoService, useValue: { translate: t } },
			{ provide: QueryClient, useValue: queries },
		],
	});
	TestBed.overrideComponent(OrderView, { set: { imports: [], template: '' } });
	const page = TestBed.createComponent(OrderView).componentInstance;
	return { page, gateway, modals, instance, router, notifier, queries };
}

afterEach(() => {
	current.set(undefined);
	h.queries = [];
	h.saved = [];
	h.done = true;
});

describe('a purchase order’s page (po04): the last cases', () => {
	it('a cancelled order that was never sent sits before the first step', () => {
		expect(orderStep({ status: 'cancelled', sentAt: null, lines: [line(1, 0)] } as never)).toBe(0);
		expect(orderStep({ status: 'cancelled', sentAt: '2026-11-01', lines: [line(1, 0)] } as never)).toBe(1);
		expect(orderStep({ status: 'closed_short', sentAt: '2026-11-01', lines: [line(2, 1)] } as never)).toBe(2);
		expect(['draft', 'sent', 'received'].map((status) => orderStep({ status, lines: [] } as never))).toEqual([
			0, 1, 3,
		]);
	});

	it('before the order arrives: nothing to show, and every action waits for it', async () => {
		const { page, gateway, modals } = view({ id: null });
		expect(page.id()).toBe('');
		expect([page.order(), page.step(), page.closed(), page.shortUnits(), page.daysLate()]).toEqual([
			null,
			0,
			false,
			0,
			0,
		]);
		expect([page.entries(), page.canReceive(), page.canCancel(), page.canClose()]).toEqual([
			[],
			false,
			false,
			false,
		]);
		expect(page.totals()).toEqual({ ordered: '0', received: '0', toCome: '0' });
		await page.send();
		await page.pdf();
		await page.closeShort();
		await page.cancelOrder();
		expect(modals.open).not.toHaveBeenCalled();
		expect(gateway.orderPdf).not.toHaveBeenCalled();
		const [one, activity] = h.queries as Array<() => { enabled: boolean }>;
		expect([one?.().enabled, activity?.().enabled]).toEqual([false, false]);
	});

	it('asks for the order, and for its activity only on that tab', async () => {
		const { page, gateway } = view();
		const [one, activity] = h.queries;
		await one?.().queryFn();
		expect(gateway.order).toHaveBeenCalledWith('po_3');
		expect(activity?.().enabled).toBe(false);
		page.tab.set('activity');
		expect(activity?.().enabled).toBe(true);
		await activity?.().queryFn();
		expect(gateway.orderActivity).toHaveBeenCalledWith('po_3');
	});

	it('a part-received order: what is still to come, the entries that brought it, and closing it short', async () => {
		current.set(order());
		const { page, notifier, queries, gateway } = view();
		expect([
			page.step(),
			page.closed(),
			page.shortUnits(),
			page.canReceive(),
			page.canClose(),
			page.canCancel(),
		]).toEqual([2, false, 1204, true, true, false]);
		expect(page.daysLate()).toBeGreaterThan(0);
		expect(page.entries()).toEqual([
			{ id: 'pe_1', number: 'PE/1' },
			{ id: 'pe_2', number: 'pe_2' },
		]);
		expect(page.totals().toCome).toBe(page.shortText());
		expect(page.still(line(3, 5) as never)).toBe(0);
		await page.closeShort();
		expect(gateway.closeOrder).toHaveBeenCalledWith('po_3', 'Supplier stopped weaving it');
		expect(notifier.showSuccess).toHaveBeenCalledWith('po_closed:{"number":"PO/26-27/000003"}');
		expect(queries.invalidateQueries).toHaveBeenCalledTimes(1);
		h.done = false;
		await page.closeShort();
		expect(notifier.showSuccess).toHaveBeenCalledTimes(1);
	});

	it('a draft can be cancelled; a closed one is shown as such and is not late', async () => {
		current.set(order({ status: 'draft', late: false, lines: [line(4, 0)] }));
		const { page, notifier, gateway } = view();
		expect([page.canCancel(), page.daysLate(), page.canClose()]).toEqual([true, 0, false]);
		await page.cancelOrder();
		expect(gateway.cancelOrder).toHaveBeenCalledWith('po_3', 'Supplier stopped weaving it');
		expect(notifier.showSuccess).toHaveBeenCalledWith('po_cancelled:{"number":"PO/26-27/000003"}');
		h.done = false;
		await page.cancelOrder();
		expect(notifier.showSuccess).toHaveBeenCalledTimes(1);
		current.set(order({ status: 'closed_short' }));
		expect(page.closed()).toBe(true);
	});

	it('Edit, Receive goods, the PDF, and Copy as new draft', async () => {
		current.set(order());
		const { page, router, notifier, gateway } = view();
		page.edit();
		page.receive();
		await page.pdf();
		await page.copy();
		expect(h.saved).toEqual(['PO-26-27-000003.pdf']);
		expect(router.navigate.mock.calls).toEqual([
			[['/purchase-orders', 'po_3', 'edit']],
			[['/purchase-entries', 'create'], { queryParams: { order: 'po_3' } }],
			[['/purchase-orders', 'po_9', 'edit']],
		]);
		gateway.orderPdf.mockReturnValueOnce(throwError(() => new Error('down')));
		gateway.copyOrder.mockReturnValueOnce(throwError(() => new Error('down')));
		await page.pdf();
		await page.copy();
		expect(notifier.showError).toHaveBeenCalledTimes(2);
	});

	it('Send: the supplier’s address when it can be read, nothing done when the popup is closed', async () => {
		current.set(order({ status: 'draft' }));
		const { page, instance, notifier, queries } = view({
			results: [undefined, order({ status: 'sent', number: 'PO/3' })],
			gateway: {
				supplier: vi
					.fn()
					.mockReturnValueOnce(throwError(() => new Error('gone')))
					.mockReturnValueOnce(of({ email: 'orders@tant.test' })),
			},
		});
		await page.send();
		expect(instance.start).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'po_3' }), null);
		expect(notifier.showSuccess).not.toHaveBeenCalled();
		await page.send();
		expect(instance.start).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'po_3' }), 'orders@tant.test');
		expect(notifier.showSuccess).toHaveBeenCalledWith('po_sent:{"number":"PO/3"}');
		expect(queries.invalidateQueries).toHaveBeenCalled();
	});
});
